import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { SignupPaymentService } from './signup-payment.service';
import { PlatformQrService } from './platform-qr.service';
import { PlatformQrController } from './platform-qr.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Module({
  providers: [BillingService, SignupPaymentService, PlatformQrService, PrismaService, AuditService],
  controllers: [BillingController, PlatformQrController],
  // Exported so AuthModule can gate signup on it and TenantsModule can confirm
  // payments, without either re-instantiating the QR logic.
  exports: [SignupPaymentService, PlatformQrService],
})
export class BillingModule {}
