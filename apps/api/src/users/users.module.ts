import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AuditModule } from '../audit/audit.module';
import { AuthzModule } from '../authz/authz.module';
import { PlatformApprovalsModule } from '../platform-approvals/platform-approvals.module';

@Module({
  imports: [AuditModule, AuthzModule, PlatformApprovalsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule { }
