/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped Prisma client and API responses. */
/**
 * Legacy early settlement (UC-31, traceability gap #6): paying the payoff
 * quote closes the loan. An ordinary repayment of the same amount does not,
 * because it pays future instalments' interest before principal.
 */
import { Fixture, TEST_DB, bootstrap, borrower, expectOk } from './harness';

const d = TEST_DB ? describe : describe.skip;

d('Legacy payoff and settlement (integration)', () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await bootstrap();
  }, 60_000);
  afterAll(async () => f?.app.close());

  /** A disbursed legacy loan: 3 monthly instalments, the first already due. */
  async function legacyLoan() {
    return f.system(async () => {
      const b = await borrower(f, f.t1, f.b1);
      const product = await f.prisma.loanProduct.create({
        data: { tenantId: f.t1, name: 'Payoff test', interestMethod: 'FLAT' },
      });
      const now = Date.now();
      const day = 86_400_000;
      const loan = await f.prisma.loan.create({
        data: {
          tenantId: f.t1,
          borrowerId: b.id,
          productId: product.id,
          branchId: f.b1,
          principal: '3000',
          annualInterestRate: '12',
          termMonths: 3,
          interestMethod: 'FLAT',
          startDate: new Date(now - 40 * day),
          status: 'DISBURSED',
        },
      });
      for (const [n, offset] of [
        [1, -10],
        [2, 20],
        [3, 50],
      ])
        await f.prisma.repaymentSchedule.create({
          data: {
            loanId: loan.id,
            installmentNumber: n,
            dueDate: new Date(now + offset * day),
            principalAmount: '1000',
            interestAmount: '30',
            totalAmount: '1030',
            outstandingPrincipal: String(3000 - n * 1000),
          },
        });
      return loan.id as string;
    });
  }

  it('the quote charges interest only on what is due', async () => {
    const id = await legacyLoan();
    const q = expectOk(await f.as('admin1').get(`/loans/${id}/payoff-quote`));
    expect(q.outstandingPrincipal).toBe(3000);
    expect(q.accruedInterestDue).toBe(30);
    expect(q.futureInterestWaived).toBe(60);
    expect(q.payoffAmount).toBe(3030);
  });

  it('settling at the quote pays everything, waives future interest and closes the loan', async () => {
    const id = await legacyLoan();
    const q = expectOk(await f.as('admin1').get(`/loans/${id}/payoff-quote`));
    const r = expectOk(
      await f.as('admin1').post('/repayments/settlements', {
        loanId: id,
        amount: q.payoffAmount,
        idempotencyKey: `settle-${id}`,
      }),
    );
    expect(r.status).toBe('CLOSED');
    const loan = await f.system(() =>
      f.prisma.loan.findUnique({ where: { id }, include: { schedules: true } }),
    );
    expect(loan.status).toBe('CLOSED');
    expect(loan.schedules.every((s: any) => s.isPaid)).toBe(true);
    // The journal balances and clears the principal.
    const entries = await f.system(() =>
      f.prisma.journalEntry.findMany({
        where: { loanId: id },
        include: { lines: true },
      }),
    );
    const lines = entries.flatMap((e: any) => e.lines);
    const debit = lines.reduce((s: number, l: any) => s + Number(l.debit), 0);
    const credit = lines.reduce((s: number, l: any) => s + Number(l.credit), 0);
    expect(debit).toBeCloseTo(credit, 2);
    // Retrying the same request does not settle twice.
    const again = expectOk(
      await f.as('admin1').post('/repayments/settlements', {
        loanId: id,
        amount: q.payoffAmount,
        idempotencyKey: `settle-${id}`,
      }),
    );
    expect(again.id).toBe(r.repayment.id);
  });

  it('refuses an amount other than the quote', async () => {
    const id = await legacyLoan();
    const res = await f
      .as('admin1')
      .post('/repayments/settlements', { loanId: id, amount: 3000 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/3030\.00/);
  });
});
