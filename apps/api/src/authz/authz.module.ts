import { Module } from '@nestjs/common';
import { AuthzService } from './authz.service';
import { AuditModule } from '../audit/audit.module';
import { PermissionGuard } from './permission.guard';
import { PlatformOnlyGuard } from './platform-only.guard';
import { TenantScopeGuard } from './tenant-scope.guard';
import { BranchScopeGuard } from './branch-scope.guard';

/**
 * `MakerCheckerGuard` used to live here as a `return true` stub. Maker/checker
 * needs the resource's creator, which a guard cannot see, so it is enforced in
 * the service layer via `AuthzService.assertMakerChecker` (loan approve,
 * reject and disburse). The stub was removed rather than left to imply a
 * control that was not running.
 */
@Module({
  imports: [AuditModule],
  providers: [
    AuthzService,
    PermissionGuard,
    PlatformOnlyGuard,
    TenantScopeGuard,
    BranchScopeGuard,
  ],
  exports: [
    AuthzService,
    PermissionGuard,
    PlatformOnlyGuard,
    TenantScopeGuard,
    BranchScopeGuard,
  ],
})
export class AuthzModule {}
