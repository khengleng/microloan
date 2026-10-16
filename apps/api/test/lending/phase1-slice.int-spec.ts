/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-require-imports -- integration fixtures: modules are required after the test environment is configured, and fixture rows come from the untyped Prisma client. */
/**
 * Phase 1 vertical slice: five products through configuration, approval,
 * application, disbursement, accrual, repayment, accounting and audit — over
 * the real HTTP API, guards and database.
 */
import { Fixture, TEST_DB, bootstrap, expectOk, key } from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Phase 1 vertical slice (integration)', () => {
  let f: Fixture;
  const loans: Record<string, string> = {};

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
  }, 60_000);
  afterAll(async () => f?.app.close());

  const reconcile = async () => {
    const rec = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(rec.breaks).toEqual([]);
    expect(rec.trialBalanceBalanced).toBe(true);
    return rec;
  };

  it('personal instalment: configured, approved, disbursed with a deducted fee', async () => {
    const { productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-STD',
    );
    const r = await originateAndDisburse(f, productId, {
      principal: '5000',
      numberOfInstalments: 12,
      disbursementDate: '2026-01-05',
    });
    loans.personal = r.loanId;
    const loan = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${r.loanId}`),
    );
    expect(loan.account.status).toBe('ACTIVE');
    expect(loan.account.principalOutstanding).toBe('5000');
    const disb = loan.events.find((e: any) => e.type === 'DISBURSEMENT');
    // 1% processing fee deducted: 4,950 paid out, fee income 50.
    const lines = disb.journal.lines
      .map(
        (l: any) => `${l.accountCode}:${Number(l.debit)}:${Number(l.credit)}`,
      )
      .sort();
    expect(lines).toEqual(['1000:0:4950', '1200:5000:0', '4200:0:50']);
    expect(loan.schedule.filter((l: any) => l.status === 'DUE')).toHaveLength(
      12,
    );
  });

  it('individual microenterprise: fortnightly, guarantor required, separately collected fee with tax', async () => {
    const { productId } = await activeProduct(f, 'MICRO_INDIVIDUAL', 'MF-IND');
    const r = await originateAndDisburse(
      f,
      productId,
      {
        principal: '1500',
        numberOfInstalments: 26,
        disbursementDate: '2026-01-05',
      },
      { guarantee: true },
    );
    loans.micro = r.loanId;
    const loan = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${r.loanId}`),
    );
    const upfront = loan.schedule.find((l: any) => l.number === 0);
    expect(upfront.feeDue).toBe('5');
    expect(upfront.taxDue).toBe('0.5');
    expect(loan.account.feesReceivable).toBe('5.5');
    expect(loan.schedule.find((l: any) => l.number === 1).dueDate).toBe(
      '2026-01-19',
    );
  });

  it('SME term: equal principal, collateral LTV and approval-stage documents, fee with VAT', async () => {
    const { productId } = await activeProduct(f, 'SME_TERM', 'SME-TERM');
    const r = await originateAndDisburse(
      f,
      productId,
      {
        principal: '50000',
        numberOfInstalments: 24,
        disbursementDate: '2026-01-05',
      },
      {
        docs: [
          'BUSINESS_REGISTRATION',
          'FINANCIAL_STATEMENTS',
          'COLLATERAL_TITLE',
        ],
        collateral: {
          type: 'COMMERCIAL_PROPERTY',
          description: 'Shophouse',
          marketValue: '100000',
          valuationDate: '2025-12-01',
          valuer: 'Valuer Co',
          method: 'MARKET',
        },
        // Business cash flow for the DSR check (≈2,400/month on 24 months).
        borrowerOver: { monthlyIncome: '15000' },
      },
    );
    loans.sme = r.loanId;
    const loan = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${r.loanId}`),
    );
    const due = loan.schedule.filter((l: any) => l.number > 0);
    expect(new Set(due.slice(0, 23).map((l: any) => l.principalDue))).toEqual(
      new Set(['2083.33']),
    );
    const disb = loan.events.find((e: any) => e.type === 'DISBURSEMENT');
    // 1% arrangement fee = 500 + 10% VAT = 50, deducted: cash 49,450.
    const lines = Object.fromEntries(
      disb.journal.lines.map((l: any) => [
        l.accountCode,
        Number(l.debit) || -Number(l.credit),
      ]),
    );
    expect(lines).toEqual({
      '1200': 50000,
      '1000': -49450,
      '4200': -500,
      '2200': -50,
    });
  });

  it('mortgage: two documents at approval, LTV with haircut, financed arrangement fee', async () => {
    const { productId } = await activeProduct(f, 'HOME_MORTGAGE', 'MTG-STD');
    const r = await originateAndDisburse(
      f,
      productId,
      {
        principal: '80000',
        numberOfInstalments: 240,
        disbursementDate: '2026-01-05',
      },
      {
        docs: ['ID_DOCUMENT', 'TITLE_DEED', 'VALUATION_REPORT'],
        collateral: {
          type: 'RESIDENTIAL_PROPERTY',
          description: 'Borey villa',
          marketValue: '150000',
          valuationDate: '2025-11-20',
          valuer: 'Valuer Co',
          method: 'MARKET',
        },
      },
    );
    loans.mortgage = r.loanId;
    const loan = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${r.loanId}`),
    );
    // 0.5% arrangement fee financed: booked principal 80,400; cash out 80,000.
    expect(loan.account.bookedPrincipal).toBe('80400');
    expect(loan.schedule.filter((l: any) => l.number > 0)).toHaveLength(240);
  });

  it('mortgage above the threshold needs two independent approvers', async () => {
    const versions = expectOk(await f.as('maker').get('/lending/products'));
    const product = versions.find((p: any) => p.code === 'MTG-STD');
    const { borrower } = require('./harness');
    const b = await borrower(f, f.t1, f.b1, { monthlyIncome: '9000' });
    const app = expectOk(
      await f.as('ro').post('/lending/applications', {
        borrowerId: b.id,
        productId: product.id,
        terms: {
          principal: '150000',
          numberOfInstalments: 240,
          disbursementDate: '2026-01-05',
        },
      }),
    );
    const { docs } = require('./setup');
    await docs(f, app.id, ['ID_DOCUMENT', 'TITLE_DEED', 'VALUATION_REPORT']);
    expectOk(
      await f.as('ro').post(`/lending/applications/${app.id}/collateral`, {
        type: 'RESIDENTIAL_PROPERTY',
        description: 'Villa',
        marketValue: '300000',
        valuationDate: '2025-12-01',
        valuer: 'V',
        method: 'MARKET',
      }),
    );
    expectOk(await f.as('ro').post(`/lending/applications/${app.id}/submit`));
    expectOk(
      await f.as('analyst').post(`/lending/applications/${app.id}/recommend`, {
        recommendation: 'APPROVE',
        rationale: 'Within policy',
      }),
    );
    const first = expectOk(
      await f.as('approver').post(`/lending/applications/${app.id}/approve`, {
        rationale: 'first',
      }),
    );
    expect(first).toMatchObject({ approvalsRecorded: 1, approvalsRequired: 2 });
    expect(first.application.status).toBe('RECOMMENDED');
    // The same approver cannot provide the second approval.
    const again = await f
      .as('approver')
      .post(`/lending/applications/${app.id}/approve`, { rationale: 'again' });
    expect(again.status).toBe(403);
    const second = expectOk(
      await f.as('approver2').post(`/lending/applications/${app.id}/approve`, {
        rationale: 'second',
      }),
    );
    expect(second.application.status).toBe('APPROVED');
  });

  it('seasonal crop loan: dated harvest instalments on a holiday calendar', async () => {
    const { productId } = await activeProduct(
      f,
      'AGRI_CROP_SEASONAL',
      'AG-CROP',
    );
    const r = await originateAndDisburse(
      f,
      productId,
      {
        principal: '2000',
        disbursementDate: '2026-01-05',
        explicitSchedule: [
          { dueDate: '2026-06-14', principal: '800' },
          { dueDate: '2026-11-16', principal: '1200' },
        ],
      },
      { borrowerOver: { occupation: 'Farmer' } },
    );
    loans.agri = r.loanId;
    const loan = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${r.loanId}`),
    );
    const lines = loan.schedule.filter((l: any) => l.number > 0);
    // 14 June 2026 is a Sunday → FOLLOWING moves the due date to Monday 15 June.
    expect(lines.map((l: any) => l.dueDate)).toEqual([
      '2026-06-15',
      '2026-11-16',
    ]);
    // Daily ACT/365 interest: 2,000 × 0.14 × 160/365 = 122.74 (period ends on the unadjusted 14 June).
    expect(lines[0].interestDue).toBe('122.74');
  });

  it('accrues daily, assesses delinquency, and posts repayments with allocation', async () => {
    // 2026-01-19: the micro loan's first fortnightly instalment falls due.
    expectOk(
      await f
        .as('finance')
        .post('/lending/ops/business-date', { businessDate: '2026-01-19' }),
    );
    const batch1 = expectOk(
      await f.as('finance').post('/lending/loans/batch/run'),
    );
    expect(batch1.failed).toEqual([]);
    let micro = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loans.micro}`),
    );
    const inst1 = micro.schedule.find((l: any) => l.number === 1);
    const due = Number(inst1.principalDue) + Number(inst1.interestDue) + 5.5;
    expect(Number(micro.account.interestReceivable)).toBeCloseTo(
      Number(inst1.interestDue),
      2,
    );
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${loans.micro}/repayments`,
          { amount: due.toFixed(2), externalReference: 'CASH-1' },
          key('micro'),
        ),
    );
    micro = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loans.micro}`),
    );
    expect(micro.schedule.find((l: any) => l.number === 0).status).toBe('PAID');
    expect(micro.schedule.find((l: any) => l.number === 1).status).toBe('PAID');
    expect(micro.account.feesReceivable).toBe('0');

    // 2026-02-05: monthly loans fall due; the SME loan is left unpaid to go delinquent.
    expectOk(
      await f
        .as('finance')
        .post('/lending/ops/business-date', { businessDate: '2026-02-05' }),
    );
    expectOk(await f.as('finance').post('/lending/loans/batch/run'));
    for (const name of ['personal', 'mortgage']) {
      const loan = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loans[name]}`),
      );
      const first = loan.schedule.find((l: any) => l.number === 1);
      expectOk(
        await f.as('opsMaker').post(
          `/lending/loans/${loans[name]}/repayments`,
          {
            amount: (
              Number(first.principalDue) + Number(first.interestDue)
            ).toFixed(2),
          },
          key(name),
        ),
      );
      const after = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loans[name]}`),
      );
      expect(after.schedule.find((l: any) => l.number === 1).status).toBe(
        'PAID',
      );
      expect(Number(after.account.principalOutstanding)).toBeCloseTo(
        Number(loan.account.principalOutstanding) - Number(first.principalDue),
        2,
      );
    }
    expectOk(
      await f
        .as('finance')
        .post('/lending/ops/business-date', { businessDate: '2026-02-20' }),
    );
    expectOk(await f.as('finance').post('/lending/loans/batch/run'));
    const sme = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loans.sme}`),
    );
    expect(sme.account.daysPastDue).toBe(15);
    expect(sme.account.delinquencyBucket).toBe('DPD_1_30');
    expect(sme.account.collectionStage).toBe('REMINDER');
    // SME template: 6% penalty interest on the overdue amount after 3 grace days.
    expect(Number(sme.account.penaltyReceivable)).toBeGreaterThan(0);
    await reconcile();
  });

  it('seasonal loan accepts a partial prepayment and recasts the harvest instalments pro-rata', async () => {
    const before = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loans.agri}`),
    );
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${loans.agri}/repayments`,
          { amount: '1000', prepaymentStrategy: 'RECAST' },
          key('agri'),
        ),
    );
    const after = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loans.agri}`),
    );
    expect(after.account.principalOutstanding).toBe('1000');
    expect(after.agreementVersion).toBe(before.agreementVersion + 1);
    const live = after.schedule.filter((l: any) => l.status === 'DUE');
    expect(live.map((l: any) => l.principalDue)).toEqual(['400', '600']);
    expect(
      after.schedule.filter((l: any) => l.status === 'SUPERSEDED'),
    ).toHaveLength(2);
    await reconcile();
  });

  it('every step is in the audit trail with configuration versions', async () => {
    const audit = expectOk(
      await f
        .as('admin1')
        .get(`/lending/ops/audit?resourceId=${loans.personal}`),
    );
    const actions = audit.data.map((e: any) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'loan.agreement.book',
        'loan.disbursement.prepare',
        'loan.disbursement.approve',
        'loan.disbursement.execute',
        'loan.repayment.post',
      ]),
    );
    const booking = audit.data.find(
      (e: any) => e.action === 'loan.agreement.book',
    );
    expect(booking.configVersions).toMatchObject({
      productVersion: 1,
      engine: expect.any(String),
    });
  });

  it('trial balance balances per currency and the journal is immutable at the database', async () => {
    const tb = expectOk(
      await f.as('finance').get('/lending/ops/trial-balance'),
    );
    expect(tb.every((c: any) => c.totals.balanced)).toBe(true);
    const line = await f.system(() =>
      f.prisma.lendingJournalLine.findFirst({ where: { tenantId: f.t1 } }),
    );
    await expect(
      f.system(() =>
        f.prisma.lendingJournalLine.update({
          where: { id: line.id },
          data: { debit: '1' },
        }),
      ),
    ).rejects.toThrow(/immutable/);
    const event = await f.system(() =>
      f.prisma.financialEvent.findFirst({ where: { tenantId: f.t1 } }),
    );
    await expect(
      f.system(() =>
        f.prisma.financialEvent.update({
          where: { id: event.id },
          data: { amount: '1' },
        }),
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      f.system(() =>
        f.prisma.financialEvent.delete({ where: { id: event.id } }),
      ),
    ).rejects.toThrow(/cannot be deleted/);
  });
});
