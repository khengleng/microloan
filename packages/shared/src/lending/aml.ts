import { addMonths, parseDate } from './dates.js';
import { D, dec } from './decimal.js';
import { parseCsv } from './channels.js';

/**
 * AML/CFT building blocks (DECISIONS D-118…D-122): watch-list name matching,
 * customer risk rating and the cash transaction report aggregation. Pure
 * functions; every threshold, weight and list comes from the tenant's
 * lending settings (`aml`), never from here.
 */

/**
 * How money moved, as recorded on a repayment, disbursement or receipt
 * (KHQR: paid to the lender's static KHQR code, D-160). The
 * cash transaction report counts the channels the tenant lists as cash
 * (`aml.ctr.cashChannels`, default BRANCH_CASH).
 */
export const PAYMENT_CHANNEL_CODES = ['BRANCH_CASH', 'AGENT', 'BANK_TRANSFER', 'MOBILE', 'QR', 'KHQR', 'WALLET', 'PAYROLL', 'OTHER'] as const;
export type PaymentChannelCode = (typeof PAYMENT_CHANNEL_CODES)[number];

/** Red flags a staff member can tick when raising a suspicious transaction referral. */
export const STR_INDICATORS = [
  'STRUCTURING',
  'UNUSUAL_CASH',
  'THIRD_PARTY_PAYMENTS',
  'UNEXPLAINED_EARLY_REPAYMENT',
  'INCONSISTENT_WITH_PROFILE',
  'WATCH_LIST_MATCH',
  'IDENTITY_CONCERN',
  'OTHER',
] as const;

// ── Names ───────────────────────────────────────────────────────────────────

export const WATCH_LIST_ENTRY_TYPES = ['SANCTION', 'PEP', 'INTERNAL'] as const;
export type WatchListEntryType = (typeof WATCH_LIST_ENTRY_TYPES)[number];

/**
 * Normalise a personal name for matching:
 *
 *  1. Unicode NFKD, then accents on Latin letters removed — "Sokhà" →
 *     "sokha" (names in Khmer script keep their vowel signs);
 *  2. lower case;
 *  3. anything that is not a letter or digit (hyphens, apostrophes, dots,
 *     commas) becomes a space — "Hun-Sen" → "hun sen";
 *  4. a letter repeated in a row is kept once — Khmer romanisation doubles
 *     consonants inconsistently ("Sokkha" / "Sokha", "Chann" / "Chan");
 *  5. titles and honorifics the tenant lists (`ignoredTitles`: Mr, Dr, Oknha,
 *     Lok Chumteav, H.E. …) are dropped wherever they appear as whole words.
 *
 * Spacing differences of romanised Khmer names ("Sok Dara" / "Sokdara") are
 * handled by the similarity, which also compares the names with their spaces
 * removed. Returns the tokens in their original order.
 */
export function normalizeNameTokens(name: string, ignoredTitles: readonly string[] = []): string[] {
  const fold = (s: string) =>
    s
      .normalize('NFKD')
      // Accents on Latin letters only: Khmer-script vowel signs are marks too, and are kept.
      .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
      .replace(/(\p{L})\1+/gu, '$1')
      .trim();
  const tokens = fold(name).split(/\s+/).filter(Boolean);
  const titles = ignoredTitles.map((t) => fold(t).split(/\s+/).filter(Boolean)).filter((t) => t.length > 0);
  // Longest titles first, so "lok chumteav" goes before "lok".
  titles.sort((a, b) => b.length - a.length);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; ) {
    const title = titles.find((t) => t.every((w, k) => tokens[i + k] === w));
    // A name made only of titles keeps them: there is nothing else to match on.
    if (title && tokens.length > title.length) {
      i += title.length;
      continue;
    }
    out.push(tokens[i]);
    i++;
  }
  return out;
}

/** The normalised name as one string (tokens joined by single spaces). */
export function normalizeName(name: string, ignoredTitles: readonly string[] = []): string {
  return normalizeNameTokens(name, ignoredTitles).join(' ');
}

/** Jaro similarity of two strings, 0…1. */
export function jaro(a: string, b: string): number {
  if (a === b) return a.length ? 1 : 0;
  if (!a.length || !b.length) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array<boolean>(a.length).fill(false);
  const bMatch = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(b.length - 1, i + window);
    for (let j = lo; j <= hi; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = true;
      bMatch[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const m = matches;
  return (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;
}

/**
 * Jaro-Winkler similarity, 0…1: Jaro, boosted for a common prefix of up to
 * four characters by 0.1 per character (Winkler's standard constants).
 */
export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  return j + prefix * 0.1 * (1 - j);
}

export interface NameMatchOptions {
  /** Two tokens below this Jaro-Winkler score are not paired at all. */
  tokenFloor: number;
  /** Multiplies the token score when a one-word name is compared with a longer one. */
  singleTokenPenalty: number;
  ignoredTitles?: readonly string[];
}

export interface NameMatch {
  score: number;
  /** How the score was reached: paired tokens, or the names with spaces removed. */
  method: 'TOKENS' | 'JOINED';
  pairs: { a: string; b: string; score: number }[];
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Token-set Jaro-Winkler similarity of two names, 0…1.
 *
 * TOKENS — every token of one name is paired with at most one token of the
 * other, best Jaro-Winkler pairs first, ignoring pairs below `tokenFloor`;
 * order does not matter ("Dara Sok" = "Sok Dara"). The score is how well the
 * name with fewer tokens is contained in the other:
 *
 *     Σ paired JW(a, b) × (|a| + |b|)  /  (2 × total letters of the shorter name)
 *
 * so a missing middle name does not hide a match, while one shared word in a
 * longer name is discounted by `singleTokenPenalty` when the shorter name
 * has a single token ("Dara" against "Sok Dara").
 *
 * JOINED — when the names have a different number of tokens, they are also
 * compared with their spaces removed (in order, and sorted), by plain Jaro
 * without the prefix boost, for romanisation spacing ("Sokdara Chan" =
 * "Sok Dara Chan", "Chanthy" = "Chan Thy").
 *
 * The result is the higher of the two.
 */
export function nameSimilarity(nameA: string, nameB: string, opts: NameMatchOptions): NameMatch {
  const A = [...new Set(normalizeNameTokens(nameA, opts.ignoredTitles))];
  const B = [...new Set(normalizeNameTokens(nameB, opts.ignoredTitles))];
  if (!A.length || !B.length) return { score: 0, method: 'TOKENS', pairs: [] };
  const [short, long] = A.length < B.length || (A.length === B.length && A.join('').length <= B.join('').length) ? [A, B] : [B, A];
  const candidates: { a: string; b: string; score: number }[] = [];
  for (const a of short) for (const b of long) candidates.push({ a, b, score: jaroWinkler(a, b) });
  candidates.sort((x, y) => y.score - x.score || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
  const usedA = new Set<string>();
  const usedB = new Set<string>();
  const pairs: NameMatch['pairs'] = [];
  for (const c of candidates) {
    if (c.score < opts.tokenFloor || usedA.has(c.a) || usedB.has(c.b)) continue;
    usedA.add(c.a);
    usedB.add(c.b);
    pairs.push({ ...c, score: round4(c.score) });
  }
  const shortLetters = short.join('').length;
  let tokenScore = pairs.reduce((s, p) => s + p.score * (p.a.length + p.b.length), 0) / (2 * shortLetters);
  tokenScore = Math.min(1, tokenScore);
  if (short.length === 1 && long.length > 1) tokenScore *= opts.singleTokenPenalty;

  let joined = 0;
  if (A.length !== B.length) {
    const sorted = (t: string[]) => [...t].sort().join('');
    joined = Math.max(jaro(A.join(''), B.join('')), jaro(sorted(A), sorted(B)));
  }
  return joined > tokenScore
    ? { score: round4(joined), method: 'JOINED', pairs }
    : { score: round4(tokenScore), method: 'TOKENS', pairs };
}

export interface WatchListEntryForMatch {
  id: string;
  name: string;
  aliases: string[];
  entryType: string;
  dateOfBirth?: string | null;
}

export interface ScreeningHit {
  entryId: string;
  entryType: string;
  listName: string;
  matchedName: string;
  score: number;
  method: NameMatch['method'];
  /** Both dates of birth are known and their years differ: shown to the reviewer, never used to drop the hit. */
  dobMismatch: boolean;
}

/**
 * Screen one name against list entries (each with its aliases). Returns the
 * entries scoring at or above `threshold`, best first, one hit per entry.
 */
export function screenName(
  subject: { name: string; dateOfBirth?: string | null },
  entries: readonly WatchListEntryForMatch[],
  opts: NameMatchOptions & { threshold: number },
): ScreeningHit[] {
  const hits: ScreeningHit[] = [];
  for (const e of entries) {
    let best: { name: string; m: NameMatch } | null = null;
    for (const candidate of [e.name, ...e.aliases]) {
      const m = nameSimilarity(subject.name, candidate, opts);
      if (!best || m.score > best.m.score) best = { name: candidate, m };
    }
    if (!best || best.m.score < opts.threshold) continue;
    const dobMismatch =
      !!subject.dateOfBirth && !!e.dateOfBirth && subject.dateOfBirth.slice(0, 4) !== e.dateOfBirth.slice(0, 4);
    hits.push({
      entryId: e.id,
      entryType: e.entryType,
      listName: e.name,
      matchedName: best.name,
      score: best.m.score,
      method: best.m.method,
      dobMismatch,
    });
  }
  return hits.sort((x, y) => y.score - x.score || x.entryId.localeCompare(y.entryId));
}

// ── Watch-list files ────────────────────────────────────────────────────────

export const WATCH_LIST_COLUMNS = ['name', 'type', 'source', 'list_date'] as const;
export const WATCH_LIST_OPTIONAL_COLUMNS = ['aliases', 'country', 'date_of_birth', 'reference'] as const;

export interface WatchListFileEntry {
  lineNo: number;
  name: string;
  entryType: WatchListEntryType;
  source: string;
  listDate: string;
  aliases: string[];
  country: string | null;
  dateOfBirth: string | null;
  reference: string | null;
}

export interface ParsedWatchList {
  entries: WatchListFileEntry[];
  errors: { lineNo: number; message: string }[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string) => {
  if (!ISO_DATE.test(s)) return false;
  try {
    parseDate(s);
    return true;
  } catch {
    return false;
  }
};

/**
 * A watch-list file compliance uploads: CSV with a header row naming at
 * least `name,type,source,list_date`; optional `aliases` (separated by `;`
 * or `|`), `country` (ISO 3166 alpha-2), `date_of_birth` and `reference`.
 * Columns may come in any order; `#` lines are comments.
 */
export function parseWatchListFile(content: string, maxEntries: number): ParsedWatchList {
  const errors: ParsedWatchList['errors'] = [];
  let rows: { lineNo: number; cells: string[] }[];
  try {
    rows = parseCsv(content);
  } catch (e) {
    return { entries: [], errors: [{ lineNo: 0, message: (e as Error).message }] };
  }
  const head = rows.shift();
  if (!head) return { entries: [], errors: [{ lineNo: 1, message: 'The file is empty.' }] };
  const cols = head.cells.map((c) => c.toLowerCase().trim());
  const missing = WATCH_LIST_COLUMNS.filter((c) => !cols.includes(c));
  if (missing.length) {
    return { entries: [], errors: [{ lineNo: head.lineNo, message: `Missing column(s): ${missing.join(', ')}.` }] };
  }
  const known = new Set<string>([...WATCH_LIST_COLUMNS, ...WATCH_LIST_OPTIONAL_COLUMNS]);
  const unknown = cols.filter((c) => !known.has(c));
  if (unknown.length) errors.push({ lineNo: head.lineNo, message: `Unknown column(s): ${unknown.join(', ')}.` });
  if (rows.length > maxEntries) {
    errors.push({ lineNo: 0, message: `The file has ${rows.length} entries; at most ${maxEntries} are accepted.` });
    return { entries: [], errors };
  }
  const at = (row: string[], c: string) => {
    const i = cols.indexOf(c);
    return i < 0 ? '' : (row[i] ?? '').trim();
  };
  const entries: WatchListFileEntry[] = [];
  for (const { lineNo, cells } of rows) {
    const name = at(cells, 'name');
    const type = at(cells, 'type').toUpperCase();
    const source = at(cells, 'source');
    const listDate = at(cells, 'list_date');
    const dob = at(cells, 'date_of_birth');
    const country = at(cells, 'country').toUpperCase();
    const before = errors.length;
    if (name.length < 2 || name.length > 200) errors.push({ lineNo, message: 'name must be 2–200 characters.' });
    else if (!normalizeName(name).length) errors.push({ lineNo, message: 'name has no letters to match on.' });
    if (!(WATCH_LIST_ENTRY_TYPES as readonly string[]).includes(type))
      errors.push({ lineNo, message: `type must be one of ${WATCH_LIST_ENTRY_TYPES.join(', ')}.` });
    if (!source || source.length > 120) errors.push({ lineNo, message: 'source is required (at most 120 characters).' });
    if (!validDate(listDate)) errors.push({ lineNo, message: 'list_date must be a date (YYYY-MM-DD).' });
    if (dob && !validDate(dob)) errors.push({ lineNo, message: 'date_of_birth must be a date (YYYY-MM-DD).' });
    if (country && !/^[A-Z]{2}$/.test(country)) errors.push({ lineNo, message: 'country must be a two-letter ISO code.' });
    if (errors.length > before) continue;
    const aliases = at(cells, 'aliases')
      .split(/[;|]/)
      .map((a) => a.trim())
      .filter((a) => a.length >= 2)
      .slice(0, 20);
    entries.push({
      lineNo,
      name,
      entryType: type as WatchListEntryType,
      source,
      listDate,
      aliases,
      country: country || null,
      dateOfBirth: dob || null,
      reference: at(cells, 'reference').slice(0, 120) || null,
    });
  }
  if (!entries.length && !errors.length) errors.push({ lineNo: head.lineNo, message: 'The file has no entries.' });
  return { entries, errors };
}

// ── Customer risk rating ────────────────────────────────────────────────────

export const AML_RISK_RATINGS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type AmlRiskRating = (typeof AML_RISK_RATINGS)[number];

export const AML_RISK_FACTORS = ['PEP', 'COUNTRY', 'OCCUPATION', 'PRODUCT', 'CASH_INTENSITY'] as const;
export type AmlRiskFactor = (typeof AML_RISK_FACTORS)[number];

export interface AmlRiskSettings {
  weights: Record<'pep' | 'highRiskCountry' | 'highRiskOccupation' | 'highRiskProduct' | 'cashIntensive', number>;
  /** Score at or above which a customer is MEDIUM, and HIGH. */
  mediumAt: number;
  highAt: number;
  /** A politically exposed person is HIGH whatever the score. */
  pepAlwaysHigh: boolean;
  /** ISO 3166 alpha-2 codes. */
  highRiskCountries: string[];
  /** Matched as whole words in the occupation, case-insensitively. */
  highRiskOccupations: string[];
  cashIntensiveOccupations: string[];
  /** Product family codes. */
  highRiskProductFamilies: string[];
  /** Share (0…1) of repayments by value made in cash at or above which the customer counts as cash intensive. */
  cashShareThreshold: string;
  reviewMonths: Record<AmlRiskRating, number>;
}

export interface AmlRiskInput {
  pep: boolean;
  nationality: string | null;
  occupation: string | null;
  productFamilies: string[];
  /** Cash share of repayments by value, as a decimal string, or null when nothing has been repaid. */
  cashShare: string | null;
}

export interface AmlRiskResult {
  rating: AmlRiskRating;
  score: number;
  factors: { code: AmlRiskFactor; present: boolean; weight: number; detail: string }[];
}

const wordMatch = (text: string | null, terms: readonly string[]): string | null => {
  if (!text) return null;
  const hay = ` ${normalizeName(text)} `;
  return terms.find((t) => normalizeName(t) && hay.includes(` ${normalizeName(t)} `)) ?? null;
};

/**
 * Score a customer: the weights of the factors present, added up, against
 * the MEDIUM and HIGH thresholds. Every factor is reported, present or not,
 * so the rating can be explained.
 */
export function rateCustomerRisk(input: AmlRiskInput, s: AmlRiskSettings): AmlRiskResult {
  const country = input.nationality?.toUpperCase() ?? null;
  const occ = wordMatch(input.occupation, s.highRiskOccupations);
  const cashOcc = wordMatch(input.occupation, s.cashIntensiveOccupations);
  const families = input.productFamilies.filter((f) => s.highRiskProductFamilies.includes(f));
  const cashShare = input.cashShare !== null ? dec(input.cashShare) : null;
  const cashByShare = cashShare !== null && cashShare.gte(dec(s.cashShareThreshold));
  const factors: AmlRiskResult['factors'] = [
    {
      code: 'PEP',
      present: input.pep,
      weight: s.weights.pep,
      detail: input.pep ? 'Politically exposed person (confirmed watch-list match)' : 'Not a politically exposed person',
    },
    {
      code: 'COUNTRY',
      present: !!country && s.highRiskCountries.includes(country),
      weight: s.weights.highRiskCountry,
      detail: country ? `Nationality ${country}` : 'Nationality not recorded',
    },
    {
      code: 'OCCUPATION',
      present: !!occ,
      weight: s.weights.highRiskOccupation,
      detail: occ ? `Occupation matches "${occ}"` : `Occupation ${input.occupation ? `"${input.occupation}"` : 'not recorded'}`,
    },
    {
      code: 'PRODUCT',
      present: families.length > 0,
      weight: s.weights.highRiskProduct,
      detail: families.length ? `Product type ${families.join(', ')}` : 'No higher-risk product',
    },
    {
      code: 'CASH_INTENSITY',
      present: !!cashOcc || cashByShare,
      weight: s.weights.cashIntensive,
      detail: cashByShare
        ? `${cashShare!.times(100).toDecimalPlaces(1).toString()}% of repayments in cash`
        : cashOcc
          ? `Cash-intensive occupation "${cashOcc}"`
          : cashShare !== null
            ? `${cashShare.times(100).toDecimalPlaces(1).toString()}% of repayments in cash`
            : 'No repayments yet',
    },
  ];
  const score = factors.filter((f) => f.present).reduce((t, f) => t + f.weight, 0);
  let rating: AmlRiskRating = score >= s.highAt ? 'HIGH' : score >= s.mediumAt ? 'MEDIUM' : 'LOW';
  if (input.pep && s.pepAlwaysHigh) rating = 'HIGH';
  return { rating, score, factors };
}

/** The date a rating made on `ratedOn` (YYYY-MM-DD) is next due for review. */
export function nextAmlReviewDate(ratedOn: string, rating: AmlRiskRating, reviewMonths: Record<AmlRiskRating, number>): string {
  return addMonths(ratedOn, reviewMonths[rating]);
}

// ── Cash transaction report ─────────────────────────────────────────────────

export interface CashTransaction {
  id: string;
  borrowerId: string;
  /** Business date, YYYY-MM-DD. */
  date: string;
  currency: string;
  amount: string;
  direction: 'IN' | 'OUT';
}

export interface CtrGroup {
  borrowerId: string;
  date: string;
  currency: string;
  threshold: string;
  total: string;
  /** SINGLE: one transaction at or above the threshold. AGGREGATED: several the same day that together reach it. */
  basis: 'SINGLE' | 'AGGREGATED';
  transactions: CashTransaction[];
}

/**
 * Cash transactions to report: per customer, business day and currency,
 * every transaction at or above the threshold on its own (SINGLE), and the
 * day's transactions — money in and out together — whose total reaches it
 * (AGGREGATED). A transaction is reported once: a day with a single large
 * transaction and smaller ones is reported as AGGREGATED with all of them.
 * Currencies without a threshold are not assessed and are returned so the
 * report can say so.
 */
export function cashTransactionReport(
  txns: readonly CashTransaction[],
  thresholds: Record<string, string>,
): { groups: CtrGroup[]; unassessedCurrencies: string[] } {
  const byKey = new Map<string, CashTransaction[]>();
  const unassessed = new Set<string>();
  for (const t of txns) {
    if (!thresholds[t.currency]) {
      unassessed.add(t.currency);
      continue;
    }
    const k = `${t.borrowerId}|${t.date}|${t.currency}`;
    const list = byKey.get(k) ?? [];
    list.push(t);
    byKey.set(k, list);
  }
  const groups: CtrGroup[] = [];
  for (const list of byKey.values()) {
    const { borrowerId, date, currency } = list[0];
    const threshold = dec(thresholds[currency]);
    const total = list.reduce((s, t) => s.plus(dec(t.amount)), new D(0));
    if (total.lt(threshold)) continue;
    const sorted = [...list].sort((a, b) => a.id.localeCompare(b.id));
    groups.push({
      borrowerId,
      date,
      currency,
      threshold: threshold.toString(),
      total: total.toString(),
      basis: sorted.length === 1 ? 'SINGLE' : 'AGGREGATED',
      transactions: sorted,
    });
  }
  groups.sort((a, b) => a.date.localeCompare(b.date) || a.borrowerId.localeCompare(b.borrowerId) || a.currency.localeCompare(b.currency));
  return { groups, unassessedCurrencies: [...unassessed].sort() };
}

/** CSV text of a cash transaction report: one line per transaction, with its day's group. */
export function cashTransactionReportCsv(
  groups: readonly CtrGroup[],
  customer: (borrowerId: string) => { name: string; idType: string | null; idNumberHint: string | null; branch: string | null },
): string {
  const q = (v: string | null) => {
    const s = v ?? '';
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    'business_date,customer_id,customer_name,id_type,id_number_hint,branch,currency,direction,amount,transaction_id,day_total,threshold,basis',
  ];
  for (const g of groups) {
    const c = customer(g.borrowerId);
    for (const t of g.transactions)
      lines.push(
        [g.date, g.borrowerId, c.name, c.idType, c.idNumberHint, c.branch, g.currency, t.direction, t.amount, t.id, g.total, g.threshold, g.basis]
          .map((v) => q(v))
          .join(','),
      );
  }
  return `${lines.join('\n')}\n`;
}
