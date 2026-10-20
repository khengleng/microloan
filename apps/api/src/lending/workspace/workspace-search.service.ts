import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@microloan/db';
import { PrismaService } from '../../prisma/prisma.service';
import { blindIndex } from '../../common/field-crypto';
import { LendingPrisma } from '../common/lending-prisma';
import type { LendingActor } from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { branchScope } from './workspace-work.service';

export type SearchType =
  | 'BORROWER'
  | 'LOAN'
  | 'LEGACY_LOAN'
  | 'APPLICATION'
  | 'FACILITY'
  | 'CARD'
  | 'RESTRUCTURE_CASE'
  | 'ORGANISATION'
  | 'PLAN_PAYMENT';

export interface SearchResult {
  type: SearchType;
  id: string;
  title: string;
  subtitle: string;
  reference: string | null;
  status: string | null;
  /** Web route relative to the locale. */
  href: string;
}

const PER_TYPE = 8;
type Scope = Record<string, unknown>;

/**
 * Phone spellings that should find the same customer: as typed, with and
 * without the Cambodian country code. Matched only through the blind index —
 * phone numbers are encrypted and are never decrypted to search.
 */
export function phoneCandidates(q: string): string[] {
  const digits = q.replace(/[^\d]/g, '');
  if (digits.length < 6 || digits.length > 15) return [];
  const out = new Set<string>([q.replace(/[\s\-()]/g, ''), digits]);
  if (digits.startsWith('855')) {
    out.add(`+${digits}`);
    out.add(`0${digits.slice(3)}`);
  } else if (digits.startsWith('0')) {
    out.add(`+855${digits.slice(1)}`);
    out.add(`855${digits.slice(1)}`);
  } else {
    out.add(`+${digits}`);
    out.add(`0${digits}`);
    out.add(`+855${digits}`);
  }
  return [...out];
}

/**
 * One search across both stacks: borrowers (name; phone and national ID by
 * blind index), lending loans, legacy loans, applications, facilities, cards
 * and restructure cases. Every query is confined to the caller's tenant and
 * to the scope of the permission that lets them open the record, so a result
 * is never something the caller could not already open.
 */
@Injectable()
export class WorkspaceSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
  ) {}

  async search(
    actor: LendingActor,
    raw: string | undefined,
    legacy: { permissions?: string[]; branchId?: string | null } = {},
  ): Promise<{ query: string; results: SearchResult[] }> {
    const q = (raw ?? '').trim();
    if (q.length > 100)
      throw new BadRequestException('Search for at most 100 characters.');
    if (q.length < 2) return { query: q, results: [] };
    if (actor.type === 'PLATFORM') return this.platformSearch(q);
    if (actor.type !== 'USER') return { query: q, results: [] };
    const tenantId = actor.tenantId!;

    const scope = async (p: string): Promise<Scope | null> =>
      this.policy.scopeFilter(actor, p);
    const [loanScope, appScope, facilityScope, archiveScope] =
      await Promise.all([
        scope('loan.read'),
        scope('loan_application.read'),
        scope('facility.read'),
        scope('legacy_loan.read'),
      ]);
    // Legacy loans: readers of the legacy loan archive (D-154), by branch.
    const archiveBranches = branchScope(archiveScope);
    // Borrowers: anyone who can open their loans or applications (lending,
    // by branch), or the legacy customer list (own branch when they have one).
    const lendingBranches = mergeBranches(
      branchScope(loanScope),
      branchScope(appScope),
    );
    const legacyCustomers = (legacy.permissions ?? []).includes(
      'CUSTOMER_VIEW',
    );
    const legacyBranches: 'ALL' | string[] | null = legacyCustomers
      ? legacy.branchId
        ? [legacy.branchId]
        : 'ALL'
      : null;
    const borrowerBranches = mergeBranches(lendingBranches, legacyBranches);

    const tokens = q
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .slice(0, 4);
    const nameMatch: Prisma.BorrowerWhereInput = {
      AND: tokens.map((t) => ({
        OR: [
          { firstName: { contains: t, mode: 'insensitive' } },
          { lastName: { contains: t, mode: 'insensitive' } },
        ],
      })),
    };
    const phones = phoneCandidates(q)
      .map((p) => blindIndex(p, 'phone'))
      .filter((h): h is string => !!h);
    const idHash = blindIndex(q, 'id');
    const borrowerMatch: Prisma.BorrowerWhereInput = {
      OR: [
        nameMatch,
        ...(phones.length ? [{ phoneHash: { in: phones } }] : []),
        ...(idHash ? [{ idNumberHash: idHash }] : []),
      ],
    };
    const like = { contains: q, mode: 'insensitive' as const };

    return this.lp.tenantTx(tenantId, async (tx) => {
      // Borrowers matched by name, phone or ID — used both as results and to
      // find their loans, applications, facilities and cases.
      const matched = await tx.borrower.findMany({
        where: { tenantId, ...borrowerMatch },
        select: { id: true, firstName: true, lastName: true, branchId: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      const matchedIds = matched.map((b) => b.id);
      const byId = new Map(matched.map((b) => [b.id, b]));
      const results: SearchResult[] = [];

      if (borrowerBranches) {
        // A borrower recorded without a branch is visible through a loan or
        // application the caller can open (D-023).
        const ownedVia = new Set<string>();
        if (borrowerBranches !== 'ALL' && matchedIds.length) {
          const [l, a] = await Promise.all([
            loanScope
              ? tx.loanAccount.findMany({
                  where: {
                    tenantId,
                    borrowerId: { in: matchedIds },
                    ...(loanScope as Prisma.LoanAccountWhereInput),
                  },
                  select: { borrowerId: true },
                })
              : Promise.resolve([]),
            appScope
              ? tx.application.findMany({
                  where: {
                    tenantId,
                    borrowerId: { in: matchedIds },
                    ...(appScope as Prisma.ApplicationWhereInput),
                  },
                  select: { borrowerId: true },
                })
              : Promise.resolve([]),
          ]);
          for (const r of [...l, ...a]) ownedVia.add(r.borrowerId);
        }
        const visible = matched.filter(
          (b) =>
            borrowerBranches === 'ALL' ||
            (b.branchId && borrowerBranches.includes(b.branchId)) ||
            ownedVia.has(b.id),
        );
        for (const b of visible.slice(0, PER_TYPE))
          results.push({
            type: 'BORROWER',
            id: b.id,
            title: `${b.firstName} ${b.lastName}`.trim(),
            subtitle: 'Borrower',
            reference: null,
            status: null,
            href: legacyCustomers
              ? `/borrowers/${b.id}`
              : `/lending/customers/${b.id}/documents`,
          });
      }

      const name = (id: string) => {
        const b = byId.get(id);
        return b ? `${b.firstName} ${b.lastName}`.trim() : '';
      };
      const either = (ref: Record<string, unknown>) => ({
        OR: [ref, { borrowerId: { in: matchedIds } }],
      });

      if (loanScope) {
        const rows = await tx.loanAccount.findMany({
          where: {
            tenantId,
            AND: [
              either({ reference: like }),
              loanScope as Prisma.LoanAccountWhereInput,
            ],
          },
          select: {
            id: true,
            reference: true,
            status: true,
            borrowerId: true,
            familyCode: true,
          },
          orderBy: { createdAt: 'desc' },
          take: PER_TYPE,
        });
        const names = await this.names(
          tx,
          tenantId,
          rows.map((r) => r.borrowerId),
          byId,
        );
        for (const r of rows)
          results.push({
            type: 'LOAN',
            id: r.id,
            title: r.reference,
            subtitle: names.get(r.borrowerId) ?? name(r.borrowerId),
            reference: r.reference,
            status: r.status,
            href: `/lending/loans/${r.id}`,
          });

        const cases = await tx.restructureCase.findMany({
          where: {
            tenantId,
            AND: [
              either({ reference: like }),
              { loanAccount: loanScope as Prisma.LoanAccountWhereInput },
            ],
          },
          select: {
            id: true,
            reference: true,
            status: true,
            borrowerId: true,
            loanAccount: { select: { reference: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: PER_TYPE,
        });
        const caseNames = await this.names(
          tx,
          tenantId,
          cases.map((r) => r.borrowerId),
          byId,
        );
        for (const r of cases)
          results.push({
            type: 'RESTRUCTURE_CASE',
            id: r.id,
            title: r.reference,
            subtitle: `${caseNames.get(r.borrowerId) ?? ''} · ${r.loanAccount.reference}`,
            reference: r.reference,
            status: r.status,
            href: `/lending/restructures/${r.id}`,
          });
      }

      if (appScope) {
        const rows = await tx.application.findMany({
          where: {
            tenantId,
            AND: [
              either({ reference: like }),
              appScope as Prisma.ApplicationWhereInput,
            ],
          },
          select: { id: true, reference: true, status: true, borrowerId: true },
          orderBy: { createdAt: 'desc' },
          take: PER_TYPE,
        });
        const names = await this.names(
          tx,
          tenantId,
          rows.map((r) => r.borrowerId),
          byId,
        );
        for (const r of rows)
          results.push({
            type: 'APPLICATION',
            id: r.id,
            title: r.reference,
            subtitle: names.get(r.borrowerId) ?? '',
            reference: r.reference,
            status: r.status,
            href: `/lending/applications/${r.id}`,
          });
      }

      if (facilityScope) {
        const rows = await tx.facility.findMany({
          where: {
            tenantId,
            AND: [
              either({ reference: like }),
              facilityScope as Prisma.FacilityWhereInput,
            ],
          },
          select: {
            id: true,
            reference: true,
            status: true,
            borrowerId: true,
            facilityType: true,
          },
          orderBy: { createdAt: 'desc' },
          take: PER_TYPE,
        });
        const names = await this.names(
          tx,
          tenantId,
          rows.map((r) => r.borrowerId),
          byId,
        );
        for (const r of rows)
          results.push({
            type: 'FACILITY',
            id: r.id,
            title: r.reference,
            subtitle: `${names.get(r.borrowerId) ?? ''} · ${r.facilityType}`,
            reference: r.reference,
            status: r.status,
            href: `/lending/facilities/${r.id}`,
          });

        const last4 = /^\d{4}$/.test(q) ? q : null;
        const cards = await tx.cardAccount.findMany({
          where: {
            tenantId,
            AND: [
              {
                OR: [
                  { reference: like },
                  ...(last4 ? [{ maskedNumber: { endsWith: last4 } }] : []),
                  { facility: { borrowerId: { in: matchedIds } } },
                ],
              },
              { facility: facilityScope as Prisma.FacilityWhereInput },
            ],
          },
          select: {
            id: true,
            reference: true,
            status: true,
            maskedNumber: true,
            facility: { select: { borrowerId: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: PER_TYPE,
        });
        const cardNames = await this.names(
          tx,
          tenantId,
          cards.map((r) => r.facility.borrowerId),
          byId,
        );
        for (const r of cards)
          results.push({
            type: 'CARD',
            id: r.id,
            title: `${r.reference} · ${r.maskedNumber}`,
            subtitle: cardNames.get(r.facility.borrowerId) ?? '',
            reference: r.reference,
            status: r.status,
            href: `/lending/cards/${r.id}`,
          });
      }

      // The legacy loan archive: loans of matched borrowers, for its readers.
      if (archiveBranches && matchedIds.length) {
        const rows = await tx.loan.findMany({
          where: {
            tenantId,
            borrowerId: { in: matchedIds },
            ...(archiveBranches === 'ALL'
              ? {}
              : { branchId: { in: archiveBranches } }),
          },
          select: {
            id: true,
            status: true,
            borrowerId: true,
            principal: true,
            currency: true,
          },
          orderBy: { createdAt: 'desc' },
          take: PER_TYPE,
        });
        for (const r of rows)
          results.push({
            type: 'LEGACY_LOAN',
            id: r.id,
            title: `${name(r.borrowerId)} · ${r.principal.toString()} ${r.currency}`,
            subtitle: 'Legacy loan archive',
            reference: null,
            status: r.status,
            href: `/lending/legacy-archive?loan=${r.id}`,
          });
      }
      return { query: q, results };
    });
  }

  private async names(
    tx: Prisma.TransactionClient,
    tenantId: string,
    ids: string[],
    known: Map<string, { firstName: string; lastName: string }>,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const missing: string[] = [];
    for (const id of new Set(ids)) {
      const b = known.get(id);
      if (b) out.set(id, `${b.firstName} ${b.lastName}`.trim());
      else missing.push(id);
    }
    if (missing.length) {
      const rows = await tx.borrower.findMany({
        where: { tenantId, id: { in: missing } },
        select: { id: true, firstName: true, lastName: true },
      });
      for (const r of rows)
        out.set(r.id, `${r.firstName} ${r.lastName}`.trim());
    }
    return out;
  }

  /** The platform console searches organisations and plan payments — never tenant borrowers. */
  private async platformSearch(q: string) {
    const like = { contains: q, mode: 'insensitive' as const };
    const [tenants, payments] = await Promise.all([
      this.prisma.tenant.findMany({
        where: { name: like },
        select: { id: true, name: true, status: true, plan: true },
        orderBy: { name: 'asc' },
        take: PER_TYPE,
      }),
      this.prisma.planPayment.findMany({
        where: { reference: like },
        select: {
          id: true,
          reference: true,
          status: true,
          plan: true,
          tenant: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: PER_TYPE,
      }),
    ]);
    const results: SearchResult[] = [
      ...tenants.map((t) => ({
        type: 'ORGANISATION' as const,
        id: t.id,
        title: t.name,
        subtitle: t.plan,
        reference: null,
        status: t.status,
        href: '/tenants',
      })),
      ...payments.map((p) => ({
        type: 'PLAN_PAYMENT' as const,
        id: p.id,
        title: p.reference,
        subtitle: `${p.tenant.name} · ${p.plan}`,
        reference: p.reference,
        status: p.status,
        href: '/platform-payments',
      })),
    ];
    return { query: q, results };
  }
}

function mergeBranches(
  a: 'ALL' | string[] | null,
  b: 'ALL' | string[] | null,
): 'ALL' | string[] | null {
  if (a === 'ALL' || b === 'ALL') return 'ALL';
  if (!a && !b) return null;
  return [...new Set([...(a ?? []), ...(b ?? [])])];
}
