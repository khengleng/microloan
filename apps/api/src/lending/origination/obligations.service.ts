import { Injectable } from '@nestjs/common';
import { lending } from '@microloan/shared';
import { TenantSettingsService } from '../../tenant-settings/tenant-settings.service';
import { BusinessDateService } from '../common/business-date.service';
import type { Tx } from '../common/lending-prisma';
import { D, toLocalDate } from '../common/util';

type Dec = InstanceType<typeof lending.D>;

/** What an application declares about the borrower's debts elsewhere. */
export interface DeclaredObligations {
  declaredExternalMonthlyPayments?: unknown;
  declaredOtherLenders?: number | null;
  refinancesLoanId?: string | null;
}

export interface ObligationsResult {
  /** Monthly repayments the borrower already owes, besides this loan. */
  monthly: Dec;
  metrics: Record<string, string | number | null>;
  blocking: { code: string; message: string }[];
}

/** Average months from `from` to `to`, at least one. */
function monthsBetween(from: string, to: string): Dec {
  return lending.D.max(
    1,
    new lending.D(lending.daysBetween(from, to)).div('30.4375'),
  );
}

/**
 * The borrower's other obligations for the debt-service ratio (D-126): the
 * instalments of their other live loans with this lender, the latest minimum
 * payment of their open credit lines and cards, and what they declared they
 * pay other lenders. Also the lender-count eligibility rule.
 *
 * Read on committed state inside the assessment's transaction; nothing is
 * cached. Loans in another currency than the application's are not
 * converted: they are counted in a metric for the approver instead.
 */
@Injectable()
export class BorrowerObligationsService {
  constructor(
    private readonly settings: TenantSettingsService,
    private readonly businessDate: BusinessDateService,
  ) {}

  async assess(
    tx: Tx,
    app: DeclaredObligations & {
      tenantId: string;
      borrowerId: string;
      groupId?: string | null;
      currency: string;
    },
    groupLiability: boolean,
  ): Promise<ObligationsResult> {
    const tenantId = app.tenantId;
    const settings = (await this.settings.get(tenantId, tx)).affordability;
    const today = await this.businessDate.get(tenantId, tx);
    const metrics: Record<string, string | number | null> = {};
    const blocking: ObligationsResult['blocking'] = [];

    // The people whose income the ratio is measured against.
    const borrowerIds =
      groupLiability && app.groupId
        ? (
            await tx.groupMembership.findMany({
              where: { tenantId, groupId: app.groupId, leftOn: null },
              select: { borrowerId: true },
            })
          ).map((m) => m.borrowerId)
        : [app.borrowerId];

    let own = D('0');
    let ownLoans = 0;
    let otherCurrency = 0;
    if (settings.includeOwnLoans) {
      const accounts = await tx.loanAccount.findMany({
        where: {
          tenantId,
          borrowerId: { in: borrowerIds },
          status: { in: ['BOOKED', 'ACTIVE'] },
          ...(app.refinancesLoanId
            ? { id: { not: app.refinancesLoanId } }
            : {}),
        },
        select: { id: true, currency: true, status: true, agreementId: true },
      });
      for (const a of accounts) {
        if (a.currency !== app.currency) {
          otherCurrency++;
          continue;
        }
        const monthly =
          a.status === 'ACTIVE'
            ? await this.activeMonthly(tx, tenantId, a.id, today)
            : await this.bookedMonthly(tx, tenantId, a.agreementId);
        if (monthly.gt(0)) {
          own = own.plus(monthly);
          ownLoans++;
        }
      }
    }

    let lines = D('0');
    let openLines = 0;
    if (settings.includeFacilityMinimumPayments) {
      const facilities = await tx.facility.findMany({
        where: {
          tenantId,
          borrowerId: { in: borrowerIds },
          status: { in: ['ACTIVE', 'SUSPENDED'] },
        },
        select: { id: true, currency: true },
      });
      for (const f of facilities) {
        const st = await tx.facilityStatement.findFirst({
          where: { tenantId, facilityId: f.id },
          orderBy: { sequence: 'desc' },
          select: { minimumPayment: true },
        });
        if (!st?.minimumPayment || D(st.minimumPayment).lte(0)) continue;
        if (f.currency !== app.currency) {
          otherCurrency++;
          continue;
        }
        lines = lines.plus(D(st.minimumPayment));
        openLines++;
      }
    }

    const declared =
      app.declaredExternalMonthlyPayments !== null &&
      app.declaredExternalMonthlyPayments !== undefined
        ? D(app.declaredExternalMonthlyPayments as string)
        : D('0');
    const monthly = own.plus(lines).plus(declared);
    metrics.otherLoansMonthlyPayment = own.toDecimalPlaces(2).toString();
    metrics.otherLoans = ownLoans;
    metrics.creditLinesMinimumPayment = lines.toDecimalPlaces(2).toString();
    metrics.creditLines = openLines;
    metrics.declaredExternalMonthlyPayments = declared
      .toDecimalPlaces(2)
      .toString();
    metrics.declaredOtherLenders = app.declaredOtherLenders ?? null;
    metrics.otherObligationsMonthly = monthly.toDecimalPlaces(2).toString();
    if (otherCurrency) metrics.obligationsInOtherCurrencies = otherCurrency;

    // Over-indebtedness: the borrower may owe at most this many lenders,
    // counting this one. Checked at submission and approval alike, since the
    // declaration can only be corrected while the application is a draft.
    const max = settings.maxLendersPerBorrower;
    if (max !== null) {
      const declaredLenders = app.declaredOtherLenders;
      if (declaredLenders === null || declaredLenders === undefined)
        blocking.push({
          code: 'LENDERS',
          message: `Record how many other lenders the borrower owes; this lender allows at most ${max} lender(s) per borrower.`,
        });
      else {
        metrics.lenderCount = declaredLenders + 1;
        if (declaredLenders + 1 > max)
          blocking.push({
            code: 'LENDERS',
            message: `The borrower would owe ${declaredLenders + 1} lenders; at most ${max} are allowed.`,
          });
      }
    }
    return { monthly, metrics, blocking };
  }

  /** An active loan's average monthly repayment over what is left of it. */
  private async activeMonthly(
    tx: Tx,
    tenantId: string,
    loanAccountId: string,
    today: string,
  ): Promise<Dec> {
    const due = await tx.scheduleInstalment.findMany({
      where: { tenantId, loanAccountId, status: 'DUE' },
      select: {
        dueDate: true,
        principalDue: true,
        interestDue: true,
        feeDue: true,
        taxDue: true,
        principalPaid: true,
        interestPaid: true,
        feePaid: true,
        taxPaid: true,
      },
    });
    if (!due.length) return D('0');
    let total = D('0');
    let last = today;
    for (const l of due) {
      total = total
        .plus(D(l.principalDue).minus(D(l.principalPaid)))
        .plus(D(l.interestDue).minus(D(l.interestPaid)))
        .plus(D(l.feeDue).minus(D(l.feePaid)))
        .plus(D(l.taxDue).minus(D(l.taxPaid)));
      const d = toLocalDate(l.dueDate)!;
      if (lending.compareDates(d, last) > 0) last = d;
    }
    return total.div(monthsBetween(today, last));
  }

  /** A booked, not yet disbursed loan: its contract schedule's average monthly payment. */
  private async bookedMonthly(
    tx: Tx,
    tenantId: string,
    agreementId: string,
  ): Promise<Dec> {
    const v = await tx.agreementVersion.findFirst({
      where: { tenantId, agreementId },
      orderBy: { version: 'desc' },
      select: { calculation: true },
    });
    const s = (
      v?.calculation as {
        schedule?: {
          lines?: { dueDate: string }[];
          totals?: { payments?: string };
        };
      } | null
    )?.schedule;
    if (!s?.lines?.length || !s.totals?.payments) return D('0');
    const first = s.lines[0].dueDate;
    const last = s.lines[s.lines.length - 1].dueDate;
    // From one period before the first due date: the loan's whole term.
    const months = lending.D.max(
      1,
      monthsBetween(first, last).plus(s.lines.length > 1 ? D(1) : D(0)),
    );
    return D(s.totals.payments).div(months);
  }
}
