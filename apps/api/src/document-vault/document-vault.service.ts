import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class DocumentVaultService {
    private s3Client: S3Client;
    private readonly logger = new Logger(DocumentVaultService.name);
    private bucketName = process.env.AWS_S3_BUCKET_NAME || 'microloan-documents';

    constructor(
        private prisma: PrismaService,
        private audit: AuditService,
    ) {
        this.s3Client = new S3Client({
            region: process.env.AWS_REGION || 'us-east-1',
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
            },
        });
    }

    async uploadDocument(tenantId: string, loanId: string, actorId: string, file: Express.Multer.File) {
        const loan = await this.prisma.loan.findFirst({ where: { id: loanId, tenantId } });
        if (!loan) throw new NotFoundException('Loan not found');

        // ── File type allowlist (OWASP: reject unknown/dangerous types) ─────────────
        const ALLOWED_MIME_TYPES = new Set([
            'application/pdf',
            'image/jpeg',
            'image/png',
            'image/webp',
        ]);
        if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
            throw new BadRequestException(
                `File type '${file.mimetype}' is not allowed. Accepted types: PDF, JPEG, PNG, WebP.`
            );
        }

        const key = `tenants/${tenantId}/loans/${loanId}/${Date.now()}_${file.originalname}`;

        try {
            await this.s3Client.send(new PutObjectCommand({
                Bucket: this.bucketName,
                Key: key,
                Body: file.buffer,
                ContentType: file.mimetype,
            }));
        } catch (error) {
            this.logger.error('Failed to upload document to S3', error);
            // Fallback to storing as base64 in DB if S3 fails or is unconfigured
            const document = await this.prisma.document.create({
                data: {
                    tenantId,
                    loanId,
                    name: file.originalname,
                    content: 'DB_OVERFLOW:' + file.buffer.toString('base64'),
                    type: file.mimetype,
                }
            });

            await this.audit.logAction(tenantId, actorId, 'CREATE', 'Document', document.id, { event: 'DOCUMENT_UPLOADED_FALLBACK' });
            return document;
        }

        const document = await this.prisma.document.create({
            data: {
                tenantId,
                loanId,
                name: file.originalname,
                content: key, // Store the S3 Key in the content field
                type: file.mimetype,
            }
        });

        await this.audit.logAction(tenantId, actorId, 'CREATE', 'Document', document.id, { event: 'DOCUMENT_UPLOADED_S3' });
        return document;
    }

    async getDocuments(tenantId: string, loanId: string) {
        return this.prisma.document.findMany({
            where: { tenantId, loanId },
            select: { id: true, name: true, type: true, createdAt: true },
        });
    }

    async downloadDocument(tenantId: string, id: string, actorId: string) {
        const document = await this.prisma.document.findFirst({ where: { id, tenantId } });
        if (!document) throw new NotFoundException('Document not found');

        await this.audit.logAction(tenantId, actorId, 'READ', 'Document', id, { event: 'DOCUMENT_DOWNLOADED' });

        if (document.content.startsWith('DB_OVERFLOW:')) {
            const base64 = document.content.replace('DB_OVERFLOW:', '');
            const buffer = Buffer.from(base64, 'base64');
            return { type: 'buffer', data: buffer, mimetype: document.type, name: document.name };
        }

        // Generate Presigned URL for S3 content
        try {
            const command = new GetObjectCommand({
                Bucket: this.bucketName,
                Key: document.content,
            });
            const url = await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
            return { type: 'url', url, name: document.name };
        } catch (error) {
            this.logger.error('Failed to generate presigned URL', error);
            throw new BadRequestException('Failed to retrieve document from storage');
        }
    }
}
