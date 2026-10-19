/**
 * Borrowing base (LT-14). Pure: no I/O, no clock.
 *
 * A borrowing-base certificate lists the borrower's inventory and receivables
 * by class. Each line's gross value is reduced by what is ineligible — stated
 * ineligibles (obsolete stock, disputed invoices), lines older than the
 * class's age limit, and any one counterparty's value above the class's
 * concentration limit — and the eligible value of each class is advanced at
 * the class's rate. The sum is the borrowing base; a revolving line may be
 * drawn only up to the lower of its limit and that base.
 */
import { D, Dec, EngineError, ZERO, dec, sum } from './decimal.js';
import { defaultRounding, parseMoney, roundMoney, RoundingRule } from './money.js';
import { addDays, compareDates, LocalDate, parseDate } from './dates.js';

export type CollateralClassKind = 'INVENTORY' | 'RECEIVABLES';

export interface BorrowingBaseClass {
  code: string;
  label: string;
  kind: CollateralClassKind;
  advanceRate: string;
  maxAgeDays?: number | null;
  concentrationLimit?: string | null;
}

export interface BorrowingBaseLineInput {
  classCode: string;
  description: string;
  /** Debtor (receivables) or supplier / location (inventory); concentration is measured per counterparty. */
  counterparty?: string | null;
  grossValue: string;
  /** Value the borrower or the lender excludes outright (obsolete, disputed, consigned…). */
  ineligibleAmount?: string | null;
  ineligibleReason?: string | null;
  /** Days since invoice date or receipt into stock. */
  ageDays?: number | null;
}

export interface BorrowingBaseLine extends BorrowingBaseLineInput {
  grossValue: string;
  ineligibleAmount: string;
  agedOut: string;
  concentrationExcess: string;
  eligible: string;
}

export interface BorrowingBaseClassResult {
  code: string;
  label: string;
  kind: CollateralClassKind;
  advanceRate: string;
  gross: string;
  /** Stated ineligibles. */
  ineligible: string;
  /** Value excluded for age. */
  agedOut: string;
  /** Value excluded above the concentration limit. */
  concentrationExcess: string;
  eligible: string;
  /** Eligible × advance rate, rounded down to the currency. */
  advance: string;
}

export interface BorrowingBaseResult {
  currency: string;
  classes: BorrowingBaseClassResult[];
  lines: BorrowingBaseLine[];
  gross: string;
  ineligible: string;
  eligible: string;
  borrowingBase: string;
  explanation: string[];
}

/** Work out the borrowing base a certificate supports. */
export function computeBorrowingBase(
  classes: BorrowingBaseClass[],
  input: BorrowingBaseLineInput[],
  currency: string,
  rounding?: RoundingRule,
): BorrowingBaseResult {
  const rule = { ...(rounding ?? defaultRounding(currency)), mode: 'DOWN' as const };
  if (!input.length) throw new EngineError('INVALID_CERTIFICATE', 'A certificate needs at least one line.');
  const byCode = new Map(classes.map((c) => [c.code, c]));
  const lines = input.map((l, i) => {
    const cls = byCode.get(l.classCode);
    if (!cls) throw new EngineError('INVALID_CERTIFICATE', `Line ${i + 1}: ${l.classCode} is not a collateral class of this facility.`);
    const gross = parseMoney(l.grossValue, currency, `lines[${i}].grossValue`);
    const inel = l.ineligibleAmount ? parseMoney(l.ineligibleAmount, currency, `lines[${i}].ineligibleAmount`) : ZERO;
    if (gross.lt(0) || inel.lt(0)) throw new EngineError('INVALID_CERTIFICATE', `Line ${i + 1}: values cannot be negative.`);
    if (inel.gt(gross)) throw new EngineError('INVALID_CERTIFICATE', `Line ${i + 1}: the ineligible amount exceeds the gross value.`);
    if (l.ageDays != null && (!Number.isInteger(l.ageDays) || l.ageDays < 0))
      throw new EngineError('INVALID_CERTIFICATE', `Line ${i + 1}: age must be a whole number of days.`);
    const aged = cls.maxAgeDays != null && l.ageDays != null && l.ageDays > cls.maxAgeDays;
    const agedOut = aged ? gross.minus(inel) : ZERO;
    return { l, cls, gross, inel, agedOut, base: gross.minus(inel).minus(agedOut), excess: ZERO };
  });

  // Concentration: within a class, one counterparty may make up at most the
  // limit's share of the class's eligible value; the excess is ineligible,
  // taken from that counterparty's lines in order.
  for (const cls of classes) {
    if (!cls.concentrationLimit) continue;
    const limit = dec(cls.concentrationLimit, 'concentrationLimit');
    const mine = lines.filter((x) => x.cls.code === cls.code);
    const total = sum(mine.map((x) => x.base));
    const cap = total.times(limit);
    const groups = new Map<string, typeof mine>();
    mine.forEach((x, i) => {
      const k = x.l.counterparty?.trim().toUpperCase() || `#${i}`;
      groups.set(k, [...(groups.get(k) ?? []), x]);
    });
    for (const group of groups.values()) {
      let over = sum(group.map((x) => x.base)).minus(cap);
      for (const x of group) {
        if (over.lte(0)) break;
        const take = D.min(over, x.base);
        x.excess = take;
        x.base = x.base.minus(take);
        over = over.minus(take);
      }
    }
  }

  const classResults: BorrowingBaseClassResult[] = classes
    .map((cls) => {
      const mine = lines.filter((x) => x.cls.code === cls.code);
      const eligible = sum(mine.map((x) => x.base));
      return {
        code: cls.code,
        label: cls.label,
        kind: cls.kind,
        advanceRate: cls.advanceRate,
        gross: sum(mine.map((x) => x.gross)).toString(),
        ineligible: sum(mine.map((x) => x.inel)).toString(),
        agedOut: sum(mine.map((x) => x.agedOut)).toString(),
        concentrationExcess: sum(mine.map((x) => x.excess)).toString(),
        eligible: eligible.toString(),
        advance: roundMoney(eligible.times(dec(cls.advanceRate, 'advanceRate')), rule).toString(),
        used: mine.length > 0,
      };
    })
    .filter((c) => c.used)
    .map(({ used: _used, ...c }) => c);

  const gross = sum(lines.map((x) => x.gross));
  const eligible = sum(lines.map((x) => x.base));
  const borrowingBase = sum(classResults.map((c) => dec(c.advance)));
  return {
    currency,
    classes: classResults,
    lines: lines.map((x) => ({
      ...x.l,
      grossValue: x.gross.toString(),
      ineligibleAmount: x.inel.toString(),
      agedOut: x.agedOut.toString(),
      concentrationExcess: x.excess.toString(),
      eligible: x.base.toString(),
    })),
    gross: gross.toString(),
    ineligible: gross.minus(eligible).toString(),
    eligible: eligible.toString(),
    borrowingBase: borrowingBase.toString(),
    explanation: classResults.map(
      (c) =>
        `${c.label}: gross ${c.gross} − ineligible ${c.ineligible} − aged ${c.agedOut} − over concentration ${c.concentrationExcess} = eligible ${c.eligible}; × ${c.advanceRate} = ${c.advance}.`,
    ),
  };
}

export interface BorrowingBaseAvailability {
  limit: string;
  borrowingBase: string | null;
  /** The lower of the limit and the borrowing base. */
  drawingCap: string;
  outstanding: string;
  available: string;
  certificateAsOf: LocalDate | null;
  /** The certificate may support drawings up to and including this date. */
  certificateValidThrough: LocalDate | null;
  stale: boolean;
  reason: string | null;
}

/**
 * What may be drawn on `date` under the accepted certificate: nothing without
 * one, nothing once it is older than the maximum age, and otherwise the lower
 * of the limit and the borrowing base, less what is already drawn.
 */
export function borrowingBaseAvailability(input: {
  limit: string;
  outstanding: string;
  date: LocalDate;
  maxAgeDays: number;
  certificate: { asOfDate: LocalDate; borrowingBase: string } | null;
}): BorrowingBaseAvailability {
  parseDate(input.date, 'date');
  const limit = dec(input.limit, 'limit');
  const outstanding = dec(input.outstanding, 'outstanding');
  const c = input.certificate;
  if (!c) {
    return {
      limit: limit.toString(),
      borrowingBase: null,
      drawingCap: '0',
      outstanding: outstanding.toString(),
      available: '0',
      certificateAsOf: null,
      certificateValidThrough: null,
      stale: true,
      reason: 'No borrowing-base certificate has been accepted; nothing can be drawn until one is.',
    };
  }
  const validThrough = addDays(c.asOfDate, input.maxAgeDays);
  const stale = compareDates(input.date, validThrough) > 0;
  const base = dec(c.borrowingBase, 'borrowingBase');
  const cap: Dec = D.min(limit, base);
  const available = stale ? ZERO : D.max(cap.minus(outstanding), ZERO);
  return {
    limit: limit.toString(),
    borrowingBase: base.toString(),
    drawingCap: cap.toString(),
    outstanding: outstanding.toString(),
    available: available.toString(),
    certificateAsOf: c.asOfDate,
    certificateValidThrough: validThrough,
    stale,
    reason: stale
      ? `The borrowing-base certificate as of ${c.asOfDate} is more than ${input.maxAgeDays} days old; accept a new certificate before drawing.`
      : null,
  };
}
