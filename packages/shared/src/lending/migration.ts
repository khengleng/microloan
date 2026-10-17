/**
 * Loan-book migration (taking over a portfolio from another system). Pure:
 * no I/O, no clock.
 *
 * Each running loan is described as at the cut-over date: its contract
 * (product, rate, original principal and dates) and its position (principal
 * outstanding, what is overdue, interest accrued, the next due date and the
 * instalments left). From that the engine rebuilds what the platform needs
 * to service the loan from cut-over on:
 *
 * - the remaining schedule, from the start of the current period to
 *   maturity, on the performing principal (outstanding less overdue);
 * - one arrears line holding everything overdue, due on the oldest overdue
 *   date, so days past due continue from the old system;
 * - the opening balances: principal, interest (the contract's accrual for the
 *   current period plus overdue interest), fees, penalties, and allowance.
 *
 * The interest accrued by the old system is compared with the contract's
 * accrual; any difference is reported, never silently absorbed.
 */
import { dec, Dec, ZERO, EngineError } from './decimal.js';
import { parseMoney } from './money.js';
import { LocalDate, addMonths, compareDates, daysBetween, parseDate } from './dates.js';
import { parseCsv } from './channels.js';
import { ScheduleInput, ScheduleLine, generateSchedule } from './schedule.js';
import { accruedOnLine } from './servicing.js';

export const MIGRATION_COLUMNS = [
  'external_loan_id',
  'customer_id',
  'first_name',
  'last_name',
  'id_number',
  'phone',
  'date_of_birth',
  'branch_code',
  'product_code',
  'currency',
  'original_principal',
  'disbursement_date',
  'annual_rate_pct',
  'principal_outstanding',
  'next_due_date',
  'remaining_instalments',
  'current_period_start',
  'interest_accrued',
  'overdue_principal',
  'overdue_interest',
  'overdue_fees',
  'overdue_penalties',
  'oldest_overdue_date',
  'non_accrual',
  'allowance',
  'monthly_income',
] as const;

export const MIGRATION_REQUIRED: readonly string[] = [
  'external_loan_id',
  'customer_id',
  'first_name',
  'last_name',
  'product_code',
  'currency',
  'original_principal',
  'disbursement_date',
  'principal_outstanding',
  'next_due_date',
  'remaining_instalments',
];

export type MigrationColumn = (typeof MIGRATION_COLUMNS)[number];
export type MigrationRowInput = Partial<Record<MigrationColumn, string>>;

export interface MigrationIssue {
  field: string;
  message: string;
}

export interface ParsedMigrationFile {
  rows: { lineNo: number; values: MigrationRowInput }[];
  /** Problems with the file itself (header, duplicates); rows are not checked when present. */
  fileErrors: string[];
  unknownColumns: string[];
}

/** A header row naming the columns (any order), then one row per loan. */
export function parseMigrationFile(text: string): ParsedMigrationFile {
  const rows = parseCsv(text);
  if (!rows.length) return { rows: [], fileErrors: ['The file is empty.'], unknownColumns: [] };
  const header = rows[0].cells.map((h) => h.trim().toLowerCase());
  const fileErrors: string[] = [];
  const missing = MIGRATION_REQUIRED.filter((c) => !header.includes(c));
  if (missing.length) fileErrors.push(`Missing column(s): ${missing.join(', ')}.`);
  const dup = header.filter((h, i) => header.indexOf(h) !== i);
  if (dup.length) fileErrors.push(`Repeated column(s): ${[...new Set(dup)].join(', ')}.`);
  const known = new Set<string>(MIGRATION_COLUMNS);
  const unknownColumns = header.filter((h) => h && !known.has(h));
  const out = rows.slice(1).map((r) => {
    const values: MigrationRowInput = {};
    header.forEach((h, i) => {
      if (known.has(h) && r.cells[i] !== undefined && r.cells[i] !== '') values[h as MigrationColumn] = r.cells[i];
    });
    return { lineNo: r.lineNo, values };
  });
  const ids = new Map<string, number>();
  for (const r of out) {
    const id = r.values.external_loan_id;
    if (!id) continue;
    if (ids.has(id)) fileErrors.push(`Loan ${id} appears on lines ${ids.get(id)} and ${r.lineNo}.`);
    else ids.set(id, r.lineNo);
  }
  if (!out.length) fileErrors.push('The file has a header but no loans.');
  return { rows: out, fileErrors, unknownColumns };
}

export interface MigratedLoan {
  currency: string;
  principalOutstanding: string;
  /** Performing principal re-amortized over the remaining instalments. */
  performingPrincipal: string;
  arrears: {
    principal: string;
    interest: string;
    fees: string;
    penalties: string;
    dueDate: LocalDate;
  } | null;
  /** The contract's accrual for the current period up to cut-over. */
  accruedAtCutOver: string;
  /** Accrued interest according to the old system, when given. */
  sourceAccrued: string | null;
  /** Contract accrual less the old system's figure. */
  accrualDifference: string;
  interestOpening: string;
  feesOpening: string;
  penaltyOpening: string;
  allowance: string;
  nonAccrual: boolean;
  daysPastDue: number;
  scheduleInput: ScheduleInput;
  lines: ScheduleLine[];
  instalmentAmount: string | null;
  maturityDate: LocalDate;
  warnings: string[];
}

const truthy = (v: string | undefined) => !!v && /^(y|yes|true|1)$/i.test(v.trim());

/** Field-level checks that need no configuration. */
export function checkMigrationRow(v: MigrationRowInput, cutOver: LocalDate): MigrationIssue[] {
  const issues: MigrationIssue[] = [];
  const add = (field: string, message: string) => issues.push({ field, message });
  for (const f of MIGRATION_REQUIRED) if (!v[f as MigrationColumn]?.trim()) add(f, 'is required');
  const money = (f: MigrationColumn, required = false) => {
    const s = v[f];
    if (!s) {
      if (required) add(f, 'is required');
      return;
    }
    if (!/^\d+(\.\d{1,4})?$/.test(s)) add(f, `"${s}" is not an amount (digits, up to 4 decimals, no thousands separators)`);
  };
  const date = (f: MigrationColumn) => {
    const s = v[f];
    if (!s) return;
    try {
      parseDate(s, f);
    } catch {
      add(f, `"${s}" is not a date (YYYY-MM-DD)`);
    }
  };
  for (const f of ['original_principal', 'principal_outstanding', 'interest_accrued', 'overdue_principal', 'overdue_interest', 'overdue_fees', 'overdue_penalties', 'allowance', 'monthly_income'] as const) money(f);
  for (const f of ['disbursement_date', 'next_due_date', 'current_period_start', 'oldest_overdue_date', 'date_of_birth'] as const) date(f);
  if (v.annual_rate_pct && !/^\d+(\.\d{1,6})?$/.test(v.annual_rate_pct)) add('annual_rate_pct', `"${v.annual_rate_pct}" is not a percentage, e.g. 18 or 18.5`);
  if (v.remaining_instalments && !/^\d+$/.test(v.remaining_instalments)) add('remaining_instalments', 'must be a whole number');
  if (v.remaining_instalments === '0') add('remaining_instalments', 'must be at least 1; a loan with nothing left to pay is not migrated');
  if (v.currency && !/^[A-Z]{3}$/.test(v.currency)) add('currency', 'must be a 3-letter code such as USD or KHR');
  if (issues.length) return issues;

  const outstanding = dec(v.principal_outstanding!);
  if (outstanding.lte(0)) add('principal_outstanding', 'must be above 0');
  if (outstanding.gt(dec(v.original_principal!))) add('principal_outstanding', 'cannot exceed the original principal');
  const overdue = dec(v.overdue_principal ?? '0');
  if (overdue.gte(outstanding) && outstanding.gt(0)) add('overdue_principal', 'must be less than the principal outstanding (a fully overdue loan has no schedule left to rebuild)');
  if (compareDates(v.disbursement_date!, cutOver) > 0) add('disbursement_date', `is after the cut-over date ${cutOver}`);
  if (compareDates(v.next_due_date!, cutOver) <= 0) add('next_due_date', `must be after the cut-over date ${cutOver}; anything due by then is overdue`);
  if (v.current_period_start && compareDates(v.current_period_start, cutOver) > 0) add('current_period_start', 'cannot be after the cut-over date');
  const anyOverdue = ['overdue_principal', 'overdue_interest', 'overdue_fees', 'overdue_penalties'].some((f) => dec(v[f as MigrationColumn] ?? '0').gt(0));
  if (anyOverdue && !v.oldest_overdue_date) add('oldest_overdue_date', 'is required when anything is overdue');
  if (v.oldest_overdue_date && compareDates(v.oldest_overdue_date, cutOver) > 0) add('oldest_overdue_date', 'cannot be after the cut-over date');
  if (!anyOverdue && v.oldest_overdue_date) add('oldest_overdue_date', 'is given but nothing is overdue');
  return issues;
}

/**
 * Rebuild a migrated loan as at cut-over. `base` is the product's schedule
 * input for the contract (from toScheduleInput); this replaces its principal,
 * dates and term with the position at cut-over.
 */
export function buildMigratedLoan(base: ScheduleInput, v: MigrationRowInput, cutOver: LocalDate): MigratedLoan {
  const currency = base.currency;
  if (v.currency !== currency) throw new EngineError('CURRENCY_MISMATCH', `The product lends in ${currency}, the loan is in ${v.currency}.`);
  const warnings: string[] = [];
  const m = (f: MigrationColumn) => parseMoney(v[f] ?? '0', currency, f);
  const outstanding = m('principal_outstanding');
  const overduePrincipal = m('overdue_principal');
  const overdueInterest = m('overdue_interest');
  const overdueFees = m('overdue_fees');
  const overduePenalties = m('overdue_penalties');
  const performing = outstanding.minus(overduePrincipal);
  const n = Number(v.remaining_instalments);
  const next = v.next_due_date!;
  // The current period starts at the previous due date; monthly loans can work it out.
  let periodStart = v.current_period_start;
  if (!periodStart) {
    if (base.frequency !== 'MONTHLY') throw new EngineError('PERIOD_START_REQUIRED', 'current_period_start is required for loans that are not repaid monthly.');
    periodStart = addMonths(next, -1);
    if (compareDates(periodStart, cutOver) > 0) periodStart = cutOver;
  }
  if (compareDates(periodStart, next) >= 0) throw new EngineError('INVALID_PERIOD', 'current_period_start must be before next_due_date.');

  const input: ScheduleInput = {
    ...base,
    principal: performing.toString(),
    disbursementDate: periodStart,
    firstDueDate: next,
    numberOfInstalments: n,
    principalGraceInstalments: 0,
    interestGraceInstalments: 0,
    explicitSchedule: undefined,
    balloonAmount: base.method === 'BALLOON' ? base.balloonAmount : undefined,
  };
  if (v.annual_rate_pct) {
    input.annualRate = dec(v.annual_rate_pct).div(100).toString();
    input.rates = undefined;
  }
  if (input.method === 'EXPLICIT') throw new EngineError('UNSUPPORTED', 'Loans with explicitly dated schedules are migrated with a custom file; use an instalment product.');
  if (input.method === 'BALLOON') throw new EngineError('UNSUPPORTED', 'Balloon loans need their balloon at cut-over; migrate them with an instalment product or by restructure after migration.');
  const schedule = generateSchedule(input);
  const first = schedule.lines[0];
  const accrued = accruedOnLine(
    { periodStart: first.periodStart, periodEnd: first.periodEnd, openingPrincipal: first.openingPrincipal, interest: first.interest, capitalizedInterest: first.capitalizedInterest },
    cutOver,
    input,
  );
  const sourceAccrued = v.interest_accrued ? m('interest_accrued') : null;
  const difference = sourceAccrued ? accrued.minus(sourceAccrued) : ZERO;
  if (sourceAccrued && !difference.isZero())
    warnings.push(`Accrued interest per the old system is ${sourceAccrued}; the contract gives ${accrued} for ${first.periodStart} to ${cutOver} (difference ${difference}). The contract figure is booked.`);
  const anyOverdue = [overduePrincipal, overdueInterest, overdueFees, overduePenalties].some((x: Dec) => x.gt(0));
  const dueDate = v.oldest_overdue_date ?? cutOver;
  const dpd = anyOverdue ? Math.max(0, daysBetween(dueDate, cutOver)) : 0;
  const original = m('original_principal');
  if (performing.gt(0) && schedule.lines.length !== n) warnings.push(`The schedule has ${schedule.lines.length} instalments, not ${n}.`);
  if (compareDates(v.disbursement_date!, periodStart) > 0) warnings.push('The disbursement date is after the start of the current period.');
  if (original.lt(outstanding)) warnings.push('The principal outstanding exceeds the original principal.');
  return {
    currency,
    principalOutstanding: outstanding.toString(),
    performingPrincipal: performing.toString(),
    arrears: anyOverdue
      ? { principal: overduePrincipal.toString(), interest: overdueInterest.toString(), fees: overdueFees.toString(), penalties: overduePenalties.toString(), dueDate }
      : null,
    accruedAtCutOver: accrued.toString(),
    sourceAccrued: sourceAccrued?.toString() ?? null,
    accrualDifference: difference.toString(),
    interestOpening: accrued.plus(overdueInterest).toString(),
    feesOpening: overdueFees.toString(),
    penaltyOpening: overduePenalties.toString(),
    allowance: m('allowance').toString(),
    nonAccrual: truthy(v.non_accrual),
    daysPastDue: dpd,
    scheduleInput: input,
    lines: schedule.lines,
    instalmentAmount: schedule.instalmentAmount,
    maturityDate: schedule.maturityDate,
    warnings,
  };
}

/** A blank file with every column and one example row, for download. */
export function migrationTemplate(): string {
  const example: Record<string, string> = {
    external_loan_id: 'OLD-000123',
    customer_id: 'C-4471',
    first_name: 'Sokha',
    last_name: 'Chan',
    id_number: '010203040',
    phone: '+85512345678',
    date_of_birth: '1988-04-12',
    branch_code: 'HQ',
    product_code: 'PL-STD',
    currency: 'USD',
    original_principal: '5000.00',
    disbursement_date: '2025-06-05',
    annual_rate_pct: '18',
    principal_outstanding: '3120.40',
    next_due_date: '2026-11-05',
    remaining_instalments: '12',
    current_period_start: '2026-10-05',
    interest_accrued: '19.10',
    overdue_principal: '0',
    overdue_interest: '0',
    overdue_fees: '0',
    overdue_penalties: '0',
    oldest_overdue_date: '',
    non_accrual: 'N',
    allowance: '31.20',
    monthly_income: '800',
  };
  return `${MIGRATION_COLUMNS.join(',')}\n${MIGRATION_COLUMNS.map((c) => example[c] ?? '').join(',')}\n`;
}
