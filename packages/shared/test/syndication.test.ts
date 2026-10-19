/**
 * Syndicated loans (LT-24): shares, funding and the split of every collection.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lending as L } from '../src/index.js';

const R = { increment: '0.01', mode: 'HALF_UP' } as const;
const sum = (xs: string[]) => xs.reduce((a, x) => a.plus(x), new L.D(0)).toString();

describe('syndicate composition', () => {
  test('shares summing to 100% resolve to commitments that sum to the loan exactly', () => {
    const p = L.resolveParticipations(
      '1000000.01',
      [
        { lenderName: 'Agent Bank', isAgent: true, share: '0.4' },
        { lenderName: 'Bank B', isAgent: false, share: '0.35' },
        { lenderName: 'Bank C', isAgent: false, share: '0.25' },
      ],
      R,
    );
    assert.deepEqual(
      p.map((x) => x.commitment),
      ['400000.01', '350000', '250000'],
    );
    assert.equal(sum(p.map((x) => x.commitment)), '1000000.01');
    assert.equal(p[0].feeShare, '0.4');
  });

  test('amounts resolve to shares; the agent absorbs the share rounding', () => {
    const p = L.resolveParticipations(
      '300000',
      [
        { lenderName: 'Agent', isAgent: true, amount: '100000' },
        { lenderName: 'B', isAgent: false, amount: '100000' },
        { lenderName: 'C', isAgent: false, amount: '100000' },
      ],
      R,
    );
    assert.equal(p[1].share, '0.333333333333');
    assert.equal(p[0].share, '0.333333333334');
    assert.equal(sum(p.map((x) => x.share)), '1');
  });

  test('refused: shares not summing to 100%, no agent, two agents, a mix, duplicates', () => {
    const run = (ps: L.ParticipantInput[]) => () => L.resolveParticipations('1000', ps, R);
    assert.throws(run([{ lenderName: 'A', isAgent: true, share: '0.5' }, { lenderName: 'B', isAgent: false, share: '0.4' }]), /sum to 100%; they sum to 90%/);
    assert.throws(run([{ lenderName: 'A', isAgent: false, share: '0.5' }, { lenderName: 'B', isAgent: false, share: '0.5' }]), /Exactly one participant must be the agent/);
    assert.throws(run([{ lenderName: 'A', isAgent: true, share: '0.5' }, { lenderName: 'B', isAgent: true, share: '0.5' }]), /Exactly one/);
    assert.throws(run([{ lenderName: 'A', isAgent: true, share: '0.5' }, { lenderName: 'B', isAgent: false, amount: '500' }]), /not a mix/);
    assert.throws(run([{ lenderName: 'A', isAgent: true, share: '0.5' }, { lenderName: 'a ', isAgent: false, share: '0.5' }]), /listed twice/);
    assert.throws(run([{ lenderName: 'A', isAgent: true, amount: '600' }, { lenderName: 'B', isAgent: false, amount: '500' }]), /sum to the loan amount 1000/);
  });

  test('fee shares are optional and must also sum to 100%', () => {
    const p = L.resolveParticipations(
      '1000',
      [
        { lenderName: 'Agent', isAgent: true, share: '0.5', feeShare: '1' },
        { lenderName: 'B', isAgent: false, share: '0.5', feeShare: '0' },
      ],
      R,
    );
    assert.equal(p[0].feeShare, '1');
    assert.throws(
      () => L.resolveParticipations('1000', [{ lenderName: 'A', isAgent: true, share: '0.5', feeShare: '0.6' }, { lenderName: 'B', isAgent: false, share: '0.5' }], R),
      /Fee shares must sum to 100%/,
    );
  });
});

describe('splitting collections', () => {
  const syndicate = [
    { isAgent: true, share: '0.4', feeShare: '1' },
    { isAgent: false, share: '0.35', feeShare: '0' },
    { isAgent: false, share: '0.25', feeShare: '0' },
  ];

  test('principal and interest by share, fees by fee share; parts sum to the whole', () => {
    const parts = L.splitCollection(syndicate, { PRINCIPAL: '10000.01', INTEREST: '833.33', FEE: '50' }, R);
    assert.deepEqual(parts.map((p) => p.PRINCIPAL), ['4000.01', '3500', '2500']);
    assert.deepEqual(parts.map((p) => p.INTEREST), ['333.34', '291.66', '208.33']);
    assert.deepEqual(parts.map((p) => p.FEE), ['50', '0', '0']);
    for (const c of ['PRINCIPAL', 'INTEREST', 'FEE'] as const) assert.ok(new L.D(sum(parts.map((p) => p[c]))).eq({ PRINCIPAL: '10000.01', INTEREST: '833.33', FEE: '50' }[c]));
  });

  test('a reversal splits to exactly the negative of its original', () => {
    const fwd = L.splitCollection(syndicate, { INTEREST: '833.33' }, R);
    const back = L.splitCollection(syndicate, { INTEREST: '-833.33' }, R);
    fwd.forEach((p, i) => assert.ok(new L.D(p.INTEREST).plus(back[i].INTEREST).isZero()));
  });

  test('the SYNDICATED template is available and requires the capability', () => {
    assert.equal(L.templateAvailability(L.TEMPLATE_BY_CODE.SYNDICATED).available, true);
    assert.ok(L.requiredCapabilitiesFor(L.TEMPLATE_BY_CODE.SYNDICATED.defaultConfig).includes('syndication.participations'));
  });
});
