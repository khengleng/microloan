/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * Disbursement beyond a single payout: a down payment before disbursement
 * (UC-02), payment to third parties (UC-05) and a consolidation loan paying
 * off several internal and external debts (UC-35, LT-10).
 */
import {
  Fixture,
  TEST_DB,
  bootstrap,
  borrower,
  expectOk,
  key,
} from './harness';
import {
  activeProduct,
  docs,
  originateAndDisburse,
  standardRoles,
} from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Down payments, payees and consolidation (integration)', () => {
  let f: Fixture;
  let shopProduct: string;
  let plainProduct: string;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    ({ productId: shopProduct } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'MOTO-SHOP',
      (c) => {
        c.pricing.fees = [];
        c.operations.downPayment = { minFraction: '0.20' };
      },
    ));
    ({ productId: plainProduct } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-PAYEES',
      (c) => {
        c.pricing.fees = [];
      },
    ));
  }, 90_000);
  afterAll(async () => f?.app.close());

  const reconcile = async () => {
    const rec = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(rec.breaks).toEqual([]);
    expect(rec.trialBalanceBalanced).toBe(true);
  };
  const loan = async (id: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${id}`));

  it('UC-02: the terms must carry the minimum down payment', async () => {
    const b = await borrower(f, f.t1, f.b1);
    const res = await f.as('ro').post('/lending/applications', {
      borrowerId: b.id,
      productId: shopProduct,
      terms: {
        principal: '8000',
        numberOfInstalments: 12,
        disbursementDate: '2026-01-05',
        downPayment: '1000',
      },
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/downPayment/);
  });

  it('UC-02 + UC-05: no payout before the down payment; then proceeds and the held down payment go to the dealer', async () => {
    let blocked = false;
    const { loanId } = await originateAndDisburse(
      f,
      shopProduct,
      {
        principal: '8000',
        numberOfInstalments: 12,
        disbursementDate: '2026-01-05',
        downPayment: '2000',
      },
      {
        payees: [
          {
            type: 'DEALER',
            name: 'Phnom Penh Motors',
            account: 'ABA-0012',
            amount: '10000.00',
          },
        ],
        beforeDisbursement: async (id) => {
          // Prepare + approve, then try to execute before the down payment exists.
          const task = expectOk(
            await f
              .as('opsMaker')
              .post(`/lending/loans/${id}/disbursements`, {}),
          );
          expectOk(
            await f
              .as('opsChecker')
              .post(`/lending/loans/${id}/disbursements/${task.id}/decision`, {
                approve: true,
              }),
          );
          const early = await f
            .as('opsChecker')
            .post(
              `/lending/loans/${id}/disbursements/execute`,
              { externalReference: 'EARLY' },
              key('early'),
            );
          blocked =
            early.status === 400 &&
            early.body.code === 'DOWN_PAYMENT_OUTSTANDING';
          expectOk(
            await f.as('opsMaker').post(
              `/lending/loans/${id}/down-payments`,
              {
                amount: '2000.00',
                collectedBy: 'LENDER',
                externalReference: 'RCPT-77',
              },
              key('dp'),
            ),
          );
          // Reject the approved task so the helper can run its own prepare/approve/execute.
          const t = (await loan(id)).tasks.find(
            (x: any) => x.action === 'DISBURSEMENT' && x.status === 'APPROVED',
          );
          if (t)
            await f.system(() =>
              f.prisma.approvalTask.update({
                where: { id: t.id },
                data: { status: 'CANCELLED' },
              }),
            );
        },
      },
    );
    expect(blocked).toBe(true);
    const l = await loan(loanId);
    expect(l.account.status).toBe('ACTIVE');
    expect(l.account.downPaymentReceived).toBe('2000');
    expect(l.account.downPaymentHeld).toBe('0');
    const disb = l.events.find((e: any) => e.type === 'DISBURSEMENT');
    expect(disb.components.payees[0].type).toBe('DEALER');
    const lines = disb.journal.lines
      .map(
        (x: any) => `${x.accountCode}:${Number(x.debit)}:${Number(x.credit)}`,
      )
      .sort();
    expect(lines).toEqual(['1000:0:10000', '1200:8000:0', '2600:2000:0']);
    await reconcile();
  });

  it('UC-05: payees must add up to the payout', async () => {
    await expect(
      originateAndDisburse(
        f,
        plainProduct,
        {
          principal: '5000',
          numberOfInstalments: 12,
          disbursementDate: '2026-01-05',
        },
        { payees: [{ type: 'SCHOOL', name: 'RUPP', amount: '3000.00' }] },
      ),
    ).rejects.toThrow(/add up/);
    const { loanId } = await originateAndDisburse(
      f,
      plainProduct,
      {
        principal: '5000',
        numberOfInstalments: 12,
        disbursementDate: '2026-01-05',
      },
      {
        payees: [
          {
            type: 'SCHOOL',
            name: 'Royal University of Phnom Penh',
            reference: 'TUITION-2026',
            amount: '3000.00',
          },
          { type: 'BORROWER', name: 'Borrower', amount: '2000.00' },
        ],
      },
    );
    const disb = (await loan(loanId)).events.find(
      (e: any) => e.type === 'DISBURSEMENT',
    );
    expect(disb.components.payees.map((p: any) => p.type)).toEqual([
      'SCHOOL',
      'BORROWER',
    ]);
  });

  it('UC-35 / LT-10: a consolidation loan pays off two internal loans and an outside debt', async () => {
    const b = await borrower(f, f.t1, f.b1, { monthlyIncome: '9000' });
    const small = { numberOfInstalments: 12, disbursementDate: '2026-01-05' };
    const a = (
      await originateAndDisburse(
        f,
        plainProduct,
        { ...small, principal: '1500' },
        { borrowerId: b.id },
      )
    ).loanId;
    const c = (
      await originateAndDisburse(
        f,
        plainProduct,
        { ...small, principal: '2500' },
        { borrowerId: b.id },
      )
    ).loanId;
    const payoff = async (id: string) =>
      expectOk(
        await f.as('opsMaker').get(`/lending/loans/${id}/settlement-quote`),
      ).payable as string;
    const pa = await payoff(a);
    const pc = await payoff(c);
    const outside = '1000.00';
    const total = 8000;
    const toBorrower = (
      total -
      Number(pa) -
      Number(pc) -
      Number(outside)
    ).toFixed(2);
    const { loanId } = await originateAndDisburse(
      f,
      plainProduct,
      { ...small, principal: String(total) },
      {
        borrowerId: b.id,
        payees: [
          {
            type: 'INTERNAL_LOAN',
            name: 'Existing loan A',
            loanId: a,
            amount: pa,
          },
          {
            type: 'INTERNAL_LOAN',
            name: 'Existing loan B',
            loanId: c,
            amount: pc,
          },
          {
            type: 'PREVIOUS_LENDER',
            name: 'Other MFI',
            reference: 'ACC-55',
            amount: outside,
          },
          { type: 'BORROWER', name: 'Borrower', amount: toBorrower },
        ],
      },
    );
    expect((await loan(a)).account.status).toBe('CLOSED');
    expect((await loan(c)).account.status).toBe('CLOSED');
    expect((await loan(loanId)).account.status).toBe('ACTIVE');
    await reconcile();
  });

  it("UC-35: another borrower's loan cannot be named as a payee", async () => {
    const other = (
      await originateAndDisburse(f, plainProduct, {
        principal: '1000',
        numberOfInstalments: 6,
        disbursementDate: '2026-01-05',
      })
    ).loanId;
    const quote = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${other}/settlement-quote`),
    ).payable as string;
    await expect(
      originateAndDisburse(
        f,
        plainProduct,
        {
          principal: '3000',
          numberOfInstalments: 12,
          disbursementDate: '2026-01-05',
        },
        {
          payees: [
            {
              type: 'INTERNAL_LOAN',
              name: 'Not theirs',
              loanId: other,
              amount: quote,
            },
            {
              type: 'BORROWER',
              name: 'Borrower',
              amount: (3000 - Number(quote)).toFixed(2),
            },
          ],
        },
      ),
    ).rejects.toThrow(/same borrower/);
    expect((await loan(other)).account.status).toBe('ACTIVE');
    void docs;
  });
});
