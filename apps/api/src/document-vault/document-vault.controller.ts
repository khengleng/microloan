import {
    Controller,
    Post,
    Get,
    Param,
    UseInterceptors,
    UploadedFile,
    UseGuards,
    Res,
    BadRequestException,
    UnsupportedMediaTypeException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentVaultService } from './document-vault.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import type { Response } from 'express';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

const MAX_UPLOAD_BYTES = Number(process.env.DOCUMENT_UPLOAD_MAX_BYTES || 10 * 1024 * 1024);
const ALLOWED_MIME_TYPES = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
]);

const uploadOptions: MulterOptions = {
    // Critical: enforce hard size limit at the multipart parser boundary.
    limits: { fileSize: MAX_UPLOAD_BYTES },
    fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
            return cb(new UnsupportedMediaTypeException('Unsupported file type. Accepted: PDF, JPEG, PNG, WebP.'), false);
        }
        return cb(null, true);
    },
};

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('documents')
export class DocumentVaultController {
    constructor(private readonly documentVaultService: DocumentVaultService) { }

    @Roles('ADMIN', 'OPERATOR', 'SALES', 'FINANCE')
    @Post('upload/:loanId')
    @UseInterceptors(FileInterceptor('file', uploadOptions))
    async uploadDocument(
        @CurrentUser() user: JwtPayload,
        @Param('loanId') loanId: string,
        @UploadedFile() file: Express.Multer.File,
    ) {
        if (!file) throw new BadRequestException('File is required');
        return this.documentVaultService.uploadDocument(user.tenantId, loanId, user.sub, file);
    }

    @Roles('ADMIN', 'OPERATOR', 'SALES', 'FINANCE', 'CX')
    @Get('loan/:loanId')
    async getDocuments(@CurrentUser() user: JwtPayload, @Param('loanId') loanId: string) {
        return this.documentVaultService.getDocuments(user.tenantId, loanId);
    }

    @Roles('ADMIN', 'OPERATOR', 'SALES', 'FINANCE', 'CX')
    @Get('download/:documentId')
    async downloadDocument(
        @CurrentUser() user: JwtPayload,
        @Param('documentId') documentId: string,
        @Res() res: Response,
    ) {
        const doc = await this.documentVaultService.downloadDocument(user.tenantId, documentId, user.sub);
        // Fix 6: service always returns a presigned URL now — no buffer fallback
        return res.redirect(doc.url!);
    }
}
