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

import { LendingModule } from '../lending/lending.module';
import { PortalDocumentsController } from './portal-documents.controller';

@Module({
  imports: [PassportModule, JwtModule.register({}), AuthzModule, LendingModule],
  controllers: [BorrowerPortalController, KycReviewController, PortalDocumentsController],
  providers: [BorrowerAuthService, BorrowerPortalService, KycReviewService, BorrowerJwtStrategy],
})
export class BorrowerPortalModule {}
