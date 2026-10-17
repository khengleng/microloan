/**
 * FACTORING over the real HTTP API, guards and database: invoices bought on
 * a revolving programme limit at the advance rate net of a service fee,
 * the debtor notified before the purchase, a debtor concentration limit,
 * debtor collections, and FULL, NO and LIMITED recourse when the debtor
 * defaults — the lender's share written off under maker-checker — to the
 * programme's closure with balanced books.
 *
 * Evidence for: trade.factoring
 */
import {
  Fixture,
  TEST_DB,
  authority,
  bootstrap,
  expectOk,
  key,
} from './harness';
import { activeProduct, standardRoles } from './setup';
import {
  bookProgramme,
  enableFlag,
  fund,
  glNet,
  journalsBalance,
  loanOf,
  reconciliationBreaks,
  runBatch,
  setBusinessDate,
} from './trade-helpers';

const d = TEST_DB ? describe : describe.skip;

d('FACTORING (integration)', () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    await authority(
      f,
      f.t1,
      'opsChecker',
      'facility.drawdown.approve',
      'USD',
      '1000000',
    );
    for (const flag of [
      'lending.revolving.drawdown',
      'lending.trade.receivables_purchase',
    ])
      await enableFlag(f, flag);
    await setBusinessDate(f, '2026-02-02');
  }, 90_000);
  afterAll(async () => f?.app.close());

  const invoiceOf = async (id: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/invoices/${id}`));

  describe('full recourse, disclosed to the debtor', () => {
    let facilityId: string;
    let loanId: string;
    let invoiceId: string;

    beforeAll(async () => {
      const { productId } = await activeProduct(f, 'FACTORING', 'FCT-FULL');
      ({ facilityId, loanId } = await bookProgramme(
        f,
        productId,
        '100000',
        '2026-02-02',
      ));
    }, 60_000);

    it('the debtor must be notified before the invoice is bought; the seller gets the advance less the service fee', async () => {
      const inv = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/facilities/${facilityId}/invoices`, {
            debtorName: 'Angkor Retail Co.',
            invoiceNumber: 'F-1',
            amount: '20000',
            issueDate: '2026-02-01',
            dueDate: '2026-04-02',
          }),
      );
      invoiceId = inv.id;
      expect(inv.kind).toBe('FACTORING');
      expect(inv.receivable.recourse).toBe('FULL');
      expectOk(
        await f.as('approver').post(`/lending/invoices/${invoiceId}/approve`),
      );
      const early = await f
        .as('opsMaker')
        .post(`/lending/invoices/${invoiceId}/advance`);
      expect(early.status).toBe(409);
      expect(early.body.code).toBe('ACKNOWLEDGEMENT_REQUIRED');
      expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/invoices/${invoiceId}/acknowledge`, {
            method: 'NOTICE_LETTER',
            reference: 'NOA-001',
          }),
      );
      const req = expectOk(
        await f.as('opsMaker').post(`/lending/invoices/${invoiceId}/advance`),
      );
      expect(req.advance).toBe('17000');
      expect(req.serviceFee).toBe('100');
      expect(req.paidOut).toBe('16900');
      // Maker-checker: the requester neither approves nor releases.
      expect(
        (
          await f
            .as('opsMaker')
            .post(`/lending/invoices/${invoiceId}/advance/approve`)
        ).status,
      ).toBe(403);
      expectOk(
        await f
          .as('opsChecker')
          .post(`/lending/invoices/${invoiceId}/advance/approve`),
      );
      expect(
        (
          await f
            .as('opsMaker')
            .post(
              `/lending/invoices/${invoiceId}/advance/release`,
              { externalReference: 'X' },
              key('self'),
            )
        ).status,
      ).toBe(403);
      const released = expectOk(
        await f
          .as('opsChecker')
          .post(
            `/lending/invoices/${invoiceId}/advance/release`,
            { externalReference: 'BANK-F1' },
            key('f1'),
          ),
      );
      expect(released.status).toBe('FUNDED');
      expect(released.paidOut).toBe('16900');
      expect(released.recourseDate).toBe('2026-06-01');
      expect(await glNet(f, '1200', loanId)).toBe('17000.00');
      expect(await glNet(f, '1000', loanId)).toBe('-16900.00');
      expect(await glNet(f, '4540', loanId)).toBe('-100.00');
      expect((await loanOf(f, loanId)).account.principalOutstanding).toBe(
        '17000',
      );
    });

    it('a debtor concentration above half the limit is refused', async () => {
      const big = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/facilities/${facilityId}/invoices`, {
            debtorName: 'ANGKOR  retail co.',
            invoiceNumber: 'F-2',
            amount: '40000',
            issueDate: '2026-02-01',
            dueDate: '2026-04-15',
          }),
      );
      expectOk(
        await f.as('opsMaker').post(`/lending/invoices/${big.id}/acknowledge`, {
          method: 'EMAIL',
          reference: 'NOA-002',
        }),
      );
      expectOk(
        await f.as('approver').post(`/lending/invoices/${big.id}/approve`),
      );
      const r = await f
        .as('opsMaker')
        .post(`/lending/invoices/${big.id}/advance`);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('DEBTOR_CONCENTRATION');
      expectOk(
        await f.as('approver').post(`/lending/invoices/${big.id}/reject`, {
          reason: 'Concentration on Angkor Retail',
        }),
      );
      const reg = expectOk(
        await f
          .as('opsMaker')
          .get(`/lending/facilities/${facilityId}/invoices`),
      );
      expect(reg.kind).toBe('FACTORING');
      expect(reg.debtors).toEqual([
        expect.objectContaining({
          name: 'Angkor Retail Co.',
          invoices: 1,
          advanceOutstanding: '17000',
          shareOfLimit: '0.17',
        }),
      ]);
    });

    it('the programme does not close while a receivable is open', async () => {
      const r = await f
        .as('opsChecker')
        .post(`/lending/facilities/${facilityId}/receivables/close`);
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('PROGRAMME_OPEN');
    });

    it('the debtor pays the factor: fee, then advance, the balance owed to the seller and paid out under maker-checker', async () => {
      await setBusinessDate(f, '2026-03-19');
      const r = expectOk(
        await f.as('opsMaker').post(
          `/lending/invoices/${invoiceId}/collections`,
          {
            source: 'DEBTOR',
            amount: '20000',
            externalReference: 'DEBTOR-1',
          },
          key('f1-col'),
        ),
      );
      // 45 days → two started 30-day periods at 1.5% of 20,000.
      expect(r.toFee).toBe('600');
      expect(r.toAdvance).toBe('17000');
      expect(r.toReserve).toBe('2400');
      expect(r.status).toBe('SETTLED');
      const task = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/invoices/${invoiceId}/reserve-payouts`, {}),
      );
      expect(
        (
          await f
            .as('opsMaker')
            .post(
              `/lending/invoices/${invoiceId}/reserve-payouts/${task.id}/decision`,
              { approve: true },
              key('self'),
            )
        ).status,
      ).toBe(403);
      expectOk(
        await f
          .as('opsChecker')
          .post(
            `/lending/invoices/${invoiceId}/reserve-payouts/${task.id}/decision`,
            { approve: true },
            key('f1-res'),
          ),
      );
      expect(await glNet(f, '4200', loanId)).toBe('-600.00');
      expect(await glNet(f, '2310', loanId)).toBe('0.00');
      const closed = expectOk(
        await f
          .as('opsChecker')
          .post(`/lending/facilities/${facilityId}/receivables/close`),
      );
      expect(closed.status).toBe('CLOSED');
      expect((await loanOf(f, loanId)).account.status).toBe('CLOSED');
      expect(await journalsBalance(f, loanId)).toBe(true);
      expect(await reconciliationBreaks(f, [loanId])).toEqual([]);
    });
  });

  describe('without recourse', () => {
    let facilityId: string;
    let loanId: string;
    let invoiceId: string;

    beforeAll(async () => {
      const { productId } = await activeProduct(
        f,
        'FACTORING',
        'FCT-NR',
        (c) => {
          c.trade.factoring.recourse = 'NONE';
          c.attributes.recourse = 'NON_RECOURSE';
        },
      );
      ({ facilityId, loanId } = await bookProgramme(
        f,
        productId,
        '50000',
        '2026-03-19',
      ));
      const inv = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/facilities/${facilityId}/invoices`, {
            debtorName: 'Mekong Foods Ltd',
            invoiceNumber: 'MF-9',
            amount: '10000',
            issueDate: '2026-03-18',
            dueDate: '2026-04-17',
          }),
      );
      invoiceId = inv.id;
      expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/invoices/${invoiceId}/acknowledge`, {
            method: 'DEBTOR_ACKNOWLEDGED',
            reference: 'ACK-MF-9',
          }),
      );
      const { released } = await fund(f, invoiceId, 'mf9');
      expect(released.paidOut).toBe('8450');
    }, 60_000);

    it('the seller owes nothing: a recourse payment is refused', async () => {
      const r = await f
        .as('opsMaker')
        .post(
          `/lending/invoices/${invoiceId}/collections`,
          { source: 'BORROWER', amount: '100' },
          key('nr-b'),
        );
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('WITHOUT_RECOURSE');
    });

    it('unpaid past due + grace, the receivable defaults with the lender and the facility does not age', async () => {
      await setBusinessDate(f, '2026-06-16');
      await runBatch(f);
      expect((await invoiceOf(invoiceId)).invoice.status).toBe('FUNDED');
      await setBusinessDate(f, '2026-06-17');
      await runBatch(f);
      const inv = await invoiceOf(invoiceId);
      expect(inv.invoice.status).toBe('DEFAULTED');
      // 2026-03-19 → 2026-06-16 is 89 days: three started periods.
      expect(inv.invoice.feeRaised).toBe('450');
      expect(inv.quote.holderOwes).toBe('0');
      expect(inv.quote.lenderBears).toBe('8950');
      const l = await loanOf(f, loanId);
      expect(l.account.daysPastDue).toBe(0);
    });

    it('a late part-payment from the debtor still counts; the rest is written off under maker-checker as the lender’s loss', async () => {
      const r = expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/invoices/${invoiceId}/collections`,
            { source: 'DEBTOR', amount: '2000', externalReference: 'MF-PART' },
            key('nr-d'),
          ),
      );
      expect(r.toFee).toBe('450');
      expect(r.toAdvance).toBe('1550');
      const task = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/invoices/${invoiceId}/write-offs`, {
            reason: 'Debtor insolvent',
          }),
      );
      expect(task.amount).toBe('6950');
      expect(
        (
          await f
            .as('opsMaker')
            .post(
              `/lending/invoices/${invoiceId}/write-offs/${task.id}/decision`,
              { approve: true },
              key('self'),
            )
        ).status,
      ).toBe(403);
      // Another write-off cannot be stacked while one waits.
      expect(
        (
          await f
            .as('opsMaker')
            .post(`/lending/invoices/${invoiceId}/write-offs`, {
              reason: 'again',
            })
        ).status,
      ).toBe(409);
      const done = expectOk(
        await f
          .as('opsChecker')
          .post(
            `/lending/invoices/${invoiceId}/write-offs/${task.id}/decision`,
            { approve: true },
            key('nr-wo'),
          ),
      );
      expect(done.status).toBe('WRITTEN_OFF');
      expect(await glNet(f, '5500', loanId)).toBe('6950.00');
      expect(await glNet(f, '1200', loanId)).toBe('0.00');
      const l = await loanOf(f, loanId);
      expect(l.account.principalOutstanding).toBe('0');
      expect(l.account.feesReceivable).toBe('0');
      expectOk(
        await f
          .as('opsChecker')
          .post(`/lending/facilities/${facilityId}/receivables/close`),
      );
      expect((await loanOf(f, loanId)).account.status).toBe('CLOSED');
      expect(await journalsBalance(f, loanId)).toBe(true);
      expect(await reconciliationBreaks(f, [loanId])).toEqual([]);
    });
  });

  describe('limited recourse', () => {
    let facilityId: string;
    let loanId: string;
    let invoiceId: string;

    beforeAll(async () => {
      const { productId } = await activeProduct(
        f,
        'FACTORING',
        'FCT-LTD',
        (c) => {
          c.trade.factoring.recourse = 'LIMITED';
          c.trade.factoring.limitedRecourseRate = '0.3';
          c.attributes.recourse = 'LIMITED';
        },
      );
      ({ facilityId, loanId } = await bookProgramme(
        f,
        productId,
        '50000',
        '2026-06-17',
      ));
      const inv = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/facilities/${facilityId}/invoices`, {
            debtorName: 'Kampot Pepper Co.',
            invoiceNumber: 'KP-3',
            amount: '10000',
            issueDate: '2026-06-17',
            dueDate: '2026-07-17',
          }),
      );
      invoiceId = inv.id;
      expect(inv.receivable.recourseCap).toBe('3000');
      expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/invoices/${invoiceId}/acknowledge`, {
            method: 'NOTICE_LETTER',
            reference: 'NOA-KP-3',
          }),
      );
      await fund(f, invoiceId, 'kp3');
    }, 60_000);

    it('on default the seller owes up to its cap, aged as arrears; the lender bears the rest', async () => {
      await setBusinessDate(f, '2026-09-16');
      await runBatch(f);
      const inv = await invoiceOf(invoiceId);
      expect(inv.invoice.status).toBe('RECOURSE');
      expect(inv.quote.owed).toBe('8950');
      expect(inv.quote.holderOwes).toBe('3000');
      expect(inv.quote.lenderBears).toBe('5950');
      expect((await loanOf(f, loanId)).account.daysPastDue).toBe(1);
      // Nothing is written off while the seller still owes its share.
      const early = await f
        .as('opsMaker')
        .post(`/lending/invoices/${invoiceId}/write-offs`, {
          reason: 'too early',
        });
      expect(early.status).toBe(409);
      expect(early.body.code).toBe('RECOURSE_OUTSTANDING');
      const over = await f
        .as('opsMaker')
        .post(
          `/lending/invoices/${invoiceId}/collections`,
          { source: 'BORROWER', amount: '3000.01' },
          key('ltd-over'),
        );
      expect(over.status).toBe(400);
      expect(over.body.code).toBe('RECOURSE_CAP');
    });

    it('once the seller has paid its cap the arrears stop, and the lender’s share is written off', async () => {
      expectOk(
        await f.as('opsMaker').post(
          `/lending/invoices/${invoiceId}/collections`,
          {
            source: 'BORROWER',
            amount: '3000',
            externalReference: 'SELLER-CAP',
          },
          key('ltd-pay'),
        ),
      );
      await runBatch(f);
      expect((await loanOf(f, loanId)).account.daysPastDue).toBe(0);
      const task = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/invoices/${invoiceId}/write-offs`, {
            reason: 'Debtor in liquidation',
          }),
      );
      expect(task.amount).toBe('5950');
      expectOk(
        await f
          .as('opsChecker')
          .post(
            `/lending/invoices/${invoiceId}/write-offs/${task.id}/decision`,
            { approve: true },
            key('ltd-wo'),
          ),
      );
      expect(await glNet(f, '5500', loanId)).toBe('5950.00');
      expectOk(
        await f
          .as('opsChecker')
          .post(`/lending/facilities/${facilityId}/receivables/close`),
      );
      expect((await loanOf(f, loanId)).account.status).toBe('CLOSED');
      expect(await journalsBalance(f, loanId)).toBe(true);
      expect(await reconciliationBreaks(f, [loanId])).toEqual([]);
    });
  });
});
