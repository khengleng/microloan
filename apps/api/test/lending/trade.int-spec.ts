/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: modules are required after the test environment is configured, and fixture rows come from the untyped Prisma client. */
/**
 * Trade finance over the real HTTP API, guards and database:
 *
 *  • LT-18 invoice financing — register, approve, advance under maker-checker,
 *    debtor settlement and the borrower's balance paid out (TV-20);
 *  • UC-67 recourse — an unpaid invoice past due date + grace becomes the
 *    borrower's debt and ages as arrears until repaid;
 *  • LT-19 / UC-53 letters of credit — issuance with a fee and a contingent
 *    memo, and a payment under the credit converting into the importer's loan.
 *
 * Evidence for: trade.invoice_finance, trade.letter_of_credit
 */
import {
  Fixture,
  TEST_DB,
  authority,
  borrower,
  bootstrap,
  expectOk,
  key,
} from './harness';
import { activeProduct, docs, standardRoles } from './setup';
import { lending } from '@microloan/shared';

const d = TEST_DB ? describe : describe.skip;

d('Trade finance (integration)', () => {
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
    await authority(f, f.t1, 'approver', 'trade.lc.issue', 'USD', '1000000');
    for (const flagKey of [
      'lending.revolving.drawdown',
      'lending.trade.invoice_finance',
      'lending.trade.letters_of_credit',
    ])
      await enableFlag(flagKey);
  }, 60_000);
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
      current = next;
    }
    return current;
  }

  async function enableFlag(flagKey: string) {
    const r = expectOk(
      await f.as('admin1').post('/lending/access/flags/rules', {
        flagKey,
        scopeType: 'TENANT',
        enabled: true,
        reason: 'trade finance integration tests',
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

  /** Application → approval → booking of an invoice-finance facility. */
  async function bookInvoiceFacility(productId: string, limit: string) {
    const b = await borrower(f, f.t1, f.b1, { monthlyIncome: '40000' });
    const app = expectOk(
      await f.as('ro').post('/lending/applications', {
        borrowerId: b.id,
        productId,
        terms: {
          principal: limit,
          numberOfInstalments: 12,
          disbursementDate: '2026-01-05',
          annualRate: '0',
        },
      }),
    );
    await docs(f, app.id, ['ID_DOCUMENT']);
    expectOk(await f.as('ro').post(`/lending/applications/${app.id}/submit`));
    expectOk(
      await f.as('analyst').post(`/lending/applications/${app.id}/recommend`, {
        recommendation: 'APPROVE',
        rationale: 'Receivables book reviewed',
      }),
    );
    expectOk(
      await f.as('approver').post(`/lending/applications/${app.id}/approve`, {
        rationale: 'Within authority',
      }),
    );
    const booked = expectOk(
      await f.as('opsMaker').post(`/lending/applications/${app.id}/book`, {}),
    );
    return {
      facilityId: booked.facility.id as string,
      loanId: booked.account.id as string,
      borrowerId: b.id as string,
    };
  }

  /** Register → approve → request → approve → release. */
  async function financeInvoice(
    facilityId: string,
    invoice: Record<string, unknown>,
    tag: string,
  ) {
    const inv = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/invoices`, invoice),
    );
    expectOk(
      await f.as('approver').post(`/lending/invoices/${inv.id}/approve`),
    );
    const req = expectOk(
      await f.as('opsMaker').post(`/lending/invoices/${inv.id}/advance`),
    );
    expectOk(
      await f
        .as('opsChecker')
        .post(`/lending/invoices/${inv.id}/advance/approve`),
    );
    const released = expectOk(
      await f
        .as('opsChecker')
        .post(
          `/lending/invoices/${inv.id}/advance/release`,
          { externalReference: `BANK-${tag}` },
          `inv-release-${tag}`,
        ),
    );
    return {
      invoiceId: inv.id as string,
      advance: req.advance as string,
      released,
    };
  }

  const loan = async (loanId: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${loanId}`));

  async function reconciliationBreaks(loanIds: string[]) {
    const r = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(r.trialBalanceBalanced).toBe(true);
    return r.breaks.filter((b: { loanAccountId: string }) =>
      loanIds.includes(b.loanAccountId),
    );
  }

  /** Net (debit − credit) on a ledger account, for one loan or tenant-level. */
  async function glNet(accountCode: string, loanAccountId: string | null) {
    const rows = await f.system(() =>
      f.prisma.lendingJournalLine.findMany({
        where: { tenantId: f.t1, accountCode, loanAccountId },
      }),
    );
    return rows
      .reduce(
        (t: any, l: any) =>
          t.plus(l.debit.toString()).minus(l.credit.toString()),
        new lending.D(0),
      )
      .toFixed(2);
  }

  // ── LT-18 / TV-20 ─────────────────────────────────────────────────────────

  describe('LT-18 invoice financing', () => {
    let productId: string;
    let facilityId: string;
    let loanId: string;
    let invoiceId: string;

    beforeAll(async () => {
      await setBusinessDate('2026-01-05');
      ({ productId } = await activeProduct(f, 'INVOICE_BACKED', 'INV-FIN'));
      ({ facilityId, loanId } = await bookInvoiceFacility(productId, '50000'));
    }, 60_000);

    it('TV-20 / LT-18: an approved invoice of 10,000.00 is advanced 8,000.00 under maker-checker', async () => {
      const inv = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/facilities/${facilityId}/invoices`, {
            debtorName: 'Angkor Retail Co.',
            invoiceNumber: 'AR-1001',
            amount: '10000',
            issueDate: '2026-01-05',
            dueDate: '2026-03-06',
          }),
      );
      invoiceId = inv.id;
      expect(inv.status).toBe('SUBMITTED');
      expect(inv.advanceRate).toBe('0.8');

      // No advance on an invoice nobody has approved.
      const early = await f
        .as('opsMaker')
        .post(`/lending/invoices/${invoiceId}/advance`);
      expect(early.status).toBe(403);
      expectOk(
        await f.as('approver').post(`/lending/invoices/${invoiceId}/approve`),
      );

      const req = expectOk(
        await f.as('opsMaker').post(`/lending/invoices/${invoiceId}/advance`),
      );
      expect(req.advance).toBe('8000');
      // The requester cannot approve or release their own advance.
      expect(
        (
          await f
            .as('opsMaker')
            .post(`/lending/invoices/${invoiceId}/advance/approve`)
        ).status,
      ).toBe(403);
      // Releasing before approval is refused.
      expect(
        (
          await f
            .as('opsChecker')
            .post(
              `/lending/invoices/${invoiceId}/advance/release`,
              { externalReference: 'X' },
              key('early'),
            )
        ).status,
      ).toBe(403);
      expectOk(
        await f
          .as('opsChecker')
          .post(`/lending/invoices/${invoiceId}/advance/approve`),
      );
      const k = key('inv-release');
      const released = expectOk(
        await f
          .as('opsChecker')
          .post(
            `/lending/invoices/${invoiceId}/advance/release`,
            { externalReference: 'BANK-ADV-1' },
            k,
          ),
      );
      expect(released.status).toBe('FUNDED');
      expect(released.recourseDate).toBe('2026-04-05');
      // A retry with the same key replays; it does not pay twice.
      const replay = expectOk(
        await f
          .as('opsChecker')
          .post(
            `/lending/invoices/${invoiceId}/advance/release`,
            { externalReference: 'BANK-ADV-1' },
            k,
          ),
      );
      expect(replay.replayed).toBe(true);

      const l = await loan(loanId);
      expect(l.account.status).toBe('ACTIVE');
      expect(l.account.principalOutstanding).toBe('8000');
      const fac = expectOk(
        await f
          .as('opsMaker')
          .get(`/lending/facilities/${facilityId}/invoices`),
      );
      expect(fac.position.outstanding).toBe('8000');
      expect(fac.summary.advancedOutstanding).toBe('8000');
    });

    it('LT-18: the same invoice cannot be financed twice, and a plain drawdown is refused', async () => {
      const dup = await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/invoices`, {
          debtorName: '  angkor retail   co. ',
          invoiceNumber: 'AR-1001',
          amount: '10000',
          issueDate: '2026-01-05',
          dueDate: '2026-03-06',
        });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('INVOICE_DUPLICATE');
      const plain = await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/drawdowns`, { amount: '100' });
      expect(plain.status).toBe(400);
      expect(plain.body.code).toBe('INVOICE_FACILITY');
    });

    it('TV-20: the debtor pays 10,000.00 after 60 days → fee 400.00, advance repaid, 1,600.00 to the borrower', async () => {
      await setBusinessDate('2026-03-06');
      const q = expectOk(
        await f.as('opsMaker').get(`/lending/invoices/${invoiceId}/quote`),
      );
      expect(q.feeToDate).toBe('400');
      expect(q.owed).toBe('8400');
      expect(q.surplusIfDebtorPaysInFull).toBe('1600');

      const r = expectOk(
        await f.as('opsMaker').post(
          `/lending/invoices/${invoiceId}/collections`,
          {
            source: 'DEBTOR',
            amount: '10000',
            externalReference: 'DEBTOR-WIRE-1',
          },
          key('tv20'),
        ),
      );
      expect(r.feeRaise).toBe('400');
      expect(r.toFee).toBe('400');
      expect(r.toAdvance).toBe('8000');
      expect(r.toReserve).toBe('1600');
      expect(r.status).toBe('SETTLED');

      const l = await loan(loanId);
      expect(l.account.principalOutstanding).toBe('0');
      expect(l.account.feesReceivable).toBe('0');
      const inv = expectOk(
        await f.as('opsMaker').get(`/lending/invoices/${invoiceId}`),
      );
      expect(inv.invoice.reserveOwed).toBe('1600');
      expect(inv.collections).toHaveLength(1);
      // Fee income earned, and the limit reinstated by the repaid advance.
      expect(await glNet('4200', loanId)).toBe('-400.00');
      const fac = expectOk(
        await f
          .as('opsMaker')
          .get(`/lending/facilities/${facilityId}/invoices`),
      );
      expect(fac.position.outstanding).toBe('0');
    });

    it('TV-20: the 1,600.00 balance is paid to the borrower under maker-checker', async () => {
      const task = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/invoices/${invoiceId}/reserve-payouts`, {
            externalReference: 'PAY-BORROWER-1',
          }),
      );
      expect(task.amount).toBe('1600');
      // The proposer cannot approve their own payout.
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
            key('reserve'),
          ),
      );
      const inv = expectOk(
        await f.as('opsMaker').get(`/lending/invoices/${invoiceId}`),
      );
      expect(inv.invoice.reserveOwed).toBe('0');
      expect(inv.invoice.reservePaid).toBe('1600');
      expect(await glNet('2310', loanId)).toBe('0.00');
      expect(await reconciliationBreaks([loanId])).toEqual([]);
    });

    // ── UC-67 recourse ──────────────────────────────────────────────────────

    it('UC-67: unpaid after due date + grace, the borrower owes advance + fee, aged as arrears', async () => {
      // Invoice of 5,000 due in 30 days; 30 days' grace → recourse on 2026-05-05.
      const { invoiceId: id, advance } = await financeInvoice(
        facilityId,
        {
          debtorName: 'Tonle Sap Traders',
          invoiceNumber: 'TST-77',
          amount: '5000',
          issueDate: '2026-03-01',
          dueDate: '2026-04-05',
        },
        'rec',
      );
      expect(advance).toBe('4000');
      await setBusinessDate('2026-05-05');
      expectOk(await f.as('opsMaker').post('/lending/loans/batch/run'));
      // The last day of grace: not yet recourse.
      expect(
        expectOk(await f.as('opsMaker').get(`/lending/invoices/${id}`)).invoice
          .status,
      ).toBe('FUNDED');

      await setBusinessDate('2026-05-06');
      expectOk(await f.as('opsMaker').post('/lending/loans/batch/run'));
      let inv = expectOk(await f.as('opsMaker').get(`/lending/invoices/${id}`));
      expect(inv.invoice.status).toBe('RECOURSE');
      // Fee to the recourse date: 2026-03-06 → 2026-05-05 is 60 days → 2 × 2% × 5,000.
      expect(inv.invoice.feeRaised).toBe('200');
      expect(inv.quote.owed).toBe('4200');
      let l = await loan(loanId);
      expect(l.account.daysPastDue).toBe(1);
      expect(l.account.delinquencyBucket).toBe('DPD_1_30');
      expect(l.account.feesReceivable).toBe('200');

      await setBusinessDate('2026-05-20');
      expectOk(await f.as('opsMaker').post('/lending/loans/batch/run'));
      l = await loan(loanId);
      expect(l.account.daysPastDue).toBe(15);
      // The fee stopped at the recourse date.
      expect(
        expectOk(await f.as('opsMaker').get(`/lending/invoices/${id}/quote`))
          .owed,
      ).toBe('4200');

      // A recourse payment may not exceed what is owed.
      const over = await f
        .as('opsMaker')
        .post(
          `/lending/invoices/${id}/collections`,
          { source: 'BORROWER', amount: '4200.01' },
          key('over'),
        );
      expect(over.status).toBe(400);
      const paid = expectOk(
        await f.as('opsMaker').post(
          `/lending/invoices/${id}/collections`,
          {
            source: 'BORROWER',
            amount: '4200',
            externalReference: 'BORROWER-CASH',
          },
          key('recourse'),
        ),
      );
      expect(paid.toFee).toBe('200');
      expect(paid.toAdvance).toBe('4000');
      expect(paid.status).toBe('SETTLED');
      expectOk(await f.as('opsMaker').post('/lending/loans/batch/run'));
      l = await loan(loanId);
      expect(l.account.daysPastDue).toBe(0);
      expect(l.account.principalOutstanding).toBe('0');
      inv = expectOk(await f.as('opsMaker').get(`/lending/invoices/${id}`));
      expect(inv.invoice.collectedFromBorrower).toBe('4200');
      expect(await reconciliationBreaks([loanId])).toEqual([]);
    });
  });

  // ── LT-19 / UC-53 ─────────────────────────────────────────────────────────

  describe('LT-19 letters of credit', () => {
    let lcProductId: string;
    let importer: string;
    let lcId: string;
    let drawingId: string;
    let convertedLoanId: string;

    beforeAll(async () => {
      await activeProduct(f, 'WORKING_CAPITAL', 'IMPORT-LOAN', (c: any) => {
        c.repayment.method = 'EQUAL_INSTALMENT';
        c.limits = {
          minAmount: '1000',
          maxAmount: '500000',
          minInstalments: 1,
          maxInstalments: 12,
        };
      });
      ({ productId: lcProductId } = await activeProduct(
        f,
        'LETTER_OF_CREDIT',
        'LC-IMPORT',
        (c: any) => {
          c.trade.letterOfCredit.conversionProductCode = 'IMPORT-LOAN';
        },
      ));
      importer = (await borrower(f, f.t1, f.b1, { firstName: 'Importer' })).id;
    }, 60_000);

    it('LT-19: a letter-of-credit product is not originated as a loan', async () => {
      const r = await f.as('ro').post('/lending/applications', {
        borrowerId: importer,
        productId: lcProductId,
        terms: {
          principal: '10000',
          numberOfInstalments: 6,
          disbursementDate: '2026-05-20',
        },
      });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('LETTER_OF_CREDIT_PRODUCT');
    });

    it('LT-19: issued by a checker with a fee and an off-balance-sheet contingent memo', async () => {
      const businessDate = expectOk(
        await f.as('finance').get('/lending/ops/business-date'),
      ).businessDate as string;
      const lc = expectOk(
        await f.as('opsMaker').post('/lending/letters-of-credit', {
          borrowerId: importer,
          productId: lcProductId,
          amount: '100000',
          beneficiaryName: 'Shenzhen Parts Co.',
          beneficiaryBank: 'Bank of Shenzhen',
          expiryDate: lending.addDays(businessDate, 120),
          numberOfInstalments: 6,
        }),
      );
      lcId = lc.id;
      expect(lc.status).toBe('REQUESTED');
      // 0.5% per started 90 days: 120 days → 2 periods → 1,000.00.
      expect(lc.feeAmount).toBe('1000');
      // The maker cannot issue; a checker does.
      expect(
        (
          await f
            .as('opsMaker')
            .post(
              `/lending/letters-of-credit/${lcId}/issue`,
              {},
              key('self-issue'),
            )
        ).status,
      ).toBe(403);
      const issued = expectOk(
        await f
          .as('approver')
          .post(
            `/lending/letters-of-credit/${lcId}/issue`,
            {},
            key('lc-issue'),
          ),
      );
      expect(issued.status).toBe('ISSUED');
      expect(issued.fee).toBe('1000');
      // Contingent memo: customer liability vs commitments, off the loan book.
      expect(await glNet('9100', null)).toBe('100000.00');
      expect(await glNet('9200', null)).toBe('-100000.00');
    });

    it('UC-53: the bank pays 60,000.00 under the credit and it converts into a loan for the importer', async () => {
      const over = await f
        .as('opsMaker')
        .post(`/lending/letters-of-credit/${lcId}/drawings`, {
          amount: '100000.01',
          documentsReference: 'BL-1',
        });
      expect(over.status).toBe(400);
      expect(over.body.code).toBe('LC_EXCEEDED');
      const drawing = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/letters-of-credit/${lcId}/drawings`, {
            amount: '60000',
            documentsReference: 'BL-2026-118 / INV-SZ-55',
          }),
      );
      drawingId = drawing.id;
      expect(
        (
          await f
            .as('opsMaker')
            .post(
              `/lending/letters-of-credit/${lcId}/drawings/${drawingId}/approve`,
            )
        ).status,
      ).toBe(403);
      expectOk(
        await f
          .as('opsChecker')
          .post(
            `/lending/letters-of-credit/${lcId}/drawings/${drawingId}/approve`,
          ),
      );
      const k = key('lc-pay');
      const paid = expectOk(
        await f
          .as('opsChecker')
          .post(
            `/lending/letters-of-credit/${lcId}/drawings/${drawingId}/pay`,
            { externalReference: 'SWIFT-MT202-991' },
            k,
          ),
      );
      expect(paid.status).toBe('PAID');
      convertedLoanId = paid.loanAccountId;
      const replay = expectOk(
        await f
          .as('opsChecker')
          .post(
            `/lending/letters-of-credit/${lcId}/drawings/${drawingId}/pay`,
            { externalReference: 'SWIFT-MT202-991' },
            k,
          ),
      );
      expect(replay.replayed).toBe(true);

      const l = await loan(convertedLoanId);
      expect(l.account.status).toBe('ACTIVE');
      expect(l.account.borrowerId).toBe(importer);
      expect(l.account.principalOutstanding).toBe('60000');
      expect(l.productCode).toBe('IMPORT-LOAN');
      expect(
        l.schedule.filter((x: { number: number }) => x.number > 0),
      ).toHaveLength(6);
      const disbursement = l.events.find(
        (e: { type: string }) => e.type === 'DISBURSEMENT',
      );
      expect(disbursement.components.paidTo).toBe('Shenzhen Parts Co.');

      const view = expectOk(
        await f.as('opsMaker').get(`/lending/letters-of-credit/${lcId}`),
      );
      expect(view.letterOfCredit.status).toBe('PARTIALLY_DRAWN');
      expect(view.undrawn).toBe('40000');
      // The paid part left the memo.
      expect(await glNet('9100', null)).toBe('40000.00');
    });

    it('LT-19: cancelling releases the undrawn commitment; the books reconcile', async () => {
      const r = expectOk(
        await f.as('approver').post(
          `/lending/letters-of-credit/${lcId}/close`,
          {
            action: 'CANCEL',
            reason: 'Beneficiary agreed to cancel the balance',
          },
          key('lc-close'),
        ),
      );
      expect(r.status).toBe('CANCELLED');
      expect(r.released).toBe('40000');
      expect(await glNet('9100', null)).toBe('0.00');
      expect(await glNet('9200', null)).toBe('0.00');
      expect(await reconciliationBreaks([convertedLoanId])).toEqual([]);
      const list = expectOk(
        await f.as('opsMaker').get('/lending/letters-of-credit'),
      );
      expect(list.data.some((x: { id: string }) => x.id === lcId)).toBe(true);
    });
  });
});
