import { computePayoff } from './payoff';

const line = (n: number, due: string, over: Record<string, number | boolean> = {}) => ({
  id: `s${n}`,
  dueDate: new Date(due),
  isPaid: false,
  principalAmount: 800,
  interestAmount: 100.1,
  penaltyAmount: 0,
  paidPrincipal: 0,
  paidInterest: 0,
  paidPenalty: 0,
  ...over,
});

describe('legacy payoff quote (UC-31)', () => {
  it('charges interest only on instalments already due, and every penalty', () => {
    const q = computePayoff(
      [
        line(1, '2026-01-05', { isPaid: true }),
        line(2, '2026-02-05', { paidInterest: 50.05, penaltyAmount: 10 }),
        line(3, '2026-03-05'),
        line(4, '2026-04-05'),
      ],
      new Date('2026-03-10'),
    );
    expect(q.outstandingPrincipal).toBe(2400);
    expect(q.accruedInterestDue).toBe(150.15);
    expect(q.futureInterestWaived).toBe(100.1);
    expect(q.outstandingPenalty).toBe(10);
    expect(q.payoffAmount).toBe(2560.15);
  });

  it('adds up in cents, never drifting in binary floating point', () => {
    const many = Array.from({ length: 30 }, (_, i) => line(i, '2026-01-01', { principalAmount: 0.1, interestAmount: 0.2 }));
    expect(computePayoff(many, new Date('2026-02-01')).payoffAmount).toBe(9);
  });
});
