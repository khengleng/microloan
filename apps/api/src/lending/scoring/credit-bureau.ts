import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { lending } from '@microloan/shared';
import type { Adapter } from '../integrations/adapters';
import type { Tx } from '../common/lending-prisma';
import { D, fromLocalDate, localDateIn, toLocalDate } from '../common/util';
import { maskIdNumber, maskPhone } from '../../common/mask';
import { instalmentHistories } from './repayment-history';

/**
 * Credit bureau providers (DECISIONS D-176, D-180).
 *
 * A credit report comes from a provider chosen in the tenant's settings
 * (`scoring.creditReport.provider`, default INTERNAL):
 *
 *  - INTERNAL — the lender's in-house bureau: the report is assembled from
 *    this tenant's own records only (lending loans, credit lines and cards,
 *    and the read-only legacy loan archive). No other lender's data exists
 *    here, so nothing is shared between tenants.
 *  - CBC — Credit Bureau Cambodia. On hold: this is an adapter shell that
 *    reports "not configured / on hold" (capability bureau.cbc_provider,
 *    REQUIRES_INTEGRATION). A real adapter slots in here; it must return the
 *    same CreditReportInput, so the report, grid, score and documents work
 *    unchanged.
 */
export const CREDIT_BUREAU_PROVIDERS = ['INTERNAL', 'CBC'] as const;
export type CreditBureauProviderCode = (typeof CREDIT_BUREAU_PROVIDERS)[number];

/** Whose report, as of when, under which consent. */
export interface CreditReportSubjectRef {
  tenantId: string;
  borrowerId: string;
  /** The application being decided, if any: listed among enquiries, never counted against the borrower. */
  applicationId: string | null;
  consentId: string;
  asOf: string;
  /** This pull, listed as the latest enquiry. */
  enquiry: { id: string; reference: string; purpose: string; by: string };
}

export type BureauAvailability =
  | { usable: true }
  | {
      usable: false;
      reason: 'ON_HOLD' | 'NOT_CONFIGURED';
      capability: string;
      message: string;
    };

export interface CreditBureauProvider extends Adapter {
  readonly code: CreditBureauProviderCode;
  availability(tx: Tx, tenantId: string): Promise<BureauAvailability>;
  /** Everything the report is built from (the engine builds the report itself). */
  fetch(
    tx: Tx,
    subject: CreditReportSubjectRef,
  ): Promise<lending.CreditReportInput>;
}

/** Credit Bureau Cambodia: on hold. Never fabricates a report. */
export class CbcBureauShell implements CreditBureauProvider {
  readonly code = 'CBC' as const;
  readonly name = 'CBC_ON_HOLD';
  readonly isMock = false;
  availability(): Promise<BureauAvailability> {
    return Promise.resolve({
      usable: false,
      reason: 'ON_HOLD',
      capability: 'bureau.cbc_provider',
      message:
        'Credit Bureau Cambodia is not configured: the integration is on hold. Choose the in-house provider (INTERNAL) in the lending settings.',
    });
  }
  fetch(): Promise<lending.CreditReportInput> {
    return Promise.reject(
      new ServiceUnavailableException({
        message: 'Credit Bureau Cambodia is not configured (on hold).',
        code: 'BUREAU_NOT_CONFIGURED',
      }),
    );
  }
}

const LEGACY_REPORTED = [
  'DISBURSED',
  'DEFAULTED',
  'CLOSED',
  'WRITTEN_OFF',
] as const;

/** The in-house bureau: the borrower's report from this tenant's own records. */
@Injectable()
export class InternalCreditBureau implements CreditBureauProvider {
  readonly code = 'INTERNAL' as const;
  readonly name = 'INTERNAL_BUREAU';
  readonly isMock = false;

  availability(): Promise<BureauAvailability> {
    return Promise.resolve({ usable: true });
  }

  async fetch(
    tx: Tx,
    s: CreditReportSubjectRef,
  ): Promise<lending.CreditReportInput> {
    const { tenantId, borrowerId, asOf } = s;
    const [subject, lendingLines, legacyLines, guarantees, enquiries] =
      await Promise.all([
        this.subject(tx, tenantId, borrowerId),
        this.lendingFacilities(tx, tenantId, borrowerId),
        this.legacyLoans(tx, tenantId, borrowerId),
        this.guarantees(tx, tenantId, borrowerId),
        this.enquiries(tx, s),
      ]);
    return {
      asOf,
      subject,
      facilities: [...lendingLines, ...legacyLines],
      guarantees,
      enquiries,
    };
  }

  private async subject(
    tx: Tx,
    tenantId: string,
    borrowerId: string,
  ): Promise<lending.CreditReportSubject> {
    const b = await tx.borrower.findFirstOrThrow({
      where: { id: borrowerId, tenantId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        idType: true,
        idNumber: true,
        phone: true,
        occupation: true,
        createdAt: true,
        branch: { select: { name: true, code: true } },
      },
    });
    return {
      borrowerId: b.id,
      name: `${b.firstName} ${b.lastName}`.trim(),
      dateOfBirth: toLocalDate(b.dateOfBirth),
      idType: b.idType,
      idNumberMasked: b.idNumber ? maskIdNumber(b.idNumber) : null,
      phoneMasked: b.phone ? maskPhone(b.phone) : null,
      occupation: b.occupation,
      branch: b.branch ? (b.branch.code ?? b.branch.name) : null,
      customerSince: localDateIn(b.createdAt),
    };
  }

  /** Lending loans, credit lines and cards: one loan account each. */
  private async lendingFacilities(
    tx: Tx,
    tenantId: string,
    borrowerId: string,
  ): Promise<lending.CreditFacilityInput[]> {
    const accounts = await tx.loanAccount.findMany({
      where: { tenantId, borrowerId, status: { not: 'BOOKED' } },
      orderBy: { createdAt: 'asc' },
    });
    if (!accounts.length) return [];
    const ids = accounts.map((a) => a.id);
    const [
      facilities,
      products,
      histories,
      restructuredLines,
      amendments,
      sales,
      negotiated,
    ] = await Promise.all([
      tx.facility.findMany({
        where: {
          tenantId,
          agreementId: { in: accounts.map((a) => a.agreementId) },
        },
        include: { card: { select: { id: true } } },
      }),
      tx.lendingProduct.findMany({
        where: {
          tenantId,
          id: { in: [...new Set(accounts.map((a) => a.productId))] },
        },
        select: { id: true, name: true },
      }),
      // The lender's instalment history, as alternative data reads it (reused, not re-derived).
      instalmentHistories(tx, tenantId, ids),
      // Lines a restructure closed while still owed: owed until the restructure took effect.
      tx.scheduleInstalment.findMany({
        where: {
          tenantId,
          loanAccountId: { in: ids },
          status: 'RESTRUCTURED',
          projected: false,
        },
        select: { loanAccountId: true, dueDate: true, agreementVersion: true },
      }),
      tx.loanAmendment.findMany({
        where: { tenantId, loanAccountId: { in: ids }, status: 'EXECUTED' },
        select: {
          loanAccountId: true,
          fromAgreementVersion: true,
          effectiveDate: true,
        },
      }),
      tx.debtSale.findMany({
        where: { tenantId, loanAccountId: { in: ids }, status: 'EXECUTED' },
        select: { loanAccountId: true, saleDate: true },
      }),
      tx.financialEvent.findMany({
        where: {
          tenantId,
          loanAccountId: { in: ids },
          type: 'SETTLEMENT',
          status: 'POSTED',
        },
        select: { loanAccountId: true, components: true },
      }),
    ]);
    const facilityOf = new Map(facilities.map((f) => [f.agreementId, f]));
    const productName = new Map(products.map((p) => [p.id, p.name]));
    return accounts.map((a) => {
      const fac = facilityOf.get(a.agreementId) ?? null;
      const amend = amendments.filter((m) => m.loanAccountId === a.id);
      const instalments: lending.ReportInstalment[] = (
        histories.get(a.id) ?? []
      ).map((h) => ({ dueDate: h.dueDate, clearedOn: h.paidOn }));
      for (const l of restructuredLines.filter(
        (x) => x.loanAccountId === a.id,
      )) {
        const m = amend.find(
          (x) => x.fromAgreementVersion === l.agreementVersion,
        );
        instalments.push({
          dueDate: toLocalDate(l.dueDate)!,
          clearedOn: m ? toLocalDate(m.effectiveDate) : null,
        });
      }
      const sale = sales.find((x) => x.loanAccountId === a.id);
      const writtenOffOn =
        a.status === 'WRITTEN_OFF' || a.writtenOffAt
          ? a.writtenOffAt
            ? localDateIn(a.writtenOffAt)
            : null
          : null;
      const status: lending.FacilityStatus = sale
        ? 'SOLD'
        : a.status === 'CLOSED'
          ? 'CLOSED'
          : a.status === 'WRITTEN_OFF'
            ? 'WRITTEN_OFF'
            : 'ACTIVE';
      const closedOn = sale
        ? toLocalDate(sale.saleDate)
        : a.status === 'CLOSED' && a.closedAt
          ? localDateIn(a.closedAt)
          : null;
      const kind: lending.FacilityKind = fac?.card
        ? 'CARD'
        : fac
          ? (fac.facilityType as lending.FacilityKind)
          : 'TERM_LOAN';
      const openedOn =
        toLocalDate(a.disbursementDate) ??
        (fac && !['PENDING', 'CANCELLED'].includes(fac.status)
          ? toLocalDate(fac.availabilityFrom)
          : null);
      const balance = D(a.principalOutstanding)
        .plus(D(a.interestReceivable))
        .plus(D(a.feesReceivable))
        .plus(D(a.penaltyReceivable));
      return {
        id: a.id,
        source: 'LENDING' as const,
        reference: a.reference,
        product: productName.get(a.productId) ?? a.familyCode,
        kind,
        revolving: !!fac?.card || !!fac?.limitReinstates,
        currency: a.currency,
        openedOn,
        closedOn,
        status,
        limit: fac ? D(fac.limitAmount).toFixed(2) : null,
        principal: D(fac ? fac.totalDrawn : a.bookedPrincipal).toFixed(2),
        balance: (status === 'ACTIVE' || status === 'WRITTEN_OFF'
          ? balance
          : D(0)
        ).toFixed(2),
        instalment:
          a.instalmentAmount !== null ? D(a.instalmentAmount).toFixed(2) : null,
        writtenOffOn,
        restructuredOn: [
          ...new Set(amend.map((m) => toLocalDate(m.effectiveDate)!)),
        ].sort(lending.compareDates),
        settled: negotiated.some(
          (e) =>
            e.loanAccountId === a.id &&
            !!(e.components as { negotiated?: boolean } | null)?.negotiated,
        ),
        currentDpd: status === 'ACTIVE' ? a.daysPastDue : null,
        instalments,
      };
    });
  }

  /** The legacy loan archive (read-only): loans that carried money on the original book. */
  private async legacyLoans(
    tx: Tx,
    tenantId: string,
    borrowerId: string,
  ): Promise<lending.CreditFacilityInput[]> {
    const loans = await tx.loan.findMany({
      where: { tenantId, borrowerId, status: { in: [...LEGACY_REPORTED] } },
      include: {
        schedules: true,
        product: { select: { name: true } },
        restructures: { select: { createdAt: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!loans.length) return [];
    const ids = loans.map((l) => l.id);
    const [repayments, moved] = await Promise.all([
      tx.repayment.findMany({
        where: { tenantId, loanId: { in: ids }, reversedAt: null },
        select: {
          loanId: true,
          date: true,
          principalPaid: true,
          interestPaid: true,
        },
      }),
      tx.migrationRow.findMany({
        where: {
          tenantId,
          status: 'POSTED',
          externalLoanId: { in: ids.map((id) => `LEGACY-${id}`) },
        },
        select: { externalLoanId: true, loanAccountId: true, postedAt: true },
      }),
    ]);
    const movedTo = new Map(
      moved.map((m) => [m.externalLoanId.slice('LEGACY-'.length), m]),
    );
    const targets = await tx.loanAccount.findMany({
      where: {
        tenantId,
        id: {
          in: moved.map((m) => m.loanAccountId).filter(Boolean) as string[],
        },
      },
      select: { id: true, reference: true },
    });
    const refOf = new Map(targets.map((t) => [t.id, t.reference]));
    return loans.map((l) => {
      const pays = repayments
        .filter((r) => r.loanId === l.id)
        .map((r) => ({
          date: localDateIn(r.date),
          amount: D(r.principalPaid).plus(D(r.interestPaid)).toString(),
        }));
      const schedule = l.schedules.map((x) => ({
        dueDate: localDateIn(x.dueDate),
        amountDue: D(x.principalAmount).plus(D(x.interestAmount)).toString(),
        isPaid: x.isPaid,
      }));
      const instalments = lending.legacyClearances(schedule, pays);
      const transfer = movedTo.get(l.id);
      const lastPay = pays
        .map((p) => p.date)
        .sort(lending.compareDates)
        .pop();
      const open = l.status === 'DISBURSED' || l.status === 'DEFAULTED';
      const status: lending.FacilityStatus = transfer
        ? 'TRANSFERRED'
        : l.status === 'WRITTEN_OFF'
          ? 'WRITTEN_OFF'
          : l.status === 'CLOSED'
            ? 'CLOSED'
            : 'ACTIVE';
      const closedOn = transfer
        ? localDateIn(transfer.postedAt ?? l.updatedAt)
        : l.status === 'CLOSED'
          ? (lastPay ?? localDateIn(l.updatedAt))
          : null;
      const owed = l.schedules.reduce(
        (t, x) =>
          t.plus(
            D(x.totalAmount)
              .minus(D(x.paidPrincipal))
              .minus(D(x.paidInterest))
              .minus(D(x.paidPenalty)),
          ),
        D(0),
      );
      const first = [...l.schedules].sort(
        (a, b) => a.installmentNumber - b.installmentNumber,
      )[0];
      const restructuredOn = [
        ...new Set(
          [
            ...l.restructures.map((r) => r.createdAt),
            ...(l.isRestructured && l.restructuredAt ? [l.restructuredAt] : []),
          ].map((d) => localDateIn(d)),
        ),
      ].sort(lending.compareDates);
      return {
        id: l.id,
        source: 'LEGACY' as const,
        reference: `LEGACY-${l.id.slice(0, 8).toUpperCase()}`,
        product: l.product?.name ?? 'Legacy loan',
        kind: 'LEGACY_LOAN' as const,
        revolving: false,
        currency: String(l.currency),
        openedOn: localDateIn(l.startDate),
        closedOn,
        status,
        limit: null,
        principal: D(l.principal).toFixed(2),
        balance: (open && !transfer && owed.gt(0) ? owed : D(0)).toFixed(2),
        instalment: first
          ? D(first.principalAmount).plus(D(first.interestAmount)).toFixed(2)
          : null,
        writtenOffOn: l.writtenOffAt ? localDateIn(l.writtenOffAt) : null,
        restructuredOn,
        settled: false,
        currentDpd: null,
        instalments,
        transferredTo: transfer?.loanAccountId
          ? (refOf.get(transfer.loanAccountId) ?? transfer.loanAccountId)
          : null,
      };
    });
  }

  /** Guarantees the borrower gave for someone else's application. */
  private async guarantees(
    tx: Tx,
    tenantId: string,
    borrowerId: string,
  ): Promise<lending.GuaranteeInput[]> {
    const rows = await tx.guarantee.findMany({
      where: { tenantId, guarantorBorrowerId: borrowerId },
      include: {
        application: {
          select: {
            id: true,
            reference: true,
            status: true,
            borrower: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!rows.length) return [];
    const loans = await tx.loanAccount.findMany({
      where: {
        tenantId,
        applicationId: { in: rows.map((r) => r.applicationId) },
      },
      select: {
        applicationId: true,
        reference: true,
        status: true,
        principalOutstanding: true,
        daysPastDue: true,
      },
    });
    return rows.map((g) => {
      const loan = loans.find((l) => l.applicationId === g.applicationId);
      return {
        id: g.id,
        applicationReference: g.application.reference,
        principalBorrower:
          `${g.application.borrower.firstName} ${g.application.borrower.lastName}`.trim(),
        type: g.type,
        amount: D(g.amount).toFixed(2),
        currency: g.currency,
        givenOn: localDateIn(g.createdAt),
        applicationStatus: g.application.status,
        loan: loan
          ? {
              reference: loan.reference,
              status: loan.status,
              balance: D(loan.principalOutstanding).toFixed(2),
              daysPastDue: loan.daysPastDue,
            }
          : null,
      };
    });
  }

  /** Applications for credit and report pulls in the last 12 months, and this pull. */
  private async enquiries(
    tx: Tx,
    s: CreditReportSubjectRef,
  ): Promise<lending.EnquiryInput[]> {
    const { tenantId, borrowerId, asOf } = s;
    const sinceTs = fromLocalDate(lending.addMonths(asOf, -12));
    const [apps, pulls] = await Promise.all([
      tx.application.findMany({
        where: { tenantId, borrowerId, createdAt: { gte: sinceTs } },
        select: {
          id: true,
          reference: true,
          createdAt: true,
          createdBy: true,
          productId: true,
          channel: true,
        },
      }),
      tx.creditReport.findMany({
        where: { tenantId, borrowerId, createdAt: { gte: sinceTs } },
        select: {
          id: true,
          reference: true,
          createdAt: true,
          purpose: true,
          requestedBy: true,
        },
      }),
    ]);
    const products = await tx.lendingProduct.findMany({
      where: {
        tenantId,
        id: { in: [...new Set(apps.map((a) => a.productId))] },
      },
      select: { id: true, name: true },
    });
    const productName = new Map(products.map((p) => [p.id, p.name]));
    return [
      ...apps.map((a) => ({
        id: a.id,
        type: 'APPLICATION' as const,
        date: localDateIn(a.createdAt),
        purpose: productName.get(a.productId) ?? a.channel,
        reference: a.reference,
        by: a.createdBy,
        current: a.id === s.applicationId,
      })),
      ...pulls.map((p) => ({
        id: p.id,
        type: 'REPORT' as const,
        date: localDateIn(p.createdAt),
        purpose: p.purpose,
        reference: p.reference,
        by: p.requestedBy,
      })),
      {
        id: s.enquiry.id,
        type: 'REPORT' as const,
        date: asOf,
        purpose: s.enquiry.purpose,
        reference: s.enquiry.reference,
        by: s.enquiry.by,
      },
    ];
  }
}
