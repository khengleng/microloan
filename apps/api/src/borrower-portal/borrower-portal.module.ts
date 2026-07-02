import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { BorrowerPortalController } from './borrower-portal.controller';
import { KycReviewController } from './kyc-review.controller';
import { BorrowerAuthService } from './borrower-auth.service';
import { BorrowerPortalService } from './borrower-portal.service';
import { KycReviewService } from './kyc-review.service';
import { BorrowerJwtStrategy } from './borrower-jwt.strategy';
import { AuthzModule } from '../authz/authz.module';
import { PaymentInstrumentsModule } from '../payment-instruments/payment-instruments.module';

@Module({
  imports: [PassportModule, JwtModule.register({}), AuthzModule, PaymentInstrumentsModule],
  controllers: [BorrowerPortalController, KycReviewController],
  providers: [BorrowerAuthService, BorrowerPortalService, KycReviewService, BorrowerJwtStrategy],
})
export class BorrowerPortalModule {}
