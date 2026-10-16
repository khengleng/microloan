import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { lending } from '@microloan/shared';
import type { Prisma } from '@microloan/db';
import { PrismaService } from '../../prisma/prisma.service';
import { LendingPrisma, Tx } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import { BusinessDateService } from '../common/business-date.service';
import {
  D,
  LendingActor,
  concurrentModification,
  decStr,
  engineCall,
  fromLocalDate,
  requireTenant,
  toLocalDate,
} from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { loanAccountResource } from '../policy/resources';

type GroupRow = NonNullable<
  Awaited<ReturnType<Tx['borrowerGroup']['findFirst']>>
>;
type MembershipRow = Awaited<
  ReturnType<Tx['groupMembership']['findMany']>
>[number];

/**
 * Solidarity groups: formation, membership and the terms a group loan is
 * bound on.
 *
 * The group itself is an origination concern — who is in it, how long they
 * have been in it, who leads it. What a *loan* does with that is decided once,
 * at booking, and frozen into `LoanGroupMember`: a later change to the group's
 * membership or to the product configuration must never alter who was liable
 * for a loan that is already running.
 */
@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
    private readonly businessDate: BusinessDateService,
  ) {}

  // ── Reads ─────────────────────────────────────────────────────────────────

  async list(
    actor: LendingActor,
    q: { status?: string; search?: string; page?: number },
  ) {
    const tenantId = requireTenant(actor);
    const scope = await this.policy.scopeFilter(actor, 'borrower_group.read');
    if (!scope) return { data: [], total: 0 };
    const where: Prisma.BorrowerGroupWhereInput = {
      tenantId,
      ...(scope as Prisma.BorrowerGroupWhereInput),
    };
    if (q.status) where.status = q.status;
    if (q.search) where.name = { contains: q.search, mode: 'insensitive' };
    const take = 50;
    const skip = (Math.max(1, q.page ?? 1) - 1) * take;
    const [data, total] = await Promise.all([
      this.prisma.borrowerGroup.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
        include: { members: true },
      }),
      this.prisma.borrowerGroup.count({ where }),
    ]);
    return { data: data.map((g) => groupView(g, g.members)), total };
  }

  async get(actor: LendingActor, id: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const { group, members } = await this.load(tx, tenantId, id);
      await this.policy.enforce(
        actor,
        'borrower_group.read',
        this.resource(group),
        tx,
      );
      const loans = await tx.loanGroupMember.findMany({
        where: { tenantId, groupId: id },
        orderBy: { createdAt: 'desc' },
      });
      return {
        ...groupView(group, members),
        loanBindings: loans.map(bindingView),
      };
    });
  }

  // ── Formation and membership ──────────────────────────────────────────────

  async create(
    actor: LendingActor,
    body: { code: string; name: string; branchId?: string; formedOn?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const businessDate = await this.businessDate.get(tenantId, tx);
      const branchId = body.branchId ?? actor.branchId ?? null;
      if (!branchId) {
        throw new BadRequestException(
          'A group belongs to a branch; name one or sign in as a branch user.',
        );
      }
      // The group does not exist yet, so authorization runs against the group
      // it is about to become: the branch decides scope, and FORMING is the
      // state it starts in.
      await this.policy.enforce(
        actor,
        'borrower_group.manage',
        this.resource({
          id: 'new',
          tenantId,
          branchId,
          status: 'FORMING',
          createdBy: actor.id,
        } as GroupRow),
        tx,
      );
      const group = await tx.borrowerGroup.create({
        data: {
          tenantId,
          branchId,
          code: body.code,
          name: body.name.slice(0, 120),
          status: 'FORMING',
          formedOn: fromLocalDate(body.formedOn ?? businessDate),
          createdBy: actor.id,
        },
      });
      await this.writeAudit(actor, tx, group, 'borrower_group.manage', {
        action: 'CREATE',
        code: group.code,
      });
      return groupView(group, []);
    });
  }

  async addMember(
    actor: LendingActor,
    id: string,
    body: { borrowerId: string; role?: 'LEADER' | 'MEMBER'; joinedOn?: string },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const { group, members } = await this.load(tx, tenantId, id);
      await this.policy.enforce(
        actor,
        'borrower_group.manage',
        this.resource(group),
        tx,
      );
      if (group.status === 'DISBANDED') {
        throw new ConflictException('This group has been disbanded.');
      }
      const borrower = await tx.borrower.findFirst({
        where: { id: body.borrowerId, tenantId },
        select: { id: true },
      });
      if (!borrower) throw new NotFoundException('Borrower not found');

      const existing = members.find((m) => m.borrowerId === body.borrowerId);
      if (existing && !existing.leftOn) {
        throw new ConflictException('This borrower is already in the group.');
      }
      const role = body.role ?? 'MEMBER';
      if (role === 'LEADER') {
        const leader = members.find((m) => m.role === 'LEADER' && !m.leftOn);
        if (leader) {
          throw new ConflictException(
            'The group already has a leader; stand the current one down first.',
          );
        }
      }
      const businessDate = await this.businessDate.get(tenantId, tx);
      const joinedOn = body.joinedOn ?? businessDate;
      if (lending.compareDates(joinedOn, businessDate) > 0) {
        throw new BadRequestException(
          `A member cannot join on ${joinedOn}, which is after the business date.`,
        );
      }
      // A borrower cannot sit in two groups that could both lend to them.
      const otherGroup = await tx.groupMembership.findFirst({
        where: {
          tenantId,
          borrowerId: body.borrowerId,
          leftOn: null,
          groupId: { not: id },
        },
      });
      if (otherGroup) {
        throw new ConflictException(
          'This borrower is already an active member of another group.',
        );
      }

      if (existing) {
        // Rejoining: the previous membership stays as history.
        await tx.groupMembership.update({
          where: { id: existing.id },
          data: { leftOn: existing.leftOn, leftAt: existing.leftAt },
        });
      }
      const membership = await tx.groupMembership.create({
        data: {
          tenantId,
          groupId: id,
          borrowerId: body.borrowerId,
          role,
          joinedOn: fromLocalDate(joinedOn),
        },
      });
      await this.cas(tx, group, {});
      await this.writeAudit(actor, tx, group, 'borrower_group.manage', {
        action: 'ADD_MEMBER',
        borrowerId: body.borrowerId,
        role,
        joinedOn,
      });
      return membershipView(membership);
    });
  }

  /**
   * Remove a member.
   *
   * Whether this is allowed depends on the loan, not the group: a member of a
   * jointly liable group with money outstanding is walking away from a debt
   * the others would inherit. The engine decides; this method supplies the
   * outstanding balance and the member's share.
   */
  async removeMember(
    actor: LendingActor,
    id: string,
    borrowerId: string,
    body: { reason: string },
  ) {
    const tenantId = requireTenant(actor);
    if (!body.reason?.trim()) {
      throw new BadRequestException('Give a reason for removing a member.');
    }
    return this.lp.tenantTx(tenantId, async (tx) => {
      const { group, members } = await this.load(tx, tenantId, id);
      await this.policy.enforce(
        actor,
        'borrower_group.manage',
        this.resource(group),
        tx,
      );
      const businessDate = await this.businessDate.get(tenantId, tx);
      const { outstanding, fraction, terms } = await this.outstandingFor(
        tx,
        tenantId,
        id,
        borrowerId,
      );
      const check = engineCall(() =>
        lending.checkMemberExit(
          terms,
          members.map(toEngineMember),
          borrowerId,
          outstanding,
          fraction,
          'USD',
          { increment: '0.01', mode: 'HALF_UP' },
          businessDate,
        ),
      );
      if (!check.ok) {
        throw new ConflictException({
          message: check.issues.map((i) => i.message).join(' '),
          code: 'MEMBER_EXIT_REFUSED',
          issues: check.issues,
        });
      }
      const membership = members.find(
        (m) => m.borrowerId === borrowerId && !m.leftOn,
      )!;
      await tx.groupMembership.update({
        where: { id: membership.id },
        data: {
          leftOn: fromLocalDate(businessDate),
          leftAt: new Date(),
          exitReason: body.reason.slice(0, 500),
          exitSettlement: check.settlementAmount,
        },
      });
      await this.cas(tx, group, {});
      await this.writeAudit(actor, tx, group, 'borrower_group.manage', {
        action: 'REMOVE_MEMBER',
        borrowerId,
        reason: body.reason,
        settlement: check.settlementAmount,
      });
      return {
        borrowerId,
        leftOn: businessDate,
        settlementAmount: check.settlementAmount,
      };
    });
  }

  async changeStatus(
    actor: LendingActor,
    id: string,
    body: { status: 'ACTIVE' | 'DORMANT' | 'DISBANDED' },
  ) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const { group } = await this.load(tx, tenantId, id);
      await this.policy.enforce(
        actor,
        'borrower_group.manage',
        this.resource(group),
        tx,
      );
      if (body.status === 'DISBANDED') {
        const open = await tx.loanGroupMember.findMany({
          where: { tenantId, groupId: id },
          select: { loanAccountId: true },
        });
        const live = open.length
          ? await tx.loanAccount.count({
              where: {
                tenantId,
                id: { in: [...new Set(open.map((o) => o.loanAccountId))] },
                status: { in: ['BOOKED', 'ACTIVE'] },
              },
            })
          : 0;
        if (live) {
          throw new ConflictException(
            `This group has ${live} loan(s) still running; it cannot be disbanded.`,
          );
        }
      }
      await this.cas(tx, group, { status: body.status });
      await this.writeAudit(actor, tx, group, 'borrower_group.manage', {
        action: 'STATUS',
        status: body.status,
      });
      return { id, status: body.status };
    });
  }

  // ── Used by origination ───────────────────────────────────────────────────

  /**
   * Check a group can take this loan and work out each member's share.
   *
   * Called by the application service at submission (to refuse early) and
   * again at booking (because membership can change in between).
   */
  async composition(
    tx: Tx,
    tenantId: string,
    groupId: string,
    config: lending.ProductConfig,
    principal: string,
    asOf: string,
  ): Promise<{ members: lending.MemberShare[]; group: GroupRow }> {
    const { group, members } = await this.load(tx, tenantId, groupId);
    if (group.status === 'DISBANDED') {
      throw new ConflictException('This group has been disbanded.');
    }
    const terms = groupTermsOf(config);
    const engineMembers = members.map(toEngineMember);
    const issues = engineCall(() =>
      lending.validateGroupComposition(terms, engineMembers, asOf),
    );
    if (issues.length) {
      throw new BadRequestException({
        message: issues.map((i) => i.message).join(' '),
        code: 'GROUP_COMPOSITION_INVALID',
        issues,
      });
    }
    const shares = engineCall(() =>
      lending.allocateShares(
        terms,
        engineMembers,
        principal,
        config.identity.currency,
        config.pricing.rounding,
        asOf,
      ),
    );
    return { members: shares, group };
  }

  /** Freeze the group's liability onto a booked loan. */
  async bindLoan(
    tx: Tx,
    tenantId: string,
    loanAccountId: string,
    groupId: string,
    liability: lending.GroupLiability,
    shares: lending.MemberShare[],
    roles: Map<string, string>,
  ) {
    await tx.loanGroupMember.createMany({
      data: shares.map((s) => ({
        tenantId,
        loanAccountId,
        groupId,
        borrowerId: s.borrowerId,
        role: roles.get(s.borrowerId) ?? 'MEMBER',
        liability,
        shareAmount: s.amount,
        shareFraction: s.fraction,
        liableFor: s.liableFor,
      })),
    });
  }

  /** The members bound to a loan, with what each is liable for. */
  async loanMembers(actor: LendingActor, loanAccountId: string) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const account = await tx.loanAccount.findFirst({
        where: { id: loanAccountId, tenantId },
      });
      if (!account) throw new NotFoundException('Loan account not found');
      // Scoped against the loan itself, not the tenant: a branch-scoped
      // officer must not read the membership of another branch's loan.
      await this.policy.enforce(
        actor,
        'loan.read',
        loanAccountResource(account, null, null, true, []),
        tx,
      );
      const [bindings, contributions] = await Promise.all([
        tx.loanGroupMember.findMany({
          where: { tenantId, loanAccountId },
          orderBy: { createdAt: 'asc' },
        }),
        tx.groupContribution.findMany({
          where: { tenantId, loanAccountId },
          orderBy: { createdAt: 'asc' },
        }),
      ]);
      if (!bindings.length)
        return { group: false, members: [], contributions: [] };
      const paid = new Map<string, InstanceType<typeof lending.D>>();
      for (const c of contributions) {
        paid.set(
          c.borrowerId,
          (paid.get(c.borrowerId) ?? D('0')).plus(D(c.amount)),
        );
      }
      // Joint liability is measured against what is still owed today, not
      // against the balance at booking.
      const outstanding = decStr(account.principalOutstanding);
      return {
        group: true,
        groupId: bindings[0].groupId,
        liability: bindings[0].liability,
        outstanding,
        members: bindings.map((b) => ({
          ...bindingView(b),
          contributed: (paid.get(b.borrowerId) ?? D('0')).toString(),
          exposureToday: lending.memberExposure(
            {
              liability: b.liability as lending.GroupLiability,
            } as lending.GroupTerms,
            outstanding,
            decStr(b.shareFraction),
            account.currency,
            { increment: '0.01', mode: 'HALF_UP' },
          ),
        })),
        contributions: contributions.map((c) => ({
          borrowerId: c.borrowerId,
          amount: decStr(c.amount),
          financialEventId: c.financialEventId,
        })),
      };
    });
  }

  /** Record who paid, within a repayment already posted on a group loan. */
  async recordContributions(
    tx: Tx,
    tenantId: string,
    loanAccountId: string,
    financialEventId: string,
    contributions: { borrowerId: string; amount: string }[],
  ) {
    if (!contributions.length) return;
    const bound = await tx.loanGroupMember.findMany({
      where: { tenantId, loanAccountId },
      select: { borrowerId: true },
    });
    const known = new Set(bound.map((b) => b.borrowerId));
    const unknown = contributions.filter((c) => !known.has(c.borrowerId));
    if (unknown.length) {
      throw new BadRequestException(
        `Contribution from ${unknown.map((u) => u.borrowerId).join(', ')}, who is not on this loan.`,
      );
    }
    await tx.groupContribution.createMany({
      data: contributions
        .filter((c) => D(c.amount).gt(0))
        .map((c) => ({
          tenantId,
          loanAccountId,
          financialEventId,
          borrowerId: c.borrowerId,
          amount: c.amount,
        })),
    });
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async load(tx: Tx, tenantId: string, id: string) {
    const group = await tx.borrowerGroup.findFirst({ where: { id, tenantId } });
    if (!group) throw new NotFoundException('Group not found');
    const members = await tx.groupMembership.findMany({
      where: { tenantId, groupId: id },
      orderBy: { joinedAt: 'asc' },
    });
    return { group, members };
  }

  /**
   * The group's outstanding balance and this member's share of it, across
   * every loan the group still has running.
   */
  private async outstandingFor(
    tx: Tx,
    tenantId: string,
    groupId: string,
    borrowerId: string,
  ) {
    const bindings = await tx.loanGroupMember.findMany({
      where: { tenantId, groupId },
    });
    if (!bindings.length) {
      return { outstanding: '0', fraction: '0', terms: DEFAULT_EXIT_TERMS };
    }
    const accounts = await tx.loanAccount.findMany({
      where: {
        tenantId,
        id: { in: [...new Set(bindings.map((b) => b.loanAccountId))] },
        status: { in: ['BOOKED', 'ACTIVE'] },
      },
      select: { id: true, principalOutstanding: true, productVersionId: true },
    });
    const outstanding = accounts.reduce(
      (t, a) => t.plus(D(a.principalOutstanding)),
      D('0'),
    );
    const mine = bindings.filter(
      (b) =>
        b.borrowerId === borrowerId &&
        accounts.some((a) => a.id === b.loanAccountId),
    );
    const fraction = mine.length ? decStr(mine[0].shareFraction) : '0';

    // Exit policy comes from the product the live loan was booked under.
    let terms = DEFAULT_EXIT_TERMS;
    if (accounts.length) {
      const version = await tx.agreementVersion.findFirst({
        where: { tenantId, agreement: { account: { id: accounts[0].id } } },
        orderBy: { version: 'desc' },
        select: { productConfig: true },
      });
      const parsed = lending.validateProductConfig(version?.productConfig);
      if (parsed.ok && parsed.config.group) terms = groupTermsOf(parsed.config);
    }
    return { outstanding: outstanding.toString(), fraction, terms };
  }

  private resource(group: GroupRow) {
    return {
      type: 'BORROWER_GROUP',
      id: group.id,
      tenantId: group.tenantId,
      branchId: group.branchId,
      portfolioId: null,
      legalEntityId: null,
      workflowState: group.status,
      dataClassification: 'CONFIDENTIAL' as const,
      makerIds: group.createdBy ? [group.createdBy] : [],
    };
  }

  private async cas(
    tx: Tx,
    group: GroupRow,
    data: Prisma.BorrowerGroupUpdateManyMutationInput,
  ) {
    const res = await tx.borrowerGroup.updateMany({
      where: { id: group.id, tenantId: group.tenantId, version: group.version },
      data: { ...data, version: { increment: 1 } },
    });
    if (res.count !== 1) throw concurrentModification('This group');
  }

  private async writeAudit(
    actor: LendingActor,
    tx: Tx,
    group: GroupRow,
    action: string,
    details: Record<string, unknown>,
  ) {
    await this.audit.write(
      {
        actor,
        action,
        resourceType: 'BorrowerGroup',
        resourceId: group.id,
        outcome: 'SUCCESS',
        details: { group: group.code, ...details },
      },
      tx,
    );
  }
}

/** Used only when a group has no live loan, where exit is unconstrained. */
const DEFAULT_EXIT_TERMS: lending.GroupTerms = {
  liability: 'GROUP_JOINT',
  minMembers: 2,
  maxMembers: 50,
  shareBasis: 'EQUAL',
  minMembershipDays: 0,
  requireLeader: false,
  allowExitWithOutstanding: true,
};

export function groupTermsOf(
  config: lending.ProductConfig,
): lending.GroupTerms {
  const g = config.group!;
  return {
    liability: config.identity.liability as lending.GroupLiability,
    minMembers: g.minMembers,
    maxMembers: g.maxMembers,
    shareBasis: g.shareBasis,
    minMembershipDays: g.minMembershipDays,
    requireLeader: g.requireLeader,
    allowExitWithOutstanding: g.allowExitWithOutstanding,
  };
}

function toEngineMember(m: MembershipRow): lending.GroupMember {
  return {
    borrowerId: m.borrowerId,
    role: m.role as lending.MemberRole,
    joinedOn: toLocalDate(m.joinedOn) ?? toLocalDate(m.joinedAt)!,
    leftOn: toLocalDate(m.leftOn),
  };
}

function groupView(g: GroupRow, members: MembershipRow[]) {
  return {
    id: g.id,
    code: g.code,
    name: g.name,
    branchId: g.branchId,
    status: g.status,
    formedOn: toLocalDate(g.formedOn),
    memberCount: members.filter((m) => !m.leftOn).length,
    members: members.map(membershipView),
  };
}

function membershipView(m: MembershipRow) {
  return {
    id: m.id,
    borrowerId: m.borrowerId,
    role: m.role,
    joinedOn: toLocalDate(m.joinedOn),
    leftOn: toLocalDate(m.leftOn),
    exitReason: m.exitReason,
    exitSettlement: m.exitSettlement === null ? null : decStr(m.exitSettlement),
  };
}

function bindingView(b: {
  borrowerId: string;
  role: string;
  liability: string;
  shareAmount: unknown;
  shareFraction: unknown;
  liableFor: unknown;
}) {
  return {
    borrowerId: b.borrowerId,
    role: b.role,
    liability: b.liability,
    shareAmount: decStr(b.shareAmount as string),
    shareFraction: decStr(b.shareFraction as string),
    liableFor: decStr(b.liableFor as string),
  };
}
