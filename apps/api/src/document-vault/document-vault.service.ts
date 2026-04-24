import { Injectable, BadRequestException, NotFoundException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { JwtPayload } from '../auth/jwt.strategy';
import { AuthzService } from '../authz/authz.service';
import { Permission } from '../authz/permission.enum';

@Injectable()
export class DocumentVaultService {
    private s3Client: S3Client;
    private readonly logger = new Logger(DocumentVaultService.name);
    private bucketName = process.env.AWS_S3_BUCKET_NAME || 'microloan-documents';
    // Fix 6: S3 is required — no silent DB fallback
    private s3Configured = !!(
        process.env.AWS_ACCESS_KEY_ID &&
        process.env.AWS_SECRET_ACCESS_KEY &&
        process.env.AWS_S3_BUCKET_NAME
    );

    constructor(
        private prisma: PrismaService,
        private audit: AuditService,
        private authz: AuthzService,
    ) {
        this.s3Client = new S3Client({
            region: process.env.AWS_REGION || 'us-east-1',
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
            },
        });
    }

    async uploadDocument(actor: JwtPayload, loanId: string, file: Express.Multer.File) {
        this.authz.assertPermission(actor, Permission.DOCUMENT_UPLOAD);
        // Fix 6: Require S3 — no silent DB fallback that bloats the database with Base64
        if (!this.s3Configured) {
            throw new ServiceUnavailableException(
                'Document storage (S3) is not configured on this server. Please contact your administrator.'
            );
        }

        const loan = await this.prisma.loan.findFirst({ where: this.authz.scopeWhere(actor, { id: loanId }) });
        if (!loan) throw new NotFoundException('Loan not found');
        this.authz.assertBranchAccess(actor, loan.branchId);

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

        const key = `tenants/${loan.tenantId}/loans/${loanId}/${Date.now()}_${file.originalname}`;

        try {
            await this.s3Client.send(new PutObjectCommand({
                Bucket: this.bucketName,
                Key: key,
                Body: file.buffer,
                ContentType: file.mimetype,
            }));
        } catch (error) {
            this.logger.error('Failed to upload document to S3', error);
            // Fix 6: Surface the error — do NOT fall back to DB storage
            throw new ServiceUnavailableException('Document upload failed. Please try again or contact support.');
        }

        const document = await this.prisma.document.create({
            data: {
                tenantId: loan.tenantId,
                loanId,
                name: file.originalname,
                content: key, // Store the S3 key only — never raw file content in DB
                type: file.mimetype,
            }
        });

        await this.audit.logSecurityEvent({
            actorUserId: this.authz.actorId(actor),
            actorRole: actor.role,
            actorTenantId: actor.tenantId,
            targetType: 'Document',
            targetId: document.id,
            action: 'DOCUMENT_UPLOAD',
            result: 'SUCCESS',
        });
        return document;
    }

    async getDocuments(actor: JwtPayload, loanId: string) {
        this.authz.assertPermission(actor, Permission.DOCUMENT_VIEW);
        const loan = await this.prisma.loan.findFirst({ where: this.authz.scopeWhere(actor, { id: loanId }) });
        if (!loan) throw new NotFoundException('Loan not found');
        this.authz.assertBranchAccess(actor, loan.branchId);
        return this.prisma.document.findMany({
            where: { tenantId: loan.tenantId, loanId },
            select: { id: true, name: true, type: true, createdAt: true },
        });
    }

    async downloadDocument(actor: JwtPayload, id: string) {
        this.authz.assertPermission(actor, Permission.DOCUMENT_VIEW);
        const document = await this.prisma.document.findFirst({
            where: this.authz.scopeWhere(actor, { id }),
            include: { loan: true },
        });
        if (!document) throw new NotFoundException('Document not found');
        this.authz.assertBranchAccess(actor, document.loan.branchId);

        await this.audit.logSecurityEvent({
            actorUserId: this.authz.actorId(actor),
            actorRole: actor.role,
            actorTenantId: actor.tenantId,
            targetType: 'Document',
            targetId: id,
            action: 'DOCUMENT_DOWNLOAD',
            result: 'SUCCESS',
        });

        // Fix 6: Legacy DB_OVERFLOW records cannot be served — require re-upload
        if (document.content.startsWith('DB_OVERFLOW:')) {
            throw new ServiceUnavailableException(
                'This document was stored in a legacy format and cannot be retrieved. Please re-upload it.'
            );
        }

        try {
            const command = new GetObjectCommand({
                Bucket: this.bucketName,
                Key: document.content,
            });
            const url = await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
            return { type: 'url', url, name: document.name };
        } catch (error) {
            this.logger.error('Failed to generate presigned URL', error);
            throw new ServiceUnavailableException('Failed to retrieve document from storage. Please contact support.');
        }
    }

    // Fix 6: Delete document from S3 and DB atomically
    async deleteDocument(actor: JwtPayload, id: string) {
        this.authz.assertPermission(actor, Permission.DOCUMENT_DELETE);
        const document = await this.prisma.document.findFirst({
            where: this.authz.scopeWhere(actor, { id }),
            include: { loan: true },
        });
        if (!document) throw new NotFoundException('Document not found');
        this.authz.assertBranchAccess(actor, document.loan.branchId);

        // Attempt S3 deletion (non-fatal if object is already gone)
        if (this.s3Configured && !document.content.startsWith('DB_OVERFLOW:')) {
            try {
                await this.s3Client.send(new DeleteObjectCommand({
                    Bucket: this.bucketName,
                    Key: document.content,
                }));
            } catch (error) {
                this.logger.warn(`Could not delete S3 object key=${document.content}: ${error}`);
            }
        }

        await this.prisma.document.delete({ where: { id } });
        await this.audit.logSecurityEvent({
            actorUserId: this.authz.actorId(actor),
            actorRole: actor.role,
            actorTenantId: actor.tenantId,
            targetType: 'Document',
            targetId: id,
            action: 'DOCUMENT_DELETE',
            result: 'SUCCESS',
        });
        return { success: true };
    }
}
