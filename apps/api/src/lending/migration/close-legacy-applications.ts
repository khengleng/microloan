import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@microloan/db';

/**
 * Close the original loan module's open applications (LEGACY_RETIREMENT.md
 * §4, phase-2 precondition 2; DECISIONS D-169).
 *
 * Since the module was retired (D-153) a legacy loan that is still PENDING,
 * or APPROVED but never paid out, can be neither disbursed nor rejected from
 * any screen. This marks each one REJECTED with the reason below. It is an
 * operator's step, not a migration: it runs when the operator decides, with a
 * dry run first.
 *
 * - Idempotent: only PENDING and APPROVED rows are touched, each with a
 *   conditional update, so a second run (or two at once) changes nothing more.
 * - Audited: one AuditLog row per application (`LEGACY_APPLICATION_CLOSED`,
 *   with the status it had, the reason, the run id and the operator).
 * - Nothing else changes: no schedule, journal or lending row exists for an
 *   undisbursed legacy loan, and none is written.
 */
export const LEGACY_CLOSE_REASON = 'Original loan module retired';
export const LEGACY_CLOSE_ACTOR = 'system:legacy-retirement';
const OPEN_STATUSES = ['PENDING', 'APPROVED'] as const;

export interface CloseLegacyOptions {
  dryRun: boolean;
  /** Limit to one organisation. */
  tenantId?: string;
  /** Who ran it, recorded on every audit row (an e-mail or a name). */
  operator: string;
  now?: Date;
}

export interface CloseLegacyResult {
  runId: string;
  dryRun: boolean;
  tenants: {
    tenantId: string;
    found: number;
    closed: number;
    byStatus: Record<string, number>;
    loanIds: string[];
  }[];
  totalFound: number;
  totalClosed: number;
}

type Db = Pick<PrismaClient, 'loan' | 'auditLog' | '$transaction'>;

export async function closeLegacyApplications(
  prisma: Db,
  opts: CloseLegacyOptions,
): Promise<CloseLegacyResult> {
  const runId = randomUUID();
  const now = opts.now ?? new Date();
  const open = await prisma.loan.findMany({
    where: {
      status: { in: [...OPEN_STATUSES] },
      ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
    },
    select: { id: true, tenantId: true, status: true },
    orderBy: [{ tenantId: 'asc' }, { createdAt: 'asc' }],
  });
  const byTenant = new Map<string, typeof open>();
  for (const l of open)
    byTenant.set(l.tenantId, [...(byTenant.get(l.tenantId) ?? []), l]);

  const result: CloseLegacyResult = {
    runId,
    dryRun: opts.dryRun,
    tenants: [],
    totalFound: open.length,
    totalClosed: 0,
  };
  for (const [tenantId, loans] of byTenant) {
    const byStatus: Record<string, number> = {};
    for (const l of loans) byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
    let closed = 0;
    if (!opts.dryRun)
      closed = await prisma.$transaction(async (tx) => {
        let n = 0;
        for (const l of loans) {
          const res = await tx.loan.updateMany({
            where: { id: l.id, tenantId, status: l.status },
            data: {
              status: 'REJECTED',
              rejectedAt: now,
              rejectedBy: LEGACY_CLOSE_ACTOR,
              rejectionReason: LEGACY_CLOSE_REASON,
            },
          });
          // Changed meanwhile (another run): nothing to record here.
          if (res.count !== 1) continue;
          await tx.auditLog.create({
            data: {
              tenantId,
              userId: null,
              action: 'UPDATE',
              entity: 'Loan',
              entityId: l.id,
              metadata: {
                event: 'LEGACY_APPLICATION_CLOSED',
                from: l.status,
                to: 'REJECTED',
                reason: LEGACY_CLOSE_REASON,
                runId,
                operator: opts.operator,
              },
            },
          });
          n++;
        }
        return n;
      });
    result.totalClosed += closed;
    result.tenants.push({
      tenantId,
      found: loans.length,
      closed,
      byStatus,
      loanIds: loans.map((l) => l.id),
    });
  }
  return result;
}
