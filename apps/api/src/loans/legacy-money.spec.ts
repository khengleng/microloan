import {
  allocateRepayment,
  dec,
  localDate,
  localMidnight,
  totalDue,
  unallocateByComponent,
} from './legacy-money';

const inst = (n: number, over: Record<string, unknown> = {}) => ({
  id: `s${n}`,
  installmentNumber: n,
  principalAmount: '333.33',
  interestAmount: '3.33',
  penaltyAmount: '0',
  totalAmount: '336.66',
  paidPrincipal: '0',
  paidInterest: '0',
  paidPenalty: '0',
  isPaid: false,
  ...over,
});

/** D-098: exact allocation of a legacy repayment. */
describe('legacy repayment allocation', () => {
  it('allocates interest, principal then penalty per instalment, in exact cents', () => {
    const rows = [
      inst(1, { penaltyAmount: '0.10', totalAmount: '336.76' }),
      inst(2),
      inst(3),
    ];
    const a = allocateRepayment(rows, dec('400.03'));
    expect(
      a.lines.map((l) => [
        l.scheduleId,
        l.interest,
        l.principal,
        l.penalty,
        l.isPaid,
      ]),
    ).toEqual([
      ['s1', '3.33', '333.33', '0.10', true],
      ['s2', '3.33', '59.94', '0.00', false],
    ]);
    expect(a.applied.toFixed(2)).toBe('400.03');
    expect(a.interest.plus(a.principal).plus(a.penalty).toFixed(2)).toBe(
      '400.03',
    );
  });

  it('a hundred one-cent payments add up exactly (no floating drift)', () => {
    const rows = [inst(1)];
    let paid = dec(0);
    for (let i = 0; i < 100; i++) {
      const a = allocateRepayment(rows, dec('0.01'));
      paid = paid.plus(a.applied);
      const l = a.lines[0];
      rows[0].paidInterest = dec(rows[0].paidInterest)
        .plus(dec(l.interest))
        .toFixed(2);
      rows[0].paidPrincipal = dec(rows[0].paidPrincipal)
        .plus(dec(l.principal))
        .toFixed(2);
    }
    expect(paid.toFixed(2)).toBe('1.00');
    expect(rows[0].paidInterest).toBe('1.00');
    expect(totalDue(rows).toFixed(2)).toBe('335.66');
  });

  it('skips paid instalments', () => {
    const a = allocateRepayment([inst(1, { isPaid: true }), inst(2)], dec('5'));
    expect(a.lines.map((l) => l.scheduleId)).toEqual(['s2']);
  });

  it('a repayment without a stored allocation is taken back from the latest instalments', () => {
    const rows = [
      inst(1, { paidInterest: '3.33', paidPrincipal: '333.33', isPaid: true }),
      inst(2, { paidInterest: '3.33', paidPrincipal: '59.94' }),
    ];
    const lines = unallocateByComponent(rows, {
      principal: dec('100'),
      interest: dec('3.33'),
      penalty: dec(0),
    });
    expect(lines).toEqual([
      {
        scheduleId: 's2',
        principal: '59.94',
        interest: '3.33',
        penalty: '0.00',
        waivedInterest: '0.00',
      },
      {
        scheduleId: 's1',
        principal: '40.06',
        interest: '0.00',
        penalty: '0.00',
        waivedInterest: '0.00',
      },
    ]);
    expect(() =>
      unallocateByComponent(rows, {
        principal: dec('1000'),
        interest: dec(0),
        penalty: dec(0),
      }),
    ).toThrow(/cannot be reversed/);
  });
});

/** D-102: legacy jobs count calendar days in the tenant's zone. */
describe('legacy calendar in Asia/Phnom_Penh', () => {
  it('the local date turns at 17:00 UTC', () => {
    expect(localDate(new Date('2026-03-10T16:59:00Z'), 'Asia/Phnom_Penh')).toBe(
      '2026-03-10',
    );
    expect(localDate(new Date('2026-03-10T17:00:00Z'), 'Asia/Phnom_Penh')).toBe(
      '2026-03-11',
    );
  });
  it('local midnight is 17:00 UTC the day before', () => {
    expect(localMidnight('2026-03-11', 'Asia/Phnom_Penh').toISOString()).toBe(
      '2026-03-10T17:00:00.000Z',
    );
    expect(localMidnight('2026-03-11', 'UTC').toISOString()).toBe(
      '2026-03-11T00:00:00.000Z',
    );
  });
});
