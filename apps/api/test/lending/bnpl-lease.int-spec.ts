/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * Purchase-linked lending end to end: buy now, pay later with merchant
 * settlement and a merchant refund (LT-11, UC-52), and a true lease / Ijarah
 * with the lender owning the asset, rentals as rental income, and both lease
 * ends — return of the asset and the purchase option (LT-15).
 */
import { Fixture, TEST_DB, bootstrap, expectOk, key } from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';
import { lending } from '@microloan/shared';

const d = TEST_DB ? describe : describe.skip;

d('BNPL and leases (integration)', () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
  }, 90_000);
  afterAll(async () => f?.app.close());

  async function setBusinessDate(target: string) {
    let current = expectOk(
      await f.as('finance').get('/lending/ops/business-date'),
    ).businessDate as string;
    while (lending.compareDates(current, target) < 0) {
      const step = lending.addDays(current, 31);
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
  const repay = async (id: string, amount: string) =>
    expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/loans/${id}/repayments`, { amount }, key('repay')),
    );
  /** What is still owed on a schedule line. */
  const open = (l: any) =>
    ['principal', 'interest', 'fee', 'penalty', 'tax'].reduce(
      (t, c) =>
        t
          .plus(l[`${c}Due`] ?? '0')
          .minus(l[`${c}Paid`] ?? '0')
          .plus(c === 'interest' ? (l.deferredInterestDue ?? '0') : '0'),
      new lending.D(0),
    );

  // ── Buy now, pay later ────────────────────────────────────────────────────

  describe('BNPL (LT-11, UC-52)', () => {
    let productId: string;
    let loanId: string;
    const terms = {
      principal: '400',
      numberOfInstalments: 4,
      disbursementDate: '2026-01-05',
    };

    beforeAll(async () => {
      ({ productId } = await activeProduct(f, 'BNPL', 'BNPL-MALL'));
    }, 60_000);

    it('pays only a single MERCHANT payee', async () => {
      await expect(
        originateAndDisburse(f, productId, terms, {
          payees: [{ type: 'SELLER', name: 'Lucky Mall', amount: '400' }],
        }),
      ).rejects.toThrow(/BNPL_MERCHANT_PAYEE/);
    });

    it('LT-11: settles the merchant net of the merchant discount', async () => {
      ({ loanId } = await originateAndDisburse(f, productId, terms, {
        payees: [
          {
            type: 'MERCHANT',
            name: 'Lucky Mall',
            reference: 'ORDER-881',
            amount: '400',
          },
        ],
      }));
      const l = await loan(loanId);
      const due = l.schedule.filter((x: any) => x.number > 0);
      expect(due.map((x: any) => x.principalDue)).toEqual([
        '100',
        '100',
        '100',
        '100',
      ]);
      expect(due[0].dueDate).toBe('2026-01-19');
      const disb = l.events.find((e: any) => e.type === 'DISBURSEMENT');
      // 4% merchant discount: the merchant gets 384, the lender earns 16.
      expect(journal(disb)).toEqual(['1000:0:384', '1200:400:0', '4500:0:16']);
      const plan = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}/bnpl`),
      );
      expect(plan).toMatchObject({
        merchantName: 'Lucky Mall',
        purchaseAmount: '400',
        merchantDiscount: '16',
        merchantNet: '384',
        refundable: '400',
      });
      await reconcile();
    });

    it('UC-52: a partial return reduces the remaining instalments latest first', async () => {
      await setBusinessDate('2026-01-19');
      await repay(loanId, '100');
      await setBusinessDate('2026-01-25');
      const r = expectOk(
        await f.as('opsMaker').post(
          `/lending/loans/${loanId}/bnpl/refunds`,
          {
            amount: '150',
            merchantReference: 'RMA-17',
            reason: 'Shoes returned',
          },
          key('refund'),
        ),
      );
      expect(r.refund).toMatchObject({
        appliedToPrincipal: '150',
        customerRefund: '0',
        discountReversed: '6',
        merchantClawback: '144',
        status: 'CLAWBACK_DUE',
      });
      const l = await loan(loanId);
      const due = l.schedule.filter((x: any) => x.number > 0);
      // The next payment is unchanged; the plan ends sooner.
      expect(due.map((x: any) => x.principalDue)).toEqual([
        '100',
        '100',
        '50',
        '0',
      ]);
      expect(due[3].status).toBe('PAID');
      expect(l.account.principalOutstanding).toBe('150');
      const ev = l.events.find((e: any) => e.type === 'BNPL_REFUND');
      expect(journal(ev)).toEqual(['1200:0:150', '1240:144:0', '4500:6:0']);
      await reconcile();
    });

    it('UC-52: the merchant clawback is collected once', async () => {
      const plan = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}/bnpl`),
      );
      const refundId = plan.refunds[0].id;
      const r = expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/loans/${loanId}/bnpl/refunds/${refundId}/collect`,
            { externalReference: 'MERCHANT-STL-2' },
            key('clawback'),
          ),
      );
      expect(r.status).toBe('COLLECTED');
      const again = await f
        .as('opsMaker')
        .post(
          `/lending/loans/${loanId}/bnpl/refunds/${refundId}/collect`,
          { externalReference: 'MERCHANT-STL-2' },
          key('clawback'),
        );
      expect(again.status).toBe(409);
      const ev = (await loan(loanId)).events.find(
        (e: any) => e.type === 'MERCHANT_CLAWBACK',
      );
      expect(journal(ev)).toEqual(['1000:144:0', '1240:0:144']);
      await reconcile();
    });

    it('the reduced plan is repaid and closes; a later refund goes back to the customer in cash', async () => {
      await setBusinessDate('2026-02-02');
      await repay(loanId, '100');
      await setBusinessDate('2026-02-16');
      await repay(loanId, '50');
      expect((await loan(loanId)).account.status).toBe('CLOSED');

      const noRef = await f.as('opsMaker').post(
        `/lending/loans/${loanId}/bnpl/refunds`,
        {
          amount: '100',
          merchantReference: 'RMA-18',
          reason: 'Bag returned',
        },
        key('refund'),
      );
      expect(noRef.status).toBe(400);
      const r = expectOk(
        await f.as('opsMaker').post(
          `/lending/loans/${loanId}/bnpl/refunds`,
          {
            amount: '100',
            merchantReference: 'RMA-18',
            reason: 'Bag returned',
            externalReference: 'PAYOUT-0091',
          },
          key('refund'),
        ),
      );
      expect(r.refund).toMatchObject({
        appliedToPrincipal: '0',
        customerRefund: '100',
        discountReversed: '4',
        merchantClawback: '96',
      });
      const too = await f.as('opsMaker').post(
        `/lending/loans/${loanId}/bnpl/refunds`,
        {
          amount: '200',
          merchantReference: 'RMA-19',
          reason: 'Everything else',
          externalReference: 'PAYOUT-0092',
        },
        key('refund'),
      );
      expect(too.status).toBe(400);
      expect((await loan(loanId)).account.status).toBe('CLOSED');
      await reconcile();
    });
  });

  // ── Leases / Ijarah ───────────────────────────────────────────────────────

  describe('Ijarah lease (LT-15)', () => {
    let productId: string;
    let returned: string;
    let bought: string;
    const terms = {
      principal: '10000',
      numberOfInstalments: 12,
      disbursementDate: '2026-03-05',
      balloonAmount: '2000',
    };
    const collateral = {
      type: 'VEHICLE',
      description: 'Toyota Hilux 2026',
      marketValue: '12000',
      valuationDate: '2026-03-01',
      valuer: 'Valuer Co',
      method: 'MARKET',
    };
    const asset = (id: string) =>
      f.as('opsMaker').post(`/lending/loans/${id}/lease`, {
        assetType: 'VEHICLE',
        description: 'Toyota Hilux 2026',
        serialNumber: 'VIN-0001',
        supplierName: 'Phnom Penh Motors',
        cost: '10000',
      });
    const lease = async (registerAsset: boolean) =>
      originateAndDisburse(f, productId, terms, {
        collateral,
        borrowerOver: { monthlyIncome: '6000' },
        payees: [
          { type: 'SUPPLIER', name: 'Phnom Penh Motors', amount: '10000' },
        ],
        beforeDisbursement: async (id) => {
          if (registerAsset) expectOk(await asset(id));
        },
      });

    beforeAll(async () => {
      await setBusinessDate('2026-03-05');
      ({ productId } = await activeProduct(f, 'IJARAH', 'IJARAH-AUTO'));
    }, 60_000);

    it('the lender buys the asset: no payout before it is registered', async () => {
      await expect(lease(false)).rejects.toThrow(/LEASE_ASSET_MISSING/);
    });

    it('LT-15: the asset is paid to its supplier and carried as the lessor’s asset', async () => {
      ({ loanId: returned } = await lease(true));
      ({ loanId: bought } = await lease(true));
      const l = await loan(returned);
      const disb = l.events.find((e: any) => e.type === 'DISBURSEMENT');
      // The leased asset, not a loan receivable.
      expect(journal(disb)).toEqual(['1000:0:10000', '1250:10000:0']);
      const v = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${returned}/lease`),
      );
      expect(v.structure).toBe('IJARAH');
      expect(v.residualValue).toBe('2000');
      expect(v.asset).toMatchObject({
        ownership: 'LESSOR',
        supplierName: 'Phnom Penh Motors',
        residualValue: '2000',
      });
      const last = l.schedule.at(-1);
      expect(Number(last.principalDue)).toBeGreaterThanOrEqual(2000);
      // Registering twice is refused; registering after payout is too.
      expect((await asset(returned)).status).toBe(403);
      await reconcile();
    });

    it('rentals are rental income, and a return before the end is refused', async () => {
      const first = (await loan(returned)).schedule.find(
        (x: any) => x.number === 1,
      );
      await setBusinessDate(first.dueDate);
      for (const id of [returned, bought])
        await repay(id, open(first).toString());
      const early = await f
        .as('opsMaker')
        .post(
          `/lending/loans/${returned}/lease/return`,
          { condition: 'Good', externalReference: 'YARD-1' },
          key('return'),
        );
      expect(early.status).toBe(409);
      expect(early.body.code).toBe('LEASE_RETURN_REFUSED');
      const l = await loan(returned);
      const accrual = l.events.find((e: any) => e.type === 'ACCRUAL');
      const codes = accrual.journal.lines.map((x: any) => x.accountCode);
      expect(codes).toContain('4510');
      expect(codes).toContain('1255');
      expect(codes).not.toContain('4000');
      await reconcile();
    });

    it('every rental is paid to the end of the lease', async () => {
      const lines = (await loan(returned)).schedule.filter(
        (x: any) => x.number > 1,
      );
      for (const line of lines) {
        await setBusinessDate(line.dueDate);
        const last = line.number === lines.at(-1).number;
        for (const id of [returned, bought]) {
          const cur = (await loan(id)).schedule.find(
            (x: any) => x.number === line.number && x.status !== 'SUPERSEDED',
          );
          const owed = open(cur);
          // The lessee who returns the asset pays the final rental only.
          await repay(
            id,
            (last && id === returned ? owed.minus(2000) : owed).toString(),
          );
        }
      }
      expect((await loan(returned)).account.principalOutstanding).toBe('2000');
      expect((await loan(bought)).account.status).toBe('CLOSED');
    });

    it('LT-15: returning the asset settles the residual in kind and closes the lease', async () => {
      const r = expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/loans/${returned}/lease/return`,
            { condition: 'Good, 41,000 km', externalReference: 'YARD-7' },
            key('return'),
          ),
      );
      expect(r.status).toBe('CLOSED');
      const l = await loan(returned);
      expect(l.account.status).toBe('CLOSED');
      const ev = l.events.find((e: any) => e.type === 'LEASE_RETURN');
      expect(journal(ev)).toEqual(['1250:0:2000', '1260:2000:0']);
      const v = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${returned}/lease`),
      );
      expect(v.asset).toMatchObject({
        ownership: 'RETURNED',
        endOption: 'RETURN',
      });
      await reconcile();
    });

    it('LT-15: paying the residual exercises the purchase option and title transfers', async () => {
      const early = await f
        .as('opsMaker')
        .post(`/lending/loans/${returned}/lease/transfer-title`);
      expect(early.status).toBe(409);
      const r = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/loans/${bought}/lease/transfer-title`),
      );
      expect(r.ownership).toBe('TRANSFERRED');
      const v = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${bought}/lease`),
      );
      expect(v.asset).toMatchObject({
        ownership: 'TRANSFERRED',
        endOption: 'PURCHASE',
      });
      await reconcile();
    });
  });
});
