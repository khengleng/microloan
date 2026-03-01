import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
export declare class DocumentVaultService {
    private prisma;
    private audit;
    private s3Client;
    private readonly logger;
    private bucketName;
    constructor(prisma: PrismaService, audit: AuditService);
    uploadDocument(tenantId: string, loanId: string, actorId: string, file: Express.Multer.File): Promise<{
        id: string;
        tenantId: string;
        loanId: string;
        name: string;
        content: string;
        type: string;
        createdAt: Date;
    }>;
    getDocuments(tenantId: string, loanId: string): Promise<{
        id: string;
        createdAt: Date;
        name: string;
        type: string;
    }[]>;
    downloadDocument(tenantId: string, id: string, actorId: string): Promise<{
        type: string;
        data: Buffer<ArrayBuffer>;
        mimetype: string;
        name: string;
        url?: undefined;
    } | {
        type: string;
        url: string;
        name: string;
        data?: undefined;
        mimetype?: undefined;
    }>;
}
