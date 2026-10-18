import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { JobClaimService } from './job-claim.service';

@Global()
@Module({
  providers: [PrismaService, JobClaimService],
  exports: [PrismaService, JobClaimService],
})
export class PrismaModule {}
