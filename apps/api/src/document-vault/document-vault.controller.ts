import { Controller, Post, Get, Param, UseInterceptors, UploadedFile, UseGuards, Res, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentVaultService } from './document-vault.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt.strategy';
import type { Response } from 'express';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('documents')
export class DocumentVaultController {
    constructor(private readonly documentVaultService: DocumentVaultService) { }

    @Roles('ADMIN', 'OPERATOR', 'SALES', 'FINANCE')
    @Post('upload/:loanId')
    @UseInterceptors(FileInterceptor('file'))
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

        if (doc.type === 'url' && doc.url) {
            return res.redirect(doc.url);
        } else if (doc.type === 'buffer' && doc.mimetype) {
            res.setHeader('Content-Type', doc.mimetype);
            res.setHeader('Content-Disposition', `attachment; filename="${doc.name}"`);
            res.send(doc.data);
        }
    }
}
