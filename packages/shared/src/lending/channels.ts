import { D, Dec, dec, EngineError, ZERO } from './decimal.js';
import { getCurrency, isRepresentable, roundMoney, type RoundingRule } from './money.js';
import { addDays, compareDates, parseDate } from './dates.js';

/**
 * Payment channels (UC-16, UC-18, UC-19, UC-21): the arithmetic and the file
 * rules, kept pure so they can be tested without a database.
 *
 *  - Settlement files from mobile, QR, wallet and agent channels, and employer
 *    payroll remittance files, are parsed and validated here. A file with any
 *    malformed line is refused as a whole — a half-imported file is harder to
 *    reconcile than one sent again.
 *  - Cross-currency conversion at the bank's rate (mid rate less a spread),
 *    with the difference to the mid-rate value reported as FX gain or loss.
 *  - The auto-debit retry schedule and the amount a collection asks for.
 *  - The daily reconciliation of a channel: what the files said against what
 *    was posted to loans and what went to suspense.
 */

// ── CSV ─────────────────────────────────────────────────────────────────────

/** Strip a byte-order mark and normalise line endings, so the same file always hashes the same. */
export function normalizeFileText(text: string): string {
  return text
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n+$/, '')
    .concat('\n');
}

/** RFC 4180 CSV: quoted fields may hold commas, quotes ("") and newlines. Returns rows with their 1-based line number. */
export function parseCsv(text: string): { lineNo: number; cells: string[] }[] {
  const rows: { lineNo: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowStart = 1;
  const s = normalizeFileText(text);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        if (c === '\n') line++;
        cell += c;
      }
      continue;
    }
    if (c === '"' && cell === '') quoted = true;
    else if (c === ',') {
      cells.push(cell);
      cell = '';
    } else if (c === '\n') {
      cells.push(cell);
      if (cells.some((x) => x.trim() !== '') && !cells[0].trim().startsWith('#'))
        rows.push({ lineNo: rowStart, cells: cells.map((x) => x.trim()) });
      cells = [];
      cell = '';
      line++;
      rowStart = line;
    } else cell += c;
  }
  if (quoted)
    throw new EngineError('FILE_INVALID', `Unterminated quoted field starting on line ${rowStart}.`);
  return rows;
}

// ── Settlement and payroll files ────────────────────────────────────────────

export const SETTLEMENT_CHANNELS = ['MOBILE', 'QR', 'WALLET', 'AGENT'] as const;
export type SettlementChannel = (typeof SETTLEMENT_CHANNELS)[number];

/** Columns of a settlement file, in any order; `payer_name` is optional. */
export const SETTLEMENT_COLUMNS = ['reference', 'loan_ref', 'amount', 'currency', 'value_date', 'channel_txn_id'] as const;
/** Columns of a payroll remittance file; one of `national_id` / `loan_ref` must be given per line. */
export const PAYROLL_COLUMNS = ['employee_ref', 'national_id', 'loan_ref', 'amount'] as const;

/** Default ceiling on payment lines per file; a lender sets its own in its lending settings (paymentFiles.maxLines). */
export const MAX_FILE_LINES = 5000;

export interface FileLineError {
  lineNo: number;
  message: string;
}

export interface ChannelLine {
  lineNo: number;
  /** Unique per channel: the same id in a later file is the same payment. */
  channelTxnId: string;
  reference: string;
  loanRef: string | null;
  nationalId: string | null;
  employeeRef: string | null;
  payerName: string | null;
  amount: string;
  currency: string;
  valueDate: string;
  /** The first line in this file with the same transaction id, when this one repeats it. */
  duplicateOf: number | null;
}

export interface ParsedChannelFile {
  lines: ChannelLine[];
  errors: FileLineError[];
  /** Sum of the lines that are not repeats, per currency. */
  totals: Record<string, string>;
}

function header(row: { lineNo: number; cells: string[] } | undefined, required: readonly string[], optional: readonly string[]) {
  if (!row) throw new EngineError('FILE_EMPTY', 'The file has no header row.');
  const names = row.cells.map((c) => c.toLowerCase());
  const missing = required.filter((r) => !names.includes(r));
  if (missing.length)
    throw new EngineError('FILE_INVALID', `The header is missing column(s): ${missing.join(', ')}.`);
  const unknown = names.filter((n) => !required.includes(n) && !optional.includes(n));
  if (unknown.length)
    throw new EngineError('FILE_INVALID', `Unknown column(s) in the header: ${unknown.join(', ')}.`);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new EngineError('FILE_INVALID', `Column ${dup} appears twice in the header.`);
  return (cells: string[], name: string): string => {
    const i = names.indexOf(name);
    return i < 0 ? '' : (cells[i] ?? '');
  };
}

function amountOf(raw: string, currency: string, errors: FileLineError[], lineNo: number): string | null {
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    errors.push({ lineNo, message: `amount "${raw}" is not a positive decimal number` });
    return null;
  }
  const a = new D(raw);
  if (a.lte(0)) {
    errors.push({ lineNo, message: 'amount must be greater than zero' });
    return null;
  }
  if (!isRepresentable(a, currency)) {
    errors.push({ lineNo, message: `amount ${raw} has more decimal places than ${currency} allows` });
    return null;
  }
  return a.toString();
}

function dateOf(raw: string, errors: FileLineError[], lineNo: number, field: string): string | null {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error();
    parseDate(raw);
    return raw;
  } catch {
    errors.push({ lineNo, message: `${field} "${raw}" is not a date (YYYY-MM-DD)` });
    return null;
  }
}

function currencyOf(raw: string, errors: FileLineError[], lineNo: number): string | null {
  try {
    return getCurrency(raw.toUpperCase()).code;
  } catch {
    errors.push({ lineNo, message: `currency "${raw}" is not supported` });
    return null;
  }
}

/**
 * Marks repeats of a transaction id inside one file. An identical repeat is a
 * duplicate to ignore; the same id with different content is an error — two
 * different payments cannot share one channel transaction id.
 */
function markDuplicates(lines: ChannelLine[], errors: FileLineError[]) {
  const first = new Map<string, ChannelLine>();
  for (const l of lines) {
    const prev = first.get(l.channelTxnId);
    if (!prev) {
      first.set(l.channelTxnId, l);
      continue;
    }
    if (sameLine(prev, l)) l.duplicateOf = prev.lineNo;
    else
      errors.push({
        lineNo: l.lineNo,
        message: `transaction id ${l.channelTxnId} is already used on line ${prev.lineNo} for a different payment`,
      });
  }
}

/** Two lines describe the same payment: same money, date and target. */
export function sameLine(
  a: Pick<ChannelLine, 'amount' | 'currency' | 'valueDate' | 'loanRef' | 'nationalId'>,
  b: Pick<ChannelLine, 'amount' | 'currency' | 'valueDate' | 'loanRef' | 'nationalId'>,
): boolean {
  return (
    new D(a.amount).eq(new D(b.amount)) &&
    a.currency === b.currency &&
    a.valueDate === b.valueDate &&
    (a.loanRef ?? '') === (b.loanRef ?? '') &&
    (a.nationalId ?? '') === (b.nationalId ?? '')
  );
}

function finish(lines: ChannelLine[], errors: FileLineError[], maxLines: number): ParsedChannelFile {
  if (!lines.length && !errors.length) errors.push({ lineNo: 1, message: 'the file has no payment lines' });
  if (lines.length > maxLines)
    errors.push({ lineNo: lines[maxLines].lineNo, message: `a file may hold at most ${maxLines} lines` });
  markDuplicates(lines, errors);
  const totals: Record<string, Dec> = {};
  for (const l of lines)
    if (l.duplicateOf === null) totals[l.currency] = (totals[l.currency] ?? ZERO).plus(l.amount);
  return {
    lines,
    errors: errors.sort((a, b) => a.lineNo - b.lineNo),
    totals: Object.fromEntries(Object.entries(totals).map(([c, v]) => [c, v.toString()])),
  };
}

const TEXT_MAX = 120;
function text(raw: string, field: string, errors: FileLineError[], lineNo: number, required: boolean): string | null {
  if (!raw) {
    if (required) errors.push({ lineNo, message: `${field} is required` });
    return null;
  }
  if (raw.length > TEXT_MAX) {
    errors.push({ lineNo, message: `${field} is longer than ${TEXT_MAX} characters` });
    return null;
  }
  return raw;
}

/**
 * A mobile / QR / wallet / agent settlement file:
 *
 *     reference,loan_ref,amount,currency,value_date,channel_txn_id[,payer_name]
 *
 * `loan_ref` is the loan account reference (blank when the payer gave none —
 * the line then goes to suspense). Lines starting with `#` are comments.
 */
export function parseSettlementFile(content: string, maxLines: number = MAX_FILE_LINES): ParsedChannelFile {
  const rows = parseCsv(content);
  const col = header(rows[0], SETTLEMENT_COLUMNS, ['payer_name']);
  const errors: FileLineError[] = [];
  const lines: ChannelLine[] = [];
  for (const { lineNo, cells } of rows.slice(1)) {
    const e0 = errors.length;
    const currency = currencyOf(col(cells, 'currency'), errors, lineNo);
    const amount = currency ? amountOf(col(cells, 'amount'), currency, errors, lineNo) : null;
    const valueDate = dateOf(col(cells, 'value_date'), errors, lineNo, 'value_date');
    const txn = text(col(cells, 'channel_txn_id'), 'channel_txn_id', errors, lineNo, true);
    const reference = text(col(cells, 'reference'), 'reference', errors, lineNo, false);
    const loanRef = text(col(cells, 'loan_ref'), 'loan_ref', errors, lineNo, false);
    const payerName = text(col(cells, 'payer_name'), 'payer_name', errors, lineNo, false);
    if (errors.length > e0) continue;
    lines.push({
      lineNo,
      channelTxnId: txn!,
      reference: reference ?? '',
      loanRef,
      nationalId: null,
      employeeRef: null,
      payerName,
      amount: amount!,
      currency: currency!,
      valueDate: valueDate!,
      duplicateOf: null,
    });
  }
  return finish(lines, errors, maxLines);
}

/**
 * An employer's payroll remittance (UC-19). The employer, period, currency
 * and value date are given once for the file; each line is one employee:
 *
 *     employee_ref,national_id,loan_ref,amount
 *
 * The transaction id of a line is employer:period:employee_ref, so the same
 * deduction remitted twice is recognised as a repeat.
 */
export function parsePayrollFile(
  content: string,
  meta: { employer: string; period: string; currency: string; valueDate: string },
  maxLines: number = MAX_FILE_LINES,
): ParsedChannelFile {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(meta.period))
    throw new EngineError('FILE_INVALID', `Period ${meta.period} must be YYYY-MM.`);
  const metaErrors: FileLineError[] = [];
  const currency = currencyOf(meta.currency, metaErrors, 0);
  dateOf(meta.valueDate, metaErrors, 0, 'valueDate');
  if (metaErrors.length) throw new EngineError('FILE_INVALID', metaErrors.map((e) => e.message).join('; '));
  const rows = parseCsv(content);
  const col = header(rows[0], ['employee_ref', 'amount'], ['national_id', 'loan_ref']);
  const errors: FileLineError[] = [];
  const lines: ChannelLine[] = [];
  for (const { lineNo, cells } of rows.slice(1)) {
    const e0 = errors.length;
    const employeeRef = text(col(cells, 'employee_ref'), 'employee_ref', errors, lineNo, true);
    const amount = amountOf(col(cells, 'amount'), currency!, errors, lineNo);
    const nationalId = text(col(cells, 'national_id'), 'national_id', errors, lineNo, false);
    const loanRef = text(col(cells, 'loan_ref'), 'loan_ref', errors, lineNo, false);
    if (!nationalId && !loanRef && errors.length === e0)
      errors.push({ lineNo, message: 'each line needs a national_id or a loan_ref' });
    if (errors.length > e0) continue;
    lines.push({
      lineNo,
      channelTxnId: `${meta.employer}:${meta.period}:${employeeRef}`.slice(0, 200),
      reference: employeeRef!,
      loanRef,
      nationalId,
      employeeRef,
      payerName: meta.employer,
      amount: amount!,
      currency: currency!,
      valueDate: meta.valueDate,
      duplicateOf: null,
    });
  }
  return finish(lines, errors, maxLines);
}

// ── Cross-currency payments (UC-21) ─────────────────────────────────────────

/** A published rate: one unit of `base` buys `rate` units of `quote`. */
export interface FxRateQuote {
  base: string;
  quote: string;
  rate: string;
}

export interface FxConversion {
  amount: string;
  from: string;
  to: string;
  /** Mid rate, `to` per one `from`. */
  midRate: string;
  /** Mid rate less the spread: what the payer is credited at. */
  bankRate: string;
  spreadBps: number;
  /** What the loan is credited, in its own currency. */
  converted: string;
  /** The payment valued at the mid rate, in the loan's currency. */
  midValue: string;
  /** midValue − (converted + roundingDifference): positive is a gain to the bank, negative a loss. */
  gainLoss: string;
  /**
   * The converted amount at the loan currency's minor units less what the
   * loan is credited after the loan's own rounding increment (KHR 100, say):
   * kept by the bank (positive) or given to the borrower (negative), and
   * posted to the rounding-differences account (DECISIONS D-137).
   */
  roundingDifference: string;
  explanation: string;
}

const RATE_SIGNIFICANT = 12;
const shown = (r: Dec) => r.toSignificantDigits(RATE_SIGNIFICANT, D.ROUND_HALF_UP).toString();

/**
 * Convert a payment into the loan's currency at the bank's rate.
 *
 * The bank buys the payer's currency at the mid rate less `spreadBps` basis
 * points. The loan is credited the converted amount, rounded half-up to the
 * loan currency's minor units; the bank's books value the money received at
 * the mid rate, and the difference is the FX gain (or, for a negative
 * difference from rounding, a loss). A quote in the opposite direction is
 * inverted.
 */
export function convertPayment(input: {
  amount: string;
  from: string;
  to: string;
  quote: FxRateQuote;
  spreadBps: number;
  /** The loan's rounding rule (pricing.rounding); the currency's minor units when absent. */
  rounding?: RoundingRule;
}): FxConversion {
  const from = getCurrency(input.from).code;
  const to = getCurrency(input.to).code;
  if (from === to) throw new EngineError('FX_SAME_CURRENCY', 'The payment is already in the loan currency.');
  const amount = dec(input.amount, 'amount');
  if (amount.lte(0)) throw new EngineError('INVALID_AMOUNT', 'The amount must be positive.');
  if (!isRepresentable(amount, from))
    throw new EngineError('INVALID_AMOUNT_PRECISION', `amount ${input.amount} has more decimal places than ${from} allows.`);
  if (!Number.isInteger(input.spreadBps) || input.spreadBps < 0 || input.spreadBps > 1000)
    throw new EngineError('FX_INVALID_SPREAD', 'The spread must be a whole number of basis points from 0 to 1000.');
  const rate = dec(input.quote.rate, 'rate');
  if (rate.lte(0)) throw new EngineError('FX_INVALID_RATE', 'The exchange rate must be positive.');
  let mid: Dec;
  if (input.quote.base === from && input.quote.quote === to) mid = rate;
  else if (input.quote.base === to && input.quote.quote === from) mid = new D(1).div(rate);
  else
    throw new EngineError(
      'FX_RATE_MISMATCH',
      `A ${input.quote.base}/${input.quote.quote} rate cannot convert ${from} into ${to}.`,
    );
  // Full precision in the arithmetic (an inverted rate has no exact decimal);
  // the rates reported and stored are rounded to RATE_SIGNIFICANT digits.
  const bankRate = mid.times(new D(1).minus(new D(input.spreadBps).div(10_000)));
  const minor = { increment: new D(1).div(new D(10).pow(getCurrency(to).minorUnits)).toString(), mode: 'HALF_UP' as const };
  const atMinor = roundMoney(amount.times(bankRate), minor);
  // The loan is credited in its own rounding increment, so its balances stay
  // in amounts it can bill and collect.
  const converted = input.rounding ? roundMoney(atMinor, input.rounding) : atMinor;
  const roundingDifference = atMinor.minus(converted);
  const midValue = roundMoney(amount.times(mid), minor);
  if (converted.lte(0))
    throw new EngineError('FX_AMOUNT_TOO_SMALL', `${input.amount} ${from} converts to nothing in ${to}.`);
  const gainLoss = midValue.minus(atMinor);
  return {
    amount: amount.toString(),
    from,
    to,
    midRate: shown(mid),
    bankRate: shown(bankRate),
    spreadBps: input.spreadBps,
    converted: converted.toString(),
    midValue: midValue.toString(),
    gainLoss: gainLoss.toString(),
    roundingDifference: roundingDifference.toString(),
    explanation:
      `${amount} ${from} at ${shown(bankRate)} (mid ${shown(mid)} less ${input.spreadBps} bp) = ${atMinor} ${to}` +
      (roundingDifference.isZero() ? '' : `, credited ${converted} ${to} after rounding (difference ${roundingDifference} ${to})`) +
      `; valued at mid ${midValue} ${to}, ${gainLoss.gte(0) ? 'gain' : 'loss'} ${gainLoss.abs()} ${to}.`,
  };
}

/**
 * Whether a rate published on `rateDate` may be used for a payment valued on
 * `valueDate`: never a rate from after the value date, and at most
 * `maxAgeDays` before it (0 = only a rate for the value date itself).
 */
export function rateUsable(rateDate: string, valueDate: string, maxAgeDays: number): boolean {
  return compareDates(rateDate, valueDate) <= 0 && compareDates(addDays(rateDate, maxAgeDays), valueDate) >= 0;
}

// ── Auto-debit (UC-16) ──────────────────────────────────────────────────────

export interface AutoDebitRetryPolicy {
  /** Attempts per due date, including the first. */
  maxAttempts: number;
  /** Days between a failed attempt and the next. */
  retryIntervalDays: number;
}

/** Failures that retrying cannot fix. */
export const FINAL_DEBIT_FAILURES = ['ACCOUNT_CLOSED', 'MANDATE_INVALID', 'NO_AUTHORITY'];

/** When to try again after attempt `attemptNo` failed on `failedOn`, or null when there is no next attempt. */
export function nextDebitAttempt(
  policy: AutoDebitRetryPolicy,
  attemptNo: number,
  failedOn: string,
  failureCode: string,
): string | null {
  if (FINAL_DEBIT_FAILURES.includes(failureCode)) return null;
  if (attemptNo >= policy.maxAttempts) return null;
  return addDays(failedOn, Math.max(1, policy.retryIntervalDays));
}

/**
 * What a collection asks for on `asOf`: everything fallen due and unpaid,
 * less money already held on advance (which pays first).
 */
export function amountToCollect(
  lines: { dueDate: string; outstanding: string }[],
  asOf: string,
  advanceBalance: string,
): string {
  const due = lines
    .filter((l) => compareDates(l.dueDate, asOf) <= 0)
    .reduce((s, l) => s.plus(dec(l.outstanding, 'outstanding')), ZERO);
  const net = due.minus(dec(advanceBalance, 'advanceBalance'));
  return (net.gt(0) ? net : ZERO).toString();
}

// ── Reconciliation (UC-18, UC-19) ───────────────────────────────────────────

export type ChannelLineOutcome = 'POSTED' | 'SUSPENSE' | 'DUPLICATE';

export interface ReconciliationLine {
  lineId: string;
  fileId: string;
  lineNo: number;
  channelTxnId: string;
  currency: string;
  amount: string;
  outcome: ChannelLineOutcome;
  /** POSTED: the repayment was reversed afterwards. */
  reversed?: boolean;
  /** SUSPENSE: what is still held, and how much was matched to loans / refunded. */
  suspense?: { remaining: string; matched: string; refunded: string };
  /** DUPLICATE: the repeat differs from the original line. */
  conflicting?: boolean;
}

export interface ReconciliationBreak {
  lineId: string;
  fileId: string;
  lineNo: number;
  channelTxnId: string;
  currency: string;
  amount: string;
  kind: 'UNMATCHED_IN_SUSPENSE' | 'REVERSED' | 'CONFLICTING_DUPLICATE';
  detail: string;
}

export interface ReconciliationTotals {
  currency: string;
  lines: number;
  duplicates: number;
  /** Money the files reported (repeats excluded). */
  fileTotal: string;
  /** Applied to loans directly from the file. */
  posted: string;
  /** Posted, then reversed. */
  reversed: string;
  /** Sent to suspense, and since matched to loans / refunded / still held. */
  suspenseMatched: string;
  suspenseRefunded: string;
  suspenseOpen: string;
  /** fileTotal − every bucket above: zero when every amount is accounted for. */
  difference: string;
}

/**
 * Daily reconciliation of a channel: every amount a file reported is either
 * on a loan, in suspense (matched since, refunded or still held), or reversed.
 * A break is anything someone still has to act on.
 */
export function reconcileChannel(lines: ReconciliationLine[]): {
  totals: ReconciliationTotals[];
  breaks: ReconciliationBreak[];
} {
  const by = new Map<string, ReconciliationLine[]>();
  for (const l of lines) by.set(l.currency, [...(by.get(l.currency) ?? []), l]);
  const totals: ReconciliationTotals[] = [];
  const breaks: ReconciliationBreak[] = [];
  const brk = (l: ReconciliationLine, kind: ReconciliationBreak['kind'], amount: Dec, detail: string) =>
    breaks.push({
      lineId: l.lineId,
      fileId: l.fileId,
      lineNo: l.lineNo,
      channelTxnId: l.channelTxnId,
      currency: l.currency,
      amount: amount.toString(),
      kind,
      detail,
    });
  for (const [currency, list] of [...by.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    let file = ZERO;
    let posted = ZERO;
    let reversed = ZERO;
    let matched = ZERO;
    let refunded = ZERO;
    let open = ZERO;
    let duplicates = 0;
    for (const l of list) {
      const amount = dec(l.amount, 'amount');
      if (l.outcome === 'DUPLICATE') {
        duplicates++;
        if (l.conflicting)
          brk(l, 'CONFLICTING_DUPLICATE', amount, 'Same transaction id as an earlier line but a different payment; confirm with the channel.');
        continue;
      }
      file = file.plus(amount);
      if (l.outcome === 'POSTED') {
        if (l.reversed) {
          reversed = reversed.plus(amount);
          brk(l, 'REVERSED', amount, 'The repayment was reversed; return the money or post it again.');
        } else posted = posted.plus(amount);
      } else {
        const s = l.suspense ?? { remaining: l.amount, matched: '0', refunded: '0' };
        const rem = dec(s.remaining, 'remaining');
        matched = matched.plus(dec(s.matched, 'matched'));
        refunded = refunded.plus(dec(s.refunded, 'refunded'));
        open = open.plus(rem);
        if (rem.gt(0)) brk(l, 'UNMATCHED_IN_SUSPENSE', rem, 'Held in unidentified payments; match it to a loan or refund it.');
      }
    }
    totals.push({
      currency,
      lines: list.length,
      duplicates,
      fileTotal: file.toString(),
      posted: posted.toString(),
      reversed: reversed.toString(),
      suspenseMatched: matched.toString(),
      suspenseRefunded: refunded.toString(),
      suspenseOpen: open.toString(),
      difference: file.minus(posted).minus(reversed).minus(matched).minus(refunded).minus(open).toString(),
    });
  }
  return { totals, breaks };
}
