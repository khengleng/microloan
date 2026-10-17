/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * Murabaha end to end (D-067): the financier registers and buys the asset
 * (paid to its supplier, never the customer), sells it at cost plus a
 * disclosed profit, recognises the deferred profit over the term on its own
 * accounts, sends late charges to charity, and on early settlement waives
 * the unearned profit (ibra') — or, on a product without ibra', collects it.
 */
import { lending } from '@microloan/shared';
import { Fixture, TEST_DB, bootstrap, expectOk, key } from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Murabaha (integration)', () => {
  let f: Fixture;
  let productId: string;
  let noIbraProductId: string;
  let loanId: string;

  const terms = {
    principal: '12000',
    numberOfInstalments: 12,
    disbursementDate: '2026-01-05',
    annualRate: '0.08',
  };
  const supplier = [
    { type: 'SUPPLIER', name: 'Phnom Penh Motors', amount: '12000' },
  ];
  const asset = (id: string, cost = '12000') =>
    f.as('opsMaker').post(`/lending/loans/${id}/murabaha`, {
      assetType: 'VEHICLE',
      description: 'Toyota Vios 2026',
      serialNumber: 'VIN-MRB-1',
      supplierName: 'Phnom Penh Motors',
      cost,
    });

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    await enableFlag('lending.islamic.murabaha');
    ({ productId } = await activeProduct(f, 'MURABAHA', 'MRB-AUTO'));
    ({ productId: noIbraProductId } = await activeProduct(
      f,
      'MURABAHA',
      'MRB-NOIBRA',
      (c: any) => {
        c.murabaha.ibraShare = null;
      },
    ));
  }, 90_000);
  afterAll(async () => f?.app.close());

  async function enableFlag(flagKey: string) {
    const r = expectOk(
      await f.as('admin1').post('/lending/access/flags/rules', {
        flagKey,
        scopeType: 'TENANT',
        enabled: true,
        reason: 'Murabaha integration tests',
      }),
    );
    expectOk(
      await f
        .as('admin2')
        .post(`/lending/access/flags/changes/${r.approval.id}/decision`, {
          approve: true,
        }),
    );
  }

  async function setBusinessDate(target: string) {
    let current = expectOk(
      await f.as('finance').get('/lending/ops/business-date'),
    ).businessDate as string;
    while (lending.compareDates(current, target) < 0) {
      const step = lending.addDays(current, 7);
      const next = lending.compareDates(step, target) > 0 ? target : step;
      expectOk(
        await f
          .as('finance')
          .post('/lending/ops/business-date', { businessDate: next }),
      );
      expectOk(await f.as('finance').post('/lending/loans/batch/run'));
      current = next;
    }
  }

  const loan = async (id: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${id}`));
  const contract = async (id: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${id}/murabaha`));
  const reconcile = async () => {
    const rec = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(rec.breaks).toEqual([]);
    expect(rec.trialBalanceBalanced).toBe(true);
  };
  const journal = (event: any) =>
    event.journal.lines
      .map(
        (l: any) => `${l.accountCode}:${Number(l.debit)}:${Number(l.credit)}`,
      )
      .sort();
  /** A loan's net (debit − credit) balance on one ledger account. */
  const ledger = (l: any, code: string) =>
    l.events
      .flatMap((e: any) => e.journal?.lines ?? [])
      .filter((x: any) => x.accountCode === code)
      .reduce(
        (s: any, x: any) => s.plus(x.debit).minus(x.credit),
        new lending.D(0),
      )
      .toString();
  const open = (l: any) =>
    ['principal', 'interest', 'fee', 'penalty', 'tax'].reduce(
      (t, c) => t.plus(l[`${c}Due`] ?? '0').minus(l[`${c}Paid`] ?? '0'),
      new lending.D(0),
    );
  const repay = async (id: string, amount: string) =>
    expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/loans/${id}/repayments`, { amount }, key('repay')),
    );

  it('the financier must own the asset before paying for it', async () => {
    await expect(
      originateAndDisburse(f, productId, terms, { payees: supplier }),
    ).rejects.toThrow(/MURABAHA_ASSET_MISSING/);
  });

  it('the asset is registered at its cost and paid to its supplier, never the customer', async () => {
    await expect(
      originateAndDisburse(f, productId, terms, {
        payees: [{ type: 'BORROWER', name: 'Borrower', amount: '12000' }],
        beforeDisbursement: async (id) => {
          const wrong = await asset(id, '12500');
          expect(wrong.status).toBe(400);
          expect(wrong.body.code).toBe('MURABAHA_COST');
          expectOk(await asset(id));
        },
      }),
    ).rejects.toThrow(/MURABAHA_PAYEE/);
  });

  it('the sale: cost, a disclosed profit and the sale price; the profit is deferred', async () => {
    ({ loanId } = await originateAndDisburse(f, productId, terms, {
      payees: supplier,
      beforeDisbursement: async (id) => {
        // Before the sale the contract already discloses the price.
        expectOk(await asset(id));
        const pre = await contract(id);
        expect(pre.terms).toMatchObject({
          cost: '12000',
          profit: '960',
          salePrice: '12960',
        });
        // Maker-checker: the person who prepares a payout cannot approve it.
        const task = expectOk(
          await f.as('opsMaker').post(`/lending/loans/${id}/disbursements`, {}),
        );
        const self = await f
          .as('opsMaker')
          .post(`/lending/loans/${id}/disbursements/${task.id}/decision`, {
            approve: true,
          });
        expect(self.status).toBe(403);
        expectOk(
          await f
            .as('opsChecker')
            .post(`/lending/loans/${id}/disbursements/${task.id}/decision`, {
              approve: false,
              comment: 'Re-prepare',
            }),
        );
      },
    }));
    const l = await loan(loanId);
    expect(l.specialised).toEqual({ kind: 'MURABAHA' });
    const disb = l.events.find((e: any) => e.type === 'DISBURSEMENT');
    expect(journal(disb)).toEqual([
      '1000:0:12000',
      '1350:12000:0',
      '1360:960:0',
      '2510:0:960',
    ]);
    const c = await contract(loanId);
    expect(c.asset).toMatchObject({
      status: 'SOLD',
      cost: '12000',
      profit: '960',
      salePrice: '12960',
      supplierName: 'Phnom Penh Motors',
      deferredProfitBalance: '960',
    });
    expect(c.terms.instalments).toBe(12);
    expect(c.recognition.at(-1).deferredRemaining).toBe('0');
    expect(c.accounts).toMatchObject({
      profitIncome: '4700',
      lateChargesTo: '2800',
      deferredProfit: '2510',
    });
    await reconcile();
  });

  it('profit is recognised as earned on its own income account, never as interest', async () => {
    await setBusinessDate('2026-02-05');
    const first = (await loan(loanId)).schedule.find(
      (x: any) => x.number === 1,
    );
    expect(first.interestDue).toBe('80');
    await repay(loanId, open(first).toString());
    const l = await loan(loanId);
    const accrual = l.events.find((e: any) => e.type === 'ACCRUAL');
    const codes = accrual.journal.lines.map((x: any) => x.accountCode);
    expect(codes).toEqual(expect.arrayContaining(['1355', '4700']));
    expect(codes).not.toContain('4000');
    const release = l.events.find(
      (e: any) => e.type === 'MURABAHA_DEFERRED_PROFIT',
    );
    expect(release.journal.lines.map((x: any) => x.accountCode).sort()).toEqual(
      ['1360', '2510'],
    );
    // The memo carries exactly the profit not yet recognised.
    const c = await contract(loanId);
    expect(
      new lending.D(c.deferredProfit).plus(c.profitRecognised).toString(),
    ).toBe('960');
    expect(ledger(l, '1360')).toBe(c.deferredProfit);
    await reconcile();
  });

  it('a late charge goes to charity, not income', async () => {
    await setBusinessDate('2026-03-10');
    const l = await loan(loanId);
    const penalty = l.events.find((e: any) => e.type === 'PENALTY');
    expect(penalty).toBeDefined();
    expect(journal(penalty)).toEqual(['1230:5:0', '2800:0:5']);
    const second = l.schedule.find((x: any) => x.number === 2);
    await repay(loanId, open(second).toString());
    await reconcile();
  });

  it('early settlement waives the unearned profit (ibra’) and clears the deferred profit', async () => {
    await setBusinessDate('2026-03-20');
    const q = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loanId}/settlement-quote`),
    );
    // Earned on instalment 3 to date: 80 × 15/31; the other 761.29 is waived.
    expect(q.interest).toBe('38.71');
    expect(q.murabaha).toMatchObject({
      unearnedProfit: '761.29',
      ibra: '761.29',
      profitOwed: '38.71',
    });
    expect(q.payable).toBe('10038.71');
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${loanId}/settlement`,
          { amount: q.payable, externalReference: 'SETTLE-MRB-1' },
          key('settle'),
        ),
    );
    const l = await loan(loanId);
    expect(l.account.status).toBe('CLOSED');
    expect(ledger(l, '1360')).toBe('0');
    expect(ledger(l, '2510')).toBe('0');
    expect(ledger(l, '1350')).toBe('0');
    expect(ledger(l, '1355')).toBe('0');
    const c = await contract(loanId);
    expect(c.asset).toMatchObject({
      status: 'ENDED',
      deferredProfitBalance: '0',
      ibraGranted: '761.29',
    });
    await reconcile();
  });

  it('without ibra’ the remaining profit is payable in full and recognised on settlement', async () => {
    const { loanId: id } = await originateAndDisburse(
      f,
      noIbraProductId,
      {
        principal: '6000',
        numberOfInstalments: 12,
        disbursementDate: '2026-03-20',
        annualRate: '0.08',
      },
      {
        payees: [{ type: 'DEALER', name: 'Lucky Motors', amount: '6000' }],
        beforeDisbursement: async (lid) => {
          expectOk(
            await f.as('opsMaker').post(`/lending/loans/${lid}/murabaha`, {
              assetType: 'EQUIPMENT',
              description: 'Generator 20 kVA',
              supplierName: 'Lucky Motors',
              cost: '6000',
            }),
          );
        },
      },
    );
    const q = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${id}/settlement-quote`),
    );
    expect(q.murabaha).toMatchObject({ ibra: '0', profitOwed: '480' });
    expect(q.payable).toBe('6480');
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${id}/settlement`,
          { amount: q.payable, externalReference: 'SETTLE-MRB-2' },
          key('settle'),
        ),
    );
    const l = await loan(id);
    expect(l.account.status).toBe('CLOSED');
    const settle = l.events.find((e: any) => e.type === 'SETTLEMENT');
    expect(journal(settle)).toEqual(
      expect.arrayContaining(['1000:6480:0', '1350:0:6000', '4700:0:480']),
    );
    expect(ledger(l, '1360')).toBe('0');
    expect(ledger(l, '2510')).toBe('0');
    await reconcile();
  });

  it('paid instalment by instalment to the end, the contract closes with all its profit recognised', async () => {
    const { loanId: id } = await originateAndDisburse(
      f,
      productId,
      {
        principal: '3000',
        numberOfInstalments: 3,
        disbursementDate: '2026-03-20',
        annualRate: '0.12',
      },
      {
        payees: [{ type: 'SELLER', name: 'Home Store', amount: '3000' }],
        beforeDisbursement: async (lid) => {
          expectOk(
            await f.as('opsMaker').post(`/lending/loans/${lid}/murabaha`, {
              assetType: 'HOUSEHOLD_GOODS',
              description: 'Refrigerator and washing machine',
              supplierName: 'Home Store',
              cost: '3000',
            }),
          );
        },
      },
    );
    // Flat 12% for a quarter: a fixed profit of 90 on a sale price of 3090.
    expect((await contract(id)).terms).toMatchObject({
      profit: '90',
      salePrice: '3090',
    });
    for (const n of [1, 2, 3]) {
      const line = (await loan(id)).schedule.find((x: any) => x.number === n);
      await setBusinessDate(line.dueDate);
      await repay(id, open(line).toString());
    }
    const l = await loan(id);
    expect(l.account.status).toBe('CLOSED');
    expect(ledger(l, '1360')).toBe('0');
    expect(ledger(l, '2510')).toBe('0');
    expect(
      l.events
        .filter((e: any) => e.type === 'ACCRUAL')
        .reduce((s: any, e: any) => s.plus(e.amount), new lending.D(0))
        .toString(),
    ).toBe('90');
    expect((await contract(id)).asset).toMatchObject({
      status: 'ENDED',
      deferredProfitBalance: '0',
      ibraGranted: '0',
    });
    await reconcile();
  });

  it('the trial balance carries the new accounts', async () => {
    const tb = expectOk(
      await f.as('finance').get('/lending/ops/trial-balance'),
    );
    const codes = JSON.stringify(tb);
    for (const c of ['1350', '4700', '2800']) expect(codes).toContain(c);
  });
});
