"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var DocumentVaultService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentVaultService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const audit_service_1 = require("../audit/audit.service");
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
let DocumentVaultService = DocumentVaultService_1 = class DocumentVaultService {
    prisma;
    audit;
    s3Client;
    logger = new common_1.Logger(DocumentVaultService_1.name);
    bucketName = process.env.AWS_S3_BUCKET_NAME || 'microloan-documents';
    constructor(prisma, audit) {
        this.prisma = prisma;
        this.audit = audit;
        this.s3Client = new client_s3_1.S3Client({
            region: process.env.AWS_REGION || 'us-east-1',
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
            },
        });
    }
    async uploadDocument(tenantId, loanId, actorId, file) {
        const loan = await this.prisma.loan.findFirst({ where: { id: loanId, tenantId } });
        if (!loan)
            throw new common_1.NotFoundException('Loan not found');
        const key = `tenants/${tenantId}/loans/${loanId}/${Date.now()}_${file.originalname}`;
        try {
            await this.s3Client.send(new client_s3_1.PutObjectCommand({
                Bucket: this.bucketName,
                Key: key,
                Body: file.buffer,
                ContentType: file.mimetype,
            }));
        }
        catch (error) {
            this.logger.error('Failed to upload document to S3', error);
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
                content: key,
                type: file.mimetype,
            }
        });
        await this.audit.logAction(tenantId, actorId, 'CREATE', 'Document', document.id, { event: 'DOCUMENT_UPLOADED_S3' });
        return document;
    }
    async getDocuments(tenantId, loanId) {
        return this.prisma.document.findMany({
            where: { tenantId, loanId },
            select: { id: true, name: true, type: true, createdAt: true },
        });
    }
    async downloadDocument(tenantId, id, actorId) {
        const document = await this.prisma.document.findFirst({ where: { id, tenantId } });
        if (!document)
            throw new common_1.NotFoundException('Document not found');
        await this.audit.logAction(tenantId, actorId, 'READ', 'Document', id, { event: 'DOCUMENT_DOWNLOADED' });
        if (document.content.startsWith('DB_OVERFLOW:')) {
            const base64 = document.content.replace('DB_OVERFLOW:', '');
            const buffer = Buffer.from(base64, 'base64');
            return { type: 'buffer', data: buffer, mimetype: document.type, name: document.name };
        }
        try {
            const command = new client_s3_1.GetObjectCommand({
                Bucket: this.bucketName,
                Key: document.content,
            });
            const url = await (0, s3_request_presigner_1.getSignedUrl)(this.s3Client, command, { expiresIn: 3600 });
            return { type: 'url', url, name: document.name };
        }
        catch (error) {
            this.logger.error('Failed to generate presigned URL', error);
            throw new common_1.BadRequestException('Failed to retrieve document from storage');
        }
    }
};
exports.DocumentVaultService = DocumentVaultService;
exports.DocumentVaultService = DocumentVaultService = DocumentVaultService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService])
], DocumentVaultService);
//# sourceMappingURL=document-vault.service.js.map