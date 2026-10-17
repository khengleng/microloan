/**
 * Syndicated loans (LT-24). Pure: no I/O, no clock.
 *
 * Several lenders fund one loan through an agent (the tenant). Each
 * participant holds a share; funding, and every collection afterwards, is
 * split by share. Splits are rounded to the currency increment and the
 * rounding difference always falls to the agent, so the parts add up to the
 * whole exactly and no participant is ever paid a cent the borrower did not
 * pay.
 */
import { D, Dec, dec, EngineError } from './decimal.js';
import { roundMoney, RoundingRule } from './money.js';

export interface ParticipantInput {
  lenderName: string;
  isAgent: boolean;
  /** Share of the loan as a fraction ('0.4'), or… */
  share?: string | null;
  /** …the amount committed. Give one or the other for every participant. */
  amount?: string | null;
  /** Share of fees, when it differs from the loan share (e.g. an agency fee kept by the agent). */
  feeShare?: string | null;
}

export interface Participation {
  lenderName: string;
  isAgent: boolean;
  share: string;
  commitment: string;
  feeShare: string;
}

/** Shares are stored to 12 decimal places. */
const SHARE_DP = 12;

/**
 * Validate a syndicate and resolve every participant's share and commitment.
 *
 * Exactly one participant is the agent (the tenant itself). Shares must sum
 * to exactly 1, or commitments to exactly the loan amount; when commitments
 * are given, shares are derived from them and the agent's share absorbs the
 * rounding so the shares still sum to exactly 1. Fee shares default to the
 * loan share and, if any is given, must also sum to 1.
 */
export function resolveParticipations(
  principal: string,
  input: ParticipantInput[],
  rounding: RoundingRule,
  bounds: { minParticipants: number; maxParticipants: number } = { minParticipants: 2, maxParticipants: 50 },
): Participation[] {
  const total = dec(principal, 'principal');
  if (total.lte(0)) throw new EngineError('SYNDICATE_INPUT', 'The loan amount must be positive.');
  if (input.length < bounds.minParticipants || input.length > bounds.maxParticipants)
    throw new EngineError('SYNDICATE_SIZE', `A syndicate under this product has ${bounds.minParticipants}–${bounds.maxParticipants} participants; ${input.length} given.`);
  const agents = input.filter((p) => p.isAgent);
  if (agents.length !== 1) throw new EngineError('SYNDICATE_AGENT', 'Exactly one participant must be the agent (this lender).');
  const names = new Set<string>();
  for (const p of input) {
    const name = p.lenderName.trim().toUpperCase();
    if (!name) throw new EngineError('SYNDICATE_INPUT', 'Every participant needs a lender name.');
    if (names.has(name)) throw new EngineError('SYNDICATE_DUPLICATE', `${p.lenderName} is listed twice.`);
    names.add(name);
  }
  const byShare = input.every((p) => p.share != null && p.amount == null);
  const byAmount = input.every((p) => p.amount != null && p.share == null);
  if (!byShare && !byAmount) throw new EngineError('SYNDICATE_INPUT', 'Give every participant either a share or an amount, not a mix.');

  let shares: Dec[];
  let commitments: Dec[];
  if (byShare) {
    shares = input.map((p) => dec(p.share!, 'share'));
    if (shares.some((s) => s.lte(0) || s.gt(1))) throw new EngineError('SYNDICATE_SHARE', 'Every share must be above 0 and at most 1.');
    if (shares.some((s) => s.decimalPlaces() > SHARE_DP)) throw new EngineError('SYNDICATE_SHARE', `Shares carry at most ${SHARE_DP} decimal places.`);
    const sumShares = shares.reduce((a, s) => a.plus(s), new D(0));
    if (!sumShares.eq(1)) throw new EngineError('SYNDICATE_SHARES_SUM', `Shares must sum to 100%; they sum to ${sumShares.times(100).toString()}%.`);
    commitments = prorate(total.toString(), shares.map((s) => s.toString()), input.findIndex((p) => p.isAgent), rounding).map((x) => dec(x));
  } else {
    commitments = input.map((p) => dec(p.amount!, 'amount'));
    if (commitments.some((c) => c.lte(0))) throw new EngineError('SYNDICATE_SHARE', 'Every commitment must be positive.');
    const sumAmounts = commitments.reduce((a, c) => a.plus(c), new D(0));
    if (!sumAmounts.eq(total)) throw new EngineError('SYNDICATE_SHARES_SUM', `Commitments must sum to the loan amount ${total}; they sum to ${sumAmounts}.`);
    const agent = input.findIndex((p) => p.isAgent);
    shares = commitments.map((c) => c.div(total).toDecimalPlaces(SHARE_DP, D.ROUND_DOWN));
    const others = shares.reduce((a, s, i) => (i === agent ? a : a.plus(s)), new D(0));
    shares[agent] = new D(1).minus(others);
  }

  const feeGiven = input.some((p) => p.feeShare != null);
  let feeShares = shares;
  if (feeGiven) {
    feeShares = input.map((p, i) => (p.feeShare != null ? dec(p.feeShare, 'feeShare') : shares[i]));
    if (feeShares.some((s) => s.lt(0) || s.gt(1))) throw new EngineError('SYNDICATE_SHARE', 'Fee shares must be between 0 and 1.');
    const sumFee = feeShares.reduce((a, s) => a.plus(s), new D(0));
    if (!sumFee.eq(1)) throw new EngineError('SYNDICATE_SHARES_SUM', `Fee shares must sum to 100%; they sum to ${sumFee.times(100).toString()}%.`);
  }
  return input.map((p, i) => ({
    lenderName: p.lenderName.trim(),
    isAgent: p.isAgent,
    share: shares[i].toString(),
    commitment: commitments[i].toString(),
    feeShare: feeShares[i].toString(),
  }));
}

/**
 * Split `amount` by `shares`. Every part but the remainder holder's is
 * rounded down to the increment; the remainder holder (the agent) takes the
 * difference, so the parts sum to `amount` exactly.
 */
export function prorate(amount: string, shares: string[], remainderIndex: number, rounding: RoundingRule): string[] {
  const total = dec(amount, 'amount');
  if (remainderIndex < 0 || remainderIndex >= shares.length) throw new EngineError('SYNDICATE_INPUT', 'The remainder must fall to a participant.');
  // DOWN rounds toward zero, so a negative split (a reversal) mirrors its original.
  const down: RoundingRule = { increment: rounding.increment, mode: 'DOWN' };
  const parts = shares.map((s, i) => (i === remainderIndex ? new D(0) : roundMoney(total.times(dec(s, 'share')), down)));
  const others = parts.reduce((a, p) => a.plus(p), new D(0));
  parts[remainderIndex] = total.minus(others);
  return parts.map((p) => p.toString());
}

export type CollectionComponent = 'PRINCIPAL' | 'INTEREST' | 'PENALTY' | 'FEE';

/**
 * Split one collection, component by component, across the syndicate.
 * Principal, interest and penalties follow the loan share; fees follow the
 * fee share. Negative amounts (a reversed repayment) split the same way, so a
 * reversal exactly undoes its original.
 */
export function splitCollection(
  participants: Pick<Participation, 'isAgent' | 'share' | 'feeShare'>[],
  components: Partial<Record<CollectionComponent, string>>,
  rounding: RoundingRule,
): Record<CollectionComponent, string>[] {
  const agent = participants.findIndex((p) => p.isAgent);
  if (agent < 0) throw new EngineError('SYNDICATE_AGENT', 'The syndicate has no agent.');
  const out = participants.map(() => ({ PRINCIPAL: '0', INTEREST: '0', PENALTY: '0', FEE: '0' }) as Record<CollectionComponent, string>);
  for (const c of ['PRINCIPAL', 'INTEREST', 'PENALTY', 'FEE'] as CollectionComponent[]) {
    const v = components[c];
    if (!v || dec(v).isZero()) continue;
    const parts = prorate(v, participants.map((p) => (c === 'FEE' ? p.feeShare : p.share)), agent, rounding);
    parts.forEach((x, i) => (out[i][c] = x));
  }
  return out;
}
