import { Module } from '@nestjs/common';
import { DocumentVaultService } from './document-vault.service';
import { DocumentVaultController } from './document-vault.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Module({
  providers: [DocumentVaultService, PrismaService, AuditService],
  controllers: [DocumentVaultController]
})
export class DocumentVaultModule {}
