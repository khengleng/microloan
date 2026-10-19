import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma, Role } from '@microloan/db';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { assertFreshMfa, type MfaClaims } from '../auth/mfa-policy';
import { PlatformApprovalService } from './platform-approval.service';

type PlatformActor = MfaClaims & { sub: string; role: string; tenantId: string | null };

/**
 * Granting SUPERADMIN (D-130). One super-administrator requests it; a second
 * approves it, and only then is the account promoted (or, for an account
 * created as a super-administrator, activated). Both steps need a recent
 * authenticator code. When the requester is the only active super-
 * administrator there is nobody to approve: the grant goes ahead on their
 * MFA alone and is logged loudly (SUPERADMIN_SOLE_APPROVER).
 */
@Injectable()
export class SuperadminGrantService {
  private readonly logger = new Logger(SuperadminGrantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly approvals: PlatformApprovalService,
  ) {}

  private assertPlatform(actor: PlatformActor) {
    if (actor.role !== Role.SUPERADMIN || actor.tenantId !== null)
      throw new ForbiddenException('Only a platform super-administrator can do this.');
  }

  /** Ask for an existing account to become SUPERADMIN. */
  async requestPromotion(actor: PlatformActor, email: string) {
    this.assertPlatform(actor);
    assertFreshMfa(actor);
    const target = await this.prisma.user.findUnique({
      where: { email: (email ?? '').trim().toLowerCase() },
      select: { id: true, email: true, role: true, tenantId: true, isActive: true },
    });
    if (!target) throw new BadRequestException(`No user found with email: ${email}`);
    if (target.role === Role.SUPERADMIN && target.isActive)
      throw new ConflictException(`${target.email} is already a super-administrator.`);
    return this.request(actor, target, { mode: 'PROMOTE' });
  }

  /**
   * An account created with the SUPERADMIN role (POST /users) starts inactive
   * and is activated by the same approval (UsersService.create).
   */
  async requestForNewAccount(
    actor: PlatformActor,
    target: { id: string; email: string; role: string; tenantId: string | null },
  ) {
    return this.request(actor, target, { mode: 'NEW_ACCOUNT' });
  }

  private async request(
    actor: PlatformActor,
    target: { id: string; email: string; role: string; tenantId: string | null },
    payload: { mode: 'PROMOTE' | 'NEW_ACCOUNT' },
  ) {
    const sole = !(await this.approvals.secondApproverAvailable(actor.sub));
    const row = await this.approvals.open({
      action: 'SUPERADMIN_GRANT',
      subjectType: 'User',
      subjectId: target.id,
      makerId: actor.sub,
      payload: { ...payload, email: target.email, previousRole: target.role, previousTenantId: target.tenantId },
      soleSuperadmin: sole,
    });

    if (sole) {
      this.logger.warn(
        `SUPERADMIN granted to ${target.email} by ${actor.sub} WITHOUT a second approval: no other active super-administrator exists.`,
      );
      await this.audit.logSecurityEvent({
        actorUserId: actor.sub,
        actorRole: actor.role,
        actorTenantId: null,
        targetType: 'User',
        targetId: target.id,
        action: 'SUPERADMIN_SOLE_APPROVER',
        reason: 'No second active super-administrator exists; granted on the requester’s MFA alone.',
        newValue: { approvalId: row.id, email: target.email },
        result: 'SUCCESS',
      });
      const user = await this.execute(target.id);
      await this.auditGrant(actor.sub, actor.sub, null, target, row.id, true);
      return {
        status: 'EXECUTED' as const,
        approvalId: row.id,
        soleSuperadmin: true,
        message: `${target.email} is now a super-administrator. No second super-administrator exists, so this was recorded without a second approval.`,
        user,
      };
    }

    await this.audit.logSecurityEvent({
      actorUserId: actor.sub,
      actorRole: actor.role,
      actorTenantId: null,
      subjectTenantId: target.tenantId,
      targetType: 'User',
      targetId: target.id,
      action: 'SUPERADMIN_GRANT_REQUESTED',
      newValue: { approvalId: row.id, email: target.email, mode: payload.mode },
      result: 'SUCCESS',
    });
    return {
      status: 'PENDING_APPROVAL' as const,
      approvalId: row.id,
      soleSuperadmin: false,
      message: `Request recorded. A second super-administrator must approve it before ${target.email} becomes a super-administrator.`,
    };
  }

  async list(actor: PlatformActor, status?: string) {
    this.assertPlatform(actor);
    return this.approvals.list('SUPERADMIN_GRANT', status);
  }

  async approve(actor: PlatformActor, id: string, comment?: string) {
    this.assertPlatform(actor);
    assertFreshMfa(actor);
    const row = await this.approvals.decide(id, actor.sub, true, comment);
    const payload = (row.payload ?? {}) as { email?: string; previousRole?: string; previousTenantId?: string | null };
    const user = await this.prisma.$transaction(async (tx) => {
      await this.approvals.markExecuted(row.id, tx);
      return this.execute(row.subjectId, tx);
    });
    await this.auditGrant(
      actor.sub,
      row.makerId,
      actor.sub,
      { id: row.subjectId, email: payload.email ?? user.email, role: payload.previousRole ?? '', tenantId: payload.previousTenantId ?? null },
      row.id,
      false,
    );
    return { status: 'EXECUTED' as const, approvalId: row.id, user };
  }

  async reject(actor: PlatformActor, id: string, reason: string) {
    this.assertPlatform(actor);
    const row = await this.approvals.decide(id, actor.sub, false, reason);
    await this.audit.logSecurityEvent({
      actorUserId: actor.sub,
      actorRole: actor.role,
      actorTenantId: null,
      targetType: 'User',
      targetId: row.subjectId,
      action: 'SUPERADMIN_GRANT_REJECTED',
      reason,
      newValue: { approvalId: row.id, requestedBy: row.makerId },
      result: 'SUCCESS',
    });
    return row;
  }

  /** Promote (or activate) the account and end its sessions: its token claims change. */
  private async execute(userId: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const user = await db.user.update({
      where: { id: userId },
      data: { role: Role.SUPERADMIN, tenantId: null, branchId: null, isActive: true },
      select: { id: true, email: true, role: true, tenantId: true },
    });
    await db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return user;
  }

  /**
   * The audit entry names the super-administrator who completed the grant as
   * the actor — never the promoted account — with the requester and approver.
   * When the account belonged to a tenant, the entry is also visible in that
   * tenant's audit log (as a platform-operator action).
   */
  private async auditGrant(
    actorId: string,
    makerId: string,
    checkerId: string | null,
    target: { id: string; email: string; role: string; tenantId: string | null },
    approvalId: string,
    sole: boolean,
  ) {
    await this.audit.logSecurityEvent({
      actorUserId: actorId,
      actorRole: Role.SUPERADMIN,
      actorTenantId: null,
      subjectTenantId: target.tenantId,
      targetType: 'User',
      targetId: target.id,
      action: 'PROMOTED_TO_SUPERADMIN',
      oldValue: { role: target.role, tenantId: target.tenantId },
      newValue: {
        newRole: Role.SUPERADMIN,
        approvalId,
        requestedBy: makerId,
        approvedBy: checkerId,
        soleSuperadmin: sole,
      },
      result: 'SUCCESS',
    });
  }
}
