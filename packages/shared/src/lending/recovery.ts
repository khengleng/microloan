/**
 * Recovery workflows (UC-65 repossession, UC-66 / LT-09 pawn and gold,
 * UC-68 credit insurance, UC-71 debt sale). Pure: no I/O, no clock.
 *
 * Every recovery that brings money in — the sale of a repossessed asset, the
 * auction of a forfeited pawn, an insurer paying a claim — runs through the
 * same waterfall: the costs of getting the money are paid first, then the
 * loan's balances in the product's order, and anything left over belongs to
 * the borrower (or the estate). Anything still owed after the waterfall is a
 * deficiency: it stays on the loan rather than disappearing.
 */
import { Dec, dec, EngineError, ZERO, sum } from './decimal.js';
import { RoundingRule, parseMoney, roundMoney } from './money.js';
import { addDays, compareDates } from './dates.js';
import type { AllocationLine, DueComponent } from './servicing.js';
import type { ComponentAmount, SettlementPosition } from './settlement.js';

/** Balance components a recovery can pay, in loan-account terms. */
export type RecoveryComponent = 'PENALTY' | 'FEE' | 'INTEREST' | 'PRINCIPAL';
export const RECOVERY_COMPONENTS: RecoveryComponent[] = ['PENALTY', 'FEE', 'INTEREST', 'PRINCIPAL'];

/**
 * Default order net proceeds clear the loan in, after costs: interest, then
 * principal, then fees and penalties. A product may reorder the four.
 */
export const RECOVERY_PROCEEDS_ORDER: RecoveryComponent[] = ['INTEREST', 'PRINCIPAL', 'FEE', 'PENALTY'];

// ── Pawn and gold valuation (LT-09) ─────────────────────────────────────────

export interface PawnValuationInput {
  /** Gross weight of the item in grams. */
  weightGrams: string;
  /** Karat (1–24); converted to fineness as karat ÷ 24. Give this or `purity`. */
  karat?: number;
  /** Fineness as a fraction (0.75 = 18k, 0.9999 = 24k bullion). */
  purity?: string;
  /** Price of one gram of pure metal. */
  pricePerGram: string;
  /** Optional maximum loan-to-value: the most that can be lent against the item. */
  maxLtv?: string | null;
}

export interface PawnValuation {
  fineness: string;
  /** Weight of pure metal: weight × fineness. */
  fineWeightGrams: string;
  /** weight × fineness × price per gram, rounded to the currency. */
  value: string;
  /** value × max LTV, rounded down, when a maximum LTV is given. */
  maxLoan: string | null;
  explanation: string;
}

/** Value a gold item by weight × purity × price per gram (LT-09). */
export function pawnValuation(input: PawnValuationInput, currency: string, rounding: RoundingRule): PawnValuation {
  const weight = dec(input.weightGrams, 'weightGrams');
  if (weight.lte(0)) throw new EngineError('PAWN_INPUT', 'Weight must be greater than zero.');
  let fineness: Dec;
  if (input.karat !== undefined && input.karat !== null) {
    if (!Number.isInteger(input.karat) || input.karat < 1 || input.karat > 24)
      throw new EngineError('PAWN_INPUT', 'Karat must be a whole number from 1 to 24.');
    if (input.purity !== undefined)
      throw new EngineError('PAWN_INPUT', 'Give the karat or the purity, not both.');
    fineness = dec(input.karat).div(24);
  } else if (input.purity !== undefined) {
    fineness = dec(input.purity, 'purity');
  } else {
    throw new EngineError('PAWN_INPUT', 'The karat or the purity is required.');
  }
  if (fineness.lte(0) || fineness.gt(1)) throw new EngineError('PAWN_INPUT', 'Purity must be above 0 and at most 1.');
  const price = parseMoney(input.pricePerGram, currency, 'pricePerGram');
  if (price.lte(0)) throw new EngineError('PAWN_INPUT', 'The price per gram must be greater than zero.');
  const fine = weight.times(fineness);
  const value = roundMoney(fine.times(price), rounding);
  let maxLoan: Dec | null = null;
  if (input.maxLtv) {
    const ltv = dec(input.maxLtv, 'maxLtv');
    if (ltv.lte(0) || ltv.gt(1)) throw new EngineError('PAWN_INPUT', 'Maximum LTV must be above 0 and at most 1.');
    maxLoan = roundMoney(value.times(ltv), { increment: rounding.increment, mode: 'DOWN' });
  }
  const fin = fineness.toDecimalPlaces(6);
  return {
    fineness: fin.toString(),
    fineWeightGrams: fine.toDecimalPlaces(4).toString(),
    value: value.toString(),
    maxLoan: maxLoan?.toString() ?? null,
    explanation: `${weight} g × ${fin} fine = ${fine.toDecimalPlaces(4)} g pure × ${price} per gram = ${value}${maxLoan ? `; at ${dec(input.maxLtv!).times(100)}% LTV at most ${maxLoan} can be lent` : ''}.`,
  };
}

// ── Proceeds waterfall (UC-65, UC-66, UC-68) ────────────────────────────────

export interface RecoveryProceedsInput {
  /** What the buyer (or insurer) pays. */
  grossProceeds: string;
  /** Costs of seizure, storage and sale, paid out of the proceeds first. */
  costs?: string;
  /** What the loan owes now. Tax is carried with fees. */
  owed: SettlementPosition;
  /** Order the net proceeds clear the balances in; costs always come first. */
  order?: RecoveryComponent[];
}

export interface RecoveryProceeds {
  grossProceeds: string;
  costs: string;
  /** Costs paid out of the proceeds. */
  costsRecovered: string;
  /** Costs the proceeds did not cover; the lender bears them. */
  unrecoveredCosts: string;
  /** Gross proceeds less the costs paid from them. */
  netProceeds: string;
  /** What the net proceeds paid on the loan, by component. */
  applied: ComponentAmount[];
  totalApplied: string;
  /** Left after the loan is paid in full: owed to the borrower or the estate. */
  surplus: string;
  /** Still owed after the proceeds, by component. */
  deficiency: ComponentAmount[];
  deficiencyTotal: string;
  /** True when nothing is owed afterwards. */
  settlesLoan: boolean;
  explanation: string[];
}

export function applyRecoveryProceeds(input: RecoveryProceedsInput, currency: string): RecoveryProceeds {
  const order = input.order ?? RECOVERY_PROCEEDS_ORDER;
  if (order.length !== RECOVERY_COMPONENTS.length || new Set(order).size !== order.length || order.some((c) => !RECOVERY_COMPONENTS.includes(c)))
    throw new EngineError('INVALID_ALLOCATION_ORDER', `The proceeds order must list ${RECOVERY_COMPONENTS.join(', ')} once each.`);
  const gross = parseMoney(input.grossProceeds, currency, 'grossProceeds');
  if (gross.lte(0)) throw new EngineError('INVALID_PROCEEDS', 'Proceeds must be greater than zero.');
  const costs = parseMoney(input.costs ?? '0', currency, 'costs');
  if (costs.lt(0)) throw new EngineError('INVALID_PROCEEDS', 'Costs cannot be negative.');
  const read = (v: string | undefined, field: string) => {
    const x = parseMoney(v ?? '0', currency, field);
    if (x.lt(0)) throw new EngineError('INVALID_POSITION', `${field} is negative.`);
    return x;
  };
  const owed: Record<RecoveryComponent, Dec> = {
    PENALTY: read(input.owed.penalties, 'penalties'),
    FEE: read(input.owed.fees, 'fees').plus(read(input.owed.tax, 'tax')),
    INTEREST: read(input.owed.interest, 'interest'),
    PRINCIPAL: read(input.owed.principal, 'principal'),
  };
  const costsRecovered = Dec_min(costs, gross);
  const unrecovered = costs.minus(costsRecovered);
  const net = gross.minus(costsRecovered);
  let left = net;
  const applied: ComponentAmount[] = [];
  const deficiency: ComponentAmount[] = [];
  for (const c of order) {
    const due = owed[c];
    const paid = Dec_min(due, left);
    left = left.minus(paid);
    if (paid.gt(0)) applied.push({ component: c, amount: paid.toString() });
    if (due.minus(paid).gt(0)) deficiency.push({ component: c, amount: due.minus(paid).toString() });
  }
  const totalApplied = sum(applied.map((a) => dec(a.amount)));
  const deficiencyTotal = sum(deficiency.map((d) => dec(d.amount)));
  return {
    grossProceeds: gross.toString(),
    costs: costs.toString(),
    costsRecovered: costsRecovered.toString(),
    unrecoveredCosts: unrecovered.toString(),
    netProceeds: net.toString(),
    applied,
    totalApplied: totalApplied.toString(),
    surplus: left.toString(),
    deficiency,
    deficiencyTotal: deficiencyTotal.toString(),
    settlesLoan: deficiencyTotal.isZero(),
    explanation: [
      `Proceeds ${gross}${costs.gt(0) ? ` less costs ${costsRecovered}${unrecovered.gt(0) ? ` (${unrecovered} of the costs not covered)` : ''}` : ''} leave ${net} for the loan.`,
      `Applied: ${applied.map((a) => `${a.component} ${a.amount}`).join(', ') || 'nothing'}.`,
      left.gt(0)
        ? `The loan is paid in full; ${left} is surplus owed to the borrower.`
        : deficiencyTotal.gt(0)
          ? `A deficiency of ${deficiencyTotal} is still owed (${deficiency.map((d) => `${d.component} ${d.amount}`).join(', ')}).`
          : 'The loan is paid in full with nothing left over.',
    ],
  };
}

function Dec_min(a: Dec, b: Dec): Dec {
  return a.lt(b) ? a : b;
}

export interface InstalmentOutstanding {
  number: number;
  /** Unpaid amount per schedule component. */
  outstanding: Partial<Record<DueComponent, string>>;
}

/**
 * Place amounts applied to the loan's balances onto its instalments, oldest
 * first, so the schedule keeps agreeing with the balances when a deficiency
 * leaves the loan open. Fees cover the instalments' fees and tax.
 * Anything that cannot be placed is returned in `unplaced`; the caller must
 * treat that as a break, not round it away.
 */
export function spreadOverInstalments(
  lines: InstalmentOutstanding[],
  applied: ComponentAmount[],
): { allocations: AllocationLine[]; unplaced: ComponentAmount[] } {
  const sorted = [...lines].sort((a, b) => a.number - b.number);
  const room = sorted.map((l) => {
    const r: Partial<Record<DueComponent, Dec>> = {};
    for (const [k, v] of Object.entries(l.outstanding)) r[k as DueComponent] = dec(v ?? '0');
    return r;
  });
  const targets: Record<string, DueComponent[]> = {
    PENALTY: ['PENALTY'],
    FEE: ['FEE', 'TAX'],
    TAX: ['TAX'],
    INTEREST: ['INTEREST'],
    PRINCIPAL: ['PRINCIPAL'],
  };
  const allocations: AllocationLine[] = [];
  const unplaced: ComponentAmount[] = [];
  for (const a of applied) {
    let left = dec(a.amount);
    for (let i = 0; i < sorted.length && left.gt(0); i++) {
      for (const c of targets[a.component] ?? []) {
        const space = room[i][c] ?? ZERO;
        if (space.lte(0) || left.lte(0)) continue;
        const take = Dec_min(space, left);
        allocations.push({ instalmentNumber: sorted[i].number, component: c, amount: take.toString() });
        room[i][c] = space.minus(take);
        left = left.minus(take);
      }
    }
    if (left.gt(0)) unplaced.push({ component: a.component, amount: left.toString() });
  }
  return { allocations, unplaced };
}

// ── Redemption deadline (UC-66) ─────────────────────────────────────────────

/** Whether a pawn may be forfeited on `businessDate`: only after the deadline plus any grace. */
export function pawnForfeitable(redemptionDeadline: string, businessDate: string, graceDays: number): boolean {
  if (!Number.isInteger(graceDays) || graceDays < 0) throw new EngineError('PAWN_INPUT', 'Grace days must be a whole number of days, zero or more.');
  return compareDates(businessDate, addDays(redemptionDeadline, graceDays)) > 0;
}

// ── Debt sale (UC-71) ───────────────────────────────────────────────────────

export interface DebtSaleInput {
  price: string;
  owed: SettlementPosition;
  /** Loss allowance held against the loan. */
  allowance: string;
  /** Accrued interest held in suspense (never recognised as income). */
  interestInSuspense: string;
}

export interface DebtSaleResult {
  price: string;
  grossReceivable: string;
  /** Receivables less allowance and suspended interest: what the loan is carried at. */
  carryingAmount: string;
  /** Price − carrying amount: positive is a gain, negative a loss. */
  gainLoss: string;
  gain: string;
  loss: string;
  explanation: string;
}

/** Gain or loss on selling a loan: price against its carrying amount net of allowance. */
export function debtSaleResult(input: DebtSaleInput, currency: string): DebtSaleResult {
  const price = parseMoney(input.price, currency, 'price');
  if (price.lte(0)) throw new EngineError('INVALID_PRICE', 'The sale price must be greater than zero.');
  const g = (v: string | undefined, f: string) => parseMoney(v ?? '0', currency, f);
  const gross = g(input.owed.principal, 'principal')
    .plus(g(input.owed.interest, 'interest'))
    .plus(g(input.owed.fees, 'fees'))
    .plus(g(input.owed.tax, 'tax'))
    .plus(g(input.owed.penalties, 'penalties'));
  const allowance = g(input.allowance, 'allowance');
  const suspense = g(input.interestInSuspense, 'interestInSuspense');
  const carrying = gross.minus(allowance).minus(suspense);
  if (carrying.lt(0)) throw new EngineError('INVALID_POSITION', 'The allowance and suspended interest exceed the receivables.');
  const diff = price.minus(carrying);
  return {
    price: price.toString(),
    grossReceivable: gross.toString(),
    carryingAmount: carrying.toString(),
    gainLoss: diff.toString(),
    gain: diff.gt(0) ? diff.toString() : '0',
    loss: diff.lt(0) ? diff.negated().toString() : '0',
    explanation: `Sold for ${price} against ${gross} owed, carried at ${carrying} after ${allowance} allowance${suspense.gt(0) ? ` and ${suspense} suspended interest` : ''}: ${diff.gte(0) ? `gain ${diff}` : `loss ${diff.negated()}`}.`,
  };
}
