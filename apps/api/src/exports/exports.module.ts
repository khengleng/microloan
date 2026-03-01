import { Module } from '@nestjs/common';
import { ExportsService } from './exports.service';
import { ExportsController } from './exports.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Module({
  providers: [ExportsService, PrismaService, AuditService],
  controllers: [ExportsController]
})
export class ExportsModule {}
