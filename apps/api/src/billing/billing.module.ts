import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController, BillingWebhookReviewController } from './billing.controller';
import { StripeWebhookService } from './stripe-webhook.service';
import { SignupPaymentService } from './signup-payment.service';
import { PlatformQrService } from './platform-qr.service';
import { PlanChangeService } from './plan-change.service';
import { PlatformQrController } from './platform-qr.controller';
import { AuditService } from '../audit/audit.service';

@Module({
  // PrismaService comes from the global PrismaModule: one pool per process.
  providers: [BillingService, SignupPaymentService, PlatformQrService, PlanChangeService, AuditService, StripeWebhookService],
  controllers: [BillingController, BillingWebhookReviewController, PlatformQrController],
  // Exported so AuthModule can gate signup on it and TenantsModule can confirm
  // payments, without either re-instantiating the QR logic.
  exports: [SignupPaymentService, PlatformQrService, StripeWebhookService],
})
export class BillingModule {}
