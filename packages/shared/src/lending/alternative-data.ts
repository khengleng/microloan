/**
 * Alternative data for thin-file borrowers (DECISIONS D-078, D-079).
 *
 * Three kinds of evidence feed scorecard inputs:
 *  - the lender's own behavioural data (repayments, payment channels, group
 *    contributions), derived here from instalments and payments;
 *  - officer-captured, document-backed observations (utility bills, telco
 *    statements, rent, business cash flow), verified by a second person;
 *  - external providers (smartphone, telco, e-wallet data) — adapters only,
 *    see apps/api/src/lending/scoring/providers.ts.
 *
 * None of it may be fetched or used without the borrower's consent for that
 * source, in force at the time of use. Pure: no I/O, no clock.
 */
import { z } from 'zod';
import { dec } from './decimal.js';
import { addMonths, daysBetween, compareDates, type LocalDate } from './dates.js';
import { wholeMonthsBetween } from './policies.js';
import type { AltDataSource } from './scorecards.js';

// ── Consent ────────────────────────────────────────────────────────────────

export interface ConsentEvent {
  id: string;
  action: 'GRANT' | 'REVOKE';
  source: string;
  /** On a REVOKE: the grant it ends. */
  grantId: string | null;
  /** ISO timestamp the consent was given (GRANT) or withdrawn (REVOKE). */
  effectiveAt: string;
  /** GRANT only. */
  expiresAt: string | null;
}

/**
 * The grant in force for a source at an instant: given at or before it, not
 * expired, and not revoked at or before it. The latest such grant wins.
 */
export function consentInForce(events: ConsentEvent[], source: AltDataSource, at: string): ConsentEvent | null {
  const t = Date.parse(at);
  const revoked = new Map(events.filter((e) => e.action === 'REVOKE' && e.grantId).map((e) => [e.grantId!, Date.parse(e.effectiveAt)]));
  const live = events
    .filter((e) => e.action === 'GRANT' && e.source === source)
    .filter((e) => Date.parse(e.effectiveAt) <= t)
    .filter((e) => e.expiresAt === null || Date.parse(e.expiresAt) > t)
    .filter((e) => {
      const r = revoked.get(e.id);
      return r === undefined || r > t;
    })
    .sort((a, b) => Date.parse(b.effectiveAt) - Date.parse(a.effectiveAt));
  return live[0] ?? null;
}

// ── Officer-captured, document-verified data ───────────────────────────────

const text = (max: number) => z.string().trim().min(1).max(max);
const months = z.number().int().min(1).max(60);
const money = z.string().regex(/^\d+(\.\d{1,4})?$/, 'amounts are decimal strings');

export const OFFICER_DATA_KINDS = ['UTILITY_BILLS', 'TELCO_STATEMENT', 'RENT_HISTORY', 'BUSINESS_CASH_FLOW'] as const;
export type OfficerDataKind = (typeof OFFICER_DATA_KINDS)[number];

const onTime = <T extends z.ZodRawShape>(shape: T, observed: string, counted: string) =>
  z
    .object(shape)
    .strict()
    .superRefine((d: Record<string, unknown>, ctx) => {
      if ((d[counted] as number) > (d[observed] as number)) ctx.addIssue({ code: 'custom', path: [counted], message: `${counted} cannot exceed ${observed}` });
    });

/** What an officer records for each kind; every kind is backed by a customer document. */
export const OFFICER_DATA_SCHEMAS = {
  UTILITY_BILLS: onTime(
    {
      utility: z.enum(['ELECTRICITY', 'WATER']),
      /** E.g. EDC (Électricité du Cambodge) or the local water authority. */
      issuer: text(80),
      accountReference: text(60),
      monthsObserved: months,
      monthsOnTime: z.number().int().min(0).max(60),
    },
    'monthsObserved',
    'monthsOnTime',
  ),
  TELCO_STATEMENT: onTime(
    { operator: text(80), monthsObserved: months, monthsWithTopUp: z.number().int().min(0).max(60) },
    'monthsObserved',
    'monthsWithTopUp',
  ),
  RENT_HISTORY: onTime({ landlord: text(120), monthsObserved: months, monthsOnTime: z.number().int().min(0).max(60) }, 'monthsObserved', 'monthsOnTime'),
  BUSINESS_CASH_FLOW: z
    .object({
      method: z.enum(['SITE_VISIT', 'BANK_STATEMENT', 'SALES_RECORDS', 'OTHER']),
      monthsObserved: months,
      averageMonthlyInflow: money,
      averageMonthlyOutflow: money,
      /** The currency the business keeps its money in (USD or KHR in Cambodia). */
      currency: z.string().regex(/^[A-Z]{3}$/),
    })
    .strict(),
} as const;

/** The consent each officer-captured kind needs. */
export const OFFICER_DATA_CONSENT: Record<OfficerDataKind, AltDataSource> = {
  UTILITY_BILLS: 'UTILITY_BILLS',
  TELCO_STATEMENT: 'TELCO_STATEMENT',
  RENT_HISTORY: 'RENT_HISTORY',
  BUSINESS_CASH_FLOW: 'BUSINESS_CASH_FLOW',
};

export interface VerifiedRecord {
  id: string;
  kind: OfficerDataKind;
  data: Record<string, unknown>;
  /** End of the period observed (YYYY-MM-DD); the newest record of a kind wins. */
  periodTo: LocalDate;
}

export interface DerivedFeature {
  value: string | number | null;
  recordIds: string[];
  note?: string;
}

const ratio = (num: number, den: number) => (den > 0 ? dec(num).div(den).toDecimalPlaces(4).toString() : null);

/**
 * Scorecard inputs from verified officer records. Utility bills combine
 * every utility (electricity and water): on-time months over observed months;
 * the observed depth is the longest record. Telco and rent use the newest
 * record. Business cash flow is returned as a net monthly amount in its own
 * currency; the caller converts it and forms the coverage ratio.
 */
export function officerFeatures(records: VerifiedRecord[]): {
  utilityOnTimeRatio?: DerivedFeature;
  utilityMonthsObserved?: DerivedFeature;
  mobileTopUpMonthsActive?: DerivedFeature;
  rentOnTimeRatio?: DerivedFeature;
  businessNetMonthlyCashFlow?: DerivedFeature & { currency: string };
} {
  const newest = (kind: OfficerDataKind) =>
    records.filter((r) => r.kind === kind).sort((a, b) => compareDates(b.periodTo, a.periodTo))[0] ?? null;
  const out: ReturnType<typeof officerFeatures> = {};
  // Latest record per utility type, so a renewed bill replaces the older one.
  const utilities = new Map<string, VerifiedRecord>();
  for (const r of records.filter((x) => x.kind === 'UTILITY_BILLS').sort((a, b) => compareDates(b.periodTo, a.periodTo))) {
    const key = String(r.data.utility);
    if (!utilities.has(key)) utilities.set(key, r);
  }
  if (utilities.size) {
    const u = [...utilities.values()];
    const observed = u.reduce((s, r) => s + Number(r.data.monthsObserved), 0);
    const onTimeMonths = u.reduce((s, r) => s + Number(r.data.monthsOnTime), 0);
    out.utilityOnTimeRatio = { value: ratio(onTimeMonths, observed), recordIds: u.map((r) => r.id) };
    out.utilityMonthsObserved = { value: Math.max(...u.map((r) => Number(r.data.monthsObserved))), recordIds: u.map((r) => r.id) };
  }
  const telco = newest('TELCO_STATEMENT');
  if (telco) out.mobileTopUpMonthsActive = { value: Number(telco.data.monthsWithTopUp), recordIds: [telco.id] };
  const rent = newest('RENT_HISTORY');
  if (rent) out.rentOnTimeRatio = { value: ratio(Number(rent.data.monthsOnTime), Number(rent.data.monthsObserved)), recordIds: [rent.id] };
  const cf = newest('BUSINESS_CASH_FLOW');
  if (cf) {
    const net = dec(String(cf.data.averageMonthlyInflow)).minus(String(cf.data.averageMonthlyOutflow));
    out.businessNetMonthlyCashFlow = { value: net.toString(), recordIds: [cf.id], currency: String(cf.data.currency) };
  }
  return out;
}

/** Net monthly cash flow over the average monthly instalment (same currency); null without an instalment. */
export function cashFlowCoverage(netMonthly: string, monthlyInstalment: string): string | null {
  const i = dec(monthlyInstalment, 'monthlyInstalment');
  if (i.lte(0)) return null;
  const n = dec(netMonthly, 'netMonthly');
  return (n.lt(0) ? dec(0) : n).div(i).toDecimalPlaces(2).toString();
}

// ── The lender's own behavioural data ──────────────────────────────────────

export interface InstalmentHistory {
  dueDate: LocalDate;
  /** The date the instalment was paid in full; null while any of it is unpaid. */
  paidOn: LocalDate | null;
}

/**
 * Repayment behaviour over instalments fallen due by `asOf`: the share paid
 * in full by the due date, the average and worst lateness (an unpaid
 * instalment is late until `asOf`).
 */
export function repaymentBehaviour(
  instalments: InstalmentHistory[],
  asOf: LocalDate,
): { instalmentsObserved: number; onTimeRepaymentRatio: string | null; averageDaysLate: string | null; maxDaysPastDueEver: number | null } {
  const due = instalments.filter((i) => compareDates(i.dueDate, asOf) <= 0);
  if (!due.length) return { instalmentsObserved: 0, onTimeRepaymentRatio: null, averageDaysLate: null, maxDaysPastDueEver: null };
  const late = due.map((i) => Math.max(0, daysBetween(i.dueDate, i.paidOn && compareDates(i.paidOn, asOf) <= 0 ? i.paidOn : asOf)));
  const onTime = late.filter((d) => d === 0).length;
  return {
    instalmentsObserved: due.length,
    onTimeRepaymentRatio: dec(onTime).div(due.length).toDecimalPlaces(4).toString(),
    averageDaysLate: dec(late.reduce((s, d) => s + d, 0)).div(due.length).toDecimalPlaces(2).toString(),
    maxDaysPastDueEver: Math.max(...late),
  };
}

/** Whole months between the first disbursement with the lender and `asOf`; 0 with none. */
export function historyMonths(firstDisbursement: LocalDate | null, asOf: LocalDate): number {
  return firstDisbursement ? wholeMonthsBetween(firstDisbursement, asOf) : 0;
}

// ── Performance outcome for monitoring ─────────────────────────────────────

/**
 * Whether a booked loan went "bad" — reached `badDaysPastDue` days late on
 * any instalment within `performanceMonths` of disbursement — and whether it
 * has been on book long enough to tell (mature). A written-off loan is bad.
 */
export function performanceOutcome(input: {
  disbursementDate: LocalDate;
  instalments: InstalmentHistory[];
  writtenOff: boolean;
  asOf: LocalDate;
  badDaysPastDue: number;
  performanceMonths: number;
}): { mature: boolean; bad: boolean; worstDaysLate: number } {
  const end = addMonths(input.disbursementDate, input.performanceMonths);
  const mature = compareDates(end, input.asOf) <= 0;
  const horizon = mature ? end : input.asOf;
  let worst = 0;
  for (const i of input.instalments) {
    if (compareDates(i.dueDate, horizon) > 0) continue;
    const settled = i.paidOn && compareDates(i.paidOn, horizon) <= 0 ? i.paidOn : horizon;
    worst = Math.max(worst, daysBetween(i.dueDate, settled));
  }
  const bad = input.writtenOff || worst >= input.badDaysPastDue;
  // A loan that has already gone bad is a known outcome, mature or not.
  return { mature: mature || bad, bad, worstDaysLate: worst };
}

