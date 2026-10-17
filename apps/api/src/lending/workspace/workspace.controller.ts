import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import {
  AnyAuthenticated,
  BorrowerRoute,
} from '../../auth/auth-scope.decorator';
import { BorrowerJwtGuard } from '../../borrower-portal/borrower-jwt.guard';
import { lendingActorOf } from '../policy/lending-action.guard';
import { WorkspaceAccessService } from './workspace-access.service';
import { WorkspaceWorkService } from './workspace-work.service';
import { WorkspaceSearchService } from './workspace-search.service';

type StaffUser = {
  email?: string;
  role?: string;
  permissions?: string[];
  tenantName?: string;
  branchId?: string | null;
};
const actor = (req: Request) => lendingActorOf(req as never);
const staff = (req: Request) => (req.user ?? {}) as StaffUser;

/**
 * The signed-in person's workspace: what they may do, what waits for them.
 * Open to every authenticated staff principal — the answer is about the
 * caller, computed by the lending permission engine, and never names another
 * tenant's records.
 */
@Controller('me')
export class WorkspaceMeController {
  constructor(
    private readonly access: WorkspaceAccessService,
    private readonly work: WorkspaceWorkService,
  ) {}

  @AnyAuthenticated()
  @Get('access')
  myAccess(@Req() req: Request) {
    return this.access.access(actor(req), staff(req));
  }

  @AnyAuthenticated()
  @Get('work')
  myWork(@Req() req: Request) {
    return this.work.work(actor(req));
  }
}

/** Global search across borrowers, loans, applications, facilities, cards and cases. */
@Controller('search')
export class WorkspaceSearchController {
  constructor(private readonly svc: WorkspaceSearchService) {}

  @AnyAuthenticated()
  @Get()
  search(@Req() req: Request, @Query('q') q?: string) {
    const u = staff(req);
    return this.svc.search(actor(req), typeof q === 'string' ? q : '', {
      permissions: u.permissions,
      branchId: u.branchId,
    });
  }
}

/** The borrower's own access in the portal. */
@BorrowerRoute()
@UseGuards(BorrowerJwtGuard)
@Controller('lending/portal/me')
export class WorkspacePortalController {
  constructor(private readonly access: WorkspaceAccessService) {}

  @Get('access')
  myAccess(@Req() req: Request) {
    return this.access.access(actor(req));
  }
}
