import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const USD: L.RoundingRule = { increment: '0.01', mode: 'HALF_UP' };

const terms = (over: Partial<L.GroupTerms> = {}): L.GroupTerms => ({
  liability: 'GROUP_JOINT',
  minMembers: 3,
  maxMembers: 8,
  shareBasis: 'EQUAL',
  minMembershipDays: 30,
  requireLeader: true,
  allowExitWithOutstanding: false,
  ...over,
});

const member = (
  borrowerId: string,
  over: Partial<L.GroupMember> = {},
): L.GroupMember => ({
  borrowerId,
  role: 'MEMBER',
  joinedOn: '2025-01-01',
  ...over,
});

const GROUP: L.GroupMember[] = [
  member('b1', { role: 'LEADER' }),
  member('b2'),
  member('b3'),
];

const ASOF = '2026-01-05';

describe('group composition', () => {
  test('a well-formed group validates clean', () => {
    assert.deepEqual(L.validateGroupComposition(terms(), GROUP, ASOF), []);
  });

  const messages = (t: L.GroupTerms, m: L.GroupMember[], asOf = ASOF) =>
    L.validateGroupComposition(t, m, asOf).map((i) => i.message).join(' | ');

  test('a group below the minimum size cannot borrow', () => {
    assert.match(messages(terms(), GROUP.slice(0, 2)), /2 active member\(s\); the product requires at least 3/);
  });

  test('a group above the maximum size cannot borrow', () => {
    const big = Array.from({ length: 9 }, (_, i) => member(`b${i}`, i === 0 ? { role: 'LEADER' } : {}));
    assert.match(messages(terms(), big), /9 active member\(s\); the product allows at most 8/);
  });

  test('a member who has left does not count towards the group', () => {
    const withLeaver = [...GROUP, member('b4', { leftOn: '2025-12-01' })];
    assert.deepEqual(L.validateGroupComposition(terms(), withLeaver, ASOF), []);
    // Leaving in the future still counts them today.
    const leavingLater = [...GROUP, member('b4', { leftOn: '2026-06-01' })];
    assert.deepEqual(L.validateGroupComposition(terms({ maxMembers: 3 }), leavingLater, ASOF).length, 1);
  });

  test('a member too new to the group blocks the loan', () => {
    const fresh = [...GROUP.slice(0, 2), member('b3', { joinedOn: '2025-12-20' })];
    assert.match(messages(terms(), fresh), /joined 16 day\(s\) ago; the product requires 30/);
  });

  test('exactly one leader is required when the product says so', () => {
    assert.match(messages(terms(), GROUP.map((m) => ({ ...m, role: 'MEMBER' as const }))), /must name a leader/);
    assert.match(messages(terms(), GROUP.map((m) => ({ ...m, role: 'LEADER' as const }))), /names 3 leaders/);
    // Not required: no leader is fine.
    assert.deepEqual(
      L.validateGroupComposition(terms({ requireLeader: false }), GROUP.map((m) => ({ ...m, role: 'MEMBER' as const })), ASOF),
      [],
    );
  });

  test('a duplicated borrower is caught', () => {
    assert.match(messages(terms(), [...GROUP, member('b2')]), /appears in the group twice/);
  });

  test('a one-member minimum is refused: that is an individual loan', () => {
    assert.match(messages(terms({ minMembers: 1 }), GROUP), /one borrower is an individual loan/);
  });

  test('negotiated shares must total exactly one', () => {
    const negotiated = terms({ shareBasis: 'NEGOTIATED' });
    const ok = [
      member('b1', { role: 'LEADER', share: '0.5' }),
      member('b2', { share: '0.3' }),
      member('b3', { share: '0.2' }),
    ];
    assert.deepEqual(L.validateGroupComposition(negotiated, ok, ASOF), []);
    const short = [
      member('b1', { role: 'LEADER', share: '0.5' }),
      member('b2', { share: '0.3' }),
      member('b3', { share: '0.1' }),
    ];
    assert.match(messages(negotiated, short), /shares total 0.9; they must total exactly 1/);
  });

  test('a negotiated split needs a share for every member, and no zero shares', () => {
    const negotiated = terms({ shareBasis: 'NEGOTIATED' });
    const missing = [member('b1', { role: 'LEADER', share: '0.6' }), member('b2', { share: '0.4' }), member('b3')];
    assert.match(messages(negotiated, missing), /has no agreed share/);
    const zero = [
      member('b1', { role: 'LEADER', share: '0.6' }),
      member('b2', { share: '0.4' }),
      member('b3', { share: '0' }),
    ];
    assert.match(messages(negotiated, zero), /every member must carry some of the loan/);
  });

  test('shares on an equal-split product are refused rather than ignored', () => {
    const withShares = [member('b1', { role: 'LEADER', share: '0.5' }), member('b2'), member('b3')];
    assert.match(messages(terms(), withShares), /split equally under this product; remove the negotiated shares/);
  });
});

describe('share allocation', () => {
  test('an equal split that does not divide puts the residual on the leader', () => {
    // 1000 / 3 = 333.33 each, leaving 0.01.
    const shares = L.allocateShares(terms(), GROUP, '1000', 'USD', USD, ASOF);
    assert.deepEqual(shares.map((s) => s.amount), ['333.34', '333.33', '333.33']);
    assert.equal(shares[0].borrowerId, 'b1'); // the leader carries the cent
    const total = shares.reduce((a, s) => a.plus(s.amount), new L.D(0));
    assert.equal(total.toString(), '1000');
  });

  test('with no leader the residual goes to the first member', () => {
    const noLeader = GROUP.map((m) => ({ ...m, role: 'MEMBER' as const }));
    const shares = L.allocateShares(terms({ requireLeader: false }), noLeader, '1000', 'USD', USD, ASOF);
    assert.equal(shares[0].amount, '333.34');
  });

  test('a negotiated split follows the agreed fractions and still sums exactly', () => {
    const negotiated = terms({ shareBasis: 'NEGOTIATED' });
    const members = [
      member('b1', { role: 'LEADER', share: '0.5' }),
      member('b2', { share: '0.3' }),
      member('b3', { share: '0.2' }),
    ];
    const shares = L.allocateShares(negotiated, members, '1000', 'USD', USD, ASOF);
    assert.deepEqual(shares.map((s) => s.amount), ['500', '300', '200']);
  });

  test('under joint liability every member is liable for the whole loan', () => {
    const shares = L.allocateShares(terms(), GROUP, '1000', 'USD', USD, ASOF);
    assert.ok(shares.every((s) => s.liableFor === '1000'), JSON.stringify(shares));
    // The share says what they agreed to carry, not what they can be pursued for.
    assert.notEqual(shares[1].amount, shares[1].liableFor);
  });

  test('under individual liability each member is liable for their share only', () => {
    const shares = L.allocateShares(terms({ liability: 'GROUP_INDIVIDUAL' }), GROUP, '1000', 'USD', USD, ASOF);
    assert.deepEqual(shares.map((s) => s.liableFor), ['333.34', '333.33', '333.33']);
  });

  test('members who have left are not given a share', () => {
    const withLeaver = [...GROUP, member('b4', { leftOn: '2025-12-01' })];
    const shares = L.allocateShares(terms(), withLeaver, '900', 'USD', USD, ASOF);
    assert.equal(shares.length, 3);
    assert.ok(!shares.some((s) => s.borrowerId === 'b4'));
  });

  test('a zero principal and an empty group are both refused', () => {
    assert.throws(() => L.allocateShares(terms(), GROUP, '0', 'USD', USD, ASOF), /greater than zero/);
    assert.throws(() => L.allocateShares(terms(), [], '1000', 'USD', USD, ASOF), /no active members/);
  });

  test('a KHR group splits in settleable amounts', () => {
    const KHR: L.RoundingRule = { increment: '100', mode: 'HALF_UP' };
    const shares = L.allocateShares(terms(), GROUP, '1000000', 'KHR', KHR, ASOF);
    const total = shares.reduce((a, s) => a.plus(s.amount), new L.D(0));
    assert.equal(total.toString(), '1000000');
    // Every share is a multiple of the 100-riel settlement increment.
    assert.ok(shares.slice(1).every((s) => new L.D(s.amount).mod(100).isZero()));
  });
});

describe('member exposure', () => {
  test('joint liability exposes each member to the full outstanding balance', () => {
    assert.equal(L.memberExposure(terms(), '750', '0.3333', 'USD', USD), '750');
  });

  test('individual liability exposes each member to their share', () => {
    assert.equal(
      L.memberExposure(terms({ liability: 'GROUP_INDIVIDUAL' }), '750', '0.3333', 'USD', USD),
      '249.98',
    );
  });

  test('joint exposure does not shrink because others have paid', () => {
    // The balance falls, but each member is still liable for all that is left.
    assert.equal(L.memberExposure(terms(), '100', '0.3333', 'USD', USD), '100');
  });
});

describe('contributions', () => {
  const shares = L.allocateShares(terms(), GROUP, '900', 'USD', USD, ASOF);

  test('an even payment leaves nobody short', () => {
    const r = L.splitContributions(shares, '300', [
      { borrowerId: 'b1', amount: '100' },
      { borrowerId: 'b2', amount: '100' },
      { borrowerId: 'b3', amount: '100' },
    ], 'USD', USD);
    assert.equal(r.groupCurrent, true);
    assert.equal(r.groupShortfall, '0');
    assert.ok(r.lines.every((l) => l.shortfall === '0'));
  });

  test('a surplus from one member covers another and the group stays current', () => {
    const r = L.splitContributions(shares, '300', [
      { borrowerId: 'b1', amount: '200' },
      { borrowerId: 'b2', amount: '100' },
    ], 'USD', USD);
    assert.equal(r.groupCurrent, true, 'the loan does not care who paid');
    assert.equal(r.groupShortfall, '0');
    // The individual position is still reported: this is what the group meeting acts on.
    const b3 = r.lines.find((l) => l.borrowerId === 'b3')!;
    assert.equal(b3.shortfall, '100');
    const b1 = r.lines.find((l) => l.borrowerId === 'b1')!;
    assert.equal(b1.surplus, '100');
  });

  test('a group that pays less than the instalment is short', () => {
    const r = L.splitContributions(shares, '300', [
      { borrowerId: 'b1', amount: '100' },
      { borrowerId: 'b2', amount: '100' },
    ], 'USD', USD);
    assert.equal(r.groupCurrent, false);
    assert.equal(r.groupShortfall, '100');
  });

  test('expectations sum to the instalment exactly despite rounding', () => {
    const r = L.splitContributions(shares, '100', [], 'USD', USD);
    const expected = r.lines.reduce((a, l) => a.plus(l.expected), new L.D(0));
    assert.equal(expected.toString(), '100');
  });

  test('a contribution from someone not on the loan is refused', () => {
    assert.throws(
      () => L.splitContributions(shares, '300', [{ borrowerId: 'stranger', amount: '50' }], 'USD', USD),
      /who is not on this loan/,
    );
  });

  test('a negative contribution is refused', () => {
    assert.throws(
      () => L.splitContributions(shares, '300', [{ borrowerId: 'b1', amount: '-50' }], 'USD', USD),
      /is negative/,
    );
  });

  test('two payments from one member are added together', () => {
    const r = L.splitContributions(shares, '300', [
      { borrowerId: 'b1', amount: '60' },
      { borrowerId: 'b1', amount: '40' },
    ], 'USD', USD);
    assert.equal(r.lines.find((l) => l.borrowerId === 'b1')!.paid, '100');
  });
});

describe('member exit', () => {
  const exit = (t: L.GroupTerms, outstanding: string, borrowerId = 'b2') =>
    L.checkMemberExit(t, GROUP, borrowerId, outstanding, '0.3333', 'USD', USD, ASOF);

  test('a member may leave freely once the loan is repaid', () => {
    const r = exit(terms(), '0');
    assert.equal(r.ok, true);
    assert.equal(r.settlementAmount, null);
  });

  test('under joint liability with a balance outstanding, leaving is refused', () => {
    const r = exit(terms(), '600');
    assert.equal(r.ok, false);
    assert.match(r.issues.map((i) => i.message).join(' '), /cannot leave until it is repaid/);
  });

  test('where the product allows it, the leaver settles their share', () => {
    const r = exit(terms({ allowExitWithOutstanding: true, minMembers: 2 }), '600');
    assert.equal(r.ok, true);
    assert.equal(r.settlementAmount, '199.98'); // 600 × 0.3333
  });

  test('leaving cannot drop the group below its minimum while money is owed', () => {
    const r = exit(terms({ allowExitWithOutstanding: true }), '600');
    assert.equal(r.ok, false);
    assert.match(r.issues.map((i) => i.message).join(' '), /below the minimum of 3/);
  });

  test('the leader cannot leave mid-loan without a successor', () => {
    const r = L.checkMemberExit(
      terms({ allowExitWithOutstanding: true, minMembers: 2 }),
      GROUP,
      'b1',
      '600',
      '0.3333',
      'USD',
      USD,
      ASOF,
    );
    assert.equal(r.ok, false);
    assert.match(r.issues.map((i) => i.message).join(' '), /appoint a new leader first/);
  });

  test('someone who is not a member cannot leave', () => {
    const r = exit(terms(), '0', 'stranger');
    assert.equal(r.ok, false);
    assert.match(r.issues[0].message, /not an active member/);
  });
});
