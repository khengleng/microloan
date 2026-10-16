/**
 * Group lending: solidarity groups and joint liability.
 *
 * Two arrangements are deliberately distinguished, because they differ in the
 * one respect that matters when a member stops paying:
 *
 *  • **GROUP_JOINT** — one loan, and every member is liable for *all* of it.
 *    A shortfall by one member is a shortfall of the group; the others are
 *    expected to cover it. Shares exist only to say who agreed to carry what
 *    internally; they never cap a member's liability.
 *  • **GROUP_INDIVIDUAL** — the group is a delivery and discipline mechanism,
 *    but each member is liable for their own share alone. One member's
 *    default does not reach the others.
 *
 * Getting that distinction wrong is the difference between being able to
 * pursue a co-member for a debt and not, so it is modelled explicitly rather
 * than left to a flag somewhere in the servicing path.
 */
import { Dec, dec, EngineError, ZERO, sum } from './decimal.js';
import { RoundingRule, parseMoney, roundMoney } from './money.js';
import { LocalDate, compareDates, daysBetween } from './dates.js';

export const GROUP_LIABILITIES = ['GROUP_JOINT', 'GROUP_INDIVIDUAL'] as const;
export type GroupLiability = (typeof GROUP_LIABILITIES)[number];

/** How each member's share of the principal is decided. */
export type ShareBasis = 'EQUAL' | 'NEGOTIATED';

export interface GroupTerms {
  liability: GroupLiability;
  minMembers: number;
  maxMembers: number;
  shareBasis: ShareBasis;
  /** A member must be in the group this long before a loan can include them. */
  minMembershipDays: number;
  /** The group must name a leader who signs for it. */
  requireLeader: boolean;
  /** GROUP_JOINT: members may leave only once the loan is repaid. */
  allowExitWithOutstanding: boolean;
}

export type MemberRole = 'LEADER' | 'MEMBER';

export interface GroupMember {
  borrowerId: string;
  role: MemberRole;
  joinedOn: LocalDate;
  leftOn?: LocalDate | null;
  /**
   * Agreed share of the principal as a decimal fraction. Required when the
   * basis is NEGOTIATED; ignored when it is EQUAL.
   */
  share?: string | null;
}

export interface GroupIssue {
  path: string;
  message: string;
}

/**
 * Check a group can take a loan under these terms, as at `asOf`.
 *
 * Every problem is collected rather than thrown one at a time, so a field
 * officer sees the whole list before going back to the group.
 */
export function validateGroupComposition(terms: GroupTerms, members: GroupMember[], asOf: LocalDate): GroupIssue[] {
  const issues: GroupIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  if (terms.minMembers < 2) {
    add('minMembers', 'A group needs at least two members; one borrower is an individual loan.');
  }
  if (terms.maxMembers < terms.minMembers) {
    add('maxMembers', `The maximum group size (${terms.maxMembers}) is below the minimum (${terms.minMembers}).`);
  }

  const active = members.filter((m) => !m.leftOn || compareDates(m.leftOn, asOf) > 0);
  if (active.length < terms.minMembers) {
    add('members', `This group has ${active.length} active member(s); the product requires at least ${terms.minMembers}.`);
  }
  if (active.length > terms.maxMembers) {
    add('members', `This group has ${active.length} active member(s); the product allows at most ${terms.maxMembers}.`);
  }

  const seen = new Set<string>();
  for (const m of active) {
    if (seen.has(m.borrowerId)) add('members', `Borrower ${m.borrowerId} appears in the group twice.`);
    seen.add(m.borrowerId);
    const days = daysSince(m.joinedOn, asOf);
    if (days < terms.minMembershipDays) {
      add('members', `Borrower ${m.borrowerId} joined ${days} day(s) ago; the product requires ${terms.minMembershipDays}.`);
    }
  }

  const leaders = active.filter((m) => m.role === 'LEADER');
  if (terms.requireLeader && leaders.length !== 1) {
    add('members', leaders.length === 0 ? 'The group must name a leader.' : `The group names ${leaders.length} leaders; it must name exactly one.`);
  }

  if (terms.shareBasis === 'NEGOTIATED') {
    let total = ZERO;
    for (const m of active) {
      if (m.share === undefined || m.share === null) {
        add('members', `Borrower ${m.borrowerId} has no agreed share, which a negotiated split requires.`);
        continue;
      }
      const share = safeShare(m.share, `members.${m.borrowerId}.share`, add);
      if (share) {
        if (share.lte(0)) add('members', `Borrower ${m.borrowerId} has a share of ${m.share}; every member must carry some of the loan.`);
        total = total.plus(share);
      }
    }
    if (active.length && !total.eq(1)) {
      add('members', `The agreed shares total ${total.toString()}; they must total exactly 1.`);
    }
  } else if (active.some((m) => m.share !== undefined && m.share !== null)) {
    add('members', 'Shares are split equally under this product; remove the negotiated shares.');
  }

  return issues;
}

function safeShare(value: string, path: string, add: (p: string, m: string) => void): Dec | null {
  try {
    return dec(value, path);
  } catch (e) {
    add(path, (e as Error).message);
    return null;
  }
}

function daysSince(from: LocalDate, to: LocalDate): number {
  // Epoch-day arithmetic from the dates module; business dates are never
  // instants on this platform.
  return daysBetween(from, to);
}

// ── Shares ──────────────────────────────────────────────────────────────────

export interface MemberShare {
  borrowerId: string;
  /** The member's agreed portion of the principal, as money. */
  amount: string;
  /** That portion as a decimal fraction of the principal. */
  fraction: string;
  /**
   * What this member can actually be pursued for. Under joint liability it is
   * the whole principal, not the member's share.
   */
  liableFor: string;
}

/**
 * Split the principal across the active members.
 *
 * An equal split rarely divides exactly, so the residual goes to the leader
 * (or the first member when no leader is named) rather than being spread as
 * sub-unit amounts the currency cannot settle. The amounts always sum to the
 * principal exactly.
 *
 * `liableFor` is where the two arrangements diverge, and it is computed here
 * so no caller has to remember the rule.
 */
export function allocateShares(
  terms: GroupTerms,
  members: GroupMember[],
  principal: string,
  currency: string,
  rounding: RoundingRule,
  asOf: LocalDate,
): MemberShare[] {
  const total = parseMoney(principal, currency, 'principal');
  if (total.lte(0)) throw new EngineError('INVALID_PRINCIPAL', 'A group loan principal must be greater than zero.');
  const active = members.filter((m) => !m.leftOn || compareDates(m.leftOn, asOf) > 0);
  if (!active.length) throw new EngineError('EMPTY_GROUP', 'The group has no active members to share the loan between.');

  const amounts: Dec[] =
    terms.shareBasis === 'EQUAL'
      ? active.map(() => roundMoney(total.div(active.length), rounding))
      : active.map((m) => roundMoney(total.times(dec(m.share ?? '0', 'share')), rounding));

  // The residual lands on the leader, who signs for the group.
  const residual = total.minus(sum(amounts));
  if (!residual.isZero()) {
    const leaderIndex = active.findIndex((m) => m.role === 'LEADER');
    const target = leaderIndex >= 0 ? leaderIndex : 0;
    amounts[target] = amounts[target].plus(residual);
  }

  return active.map((m, i) => ({
    borrowerId: m.borrowerId,
    amount: amounts[i].toString(),
    fraction: amounts[i].div(total).toString(),
    liableFor: (terms.liability === 'GROUP_JOINT' ? total : amounts[i]).toString(),
  }));
}

/**
 * What one member can be pursued for on an outstanding balance.
 *
 * Under joint liability every member is liable for the whole outstanding
 * amount — that is the entire point of a solidarity group, and it does not
 * shrink because other members have paid their notional share.
 */
export function memberExposure(terms: GroupTerms, outstanding: string, memberFraction: string, currency: string, rounding: RoundingRule): string {
  const balance = parseMoney(outstanding, currency, 'outstanding');
  if (terms.liability === 'GROUP_JOINT') return balance.toString();
  return roundMoney(balance.times(dec(memberFraction, 'memberFraction')), rounding).toString();
}

// ── Contributions ───────────────────────────────────────────────────────────

export interface Contribution {
  borrowerId: string;
  amount: string;
}

export interface ContributionSplit {
  lines: { borrowerId: string; expected: string; paid: string; shortfall: string; surplus: string }[];
  totalPaid: string;
  totalExpected: string;
  /** Short overall, after surpluses from other members are counted. */
  groupShortfall: string;
  /** True when the group met its instalment, however unevenly. */
  groupCurrent: boolean;
}

/**
 * Compare what each member contributed with what they were expected to.
 *
 * Under joint liability a surplus from one member covers another's shortfall
 * and the group is current — the loan does not care who paid. The per-member
 * shortfalls are still reported, because that is what the group meeting and
 * the field officer act on.
 */
export function splitContributions(
  shares: MemberShare[],
  instalmentAmount: string,
  contributions: Contribution[],
  currency: string,
  rounding: RoundingRule,
): ContributionSplit {
  const instalment = parseMoney(instalmentAmount, currency, 'instalmentAmount');
  const paidBy = new Map<string, Dec>();
  for (const c of contributions) {
    const amount = parseMoney(c.amount, currency, 'contribution.amount');
    if (amount.lt(0)) throw new EngineError('INVALID_CONTRIBUTION', `A contribution from ${c.borrowerId} is negative.`);
    paidBy.set(c.borrowerId, (paidBy.get(c.borrowerId) ?? ZERO).plus(amount));
  }
  const unknown = [...paidBy.keys()].filter((id) => !shares.some((s) => s.borrowerId === id));
  if (unknown.length) {
    throw new EngineError('UNKNOWN_CONTRIBUTOR', `Contribution from ${unknown.join(', ')}, who is not on this loan.`);
  }

  const expectedOf = (s: MemberShare) => roundMoney(instalment.times(dec(s.fraction, 'fraction')), rounding);
  const rawExpected = shares.map(expectedOf);
  // Rounding each share independently can miss the instalment by a cent; the
  // residual sits with the first member so the expectations sum exactly.
  const residual = instalment.minus(sum(rawExpected));
  if (!residual.isZero() && rawExpected.length) rawExpected[0] = rawExpected[0].plus(residual);

  const lines = shares.map((s, i) => {
    const expected = rawExpected[i];
    const paid = paidBy.get(s.borrowerId) ?? ZERO;
    const diff = paid.minus(expected);
    return {
      borrowerId: s.borrowerId,
      expected: expected.toString(),
      paid: paid.toString(),
      shortfall: (diff.lt(0) ? diff.negated() : ZERO).toString(),
      surplus: (diff.gt(0) ? diff : ZERO).toString(),
    };
  });

  const totalPaid = sum([...paidBy.values()]);
  const groupShortfall = instalment.minus(totalPaid);
  return {
    lines,
    totalPaid: totalPaid.toString(),
    totalExpected: instalment.toString(),
    groupShortfall: (groupShortfall.gt(0) ? groupShortfall : ZERO).toString(),
    groupCurrent: groupShortfall.lte(0),
  };
}

// ── Membership changes ──────────────────────────────────────────────────────

export interface ExitCheck {
  ok: boolean;
  issues: GroupIssue[];
  /** What the member must settle before leaving, when they may leave at all. */
  settlementAmount: string | null;
}

export interface GroupExposure {
  /** Principal still owed across the group's live loans. */
  outstanding: string;
  /**
   * Loans the member is bound to that are still live — booked or active.
   *
   * This, not the balance, is what governs exit. A loan that is booked but
   * not yet disbursed owes nothing and still binds every member to it, so a
   * member who left in between would have walked away from a contract that
   * names them.
   */
  liveLoans: number;
}

/**
 * Whether a member may leave, and on what terms.
 *
 * Under joint liability a member who leaves while a loan is live is walking
 * away from a debt the others would inherit, so the product decides whether
 * that is allowed at all; when it is, they settle their share of whatever is
 * outstanding. Leaving must also not drop the group below its minimum size.
 */
export function checkMemberExit(
  terms: GroupTerms,
  members: GroupMember[],
  borrowerId: string,
  exposure: GroupExposure,
  memberFraction: string,
  currency: string,
  rounding: RoundingRule,
  asOf: LocalDate,
): ExitCheck {
  const issues: GroupIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  const active = members.filter((m) => !m.leftOn || compareDates(m.leftOn, asOf) > 0);
  const leaving = active.find((m) => m.borrowerId === borrowerId);
  if (!leaving) {
    return { ok: false, issues: [{ path: 'borrowerId', message: `Borrower ${borrowerId} is not an active member of this group.` }], settlementAmount: null };
  }

  const balance = parseMoney(exposure.outstanding, currency, 'outstanding');
  const bound = exposure.liveLoans > 0;
  let settlement: Dec | null = null;
  if (bound) {
    if (!terms.allowExitWithOutstanding) {
      add(
        'outstanding',
        balance.gt(0)
          ? `The group still owes ${balance.toString()}; under this product a member cannot leave until it is repaid.`
          : 'The group has a loan booked that this member is bound to; under this product they cannot leave until it is repaid.',
      );
    } else {
      settlement = roundMoney(balance.times(dec(memberFraction, 'memberFraction')), rounding);
    }
    if (active.length - 1 < terms.minMembers) {
      add('members', `Leaving would drop the group to ${active.length - 1} member(s), below the minimum of ${terms.minMembers} while a loan is outstanding.`);
    }
  }
  if (leaving.role === 'LEADER' && terms.requireLeader && bound) {
    add('members', 'The leader cannot leave while a loan is outstanding; appoint a new leader first.');
  }

  return {
    ok: issues.length === 0,
    issues,
    settlementAmount: issues.length === 0 && settlement ? settlement.toString() : null,
  };
}
