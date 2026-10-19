/**
 * Exact money and locking helpers for the original (legacy) loan module
 * (DECISIONS D-098 – D-102).
 *
 * Amounts are Prisma decimals end to end; they become numbers only at the
 * ledger boundary, already rounded to cents.
 */
import { Prisma } from '@microloan/db';

export type Dec = Prisma.Decimal;
export const dec = (v: unknown): Dec =>
  new Prisma.Decimal(
    v === null || v === undefined || v === '' ? 0 : (v as string),
  );
export const ZERO = new Prisma.Decimal(0);
export const maxDec = (a: Dec, b: Dec) => (a.gt(b) ? a : b);
export const minDec = (a: Dec, b: Dec) => (a.lt(b) ? a : b);
/** Cents, half up. */
export const cents = (d: Dec) =>
  d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
/** A cent-exact decimal as the number the ledger service takes. */
export const ledgerAmount = (d: Dec) => cents(d).toNumber();

/** The tenant's local time zone for the legacy jobs and calendar dates. */
export const LEGACY_TIME_ZONE = process.env.LENDING_EOD_TZ || 'Asia/Phnom_Penh';

/**
 * Lock a legacy loan for the rest of the transaction. Every legacy write
 * that changes the loan's schedule, status or ledger takes this lock first, so
 * two of them on one loan run one after the other and each re-reads what the
 * other committed.
 */
export async function lockLegacyLoan(
  tx: Prisma.TransactionClient,
  loanId: string,
  tenantId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Loan" WHERE id = ${loanId} AND "tenantId" = ${tenantId} FOR UPDATE`;
  return rows.length === 1;
}

/** Serialise legacy provisioning runs and write-offs of one tenant. */
export async function lockLegacyProvisioning(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`legacy-provisioning:${tenantId}`}))`;
}

// ── Allocation ────────────────────────────────────────────────────────────

export interface AllocSchedule {
  id: string;
  installmentNumber: number;
  principalAmount: unknown;
  interestAmount: unknown;
  penaltyAmount: unknown;
  totalAmount: unknown;
  paidPrincipal: unknown;
  paidInterest: unknown;
  paidPenalty: unknown;
  isPaid: boolean;
}

export interface AllocationLine {
  scheduleId: string;
  principal: string;
  interest: string;
  penalty: string;
  waivedInterest: string;
  /** Whether the instalment is fully paid after this line. */
  isPaid: boolean;
}

export interface StoredAllocation {
  kind: 'REPAYMENT' | 'SETTLEMENT';
  lines: Omit<AllocationLine, 'isPaid'>[];
}

/** What is still owed on unpaid instalments: interest + principal + penalty. */
export function totalDue(schedules: AllocSchedule[]): Dec {
  return schedules
    .filter((s) => !s.isPaid)
    .reduce(
      (t, s) =>
        t
          .plus(maxDec(ZERO, dec(s.interestAmount).minus(dec(s.paidInterest))))
          .plus(
            maxDec(ZERO, dec(s.principalAmount).minus(dec(s.paidPrincipal))),
          )
          .plus(maxDec(ZERO, dec(s.penaltyAmount).minus(dec(s.paidPenalty)))),
      ZERO,
    );
}

/**
 * The legacy allocation, exactly: instalments in order, within each interest,
 * then principal, then penalty. Only unpaid instalments take money.
 */
export function allocateRepayment(
  schedules: AllocSchedule[],
  amount: Dec,
): {
  lines: AllocationLine[];
  interest: Dec;
  principal: Dec;
  penalty: Dec;
  applied: Dec;
} {
  let left = amount;
  let interest = ZERO;
  let principal = ZERO;
  let penalty = ZERO;
  const lines: AllocationLine[] = [];
  const ordered = [...schedules]
    .filter((s) => !s.isPaid)
    .sort((a, b) => a.installmentNumber - b.installmentNumber);
  for (const s of ordered) {
    if (left.lte(0)) break;
    const dueI = maxDec(ZERO, dec(s.interestAmount).minus(dec(s.paidInterest)));
    const dueP = maxDec(
      ZERO,
      dec(s.principalAmount).minus(dec(s.paidPrincipal)),
    );
    const duePen = maxDec(ZERO, dec(s.penaltyAmount).minus(dec(s.paidPenalty)));
    const i = minDec(left, dueI);
    left = left.minus(i);
    const p = minDec(left, dueP);
    left = left.minus(p);
    const pen = minDec(left, duePen);
    left = left.minus(pen);
    if (i.isZero() && p.isZero() && pen.isZero()) continue;
    interest = interest.plus(i);
    principal = principal.plus(p);
    penalty = penalty.plus(pen);
    const paidAfter = dec(s.paidInterest)
      .plus(i)
      .plus(dec(s.paidPrincipal))
      .plus(p)
      .plus(dec(s.paidPenalty))
      .plus(pen);
    lines.push({
      scheduleId: s.id,
      interest: i.toFixed(2),
      principal: p.toFixed(2),
      penalty: pen.toFixed(2),
      waivedInterest: '0.00',
      isPaid: paidAfter.gte(dec(s.totalAmount)),
    });
  }
  return {
    lines,
    interest,
    principal,
    penalty,
    applied: interest.plus(principal).plus(penalty),
  };
}

/**
 * Undo a repayment recorded before its allocation was kept: take each
 * component back from the latest instalments first, so the schedule loses
 * exactly what the ledger reversal takes back.
 */
export function unallocateByComponent(
  schedules: AllocSchedule[],
  amounts: { principal: Dec; interest: Dec; penalty: Dec },
): Omit<AllocationLine, 'isPaid'>[] {
  const byId = new Map<string, Omit<AllocationLine, 'isPaid'>>();
  const ordered = [...schedules].sort(
    (a, b) => b.installmentNumber - a.installmentNumber,
  );
  const take = (
    component: 'principal' | 'interest' | 'penalty',
    paidField: 'paidPrincipal' | 'paidInterest' | 'paidPenalty',
  ) => {
    let left = amounts[component];
    for (const s of ordered) {
      if (left.lte(0)) break;
      const t = minDec(left, maxDec(ZERO, dec(s[paidField])));
      if (t.isZero()) continue;
      left = left.minus(t);
      const line = byId.get(s.id) ?? {
        scheduleId: s.id,
        principal: '0.00',
        interest: '0.00',
        penalty: '0.00',
        waivedInterest: '0.00',
      };
      line[component] = dec(line[component]).plus(t).toFixed(2);
      byId.set(s.id, line);
    }
    return left;
  };
  const short = [
    take('penalty', 'paidPenalty'),
    take('principal', 'paidPrincipal'),
    take('interest', 'paidInterest'),
  ];
  if (short.some((l) => l.gt(0)))
    throw new Error(
      'The schedule no longer holds what this repayment paid; it cannot be reversed automatically.',
    );
  return [...byId.values()];
}

// ── Calendar dates in the tenant's zone ─────────────────────────────────

/** The calendar date (YYYY-MM-DD) at `at` in `timeZone`. */
export function localDate(at: Date, timeZone = LEGACY_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The instant local midnight of `date` falls in `timeZone`. */
export function localMidnight(date: string, timeZone = LEGACY_TIME_ZONE): Date {
  const utcMidnight = new Date(`${date}T00:00:00.000Z`);
  // The zone's offset at that moment (no DST in Cambodia; correct elsewhere
  // except within an hour of a transition).
  const shown = new Date(
    `${localDate(utcMidnight, timeZone)}T${new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).format(utcMidnight)}.000Z`,
  );
  const offsetMs = shown.getTime() - utcMidnight.getTime();
  return new Date(utcMidnight.getTime() - offsetMs);
}

/** A legacy date-only value (stored at UTC midnight) as its calendar date. */
export const calendarDate = (d: Date) => d.toISOString().slice(0, 10);

/** Whole days from calendar date `from` to `to`. */
export const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
