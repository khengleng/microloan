import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Module({
  providers: [BillingService, PrismaService, AuditService],
  controllers: [BillingController]
})
export class BillingModule {}
