import { Module } from '@nestjs/common';
import { AuthzService } from './authz.service';
import { AuditModule } from '../audit/audit.module';
import { PermissionGuard } from './permission.guard';
import { PlatformOnlyGuard } from './platform-only.guard';
import { TenantScopeGuard } from './tenant-scope.guard';
import { BranchScopeGuard } from './branch-scope.guard';
import { MakerCheckerGuard } from './maker-checker.guard';

@Module({
  imports: [AuditModule],
  providers: [
    AuthzService,
    PermissionGuard,
    PlatformOnlyGuard,
    TenantScopeGuard,
    BranchScopeGuard,
    MakerCheckerGuard,
  ],
  exports: [
    AuthzService,
    PermissionGuard,
    PlatformOnlyGuard,
    TenantScopeGuard,
    BranchScopeGuard,
    MakerCheckerGuard,
  ],
})
export class AuthzModule {}
