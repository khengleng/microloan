/**
 * Buy now, pay later (LT-11) and leases (LT-15): the purchase-linked parts
 * that a plain instalment loan does not have.
 *
 * BNPL: the lender pays the merchant the purchase price less a merchant
 * discount (its fee, charged to the merchant, not the customer). When the
 * merchant refunds the customer (UC-52), the refund reduces what the customer
 * still owes, latest instalment first, and the lender claws the refunded
 * amount back from the merchant net of the discount it gives back.
 *
 * Every amount crossing this module's boundary is a decimal string.
 */
import { dec, EngineError, ZERO } from './decimal.js';
import { RoundingRule, roundMoney } from './money.js';

export interface MerchantSettlement {
  /** The purchase price financed. */
  gross: string;
  /** The lender's merchant discount fee. */
  discount: string;
  /** What the merchant is actually paid. */
  net: string;
}

export function merchantSettlement(gross: string, discountRate: string, rounding: RoundingRule): MerchantSettlement {
  const g = dec(gross, 'gross');
  const rate = dec(discountRate, 'merchantDiscountRate');
  if (g.lte(0)) throw new EngineError('INVALID_AMOUNT', 'The purchase amount must be positive.');
  if (rate.lt(0) || rate.gte(1)) throw new EngineError('INVALID_RATE', 'A merchant discount rate is a fraction below 1.');
  const discount = roundMoney(g.times(rate), rounding);
  return { gross: g.toString(), discount: discount.toString(), net: g.minus(discount).toString() };
}

export interface RefundableLine {
  number: number;
  principalDue: string;
  principalPaid: string;
}

export interface BnplRefundResult {
  /** Principal taken off each instalment, latest first. */
  reductions: { number: number; principal: string }[];
  /** Part of the refund applied to what the customer still owes. */
  appliedToPrincipal: string;
  /** Part the customer has already paid and is owed back in cash. */
  customerRefund: string;
  /** Merchant discount given back to the merchant, pro rata to the refund. */
  discountReversed: string;
  /** What the merchant owes the lender: the refund less the discount reversed. */
  merchantClawback: string;
}

/**
 * UC-52: a merchant refund or return.
 *
 * The refund reduces the remaining instalments starting with the LAST one and
 * working backwards (D-030): the customer's next payments are unchanged and
 * the plan simply ends sooner, which is what a customer who returned part of
 * a basket expects, and it never creates a partial-instalment arrears that a
 * pro-rata spread would leave on a part-paid instalment. Whatever exceeds the
 * principal still owed was paid by the customer already and is refunded to
 * them. The merchant discount is reversed in proportion to the refund — the
 * lender keeps no fee on a sale that did not happen.
 */
export function bnplRefund(
  input: { amount: string; lines: RefundableLine[]; purchaseAmount: string; alreadyRefunded: string; merchantDiscount: string; discountAlreadyReversed: string },
  rounding: RoundingRule,
): BnplRefundResult {
  const amount = dec(input.amount, 'amount');
  if (amount.lte(0)) throw new EngineError('INVALID_AMOUNT', 'A refund must be positive.');
  const purchase = dec(input.purchaseAmount, 'purchaseAmount');
  const refundable = purchase.minus(dec(input.alreadyRefunded, 'alreadyRefunded'));
  if (amount.gt(refundable)) {
    throw new EngineError('REFUND_EXCEEDS_PURCHASE', `Only ${refundable.toString()} of the ${purchase.toString()} purchase is left to refund.`);
  }
  let left = amount;
  const reductions: { number: number; principal: string }[] = [];
  for (const l of [...input.lines].sort((a, b) => b.number - a.number)) {
    if (left.lte(0)) break;
    const open = dec(l.principalDue).minus(dec(l.principalPaid));
    if (open.lte(0)) continue;
    const take = open.lt(left) ? open : left;
    reductions.push({ number: l.number, principal: take.toString() });
    left = left.minus(take);
  }
  const applied = amount.minus(left);
  // The last refund reverses exactly what is left of the discount, so
  // rounding never strands a cent of fee on a fully refunded purchase.
  const discount = dec(input.merchantDiscount, 'merchantDiscount');
  const reversedSoFar = dec(input.discountAlreadyReversed, 'discountAlreadyReversed');
  const fullyRefunded = amount.eq(refundable);
  const discountReversed = fullyRefunded ? discount.minus(reversedSoFar) : roundMoney(discount.times(amount).div(purchase), rounding);
  return {
    reductions,
    appliedToPrincipal: applied.toString(),
    customerRefund: left.toString(),
    discountReversed: (discountReversed.lt(0) ? ZERO : discountReversed).toString(),
    merchantClawback: amount.minus(discountReversed.lt(0) ? ZERO : discountReversed).toString(),
  };
}

// ── Leases (LT-15, Ijarah) ──────────────────────────────────────────────────

export interface LeaseEndCheck {
  ok: boolean;
  /** The residual (purchase-option price) still owed on the final instalment. */
  residualOutstanding: string;
  issues: string[];
}

/**
 * Whether a lessee may hand the asset back instead of buying it.
 *
 * Every rental must have been paid: what remains may only be the residual —
 * the purchase-option price carried by the final instalment — and no
 * charges. The lease does not end early by return; that is a repossession.
 */
export function leaseReturnCheck(input: {
  residualValue: string;
  principalOutstanding: string;
  chargesOutstanding: string;
  overdueRentals: string;
  finalInstalmentDue: boolean;
}): LeaseEndCheck {
  const issues: string[] = [];
  const residual = dec(input.residualValue, 'residualValue');
  const principal = dec(input.principalOutstanding, 'principalOutstanding');
  if (!input.finalInstalmentDue) issues.push('The lease has not reached its final rental; return before maturity is a repossession, not a lease end.');
  if (dec(input.chargesOutstanding).gt(0)) issues.push(`Rental profit, fees or charges of ${dec(input.chargesOutstanding).toString()} are still owed.`);
  if (dec(input.overdueRentals).gt(0)) issues.push(`Rentals of ${dec(input.overdueRentals).toString()} are still unpaid.`);
  if (!principal.eq(residual)) issues.push(`Only the residual ${residual.toString()} may be left when the asset is returned; ${principal.toString()} is outstanding.`);
  return { ok: issues.length === 0, residualOutstanding: principal.toString(), issues };
}
