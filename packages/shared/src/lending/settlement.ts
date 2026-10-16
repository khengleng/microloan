/**
 * Negotiated settlement and recovery after write-off.
 *
 * Both deal with a loan the lender no longer expects to collect in full, and
 * both turn on the same discipline: the money that actually arrives is
 * allocated to what is owed, and the gap is named explicitly rather than
 * disappearing into a balancing figure.
 *
 *  • **Negotiated settlement** — the borrower pays an agreed amount *less*
 *    than the balance and the loan closes. The shortfall is a concession the
 *    lender grants, so it is itemised by component and priced as a fraction of
 *    the full amount, which is what an approval authority is measured on.
 *  • **Recovery after write-off** — money arrives on a loan already written
 *    off. The balance is already zero, so a recovery cannot reduce it; it is
 *    allocated against what *was* written off, so the recovery of principal is
 *    distinguishable from the recovery of penalties.
 */
import { Dec, dec, EngineError, ZERO, sum } from './decimal.js';
import { RoundingRule, parseMoney, roundMoney } from './money.js';
import type { DueComponent } from './servicing.js';

/** Every component a balance can carry. */
export const SETTLEMENT_COMPONENTS: DueComponent[] = ['PENALTY', 'FEE', 'TAX', 'INTEREST', 'PRINCIPAL'];

/**
 * Default allocation for a settlement or a recovery: principal first.
 *
 * This is deliberately the *opposite* of the ordinary repayment order, which
 * clears penalties first. On a performing loan, clearing charges first stops
 * them compounding. In a settlement the lender is choosing what to give up,
 * and principal is the real loss — so principal is recovered first and the
 * concession falls on charges. Allocating charges first would protect the
 * penalties and forgive the principal, which is not what "we settled for
 * less" is ever meant to mean.
 */
export const SETTLEMENT_ALLOCATION_ORDER: DueComponent[] = ['PRINCIPAL', 'INTEREST', 'FEE', 'TAX', 'PENALTY'];

export interface SettlementPosition {
  principal: string;
  interest: string;
  fees: string;
  penalties: string;
  tax?: string;
}

function positionOf(p: SettlementPosition, currency: string): Record<DueComponent, Dec> {
  const read = (v: string | undefined, field: string) => parseMoney(v ?? '0', currency, field);
  const map: Record<DueComponent, Dec> = {
    PENALTY: read(p.penalties, 'penalties'),
    FEE: read(p.fees, 'fees'),
    TAX: read(p.tax, 'tax'),
    INTEREST: read(p.interest, 'interest'),
    PRINCIPAL: read(p.principal, 'principal'),
  };
  for (const [component, value] of Object.entries(map)) {
    if (value.lt(0)) throw new EngineError('INVALID_POSITION', `${component} is negative.`);
  }
  return map;
}

export interface ComponentAmount {
  component: DueComponent;
  amount: string;
}

// ── Negotiated settlement ───────────────────────────────────────────────────

export interface NegotiatedSettlementTerms {
  /** What the borrower will actually pay. */
  agreedAmount: string;
  /** Order the agreed amount clears components in. */
  allocationOrder?: DueComponent[];
  /**
   * Components the lender is prepared to forgive. Anything left unpaid in a
   * component that is not listed makes the settlement invalid rather than
   * being quietly written off.
   */
  forgivable: DueComponent[];
}

export interface NegotiatedSettlement {
  agreedAmount: string;
  /** What closing the loan would cost at full value. */
  fullAmount: string;
  /** The gap the lender is giving up. */
  concession: string;
  /** Concession ÷ full amount, as a decimal fraction. */
  concessionRate: string;
  /** How the agreed amount is applied. */
  allocations: ComponentAmount[];
  /** What is forgiven, by component. */
  forgiven: ComponentAmount[];
  /** True when principal itself is being forgiven, not just charges. */
  forgivesPrincipal: boolean;
  explanation: string[];
}

/**
 * Work out a negotiated settlement.
 *
 * By default the agreed amount recovers principal first, so the concession
 * falls on charges rather than on the money actually lent (see
 * `SETTLEMENT_ALLOCATION_ORDER`). A product may order it differently.
 *
 * Anything left unpaid in a component the lender has not agreed to forgive is
 * an error — a settlement that silently forgave principal because the
 * allocation ran out would be a credit decision nobody made.
 */
export function calculateNegotiatedSettlement(
  position: SettlementPosition,
  terms: NegotiatedSettlementTerms,
  currency: string,
  rounding: RoundingRule,
): NegotiatedSettlement {
  const owed = positionOf(position, currency);
  const order = terms.allocationOrder ?? SETTLEMENT_ALLOCATION_ORDER;
  assertOrder(order);
  const full = sum(Object.values(owed));
  if (full.lte(0)) {
    throw new EngineError('NOTHING_OWED', 'This loan owes nothing; there is nothing to settle.');
  }

  const agreed = parseMoney(terms.agreedAmount, currency, 'agreedAmount');
  if (agreed.lte(0)) {
    throw new EngineError('INVALID_SETTLEMENT', 'A negotiated settlement must be greater than zero.');
  }
  if (agreed.gte(full)) {
    throw new EngineError(
      'NOT_A_CONCESSION',
      `The agreed amount ${agreed.toString()} is not less than the ${full.toString()} owed; settle the loan in full instead.`,
    );
  }

  let left = agreed;
  const allocations: ComponentAmount[] = [];
  const forgiven: ComponentAmount[] = [];
  const forgivable = new Set(terms.forgivable);
  const refused: DueComponent[] = [];

  for (const component of order) {
    const due = owed[component];
    if (due.lte(0)) continue;
    const paid = due.lt(left) ? due : left;
    left = left.minus(paid);
    if (paid.gt(0)) allocations.push({ component, amount: paid.toString() });
    const gap = due.minus(paid);
    if (gap.gt(0)) {
      if (!forgivable.has(component)) refused.push(component);
      forgiven.push({ component, amount: gap.toString() });
    }
  }
  if (refused.length) {
    throw new EngineError(
      'FORGIVENESS_NOT_PERMITTED',
      `This settlement would forgive ${refused.join(', ')}, which the terms do not permit.`,
    );
  }

  const concession = sum(forgiven.map((f) => dec(f.amount)));
  const forgivesPrincipal = forgiven.some((f) => f.component === 'PRINCIPAL' && dec(f.amount).gt(0));
  return {
    agreedAmount: agreed.toString(),
    fullAmount: full.toString(),
    concession: concession.toString(),
    concessionRate: roundRate(concession.div(full)),
    allocations,
    forgiven,
    forgivesPrincipal,
    explanation: [
      `Settling at ${agreed.toString()} against ${full.toString()} owed gives up ${concession.toString()} (${roundRate(concession.div(full).times(100))}%).`,
      `Applied: ${allocations.map((a) => `${a.component} ${a.amount}`).join(', ') || 'nothing'}.`,
      `Forgiven: ${forgiven.map((f) => `${f.component} ${f.amount}`).join(', ') || 'nothing'}.`,
      forgivesPrincipal
        ? 'This settlement forgives principal, not only charges.'
        : 'Only charges are forgiven; principal is recovered in full.',
    ],
  };
}

function roundRate(value: Dec): string {
  return value.toDecimalPlaces(6).toString();
}

function assertOrder(order: DueComponent[]): void {
  if (new Set(order).size !== order.length) {
    throw new EngineError('INVALID_ALLOCATION_ORDER', 'The allocation order repeats a component.');
  }
  for (const c of order) {
    if (!SETTLEMENT_COMPONENTS.includes(c)) {
      throw new EngineError('INVALID_ALLOCATION_ORDER', `Unknown component ${String(c)} in the allocation order.`);
    }
  }
}

// ── Recovery after write-off ────────────────────────────────────────────────

export interface Recovery {
  amount: string;
  /** How the recovery is attributed to what was written off. */
  allocations: ComponentAmount[];
  /** Written-off amount still unrecovered after this payment. */
  remainingWrittenOff: string;
  /** Cumulative recovered, including this payment. */
  recoveredToDate: string;
  /** True when this payment recovers everything that was written off. */
  fullyRecovered: boolean;
  explanation: string[];
}

/**
 * Allocate money received on a loan that has already been written off.
 *
 * A written-off loan carries no balance, so a recovery cannot reduce one. It
 * is attributed against what was written off — principal recovered first,
 * because that is the economic loss the lender took — and a payment larger
 * than the outstanding written-off amount is refused rather than booked as
 * income the loan cannot account for.
 */
export function allocateRecovery(
  writtenOff: SettlementPosition,
  alreadyRecovered: ComponentAmount[],
  amount: string,
  currency: string,
  rounding: RoundingRule,
  order: DueComponent[] = SETTLEMENT_ALLOCATION_ORDER,
): Recovery {
  assertOrder(order);
  const owed = positionOf(writtenOff, currency);
  const recoveredBefore = new Map<DueComponent, Dec>();
  for (const r of alreadyRecovered) {
    const value = parseMoney(r.amount, currency, 'alreadyRecovered.amount');
    recoveredBefore.set(r.component, (recoveredBefore.get(r.component) ?? ZERO).plus(value));
  }
  for (const [component, recovered] of recoveredBefore) {
    if (recovered.gt(owed[component] ?? ZERO)) {
      throw new EngineError(
        'OVER_RECOVERED',
        `${recovered.toString()} has already been recovered against ${component}, which only ${(owed[component] ?? ZERO).toString()} was written off for.`,
      );
    }
  }

  const totalWrittenOff = sum(Object.values(owed));
  const totalRecoveredBefore = sum([...recoveredBefore.values()]);
  const outstanding = totalWrittenOff.minus(totalRecoveredBefore);

  const payment = parseMoney(amount, currency, 'amount');
  if (payment.lte(0)) throw new EngineError('INVALID_RECOVERY', 'A recovery must be greater than zero.');
  if (payment.gt(outstanding)) {
    throw new EngineError(
      'RECOVERY_EXCEEDS_WRITE_OFF',
      `${payment.toString()} exceeds the ${outstanding.toString()} still written off on this loan.`,
    );
  }

  let left = payment;
  const allocations: ComponentAmount[] = [];
  for (const component of order) {
    if (left.lte(0)) break;
    const room = (owed[component] ?? ZERO).minus(recoveredBefore.get(component) ?? ZERO);
    if (room.lte(0)) continue;
    const take = room.lt(left) ? room : left;
    left = left.minus(take);
    allocations.push({ component, amount: roundMoney(take, rounding).toString() });
  }

  const recoveredToDate = totalRecoveredBefore.plus(payment);
  const remaining = totalWrittenOff.minus(recoveredToDate);
  return {
    amount: payment.toString(),
    allocations,
    remainingWrittenOff: remaining.toString(),
    recoveredToDate: recoveredToDate.toString(),
    fullyRecovered: remaining.isZero(),
    explanation: [
      `Recovered ${payment.toString()} of the ${totalWrittenOff.toString()} written off; ${remaining.toString()} remains.`,
      `Attributed: ${allocations.map((a) => `${a.component} ${a.amount}`).join(', ')}.`,
    ],
  };
}
