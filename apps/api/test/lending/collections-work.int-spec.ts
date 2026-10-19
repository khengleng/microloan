/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * Working arrears: the escalation ladder and collector queues (UC-58), a
 * demand on the guarantor and its payments (UC-60), and set-off of the
 * borrower's deposit under maker-checker (UC-61).
 */
import { Fixture, TEST_DB, bootstrap, expectOk, key } from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Collections work, guarantor demands and set-off (integration)', () => {
  let f: Fixture;
  let guaranteed: string;
  let depositor: string;
  let current: string;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    const { productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-COLLECT',
      (c) => {
        c.pricing.fees = [];
        c.pricing.penalty = {
          type: 'NONE',
          flatAmount: null,
          percentOfOverdue: null,
          annualRate: null,
          graceDays: 0,
          capPerInstalment: null,
          capPerLoan: null,
        };
        c.operations.collectionStages = [
          {
            code: 'REMIND',
            label: 'Reminder',
            fromDpd: 1,
            action: 'SMS',
            queue: '',
          },
          {
            code: 'PHONE',
            label: 'Phone follow-up',
            fromDpd: 5,
            action: 'CALL',
            queue: 'PHONE',
          },
          {
            code: 'FIELD',
            label: 'Field visit',
            fromDpd: 30,
            action: 'VISIT',
            queue: 'FIELD',
          },
        ];
      },
    );
    const terms = {
      principal: '3000',
      numberOfInstalments: 6,
      disbursementDate: '2026-01-05',
    };
    guaranteed = (
      await originateAndDisburse(f, productId, terms, { guarantee: true })
    ).loanId;
    depositor = (await originateAndDisburse(f, productId, terms)).loanId;
    current = (await originateAndDisburse(f, productId, terms)).loanId;
  }, 90_000);
  afterAll(async () => f?.app.close());

  const loan = async (id: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${id}`));
  const moveTo = async (businessDate: string) => {
    expectOk(
      await f
        .as('finance')
        .post('/lending/ops/business-date', { businessDate }),
    );
    expect(
      expectOk(await f.as('finance').post('/lending/loans/batch/run')).failed,
    ).toEqual([]);
  };
  const tasks = async (q: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/collections/tasks${q}`));
  const reconcile = async () => {
    const rec = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(rec.breaks).toEqual([]);
    expect(rec.trialBalanceBalanced).toBe(true);
  };

  it('UC-58: a day late sends the reminder; five days late puts a call in the phone queue', async () => {
    await moveTo('2026-02-05');
    const first = (await loan(current)).schedule.find(
      (x: any) => x.number === 1 && x.status !== 'SUPERSEDED',
    );
    expectOk(
      await f.as('opsMaker').post(
        `/lending/loans/${current}/repayments`,
        {
          amount: (
            Number(first.principalDue) + Number(first.interestDue)
          ).toFixed(2),
        },
        key('c1'),
      ),
    );
    await moveTo('2026-02-06');
    const sms = await tasks(`?loanAccountId=${guaranteed}`);
    expect(sms).toHaveLength(1);
    expect(sms[0]).toMatchObject({
      stage: 'REMIND',
      action: 'SMS',
      status: 'DONE',
      outcome: 'NOTICE_SENT',
      daysPastDue: 1,
    });
    expect(await tasks(`?loanAccountId=${current}`)).toEqual([]);

    await moveTo('2026-02-10');
    // A rerun of the same day raises nothing twice.
    expect(
      expectOk(await f.as('finance').post('/lending/loans/batch/run')).failed,
    ).toEqual([]);
    const all = await tasks(`?loanAccountId=${guaranteed}`);
    expect(all).toHaveLength(2);
    const queue = await tasks('?queue=PHONE&status=OPEN');
    const call = queue.find((t: any) => t.loanAccountId === guaranteed);
    expect(call).toMatchObject({ action: 'CALL', daysPastDue: 5 });
    expect(Number(call.amountOverdue)).toBeGreaterThan(0);

    expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/collections/tasks/${call.id}/claim`),
    );
    expect(
      (
        await f
          .as('opsMaker')
          .post(`/lending/collections/tasks/${call.id}/claim`)
      ).status,
    ).toBe(409);
    const done = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/collections/tasks/${call.id}/complete`, {
          outcome: 'PROMISE_TO_PAY',
          note: 'Will pay Friday',
        }),
    );
    expect(done.status).toBe('DONE');
  });

  it('UC-60: the guarantor is called up to the guarantee and pays under the demand', async () => {
    expect(
      (
        await f
          .as('opsMaker')
          .post(`/lending/loans/${current}/guarantor-demands`, {
            guaranteeId: '00000000-0000-4000-8000-000000000000',
          })
      ).status,
    ).toBe(400);
    const { guarantees } = expectOk(
      await f
        .as('opsMaker')
        .get(`/lending/loans/${guaranteed}/guarantor-demands`),
    );
    expect(guarantees).toHaveLength(1);
    const g = guarantees[0];
    expect(
      (
        await f
          .as('opsMaker')
          .post(`/lending/loans/${guaranteed}/guarantor-demands`, {
            guaranteeId: g.id,
            amount: '1500.00',
          })
      ).status,
    ).toBe(400);
    const demand = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/loans/${guaranteed}/guarantor-demands`, {
          guaranteeId: g.id,
        }),
    );
    expect(demand.amount).toBe('1000');
    expect(demand.letter).toContain(g.guarantorName);

    const pay = (amount: string, k: string) =>
      f
        .as('opsMaker')
        .post(
          `/lending/loans/${guaranteed}/guarantor-demands/${demand.id}/payments`,
          { amount },
          key(k),
        );
    const ev = expectOk(await pay('400.00', 'g1'));
    expect(ev.components.payer.relationship).toBe('GUARANTOR');
    expectOk(await pay('600.00', 'g2'));
    const after = expectOk(
      await f
        .as('opsMaker')
        .get(`/lending/loans/${guaranteed}/guarantor-demands`),
    );
    expect(after.demands[0]).toMatchObject({ status: 'PAID', paid: '1000' });
    expect((await pay('1.00', 'g3')).status).toBe(409);
    // The guarantee is used up.
    expect(
      (
        await f
          .as('opsMaker')
          .post(`/lending/loans/${guaranteed}/guarantor-demands`, {
            guaranteeId: g.id,
          })
      ).status,
    ).toBe(400);
    await reconcile();
  });

  it('UC-61: set-off of a deposit needs a second person and clears the arrears', async () => {
    const before = await loan(depositor);
    expect(before.account.daysPastDue).toBe(5);
    const line = before.schedule.find(
      (x: any) => x.number === 1 && x.status !== 'SUPERSEDED',
    );
    const overdue = (
      Number(line.principalDue) + Number(line.interestDue)
    ).toFixed(2);
    expect(
      (
        await f.as('opsMaker').post(`/lending/loans/${depositor}/set-offs`, {
          amount: '9999.00',
          sourceAccount: 'SAV-001',
          reason: 'Arrears',
        })
      ).status,
    ).toBe(400);
    const task = expectOk(
      await f.as('opsMaker').post(`/lending/loans/${depositor}/set-offs`, {
        amount: overdue,
        sourceAccount: 'SAV-001',
        reason: 'Arrears 5 days; notice given',
      }),
    );
    expect(
      (
        await f
          .as('opsMaker')
          .post(
            `/lending/loans/${depositor}/set-offs/${task.id}/decision`,
            { approve: true },
            key('so0'),
          )
      ).status,
    ).toBe(403);
    const ev = expectOk(
      await f
        .as('opsChecker')
        .post(
          `/lending/loans/${depositor}/set-offs/${task.id}/decision`,
          { approve: true },
          key('so1'),
        ),
    );
    expect(ev.externalReference).toContain('SAV-001');
    const lines = (await loan(depositor)).events.find(
      (e: any) => e.id === ev.id,
    ).journal.lines;
    expect(
      lines.find((x: any) => x.accountCode === '2700' && Number(x.debit) > 0),
    ).toBeTruthy();

    await moveTo('2026-02-11');
    expect((await loan(depositor)).account.daysPastDue).toBe(0);
    const open = (await tasks(`?loanAccountId=${depositor}`)).filter(
      (t: any) => t.status === 'OPEN',
    );
    expect(open).toEqual([]);
    await reconcile();
  });
});
