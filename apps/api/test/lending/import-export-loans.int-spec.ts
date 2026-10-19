/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: modules are required after the test environment is configured, and fixture rows come from the untyped Prisma client. */
/**
 * IMPORT_LOAN and EXPORT_WORKING_CAPITAL over the real HTTP API, guards and
 * database: one trade transaction per loan, the document checklist received
 * and verified by different people before the loan can be paid out, the
 * amount within the financing ratio and the tenor ending by the expected
 * proceeds, and the proceeds repaying the loan — the rest passed to the
 * customer — to closure with balanced books.
 *
 * Evidence for: trade.documentary
 */
import { lending } from '@microloan/shared';
import { Fixture, TEST_DB, bootstrap, expectOk, key } from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';
import {
  enableFlag,
  journalsBalance,
  loanOf,
  reconciliationBreaks,
  setBusinessDate,
} from './trade-helpers';

const d = TEST_DB ? describe : describe.skip;

d('IMPORT_LOAN and EXPORT_WORKING_CAPITAL (integration)', () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    await enableFlag(f, 'lending.trade.documentary');
    await setBusinessDate(f, '2026-02-02');
  }, 90_000);
  afterAll(async () => f?.app.close());

  const tradeOf = async (loanId: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${loanId}/trade`));

  /** Receive (maker) and verify (checker) each listed document. */
  async function document(transactionId: string, codes: string[]) {
    const out: Record<string, string> = {};
    for (const code of codes) {
      const doc = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/trade-transactions/${transactionId}/documents`, {
            code,
            reference: `${code}-001`,
          }),
      );
      out[code] = doc.id;
      expectOk(
        await f
          .as('opsChecker')
          .post(`/lending/trade-documents/${doc.id}/verify`),
      );
    }
    return out;
  }

  describe('IMPORT_LOAN', () => {
    let loanId: string;
    let transactionId: string;

    beforeAll(async () => {
      const { productId } = await activeProduct(f, 'IMPORT_LOAN', 'IMP-1');
      ({ loanId } = await originateAndDisburse(
        f,
        productId,
        {
          principal: '45000',
          numberOfInstalments: 3,
          disbursementDate: '2026-02-02',
          annualRate: '0.12',
        },
        {
          beforeDisbursement: async (id) => {
            // Nothing is paid out before the trade is recorded…
            const none = await f
              .as('opsMaker')
              .post(`/lending/loans/${id}/disbursements`, {});
            expect(none.status).toBe(409);
            expect(none.body.code).toBe('TRADE_NOT_RECORDED');
            const trade = {
              counterpartyName: 'Shenzhen Electronics Ltd',
              counterpartyCountry: 'cn',
              goodsDescription: '2,000 solar inverters',
              transactionValue: '50000',
              cycleStartDate: '2026-01-25',
              expectedProceedsDate: '2026-05-10',
            };
            // …within 90% of the transaction…
            const over = await f
              .as('opsMaker')
              .post(`/lending/loans/${id}/trade`, {
                ...trade,
                transactionValue: '40000',
              });
            expect(over.status).toBe(400);
            expect(over.body.code).toBe('TRADE_FINANCING_RATIO');
            // …and repaid from proceeds expected before the loan matures (+30 days).
            const late = await f
              .as('opsMaker')
              .post(`/lending/loans/${id}/trade`, {
                ...trade,
                expectedProceedsDate: '2026-03-15',
              });
            expect(late.status).toBe(400);
            expect(late.body.code).toBe('TRADE_TENOR');
            const t = expectOk(
              await f.as('opsMaker').post(`/lending/loans/${id}/trade`, trade),
            );
            transactionId = t.id;
            expect(t.direction).toBe('IMPORT');
            expect(t.counterpartyCountry).toBe('CN');
            // …and every required document is verified.
            const incomplete = await f
              .as('opsMaker')
              .post(`/lending/loans/${id}/disbursements`, {});
            expect(incomplete.status).toBe(409);
            expect(incomplete.body.code).toBe('TRADE_DOCUMENTS_INCOMPLETE');
            const bl = expectOk(
              await f
                .as('opsMaker')
                .post(
                  `/lending/trade-transactions/${transactionId}/documents`,
                  { code: 'BILL_OF_LADING', reference: 'BL-1' },
                ),
            );
            // The receiver never verifies their own document.
            expect(
              (
                await f
                  .as('opsMaker')
                  .post(`/lending/trade-documents/${bl.id}/verify`)
              ).status,
            ).toBe(403);
            expectOk(
              await f
                .as('opsChecker')
                .post(`/lending/trade-documents/${bl.id}/reject`, {
                  reason: 'Consignee does not match the borrower',
                }),
            );
            expect(
              (
                await f
                  .as('opsChecker')
                  .post(`/lending/trade-documents/${bl.id}/verify`)
              ).status,
            ).toBe(409);
            const again = expectOk(
              await f
                .as('opsMaker')
                .post(
                  `/lending/trade-transactions/${transactionId}/documents`,
                  { code: 'BILL_OF_LADING', reference: 'BL-1A' },
                ),
            );
            expectOk(
              await f
                .as('opsChecker')
                .post(`/lending/trade-documents/${again.id}/verify`),
            );
            await document(transactionId, [
              'COMMERCIAL_INVOICE',
              'PACKING_LIST',
            ]);
            const view = await tradeOf(id);
            expect(view.checks.documents).toEqual({
              complete: false,
              missing: ['INSURANCE_CERTIFICATE'],
              unverified: [],
            });
            await document(transactionId, ['INSURANCE_CERTIFICATE']);
            expect((await tradeOf(id)).checks.documents.complete).toBe(true);
          },
        },
      ));
    }, 90_000);

    it('the loan is paid out against verified documents and the trade is financed', async () => {
      const view = await tradeOf(loanId);
      expect(view.transaction.status).toBe('FINANCED');
      expect(view.loan.status).toBe('ACTIVE');
      expect(view.loan.maturityDate).toBe('2026-05-02');
      expect(view.checks.cycle.ok).toBe(true);
      expect(
        view.documents.filter(
          (x: { status: string }) => x.status === 'VERIFIED',
        ),
      ).toHaveLength(4);
    });

    it('part of the sale proceeds is a repayment', async () => {
      await setBusinessDate(f, '2026-03-02');
      const r = expectOk(
        await f.as('opsMaker').post(
          `/lending/trade-transactions/${transactionId}/proceeds`,
          {
            amount: '10000',
            payerName: 'Phnom Penh Solar Retail',
            externalReference: 'SALE-1',
          },
          key('imp-p1'),
        ),
      );
      expect(r.settled).toBe(false);
      expect(r.applied).toBe('10000');
      expect(r.remitted).toBe('0');
      const l = await loanOf(f, loanId);
      expect(l.account.status).toBe('ACTIVE');
      expect(Number(l.account.principalOutstanding)).toBeLessThan(45000);
    });

    it('proceeds above the payoff settle the loan; the rest goes to the importer', async () => {
      await setBusinessDate(f, '2026-04-10');
      const view = await tradeOf(loanId);
      const payoff = view.loan.payoff as string;
      expect(Number(payoff)).toBeGreaterThan(35000);
      const noRef = await f
        .as('opsMaker')
        .post(
          `/lending/trade-transactions/${transactionId}/proceeds`,
          { amount: '50000', payerName: 'Phnom Penh Solar Retail' },
          key('imp-p2a'),
        );
      expect(noRef.status).toBe(400);
      expect(noRef.body.code).toBe('PROCEEDS_REMIT_REFERENCE');
      const r = expectOk(
        await f.as('opsMaker').post(
          `/lending/trade-transactions/${transactionId}/proceeds`,
          {
            amount: '50000',
            payerName: 'Phnom Penh Solar Retail',
            externalReference: 'SALE-2',
            remitReference: 'CASA-CREDIT-9',
          },
          key('imp-p2'),
        ),
      );
      expect(r.settled).toBe(true);
      expect(r.applied).toBe(payoff);
      expect(r.remitted).toBe(new lending.D('50000').minus(payoff).toString());
      expect((await loanOf(f, loanId)).account.status).toBe('CLOSED');
      const after = await tradeOf(loanId);
      expect(after.transaction.status).toBe('SETTLED');
      expect(after.transaction.proceedsReceived).toBe('60000');
      expect(after.proceeds).toHaveLength(2);
      expect(await journalsBalance(f, loanId)).toBe(true);
      expect(await reconciliationBreaks(f, [loanId])).toEqual([]);
    });

    it('a settled trade takes no more proceeds or documents', async () => {
      expect(
        (
          await f
            .as('opsMaker')
            .post(
              `/lending/trade-transactions/${transactionId}/proceeds`,
              { amount: '10', payerName: 'Anyone' },
              key('imp-p3'),
            )
        ).status,
      ).toBe(403);
      expect(
        (
          await f
            .as('opsMaker')
            .post(`/lending/trade-transactions/${transactionId}/documents`, {
              code: 'CUSTOMS_DECLARATION',
              reference: 'CD-1',
            })
        ).status,
      ).toBe(403);
    });
  });

  describe('EXPORT_WORKING_CAPITAL', () => {
    let loanId: string;
    let transactionId: string;

    beforeAll(async () => {
      await setBusinessDate(f, '2026-04-13');
      const { productId } = await activeProduct(
        f,
        'EXPORT_WORKING_CAPITAL',
        'EXP-1',
      );
      ({ loanId } = await originateAndDisburse(
        f,
        productId,
        {
          principal: '40000',
          numberOfInstalments: 4,
          disbursementDate: '2026-04-13',
          annualRate: '0.11',
        },
        {
          beforeDisbursement: async (id) => {
            const t = expectOk(
              await f.as('opsMaker').post(`/lending/loans/${id}/trade`, {
                counterpartyName: 'Lyon Fine Foods SARL',
                counterpartyCountry: 'FR',
                goodsDescription: '20 t Kampot pepper',
                transactionValue: '50000',
                cycleStartDate: '2026-04-10',
                expectedProceedsDate: '2026-08-10',
              }),
            );
            transactionId = t.id;
            expect(t.direction).toBe('EXPORT');
            await document(transactionId, [
              'EXPORT_CONTRACT',
              'PROFORMA_INVOICE',
              'EXPORT_LICENCE',
            ]);
          },
        },
      ));
    }, 90_000);

    it('shipment documents are kept on file after payout, and the export proceeds settle the loan', async () => {
      await setBusinessDate(f, '2026-06-01');
      const extra = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/trade-transactions/${transactionId}/documents`, {
            code: 'BILL_OF_LADING',
            reference: 'BL-EXP-1',
          }),
      );
      expect(extra.required).toBe(false);
      const payoff = (await tradeOf(loanId)).loan.payoff as string;
      const r = expectOk(
        await f.as('opsMaker').post(
          `/lending/trade-transactions/${transactionId}/proceeds`,
          {
            amount: payoff,
            payerName: 'Lyon Fine Foods SARL',
            externalReference: 'SWIFT-IN-1',
          },
          key('exp-p1'),
        ),
      );
      expect(r.settled).toBe(true);
      expect(r.remitted).toBe('0');
      expect((await loanOf(f, loanId)).account.status).toBe('CLOSED');
      expect(await journalsBalance(f, loanId)).toBe(true);
      expect(await reconciliationBreaks(f, [loanId])).toEqual([]);
      const list = expectOk(
        await f.as('opsMaker').get('/lending/trade/transactions'),
      );
      expect(list.data.map((x: { id: string }) => x.id)).toEqual(
        expect.arrayContaining([transactionId]),
      );
    });
  });
});
