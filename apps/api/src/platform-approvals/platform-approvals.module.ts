import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PlatformApprovalService } from './platform-approval.service';
import { SuperadminGrantService } from './superadmin-grant.service';

/** Second-super-administrator approvals for platform actions (D-130). */
@Module({
  imports: [PrismaModule],
  providers: [PlatformApprovalService, SuperadminGrantService],
  exports: [PlatformApprovalService, SuperadminGrantService],
})
export class PlatformApprovalsModule {}
