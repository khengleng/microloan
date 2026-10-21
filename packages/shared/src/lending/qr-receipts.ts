import { D, EngineError } from './decimal.js';
import { getCurrency, isRepresentable } from './money.js';
import { addDays, compareDates, daysBetween, parseDate } from './dates.js';
import { normalizeFileText, parseCsv } from './channels.js';
import { normalizeNameTokens } from './aml.js';

/**
 * Repayments by the lender's static KHQR code (DECISIONS D-160…D-165): pure
 * rules, testable without a database.
 *
 * Borrowers pay a fixed code with no amount, so the platform never learns of
 * a payment by itself (there is no Bakong API integration). A payment reaches
 * the books in one of three ways, all keyed on the bank's transaction
 * reference so the same transfer is never applied twice:
 *
 *  a. the borrower's "I have paid" claim in the portal — a pending claim,
 *     no money posted;
 *  b. a receipt staff saw in the lender's bank app, recorded by one person
 *     and verified by another before it posts;
 *  c. the bank / Bakong merchant statement, imported as a file: each credit
 *     line is matched (rules below) and posted, or held in suspense.
 *
 * This module parses statement files through a column mapping, normalises
 * bank references, and decides what a statement line matches.
 */

// ── Bank references ─────────────────────────────────────────────────────────

/** The fewest letters and digits a bank transaction reference may have. */
export const BANK_REF_MIN_LENGTH = 6;

/**
 * The comparable form of a bank transaction reference (Bakong hash, bank
 * reference number): letters and digits only, upper case. "ft-2602 1512" and
 * "FT26021512" are the same transfer.
 */
export function bankRefKey(raw: string): string {
  return String(raw ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
}

/** Why a typed bank reference cannot identify a transfer, or null when it can. */
export function bankRefProblem(raw: string): string | null {
  const key = bankRefKey(raw);
  if (key.length < BANK_REF_MIN_LENGTH)
    return `The bank transaction reference needs at least ${BANK_REF_MIN_LENGTH} letters or digits (the hash or reference number on the receipt).`;
  if (key.length > 100) return 'The bank transaction reference is too long.';
  return null;
}

/**
 * The value date a KHQR payment is posted with (D-162): the day it was paid,
 * but never after the business date nor further back than the loan's product
 * allows back-dating — a payment confirmed late is applied on the earliest
 * day allowed, and the day it was paid is kept on the event.
 */
export function khqrPostingDate(paidOn: string, businessDate: string, maxBackdateDays: number): string {
  if (compareDates(paidOn, businessDate) > 0) return businessDate;
  const earliest = addDays(businessDate, -Math.max(0, maxBackdateDays));
  return compareDates(paidOn, earliest) < 0 ? earliest : paidOn;
}

// ── Loan references in a payment remark ─────────────────────────────────────

/**
 * Candidate loan references written in a payment remark. Payers type them
 * loosely ("ln 260105 ab12cd", "LN-260105-AB12CD.", "loan:LN-260105-AB12CD"),
 * so every token is offered upper-cased, and runs of two or three tokens are
 * offered joined with "-" and with nothing: the caller looks them up among
 * the lender's loan references. Order: as written.
 */
export function loanRefCandidates(remark: string | null | undefined): string[] {
  const tokens = String(remark ?? '')
    .normalize('NFKC')
    .toUpperCase()
    .split(/[^0-9A-Z-]+/)
    .map((t) => t.replace(/^-+|-+$/g, ''))
    .filter((t) => t.length >= 2);
  const out = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].length >= 4) out.add(tokens[i]);
    for (const n of [2, 3]) {
      const run = tokens.slice(i, i + n);
      if (run.length !== n) continue;
      out.add(run.join('-'));
      out.add(run.join(''));
    }
  }
  return [...out].filter((c) => c.length >= 4 && c.length <= 64).slice(0, 60);
}

// ── Payers ──────────────────────────────────────────────────────────────────

/**
 * The spellings a Cambodian phone number may have been stored with, so the
 * caller can look it up by its blind index: as written, local (0…), and
 * international (+855… / 855…). Empty when the text holds no plausible number.
 */
export function phoneVariants(raw: string | null | undefined): string[] {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return [];
  let national = digits;
  if (national.startsWith('855')) national = national.slice(3);
  if (national.startsWith('0')) national = national.slice(1);
  if (national.length < 8 || national.length > 9) return [digits];
  return [...new Set([`0${national}`, `+855${national}`, `855${national}`, national, digits])];
}

/** Two personal names are the same person's: the same words, in any order, after normalisation. */
export function sameName(a: string | null | undefined, b: string | null | undefined, ignoredTitles: readonly string[] = []): boolean {
  const ta = normalizeNameTokens(String(a ?? ''), ignoredTitles).sort();
  const tb = normalizeNameTokens(String(b ?? ''), ignoredTitles).sort();
  return ta.length >= 2 && ta.length === tb.length && ta.every((t, i) => t === tb[i]);
}

// ── Statement files ─────────────────────────────────────────────────────────

export const STATEMENT_DATE_FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD-MM-YYYY', 'DD-MMM-YYYY', 'DD MMM YYYY', 'YYYY/MM/DD'] as const;
export type StatementDateFormat = (typeof STATEMENT_DATE_FORMATS)[number];

/**
 * Which columns of a bank or Bakong merchant export hold what. Each field
 * lists the header names it may appear under (case, spaces and punctuation
 * ignored). Either `amount` (credits positive; negative or a debit direction
 * is skipped) or `credit` (only rows with a credit are payments) is needed.
 */
export interface StatementMapping {
  code: string;
  label: string;
  /** False for presets made from published descriptions rather than a real file: confirm before relying on them. */
  verified: boolean;
  columns: {
    date: string[];
    amount?: string[];
    credit?: string[];
    currency?: string[];
    reference: string[];
    payerName?: string[];
    payerAccount?: string[];
    remark?: string[];
    /** A column saying CR / DR, IN / OUT …: rows whose value is not a credit are skipped. */
    direction?: string[];
  };
  /** Values of the direction column that mean money in. */
  creditValues?: string[];
  dateFormats: StatementDateFormat[];
  /** The currency of rows without a currency column; null: the importer chooses. */
  defaultCurrency?: 'USD' | 'KHR' | null;
}

const GENERIC_COLUMNS: StatementMapping['columns'] = {
  date: ['date', 'transaction date', 'trx date', 'txn date', 'value date', 'posting date', 'paid at', 'date time', 'transaction time', 'created at'],
  amount: ['amount', 'transaction amount', 'trx amount', 'txn amount', 'amount received'],
  credit: ['credit', 'credit amount', 'cr', 'cr amount', 'deposit', 'money in', 'paid in'],
  currency: ['currency', 'ccy', 'cur'],
  reference: ['reference', 'ref', 'reference no', 'reference number', 'transaction id', 'trx id', 'txn id', 'transaction reference', 'hash', 'transaction hash', 'bakong hash', 'external ref', 'apv', 'trace no'],
  payerName: ['payer name', 'payer', 'sender', 'sender name', 'from', 'from name', 'customer name', 'account name', 'debtor name'],
  payerAccount: ['payer account', 'sender account', 'from account', 'from account no', 'account', 'payer phone', 'sender phone', 'phone', 'bakong account id', 'debtor account'],
  remark: ['remark', 'remarks', 'description', 'narrative', 'note', 'notes', 'purpose', 'memo', 'details', 'payment details', 'transaction remark'],
  direction: ['direction', 'type', 'dr cr', 'debit credit', 'transaction type', 'cr dr'],
};

const ALL_DATE_FORMATS: StatementDateFormat[] = ['YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY', 'DD-MMM-YYYY', 'DD MMM YYYY', 'YYYY/MM/DD'];

/**
 * Built-in mappings. GENERIC is the platform's own documented layout and
 * accepts the usual header names of Cambodian bank and Bakong merchant
 * exports. The bank presets are the same column names with the date order
 * those exports are described with; they have not been checked against a
 * real file (verified: false) and a lender should confirm one with a sample
 * before relying on it — or define its own under its lending settings
 * (payments.khqr.statementMappings). DECISIONS D-163.
 */
export const STATEMENT_PRESETS: StatementMapping[] = [
  { code: 'GENERIC', label: 'Generic (date, amount, currency, reference, payer, remark)', verified: true, columns: GENERIC_COLUMNS, dateFormats: ALL_DATE_FORMATS, creditValues: ['CR', 'C', 'CREDIT', 'IN', 'RECEIVED', 'INCOMING'], defaultCurrency: null },
  { code: 'BAKONG_MERCHANT', label: 'Bakong merchant transaction export (unverified)', verified: false, columns: GENERIC_COLUMNS, dateFormats: ['DD-MM-YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'DD-MMM-YYYY'], creditValues: ['CR', 'CREDIT', 'IN', 'RECEIVED', 'INCOMING'], defaultCurrency: null },
  { code: 'ABA_MERCHANT', label: 'ABA merchant / PayWay export (unverified)', verified: false, columns: GENERIC_COLUMNS, dateFormats: ['DD-MMM-YYYY', 'DD MMM YYYY', 'YYYY-MM-DD', 'DD/MM/YYYY'], creditValues: ['CR', 'CREDIT', 'IN', 'RECEIVED'], defaultCurrency: null },
  { code: 'ACLEDA_STATEMENT', label: 'ACLEDA account statement (unverified)', verified: false, columns: GENERIC_COLUMNS, dateFormats: ['DD/MM/YYYY', 'DD-MM-YYYY', 'YYYY-MM-DD'], creditValues: ['CR', 'C', 'CREDIT'], defaultCurrency: null },
];

const headerKey = (h: string) =>
  String(h ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export interface StatementLine {
  lineNo: number;
  valueDate: string;
  amount: string;
  currency: string;
  bankRef: string;
  bankRefKey: string;
  payerName: string | null;
  payerAccount: string | null;
  remark: string;
  /** The first line in this file with the same bank reference, when this one repeats it. */
  duplicateOf: number | null;
}

export interface ParsedStatement {
  mapping: string;
  headerLine: number;
  /** Which column each field was read from. */
  columns: Record<string, string>;
  lines: StatementLine[];
  /** Rows that are not payments in: debits, blank amounts. */
  skipped: { lineNo: number; reason: string }[];
  errors: { lineNo: number; message: string }[];
  /** Sum of the lines that are not repeats, per currency. */
  totals: Record<string, string>;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * A statement date in one of the mapping's formats, as YYYY-MM-DD; null when
 * none fits. A time after the date is ignored; a spreadsheet serial date
 * (2000–2099) is read as such.
 */
export function parseStatementDate(raw: string, formats: readonly StatementDateFormat[]): string | null {
  const s = String(raw ?? '').trim().toUpperCase();
  const iso = (y: number, m: number, d: number) => {
    const v = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    try {
      parseDate(v);
      return v;
    } catch {
      return null;
    }
  };
  // A spreadsheet date cell read as its serial number (days since 1899-12-30).
  const serial = s.match(/^(\d{5})(?:\.\d+)?$/);
  if (serial && +serial[1] >= 36526 && +serial[1] <= 73050) return addDays('1899-12-30', +serial[1]);
  for (const f of formats) {
    let m: RegExpMatchArray | null = null;
    switch (f) {
      case 'YYYY-MM-DD':
        m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/);
        if (m) return iso(+m[1], +m[2], +m[3]);
        break;
      case 'YYYY/MM/DD':
        m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:$|\s)/);
        if (m) return iso(+m[1], +m[2], +m[3]);
        break;
      case 'DD/MM/YYYY':
        m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:$|\s)/);
        if (m) return iso(+m[3], +m[2], +m[1]);
        break;
      case 'MM/DD/YYYY':
        m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:$|\s)/);
        if (m) return iso(+m[3], +m[1], +m[2]);
        break;
      case 'DD-MM-YYYY':
        m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:$|\s)/);
        if (m) return iso(+m[3], +m[2], +m[1]);
        break;
      case 'DD-MMM-YYYY':
      case 'DD MMM YYYY':
        m = s.match(/^(\d{1,2})[-\s]([A-Z]{3})[A-Z]*[-\s,]+(\d{4})(?:$|\s)/);
        if (m && MONTHS.includes(m[2])) return iso(+m[3], MONTHS.indexOf(m[2]) + 1, +m[1]);
        break;
    }
  }
  return null;
}

const CURRENCY_ALIASES: Record<string, string> = { USD: 'USD', 'US$': 'USD', $: 'USD', '840': 'USD', KHR: 'KHR', '៛': 'KHR', RIEL: 'KHR', '116': 'KHR' };

/** A statement amount: "1,234.50", "$ 25", "25 USD", "(12.00)" (negative), "-12". Null when unreadable. */
export function parseStatementAmount(raw: string): { value: string; negative: boolean } | null {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/USD|KHR|US\$|\$|៛|RIEL/gi, '').replace(/[\s,]/g, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return { value: new D(s).toString(), negative };
}

/**
 * Parse a statement given as rows of cells (a CSV file, or a spreadsheet's
 * first sheet), through a mapping. The header is the first of the first ten
 * rows that names the date, an amount (or credit) and the reference. Rows
 * that are not money in are skipped and listed; malformed payment rows are
 * errors, and a file with any error is refused as a whole by the caller.
 */
export function parseStatementRows(
  rows: { lineNo: number; cells: string[] }[],
  mapping: StatementMapping,
  opts: { currency?: string | null; maxLines: number },
): ParsedStatement {
  const find = (header: string[], names?: string[]) => {
    if (!names?.length) return -1;
    const wanted = names.map(headerKey);
    for (const w of wanted) {
      const i = header.findIndex((h) => h === w);
      if (i >= 0) return i;
    }
    return -1;
  };
  let headerAt = -1;
  let header: string[] = [];
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const h = rows[r].cells.map(headerKey);
    if (find(h, mapping.columns.date) >= 0 && find(h, mapping.columns.reference) >= 0 && (find(h, mapping.columns.amount) >= 0 || find(h, mapping.columns.credit) >= 0)) {
      headerAt = r;
      header = h;
      break;
    }
  }
  if (headerAt < 0)
    throw new EngineError(
      'FILE_INVALID',
      `No header row found for mapping ${mapping.code}: the first rows must name a date, an amount (or credit) and a reference column.`,
    );
  const col: Record<string, number> = {};
  for (const [field, names] of Object.entries(mapping.columns)) col[field] = find(header, names as string[]);
  // A file with both an amount and a credit column: the credit column decides.
  const raw = rows[headerAt].cells;
  const columns = Object.fromEntries(Object.entries(col).filter(([, i]) => i >= 0).map(([f, i]) => [f, raw[i]]));
  const cell = (cells: string[], field: string) => (col[field] >= 0 ? String(cells[col[field]] ?? '').trim() : '');
  const creditValues = (mapping.creditValues ?? ['CR']).map((v) => v.toUpperCase());

  const lines: StatementLine[] = [];
  const skipped: ParsedStatement['skipped'] = [];
  const errors: ParsedStatement['errors'] = [];
  for (const { lineNo, cells } of rows.slice(headerAt + 1)) {
    if (cells.every((c) => !String(c ?? '').trim())) continue;
    const direction = cell(cells, 'direction').toUpperCase();
    if (col.direction >= 0 && direction && !creditValues.includes(direction)) {
      skipped.push({ lineNo, reason: `not a credit (${direction})` });
      continue;
    }
    const amountRaw = col.credit >= 0 ? cell(cells, 'credit') : cell(cells, 'amount');
    if (!amountRaw || /^0+(\.0+)?$/.test(amountRaw.replace(/[^\d.]/g, ''))) {
      skipped.push({ lineNo, reason: 'no amount received' });
      continue;
    }
    const amount = parseStatementAmount(amountRaw);
    if (!amount) {
      errors.push({ lineNo, message: `amount "${amountRaw}" is not a number` });
      continue;
    }
    if (amount.negative) {
      skipped.push({ lineNo, reason: 'money out (negative amount)' });
      continue;
    }
    const curRaw = cell(cells, 'currency').toUpperCase() || (mapping.defaultCurrency ?? opts.currency ?? '');
    const currencyCode = CURRENCY_ALIASES[curRaw] ?? curRaw;
    let currency: string;
    try {
      currency = getCurrency(currencyCode).code;
    } catch {
      errors.push({ lineNo, message: curRaw ? `currency "${curRaw}" is not supported` : 'no currency: add a currency column or choose the file currency' });
      continue;
    }
    if (!isRepresentable(new D(amount.value), currency)) {
      errors.push({ lineNo, message: `amount ${amount.value} has more decimal places than ${currency} allows` });
      continue;
    }
    const dateRaw = cell(cells, 'date');
    const valueDate = parseStatementDate(dateRaw, mapping.dateFormats);
    if (!valueDate) {
      errors.push({ lineNo, message: `date "${dateRaw}" is not in a format of mapping ${mapping.code} (${mapping.dateFormats.join(', ')})` });
      continue;
    }
    const bankRef = cell(cells, 'reference');
    const refProblem = bankRefProblem(bankRef);
    if (refProblem) {
      errors.push({ lineNo, message: bankRef ? `reference "${bankRef}": ${refProblem}` : 'the reference is empty' });
      continue;
    }
    const text = (v: string, max: number) => (v ? v.slice(0, max) : null);
    lines.push({
      lineNo,
      valueDate,
      amount: amount.value,
      currency,
      bankRef: bankRef.slice(0, 120),
      bankRefKey: bankRefKey(bankRef),
      payerName: text(cell(cells, 'payerName'), 120),
      payerAccount: text(cell(cells, 'payerAccount'), 120),
      remark: cell(cells, 'remark').slice(0, 500),
      duplicateOf: null,
    });
  }
  if (!lines.length && !errors.length) errors.push({ lineNo: rows[headerAt].lineNo, message: 'the file has no payments received' });
  if (lines.length > opts.maxLines) errors.push({ lineNo: lines[opts.maxLines].lineNo, message: `a file may hold at most ${opts.maxLines} payment lines` });
  // The same bank reference twice in one file: an identical repeat is ignored,
  // a different payment under the same reference is an error.
  const first = new Map<string, StatementLine>();
  for (const l of lines) {
    const prev = first.get(l.bankRefKey);
    if (!prev) {
      first.set(l.bankRefKey, l);
      continue;
    }
    if (new D(prev.amount).eq(new D(l.amount)) && prev.currency === l.currency && prev.valueDate === l.valueDate) l.duplicateOf = prev.lineNo;
    else errors.push({ lineNo: l.lineNo, message: `reference ${l.bankRef} is already used on line ${prev.lineNo} for a different payment` });
  }
  const totals: Record<string, InstanceType<typeof D>> = {};
  for (const l of lines) if (l.duplicateOf === null) totals[l.currency] = (totals[l.currency] ?? new D(0)).plus(l.amount);
  return {
    mapping: mapping.code,
    headerLine: rows[headerAt].lineNo,
    columns,
    lines,
    skipped,
    errors: errors.sort((a, b) => a.lineNo - b.lineNo),
    totals: Object.fromEntries(Object.entries(totals).map(([c, v]) => [c, v.toString()])),
  };
}

/** Parse a CSV statement (BOM, CRLF and quoted fields tolerated). */
export function parseStatementCsv(content: string, mapping: StatementMapping, opts: { currency?: string | null; maxLines: number }): ParsedStatement {
  // Some bank exports use semicolons; a header line without commas but with semicolons is read that way.
  const text = normalizeFileText(content);
  const firstLine = text.split('\n', 1)[0] ?? '';
  const csv = !firstLine.includes(',') && firstLine.includes(';') ? text.replace(/;/g, ',') : text;
  const rows = parseCsv(csv).map((r) => ({ lineNo: r.lineNo, cells: r.cells }));
  return parseStatementRows(rows, mapping, opts);
}

// ── Matching a statement line ───────────────────────────────────────────────

export type MatchRule = 'BANK_REFERENCE' | 'LOAN_REFERENCE' | 'CLAIM_AMOUNT' | 'INSTALMENT_AMOUNT';

/** A receipt recorded earlier (claim or staff) with the same bank reference: does the line confirm it? */
export function lineConfirmsReceipt(
  line: Pick<StatementLine, 'amount' | 'currency'>,
  receipt: { amount: string; currency: string },
): { ok: boolean; reason: string } {
  if (receipt.currency !== line.currency)
    return { ok: false, reason: `The receipt with this reference is in ${receipt.currency}; the statement line is in ${line.currency}.` };
  if (!new D(receipt.amount).eq(new D(line.amount)))
    return { ok: false, reason: `The receipt with this reference says ${receipt.amount} ${receipt.currency}; the bank received ${line.amount} ${line.currency}.` };
  return { ok: true, reason: 'The bank statement confirms the receipt with the same transaction reference.' };
}

export interface MatchCandidates {
  /** Loans whose reference appears in the remark. */
  loansInRemark: { loanId: string; reference: string; status: string; currency: string }[];
  /** Pending claims (and staff receipts) not yet confirmed, in the line's currency. */
  pendingReceipts: {
    receiptId: string;
    loanId: string;
    loanReference: string;
    amount: string;
    currency: string;
    valueDate: string;
    /** The payer on the line is this receipt's borrower (phone or name). */
    payerIsBorrower: boolean;
  }[];
  /** Borrowers the payer's phone or name identifies, with their live loans in the line's currency. */
  payers: {
    borrowerId: string;
    by: 'PHONE' | 'NAME';
    loans: { loanId: string; reference: string; currency: string; amountsDue: string[] }[];
  }[];
}

export type MatchResult =
  | { kind: 'LOAN'; rule: Extract<MatchRule, 'LOAN_REFERENCE' | 'INSTALMENT_AMOUNT'>; loanId: string; reason: string }
  | { kind: 'RECEIPT'; rule: 'CLAIM_AMOUNT'; receiptId: string; loanId: string; reason: string }
  | { kind: 'NONE'; reason: string; suggestions: string[] };

/**
 * What a statement line pays, when it is not a receipt already recorded with
 * the same bank reference (that is checked first, by lineConfirmsReceipt).
 * Exact matches only; anything doubtful goes to suspense with suggestions
 * for the person allocating it (DECISIONS D-161):
 *
 *  1. LOAN_REFERENCE — the remark names exactly one of the lender's loans,
 *     it is active and in the line's currency;
 *  2. CLAIM_AMOUNT — exactly one pending claim of the payer (phone or name)
 *     for the same amount and currency, paid within `windowDays` of the line;
 *  3. INSTALMENT_AMOUNT — the payer is identified by phone (or by a name only
 *     one borrower has), has exactly one live loan in the currency, and the
 *     amount equals what is due on it (an instalment, or all that is overdue).
 */
export function matchStatementLine(
  line: Pick<StatementLine, 'amount' | 'currency' | 'valueDate'>,
  c: MatchCandidates,
  windowDays: number,
): MatchResult {
  const amount = new D(line.amount);
  const suggestions = new Set<string>();

  // 1. The loan reference in the remark.
  const named = c.loansInRemark;
  if (named.length > 1)
    return { kind: 'NONE', reason: `The remark names ${named.length} loans (${named.map((l) => l.reference).join(', ')}).`, suggestions: named.map((l) => l.reference) };
  if (named.length === 1) {
    const l = named[0];
    if (l.status !== 'ACTIVE') return { kind: 'NONE', reason: `Loan ${l.reference} in the remark is ${l.status.toLowerCase()}.`, suggestions: [l.reference] };
    if (l.currency !== line.currency)
      return { kind: 'NONE', reason: `Loan ${l.reference} in the remark is in ${l.currency}; the payment is in ${line.currency}.`, suggestions: [l.reference] };
    return { kind: 'LOAN', rule: 'LOAN_REFERENCE', loanId: l.loanId, reason: `The remark names loan ${l.reference}.` };
  }

  // 2. A pending claim of this payer for the same amount.
  const claims = c.pendingReceipts.filter(
    (r) =>
      r.payerIsBorrower &&
      r.currency === line.currency &&
      new D(r.amount).eq(amount) &&
      Math.abs(daysBetween(r.valueDate, line.valueDate)) <= windowDays,
  );
  if (claims.length === 1)
    return {
      kind: 'RECEIPT',
      rule: 'CLAIM_AMOUNT',
      receiptId: claims[0].receiptId,
      loanId: claims[0].loanId,
      reason: `Same payer and amount as the pending claim on loan ${claims[0].loanReference}.`,
    };
  for (const r of claims) suggestions.add(r.loanReference);
  if (claims.length > 1)
    return { kind: 'NONE', reason: `${claims.length} pending claims of this payer have the same amount.`, suggestions: [...suggestions] };

  // 3. The payer's only live loan, for exactly an amount due.
  const byPhone = c.payers.filter((p) => p.by === 'PHONE');
  const identified = byPhone.length ? byPhone : c.payers.filter((p) => p.by === 'NAME');
  const viaName = !byPhone.length;
  for (const p of identified) for (const l of p.loans) suggestions.add(l.reference);
  if (identified.length === 0) return { kind: 'NONE', reason: 'No loan reference in the remark, and the payer is not a known borrower.', suggestions: [...suggestions] };
  if (identified.length > 1)
    return { kind: 'NONE', reason: `${identified.length} borrowers match the payer ${viaName ? 'name' : 'phone'}.`, suggestions: [...suggestions] };
  const loans = identified[0].loans.filter((l) => l.currency === line.currency);
  if (loans.length !== 1)
    return {
      kind: 'NONE',
      reason: loans.length ? `The payer has ${loans.length} live ${line.currency} loans; the remark names none.` : `The payer has no live ${line.currency} loan.`,
      suggestions: [...suggestions],
    };
  const loan = loans[0];
  if (!loan.amountsDue.some((a) => new D(a).eq(amount)))
    return { kind: 'NONE', reason: `The amount is not what is due on the payer's loan ${loan.reference}.`, suggestions: [loan.reference] };
  return {
    kind: 'LOAN',
    rule: 'INSTALMENT_AMOUNT',
    loanId: loan.loanId,
    reason: `The payer (by ${viaName ? 'name' : 'phone'}) has one live loan, ${loan.reference}, and the amount is what is due on it.`,
  };
}
