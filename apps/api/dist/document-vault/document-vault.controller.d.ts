import { DocumentVaultService } from './document-vault.service';
import type { JwtPayload } from '../auth/jwt.strategy';
import type { Response } from 'express';
export declare class DocumentVaultController {
    private readonly documentVaultService;
    constructor(documentVaultService: DocumentVaultService);
    uploadDocument(user: JwtPayload, loanId: string, file: Express.Multer.File): Promise<{
        id: string;
        tenantId: string;
        loanId: string;
        name: string;
        content: string;
        type: string;
        createdAt: Date;
    }>;
    getDocuments(user: JwtPayload, loanId: string): Promise<{
        id: string;
        createdAt: Date;
        name: string;
        type: string;
    }[]>;
    downloadDocument(user: JwtPayload, documentId: string, res: Response): Promise<void>;
}
