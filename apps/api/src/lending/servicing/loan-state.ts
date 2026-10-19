import { NotFoundException } from '@nestjs/common';
import { lending } from '@microloan/shared';
import type { Tx } from '../common/lending-prisma';
import { D, toLocalDate } from '../common/util';
import { loanAccountResource } from '../policy/resources';
import type { Resource } from '../policy/decision';

export type Line = Awaited<
  ReturnType<Tx['scheduleInstalment']['findMany']>
>[number];
export type Account = NonNullable<
  Awaited<ReturnType<Tx['loanAccount']['findFirst']>>
>;

export interface LoanState {
  account: Account;
  agreementVersion: number;
  contract: lending.ScheduleInput;
  config: lending.ProductConfig;
  configValid: boolean;
  /** Current schedule: everything not superseded, ordered by number. */
  lines: Line[];
  productCode: string;
  productVersionStatus: string;
  /** Interest earned on lines closed by a restructure, frozen at the effective date. */
  closedAccrual: InstanceType<typeof lending.D>;
  /**
   * Days past due established outside the schedule — a facility's unpaid
   * minimum payment (UC-38). Set by a batch hook; the larger of this and the
   * schedule's figure applies.
   */
  externalDpd?: number;
}

export const LIVE_STATUSES = ['DUE', 'PAID'];

export async function loadLoanState(
  tx: Tx,
  tenantId: string,
  accountId: string,
  opts: { lock?: boolean } = {},
): Promise<LoanState> {
  if (opts.lock !== false) {
    // Serialize money operations per loan: a concurrent request waits here and
    // then reads the committed result, instead of racing on stale balances.
    // Raw SQL bypasses the Prisma tenant guard, so it is scoped by tenant explicitly
    // (and row-level security applies inside the tenant transaction).
    await tx.$queryRaw`SELECT id FROM "LoanAccount" WHERE id = ${accountId} AND "tenantId" = ${tenantId} FOR UPDATE`;
  }
  const account = await tx.loanAccount.findFirst({
    where: { id: accountId, tenantId },
  });
  if (!account) throw new NotFoundException('Loan account not found');
  // The agreement itself is not read: the account's foreign key guarantees it
  // exists, and only its latest version is used. The live lines and the lines
  // closed by a restructure come back in one query.
  const [latest, scheduled, product, version] = await Promise.all([
    tx.agreementVersion.findFirst({
      where: { tenantId, agreementId: account.agreementId },
      orderBy: { version: 'desc' },
    }),
    tx.scheduleInstalment.findMany({
      where: {
        tenantId,
        loanAccountId: account.id,
        status: { in: [...LIVE_STATUSES, 'RESTRUCTURED'] },
      },
      orderBy: { number: 'asc' },
    }),
    tx.lendingProduct.findFirst({
      where: { id: account.productId, tenantId },
      select: { code: true },
    }),
    tx.productVersion.findFirst({
      where: { id: account.productVersionId, tenantId },
      select: { status: true },
    }),
  ]);
  if (!latest) throw new NotFoundException('Agreement not found');
  const lines = scheduled.filter((l) => LIVE_STATUSES.includes(l.status));
  // Interest earned on lines a restructure closed, frozen at the effective date.
  const closedAccrual = scheduled
    .filter((l) => l.status === 'RESTRUCTURED')
    .reduce((t, l) => t.plus(D(l.accruedAtClose ?? '0')), D('0'));
  const parsed = lending.validateProductConfig(latest.productConfig);
  return {
    account,
    agreementVersion: latest.version,
    contract: latest.scheduleInput as unknown as lending.ScheduleInput,
    config: (parsed.ok
      ? parsed.config
      : latest.productConfig) as lending.ProductConfig,
    configValid: parsed.ok,
    lines,
    productCode: product?.code ?? '',
    productVersionStatus: version?.status ?? 'UNKNOWN',
    closedAccrual,
  };
}

export function resourceOf(
  state: LoanState,
  makerIds: string[] = [],
  amount?: string,
): Resource {
  return loanAccountResource(
    state.account,
    state.productCode,
    state.productVersionStatus,
    state.configValid,
    makerIds,
    amount,
  );
}

export const outstanding = (l: Line) => ({
  PENALTY: D(l.penaltyDue).minus(D(l.penaltyPaid)),
  FEE: D(l.feeDue).minus(D(l.feePaid)),
  TAX: D(l.taxDue).minus(D(l.taxPaid)),
  // Deferred arrears carried in by a restructure are repaid as interest (already accrued before).
  INTEREST: D(l.interestDue)
    .plus(D(l.deferredInterestDue))
    .minus(D(l.interestPaid)),
  PRINCIPAL: D(l.principalDue).minus(D(l.principalPaid)),
});

export function lineFullyPaid(l: Line): boolean {
  return Object.values(outstanding(l)).every((v) => v.lte(0));
}

/** Engine view of a stored line. */
export function engineLine(
  l: Line,
): lending.RemainingLine & { capitalizedInterest: string } {
  return {
    number: l.number,
    periodStart: toLocalDate(l.periodStart)!,
    periodEnd: toLocalDate(l.periodEnd)!,
    dueDate: toLocalDate(l.dueDate)!,
    openingPrincipal: l.openingPrincipal.toString(),
    principal: l.principalDue.toString(),
    interest: l.interestDue.toString(),
    capitalizedInterest: l.capitalizedInterest.toString(),
  };
}

/**
 * Interest the contract has earned up to `asOf` across the current schedule.
 * A line whose due date has arrived is fully earned even if its accrual
 * period ends later (PRECEDING business-day adjustment).
 */
export function contractualAccrual(state: LoanState, asOf: string) {
  // Lines closed by a restructure keep the interest they had earned; deferred
  // arrears (deferredInterestDue) are not interest earned again, so they are excluded.
  let total = state.closedAccrual;
  for (const l of state.lines) {
    if (l.number === 0) continue;
    // Interest deferred to later instalments is still earned over this period.
    const e = {
      ...engineLine(l),
      capitalizedInterest: D(l.capitalizedInterest)
        .plus(D(l.deferredAccrual))
        .toString(),
    };
    total = total.plus(
      lending.compareDates(e.dueDate, asOf) <= 0
        ? D(l.interestDue)
            .plus(D(l.capitalizedInterest))
            .plus(D(l.deferredAccrual))
        : lending.accruedOnLine(e, asOf, state.contract),
    );
  }
  return total;
}

/**
 * Days from disbursement to the maturity first agreed: chooses the NBC band
 * set (D-114). Null when not known — the loan is then graded on the
 * short-term bands, the stricter set.
 */
export function originalTermDays(a: {
  disbursementDate: Date | null;
  maturityDate: Date | null;
  originalMaturityDate: Date | null;
  isRestructured: boolean;
}): number | null {
  const end =
    a.originalMaturityDate ?? (a.isRestructured ? null : a.maturityDate);
  if (!a.disbursementDate || !end) return null;
  return lending.daysBetween(
    toLocalDate(a.disbursementDate)!,
    toLocalDate(end)!,
  );
}
