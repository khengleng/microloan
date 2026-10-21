/**
 * The in-house credit report and bureau characteristics (DECISIONS D-176…D-181).
 *
 * Credit Bureau Cambodia (CBC) is on hold, so each lender builds a CBC-style
 * report on its own borrowers from its own records only: every facility
 * (lending loans, credit lines and cards, and the read-only legacy archive),
 * a 24-month payment-status grid per facility, guarantees the borrower gave,
 * enquiries, totals and the characteristics an internal bureau scorecard
 * reads. Nothing crosses tenants: the report says "1 lender" because it only
 * ever sees one.
 *
 * Pure: no I/O, no clock. The caller passes the facts (instalment due dates
 * and the dates they stopped being owed, write-off and restructure dates, …)
 * and the as-of date; the same input always gives the same report, which is
 * what lets a stored report be reproduced from its stored inputs.
 */
import { dec } from './decimal.js';
import { addDays, addMonths, compareDates, daysBetween, daysInMonth, parseDate, type LocalDate } from './dates.js';
import { wholeMonthsBetween } from './policies.js';
import { evaluateScorecard, type AdverseReason, type ScorecardDefinition, type ScoringInputs } from './scorecards.js';

// ── Report format (CBC-style; a format, not a business setting) ─────────────

export const CREDIT_REPORT_FORMAT_VERSION = 1;
/** Months of payment status shown per facility, newest month last. */
export const CREDIT_REPORT_GRID_MONTHS = 24;
/** Width of a past-due bucket in the payment-status code (1 = 1–29 days, 2 = 30–59, …). */
export const PAYMENT_STATUS_BUCKET_DAYS = 30;
/** The highest numeric payment-status code; it covers everything beyond. */
export const PAYMENT_STATUS_MAX_BUCKET = 6;

/**
 * One month of a facility's payment history:
 *  - '0' current (no instalment past due at month end);
 *  - '1'…'6' past due at month end, in 30-day buckets (1 = 1–29 days, 2 = 30–59, … 6 = 150 days or more);
 *  - 'W' written off (from the month of the write-off);
 *  - 'R' restructured in that month;
 *  - 'C' closed in that month;
 *  - '' no account that month (not yet opened, or closed before it).
 */
export type PaymentStatusCode = '0' | '1' | '2' | '3' | '4' | '5' | '6' | 'W' | 'R' | 'C' | '';
export const PAYMENT_STATUS_CODES: PaymentStatusCode[] = ['0', '1', '2', '3', '4', '5', '6', 'W', 'R', 'C', ''];

/** The numeric code for days past due at a month end. */
export function paymentStatusCode(dpd: number): PaymentStatusCode {
  if (!Number.isFinite(dpd) || dpd <= 0) return '0';
  const bucket = Math.min(PAYMENT_STATUS_MAX_BUCKET, Math.floor(dpd / PAYMENT_STATUS_BUCKET_DAYS) + 1);
  return String(bucket) as PaymentStatusCode;
}

// ── Inputs ───────────────────────────────────────────────────────────────────

/** An instalment and the date it stopped being owed (paid in full, or cleared by a restructure); null while owed. */
export interface ReportInstalment {
  dueDate: LocalDate;
  clearedOn: LocalDate | null;
}

export type FacilityKind = 'TERM_LOAN' | 'REVOLVING' | 'OVERDRAFT' | 'STAGED_DRAWDOWN' | 'CARD' | 'LEGACY_LOAN';
export type FacilityStatus = 'ACTIVE' | 'CLOSED' | 'WRITTEN_OFF' | 'SOLD' | 'TRANSFERRED';

export interface CreditFacilityInput {
  id: string;
  /** LENDING: the lending platform; LEGACY: the read-only legacy loan archive. */
  source: 'LENDING' | 'LEGACY';
  reference: string;
  product: string;
  kind: FacilityKind;
  /** Revolving limits (credit lines, overdrafts, cards) count towards utilisation. */
  revolving: boolean;
  currency: string;
  /** Disbursement or first drawdown; null when never disbursed (not reported). */
  openedOn: LocalDate | null;
  /** Closed, sold or moved to another book; null while open. */
  closedOn: LocalDate | null;
  status: FacilityStatus;
  /** Credit limit for a facility or card; null for a term loan. */
  limit: string | null;
  /** Principal disbursed (term) or limit-drawn total. */
  principal: string;
  /** Outstanding balance today (principal, interest, fees and penalties owed). */
  balance: string;
  /** The scheduled instalment, when there is one. */
  instalment: string | null;
  writtenOffOn: LocalDate | null;
  restructuredOn: LocalDate[];
  /** Settled for less than the balance owed (a negotiated settlement). */
  settled: boolean;
  /** The servicing system's own days past due today, for a live facility; the current month shows the higher of it and the derived figure (a restructure floor, an end of day not yet run). */
  currentDpd: number | null;
  instalments: ReportInstalment[];
  /** For a legacy loan moved to the lending platform: the lending loan it became. */
  transferredTo?: string | null;
}

export interface CreditReportSubject {
  borrowerId: string;
  name: string;
  dateOfBirth: LocalDate | null;
  idType: string | null;
  /** Masked: only the last characters are shown. */
  idNumberMasked: string | null;
  phoneMasked: string | null;
  occupation: string | null;
  branch: string | null;
  customerSince: LocalDate;
}

export interface GuaranteeInput {
  id: string;
  applicationReference: string;
  /** The person the borrower guaranteed. */
  principalBorrower: string;
  type: string;
  amount: string;
  currency: string;
  givenOn: LocalDate;
  applicationStatus: string;
  /** The guaranteed loan, once booked. */
  loan: { reference: string; status: string; balance: string; daysPastDue: number } | null;
}

export type EnquiryType = 'APPLICATION' | 'REPORT';

export interface EnquiryInput {
  id: string;
  type: EnquiryType;
  date: LocalDate;
  /** APPLICATION: the product; REPORT: the purpose of the pull. */
  purpose: string;
  reference: string;
  /** Who made it (staff id) or the channel. */
  by: string | null;
  /** The application being decided now: listed, never counted against the borrower. */
  current?: boolean;
}

export interface CreditReportInput {
  asOf: LocalDate;
  subject: CreditReportSubject;
  facilities: CreditFacilityInput[];
  guarantees: GuaranteeInput[];
  enquiries: EnquiryInput[];
}

// ── Output ───────────────────────────────────────────────────────────────────

export interface PaymentMonth {
  /** YYYY-MM. */
  month: string;
  code: PaymentStatusCode;
  /** Days past due at the month end (or today, for the current month); null when no account. */
  dpd: number | null;
}

export interface CreditFacilityLine {
  id: string;
  source: 'LENDING' | 'LEGACY';
  reference: string;
  product: string;
  kind: FacilityKind;
  revolving: boolean;
  currency: string;
  openedOn: LocalDate | null;
  closedOn: LocalDate | null;
  status: FacilityStatus;
  limit: string | null;
  principal: string;
  balance: string;
  instalment: string | null;
  currentDpd: number;
  worstDpd: number;
  worstDpd12m: number;
  worstDpd24m: number;
  writtenOff: boolean;
  restructured: boolean;
  settled: boolean;
  transferredTo: string | null;
  /** Oldest month first; CREDIT_REPORT_GRID_MONTHS entries. */
  history: PaymentMonth[];
}

/** Report characteristics an internal bureau scorecard reads (variable codes of SCORING_VARIABLES). */
export interface BureauCharacteristics {
  bureauWorstDpd12m: number | null;
  bureauWorstDpd24m: number | null;
  bureauMonthsSinceDelinquency: number | null;
  bureauTimes30Dpd12m: number;
  bureauWriteOff: boolean;
  bureauRestructured: boolean;
  bureauRevolvingUtilisation: string | null;
  bureauOldestFacilityMonths: number | null;
  bureauEnquiries6m: number;
  bureauEnquiries12m: number;
  bureauActiveFacilities: number;
}

export interface CreditReportTotals {
  /** Outstanding balance of open facilities, per currency. */
  exposure: { currency: string; amount: string }[];
  /** Scheduled instalments of open facilities, per currency. */
  monthlyObligation: { currency: string; amount: string }[];
  activeFacilities: number;
  closedFacilities: number;
  writtenOffFacilities: number;
  /** Lenders reporting: this lender only (1), or 0 when there is nothing to report. */
  lenders: number;
  /** Instalments that have fallen due across all facilities. */
  instalmentsFallenDue: number;
}

export interface CreditReportBody {
  formatVersion: number;
  asOf: LocalDate;
  months: string[];
  subject: CreditReportSubject;
  facilities: CreditFacilityLine[];
  guarantees: GuaranteeInput[];
  enquiries: EnquiryInput[];
  totals: CreditReportTotals;
  characteristics: BureauCharacteristics;
}

// ── Derivation ───────────────────────────────────────────────────────────────

const ym = (d: LocalDate) => d.slice(0, 7);

/** The grid's months, oldest first, ending with the as-of month. */
export function reportMonths(asOf: LocalDate, count = CREDIT_REPORT_GRID_MONTHS): string[] {
  const first = `${ym(asOf)}-01`;
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(ym(addMonths(first, -i)));
  return out;
}

function monthBounds(month: string, asOf: LocalDate): { start: LocalDate; end: LocalDate } {
  const start = `${month}-01`;
  const { y, m } = parseDate(start, 'month');
  const last = `${month}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
  return { start, end: compareDates(last, asOf) > 0 ? asOf : last };
}

/** Days past due on a date: the oldest instalment fallen due and still owed at the end of that day. */
export function daysPastDueOn(instalments: ReportInstalment[], date: LocalDate): number {
  let worst = 0;
  for (const i of instalments) {
    if (compareDates(i.dueDate, date) >= 0) continue;
    if (i.clearedOn && compareDates(i.clearedOn, date) <= 0) continue;
    worst = Math.max(worst, daysBetween(i.dueDate, date));
  }
  return worst;
}

/** When an instalment's lateness ended (the day it was cleared, or the as-of date) and how late it got by then. */
function lateness(i: ReportInstalment, asOf: LocalDate): { end: LocalDate; days: number } | null {
  if (compareDates(i.dueDate, asOf) >= 0) return null;
  const end = i.clearedOn && compareDates(i.clearedOn, asOf) <= 0 ? i.clearedOn : asOf;
  const days = daysBetween(i.dueDate, end);
  return days > 0 ? { end, days } : null;
}

/** Worst days past due reached at any time on or after `from` (null: ever), up to the as-of date. */
export function worstDpdSince(instalments: ReportInstalment[], from: LocalDate | null, asOf: LocalDate): number {
  let worst = 0;
  for (const i of instalments) {
    const l = lateness(i, asOf);
    if (l && (from === null || compareDates(l.end, from) >= 0)) worst = Math.max(worst, l.days);
  }
  return worst;
}

function within(d: LocalDate, from: LocalDate, to: LocalDate) {
  return compareDates(d, from) >= 0 && compareDates(d, to) <= 0;
}

/**
 * The last day a facility's delinquency is measured to: the write-off (from
 * then on it is reported W, not as days past due), the closing or sale, or
 * the as-of date — whichever comes first.
 */
export function facilityMeasuredTo(f: Pick<CreditFacilityInput, 'writtenOffOn' | 'closedOn'>, asOf: LocalDate): LocalDate {
  let until = asOf;
  for (const d of [f.writtenOffOn, f.closedOn]) if (d && compareDates(d, until) < 0) until = d;
  return until;
}

/** A facility's payment-status grid and its worst days past due. */
export function facilityLine(f: CreditFacilityInput, asOf: LocalDate, months = reportMonths(asOf)): CreditFacilityLine {
  const until = facilityMeasuredTo(f, asOf);
  const history: PaymentMonth[] = months.map((month) => {
    const { start, end } = monthBounds(month, asOf);
    if (!f.openedOn || compareDates(f.openedOn, end) > 0) return { month, code: '', dpd: null };
    if (f.closedOn && compareDates(f.closedOn, start) < 0) return { month, code: '', dpd: null };
    const current = end === asOf && f.currentDpd !== null && f.status === 'ACTIVE';
    const at = compareDates(end, until) > 0 ? until : end;
    const derived = daysPastDueOn(f.instalments, at);
    const dpd = current ? Math.max(derived, f.currentDpd!) : derived;
    if (f.writtenOffOn && compareDates(f.writtenOffOn, end) <= 0) return { month, code: 'W', dpd };
    if (f.restructuredOn.some((r) => within(r, start, end))) return { month, code: 'R', dpd };
    if (f.closedOn && compareDates(f.closedOn, end) <= 0) return { month, code: 'C', dpd: 0 };
    return { month, code: paymentStatusCode(dpd), dpd };
  });
  const from12 = addDays(addMonths(asOf, -12), 1);
  const from24 = addDays(addMonths(asOf, -24), 1);
  const currentDpd = f.status === 'ACTIVE' ? Math.max(f.currentDpd ?? 0, daysPastDueOn(f.instalments, asOf)) : 0;
  const ever = worstDpdSince(f.instalments, null, until);
  return {
    id: f.id,
    source: f.source,
    reference: f.reference,
    product: f.product,
    kind: f.kind,
    revolving: f.revolving,
    currency: f.currency,
    openedOn: f.openedOn,
    closedOn: f.closedOn,
    status: f.status,
    limit: f.limit,
    principal: f.principal,
    balance: f.balance,
    instalment: f.instalment,
    currentDpd,
    worstDpd: Math.max(ever, currentDpd),
    worstDpd12m: Math.max(worstDpdSince(f.instalments, from12, until), currentDpd),
    worstDpd24m: Math.max(worstDpdSince(f.instalments, from24, until), currentDpd),
    writtenOff: f.writtenOffOn !== null,
    restructured: f.restructuredOn.length > 0,
    settled: f.settled,
    transferredTo: f.transferredTo ?? null,
    history,
  };
}

const DELINQUENT_DPD = PAYMENT_STATUS_BUCKET_DAYS; // "30+ days past due"

function sumByCurrency(rows: { currency: string; amount: string | null }[]): { currency: string; amount: string }[] {
  const m = new Map<string, ReturnType<typeof dec>>();
  for (const r of rows) {
    if (r.amount === null) continue;
    m.set(r.currency, (m.get(r.currency) ?? dec(0)).plus(dec(r.amount)));
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([currency, v]) => ({ currency, amount: v.toFixed(2) }));
}

/** Characteristics of a report, as of its date. */
export function bureauCharacteristics(input: CreditReportInput, lines: CreditFacilityLine[]): BureauCharacteristics {
  const { asOf } = input;
  const opened = input.facilities.filter((f) => f.openedOn);
  const reported = lines.filter((l) => l.openedOn);
  const from12 = addDays(addMonths(asOf, -12), 1);
  const from24 = addDays(addMonths(asOf, -24), 1);
  // A facility counts in a window if it was open at some point in it.
  const openIn = (f: CreditFacilityInput, from: LocalDate) => !!f.openedOn && (!f.closedOn || compareDates(f.closedOn, from) >= 0);
  const worstIn = (from: LocalDate, key: 'worstDpd12m' | 'worstDpd24m') => {
    const ids = new Set(opened.filter((f) => openIn(f, from)).map((f) => f.id));
    const xs = reported.filter((l) => ids.has(l.id)).map((l) => l[key]);
    return xs.length ? Math.max(...xs) : null;
  };

  // The last day any facility was 30+ days past due.
  let lastDelinquent: LocalDate | null = null;
  for (const f of opened) {
    const until = facilityMeasuredTo(f, asOf);
    for (const i of f.instalments) {
      const l = lateness(i, until);
      if (l && l.days >= DELINQUENT_DPD && (!lastDelinquent || compareDates(l.end, lastDelinquent) > 0)) lastDelinquent = l.end;
    }
    if (f.status === 'ACTIVE' && (f.currentDpd ?? 0) >= DELINQUENT_DPD) lastDelinquent = asOf;
  }

  const last12 = new Set(reportMonths(asOf, 12));
  const times30 = reported.reduce((n, l) => n + l.history.filter((h) => last12.has(h.month) && h.dpd !== null && h.dpd >= DELINQUENT_DPD).length, 0);

  // Utilisation of open revolving limits: per currency, the highest.
  const revolving = reported.filter((l) => l.revolving && l.status === 'ACTIVE' && l.limit !== null && dec(l.limit).gt(0));
  let utilisation: string | null = null;
  if (revolving.length) {
    const byCur = new Map<string, { bal: ReturnType<typeof dec>; lim: ReturnType<typeof dec> }>();
    for (const l of revolving) {
      const x = byCur.get(l.currency) ?? { bal: dec(0), lim: dec(0) };
      byCur.set(l.currency, { bal: x.bal.plus(dec(l.balance)), lim: x.lim.plus(dec(l.limit!)) });
    }
    const ratios = [...byCur.values()].map((x) => x.bal.div(x.lim));
    utilisation = ratios.reduce((a, b) => (b.gt(a) ? b : a)).toDecimalPlaces(4).toString();
  }

  const oldest = opened.map((f) => f.openedOn!).sort(compareDates)[0] ?? null;
  const applicationsSince = (from: LocalDate) => input.enquiries.filter((e) => e.type === 'APPLICATION' && !e.current && compareDates(e.date, from) >= 0 && compareDates(e.date, asOf) <= 0).length;

  return {
    bureauWorstDpd12m: worstIn(from12, 'worstDpd12m'),
    bureauWorstDpd24m: worstIn(from24, 'worstDpd24m'),
    bureauMonthsSinceDelinquency: lastDelinquent ? wholeMonthsBetween(lastDelinquent, asOf) : null,
    bureauTimes30Dpd12m: times30,
    bureauWriteOff: opened.some((f) => f.writtenOffOn !== null),
    bureauRestructured: opened.some((f) => f.restructuredOn.some((r) => within(r, from24, asOf))),
    bureauRevolvingUtilisation: utilisation,
    bureauOldestFacilityMonths: oldest ? wholeMonthsBetween(oldest, asOf) : null,
    bureauEnquiries6m: applicationsSince(addDays(addMonths(asOf, -6), 1)),
    bureauEnquiries12m: applicationsSince(addDays(addMonths(asOf, -12), 1)),
    bureauActiveFacilities: reported.filter((l) => l.status === 'ACTIVE').length,
  };
}

/** Assemble the report body: facilities with their grids, guarantees, enquiries, totals and characteristics. */
export function buildCreditReport(input: CreditReportInput): CreditReportBody {
  const months = reportMonths(input.asOf);
  const facilities = input.facilities
    .filter((f) => f.openedOn !== null)
    .map((f) => facilityLine(f, input.asOf, months))
    .sort((a, b) => compareDates(b.openedOn!, a.openedOn!) || a.reference.localeCompare(b.reference));
  const open = facilities.filter((l) => l.status === 'ACTIVE');
  const fallenDue = input.facilities.reduce((n, f) => n + f.instalments.filter((i) => compareDates(i.dueDate, input.asOf) <= 0).length, 0);
  return {
    formatVersion: CREDIT_REPORT_FORMAT_VERSION,
    asOf: input.asOf,
    months,
    subject: input.subject,
    facilities,
    guarantees: [...input.guarantees].sort((a, b) => compareDates(b.givenOn, a.givenOn)),
    enquiries: [...input.enquiries].sort((a, b) => compareDates(b.date, a.date) || a.reference.localeCompare(b.reference)),
    totals: {
      exposure: sumByCurrency(open.map((l) => ({ currency: l.currency, amount: l.balance }))),
      monthlyObligation: sumByCurrency(open.map((l) => ({ currency: l.currency, amount: l.instalment }))),
      activeFacilities: open.length,
      closedFacilities: facilities.filter((l) => l.status === 'CLOSED' || l.status === 'TRANSFERRED').length,
      writtenOffFacilities: facilities.filter((l) => l.writtenOff).length,
      lenders: facilities.length ? 1 : 0,
      instalmentsFallenDue: fallenDue,
    },
    characteristics: bureauCharacteristics(input, facilities),
  };
}

// ── Bureau score ─────────────────────────────────────────────────────────────

export type NoScoreReason = 'NO_HISTORY';

export interface BureauScoreRules {
  /** Fewest months since the oldest facility opened for a score (without derogatory history). */
  minHistoryMonths: number;
  /** Days past due in the last 24 months that count as derogatory: such a borrower is always scored. */
  derogatoryDpd: number;
}

/**
 * Whether a report can be scored. A borrower with nothing, or too little, to
 * go on gets no score (NO_HISTORY) — never a low score; a write-off or a
 * serious delinquency is always scored, however short the history.
 */
export function bureauScoreEligibility(report: CreditReportBody, rules: BureauScoreRules): { eligible: true } | { eligible: false; reason: NoScoreReason; message: string } {
  const c = report.characteristics;
  if (!report.facilities.length) return { eligible: false, reason: 'NO_HISTORY', message: 'No credit facility on record.' };
  const derogatory = c.bureauWriteOff || (c.bureauWorstDpd24m ?? 0) >= rules.derogatoryDpd;
  if (derogatory) return { eligible: true };
  if ((c.bureauOldestFacilityMonths ?? 0) < rules.minHistoryMonths)
    return { eligible: false, reason: 'NO_HISTORY', message: `Less than ${rules.minHistoryMonths} months of credit history.` };
  if (report.totals.instalmentsFallenDue === 0) return { eligible: false, reason: 'NO_HISTORY', message: 'No instalment has fallen due yet.' };
  return { eligible: true };
}

export interface BureauScore {
  score: number | null;
  grade: string | null;
  gradeLabel: string | null;
  noScoreReason: NoScoreReason | null;
  message: string;
  factors: { factor: string; points: number; reason: string }[];
  adverseReasons: AdverseReason[];
}

/** Score a report on a bureau scorecard (the INTERNAL_BUREAU template or the tenant's version of it). */
export function scoreCreditReport(definition: ScorecardDefinition, report: CreditReportBody, rules: BureauScoreRules): BureauScore {
  const ok = bureauScoreEligibility(report, rules);
  if (!ok.eligible) return { score: null, grade: null, gradeLabel: null, noScoreReason: ok.reason, message: ok.message, factors: [], adverseReasons: [] };
  const r = evaluateScorecard(definition, bureauInputs(report.characteristics));
  return { score: r.score, grade: r.grade, gradeLabel: r.gradeLabel, noScoreReason: null, message: `Score ${r.score} (grade ${r.grade}).`, factors: r.factors, adverseReasons: r.adverseReasons };
}

export function bureauInputs(c: BureauCharacteristics): ScoringInputs {
  return { ...c };
}

// ── Legacy loans: when each instalment was cleared ───────────────────────────

/**
 * The legacy book records what was paid per instalment but not when, so the
 * clearing date is rebuilt by applying the loan's (non-reversed) payments to
 * its instalments oldest first. An instalment the legacy book marks paid but
 * the payments do not reach is taken as cleared on the last payment (or its
 * due date); one not marked paid is still owed.
 */
export function legacyClearances(
  schedule: { dueDate: LocalDate; amountDue: string; isPaid: boolean }[],
  payments: { date: LocalDate; amount: string }[],
): ReportInstalment[] {
  const lines = [...schedule].sort((a, b) => compareDates(a.dueDate, b.dueDate));
  const pays = [...payments].filter((p) => dec(p.amount).gt(0)).sort((a, b) => compareDates(a.date, b.date));
  let pi = 0;
  let left = pays.length ? dec(pays[0].amount) : dec(0);
  const lastPay = pays.length ? pays[pays.length - 1].date : null;
  return lines.map((l) => {
    let need = dec(l.amountDue);
    let clearedOn: LocalDate | null = null;
    while (need.gt(0) && pi < pays.length) {
      const take = left.lt(need) ? left : need;
      need = need.minus(take);
      left = left.minus(take);
      if (need.lte(0)) clearedOn = pays[pi].date;
      if (left.lte(0)) {
        pi += 1;
        left = pi < pays.length ? dec(pays[pi].amount) : dec(0);
      }
    }
    if (need.lte(0) && !clearedOn) clearedOn = l.dueDate;
    if (!l.isPaid) return { dueDate: l.dueDate, clearedOn: null };
    return { dueDate: l.dueDate, clearedOn: clearedOn ?? lastPay ?? l.dueDate };
  });
}
