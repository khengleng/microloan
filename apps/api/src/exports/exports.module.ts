import { Module } from '@nestjs/common';
import { ExportsService } from './exports.service';
import { ExportsController } from './exports.controller';
import { AuditService } from '../audit/audit.service';
import { AuthzModule } from '../authz/authz.module';

@Module({
  imports: [AuthzModule],
  // PrismaService comes from the global PrismaModule: one pool per process.
  providers: [ExportsService, AuditService],
  controllers: [ExportsController]
})
export class ExportsModule {}
