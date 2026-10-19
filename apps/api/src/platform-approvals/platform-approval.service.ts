import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@microloan/db';
import { PrismaService } from '../prisma/prisma.service';
import { operationalConfig } from '../config/operational-config';

export type PlatformApprovalAction = 'SUPERADMIN_GRANT' | 'TENANT_PURGE';
type Db = PrismaService | Prisma.TransactionClient;

const OPEN = ['PENDING', 'APPROVED'];

/**
 * Maker-checker for the platform (D-130): an action a single super-
 * administrator must not take alone — granting SUPERADMIN, purging a tenant —
 * is recorded as a pending request and needs a *different* super-administrator
 * to approve it before it can run. The database refuses a checker equal to
 * the maker and allows one open request per action and subject.
 *
 * Requests lapse after PLATFORM_APPROVAL_TTL_DAYS (default 7).
 */
@Injectable()
export class PlatformApprovalService {
  constructor(private readonly prisma: PrismaService) {}

  /** Active SUPERADMIN accounts — who could be a second approver. */
  async activeSuperadminIds(db: Db = this.prisma): Promise<string[]> {
    const rows = await db.user.findMany({
      where: { role: Role.SUPERADMIN, isActive: true, tenantId: null },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Whether someone other than `actorId` could approve. */
  async secondApproverAvailable(actorId: string): Promise<boolean> {
    return (await this.activeSuperadminIds()).some((id) => id !== actorId);
  }

  private async expireStale(action: string, subjectId?: string) {
    await this.prisma.platformApproval.updateMany({
      where: {
        action,
        ...(subjectId ? { subjectId } : {}),
        status: { in: OPEN },
        expiresAt: { lte: new Date() },
      },
      data: { status: 'CANCELLED', comment: 'Lapsed without a decision.' },
    });
  }

  async open(params: {
    action: PlatformApprovalAction;
    subjectType: string;
    subjectId: string;
    makerId: string;
    payload?: Record<string, unknown>;
    /** Recorded as already executed: no second super-administrator exists. */
    soleSuperadmin?: boolean;
  }) {
    await this.expireStale(params.action, params.subjectId);
    const existing = await this.findOpen(params.action, params.subjectId);
    if (existing)
      throw new ConflictException(
        'A request for this is already waiting for a second super-administrator.',
      );
    const now = Date.now();
    return this.prisma.platformApproval.create({
      data: {
        action: params.action,
        subjectType: params.subjectType,
        subjectId: params.subjectId,
        makerId: params.makerId,
        payload: {
          ...(params.payload ?? {}),
          ...(params.soleSuperadmin ? { soleSuperadmin: true } : {}),
        } as Prisma.InputJsonValue,
        status: params.soleSuperadmin ? 'EXECUTED' : 'PENDING',
        ...(params.soleSuperadmin
          ? { decidedAt: new Date(now), executedAt: new Date(now) }
          : {}),
        expiresAt: new Date(
          now + operationalConfig().platformApprovalTtlDays * 86_400_000,
        ),
      },
    });
  }

  /** The open (pending or approved, unexpired) request for a subject, if any. */
  async findOpen(action: PlatformApprovalAction, subjectId: string) {
    return this.prisma.platformApproval.findFirst({
      where: {
        action,
        subjectId,
        status: { in: OPEN },
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const row = await this.prisma.platformApproval.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Request not found');
    return row;
  }

  async list(action: PlatformApprovalAction, status?: string) {
    await this.expireStale(action);
    return this.prisma.platformApproval.findMany({
      where: { action, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /**
   * Approve or reject a pending request. The checker must be a different
   * super-administrator from the maker (also a database CHECK).
   */
  async decide(
    id: string,
    checkerId: string,
    approve: boolean,
    comment?: string,
  ) {
    const row = await this.get(id);
    if (row.status !== 'PENDING')
      throw new ConflictException(`This request is already ${row.status}.`);
    if (row.expiresAt.getTime() <= Date.now())
      throw new BadRequestException('This request has lapsed. Raise it again.');
    if (row.makerId === checkerId)
      throw new ForbiddenException(
        'A second super-administrator must decide this request; you raised it.',
      );
    if (!approve && !comment?.trim())
      throw new BadRequestException('Give a reason for rejecting the request.');
    const updated = await this.prisma.platformApproval.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        checkerId,
        decidedAt: new Date(),
        comment: comment?.slice(0, 500) ?? null,
      },
    });
    if (updated.count !== 1)
      throw new ConflictException('This request was decided by someone else.');
    return this.get(id);
  }

  /** Withdraw one's own open request. */
  async cancel(id: string, actorId: string) {
    const row = await this.get(id);
    if (!OPEN.includes(row.status))
      throw new ConflictException(`This request is already ${row.status}.`);
    if (row.makerId !== actorId)
      throw new ForbiddenException('Only the requester can withdraw a request.');
    await this.prisma.platformApproval.update({
      where: { id },
      data: { status: 'CANCELLED', decidedAt: new Date() },
    });
    return this.get(id);
  }

  /** Mark an approved request as carried out (once). */
  async markExecuted(id: string, db: Db = this.prisma) {
    const done = await db.platformApproval.updateMany({
      where: { id, status: 'APPROVED' },
      data: { status: 'EXECUTED', executedAt: new Date() },
    });
    if (done.count !== 1)
      throw new ConflictException('This request is not approved, or already carried out.');
  }
}
