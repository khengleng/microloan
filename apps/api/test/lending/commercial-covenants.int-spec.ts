/**
 * Commercial lending: origination credit score (OPS-2) and debt-service
 * coverage (LT-16), then DSCR, LTV and financial-statement covenants tested
 * over the life of the loan, with breach, cure and waiver.
 */
import {
  Fixture,
  TEST_DB,
  bootstrap,
  borrower,
  expectOk,
  grant,
} from './harness';
import {
  activeProduct,
  docs,
  originateAndDisburse,
  standardRoles,
} from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Credit score, DSCR and covenants (integration)', () => {
  let f: Fixture;
  let productId: string;
  let securedProduct: string;
  let loanId: string;
  let securedLoan: string;
  const terms = {
    principal: '50000',
    numberOfInstalments: 24,
    disbursementDate: '2026-01-05',
  };

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    ({ productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'CRE-DSCR',
      (c) => {
        c.pricing.fees = [];
        c.limits.maxAmount = '200000';
        c.eligibility.minDscr = '1.25';
        c.eligibility.minCreditScore = 500;
      },
    ));
    ({ productId: securedProduct } = await activeProduct(
      f,
      'HOME_EQUITY_TERM',
      'CRE-LTV',
      (c) => {
        c.pricing.fees = [];
        c.security.maxLtv = '0.80';
      },
    ));
  }, 90_000);
  afterAll(async () => f?.app.close());

  const apply = async (financials?: Record<string, string>) => {
    const b = await borrower(f, f.t1, f.b1, { monthlyIncome: '20000' });
    const app = expectOk(
      await f.as('ro').post('/lending/applications', {
        borrowerId: b.id,
        productId,
        terms: { ...terms, ...(financials ? { financials } : {}) },
      }),
    );
    await docs(f, app.id, ['ID_DOCUMENT']);
    return {
      app,
      submitted: expectOk(
        await f.as('ro').post(`/lending/applications/${app.id}/submit`),
      ),
    };
  };

  it('OPS-2: the assessment carries an explained credit score; LT-16: DSCR below the minimum blocks approval', async () => {
    const { app, submitted } = await apply({
      annualNetOperatingIncome: '30000',
    });
    const m = submitted.assessment.metrics;
    expect(m.creditScore).toBeGreaterThanOrEqual(300);
    expect(['A', 'B', 'C', 'D']).toContain(m.creditGrade);
    expect(m.creditScoreFactors).toMatch(/AFFORDABILITY/);
    expect(Number(m.debtServiceCoverage)).toBeLessThan(1.25);
    expectOk(
      await f.as('analyst').post(`/lending/applications/${app.id}/recommend`, {
        recommendation: 'APPROVE',
        rationale: 'Looks fine',
      }),
    );
    const res = await f
      .as('approver')
      .post(`/lending/applications/${app.id}/approve`, { rationale: 'Within authority' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/DSCR/);
  });

  it('LT-16: with enough income the loan is approved and booked', async () => {
    loanId = (
      await originateAndDisburse(
        f,
        productId,
        { ...terms, financials: { annualNetOperatingIncome: '60000' } },
        { borrowerOver: { monthlyIncome: '20000' } },
      )
    ).loanId;
    expect(loanId).toBeTruthy();
  });

  it('LT-16: a DSCR covenant breaches, is cured by a later test, and a second breach is waived by another person', async () => {
    const cov = expectOk(
      await f.as('opsMaker').post(`/lending/loans/${loanId}/covenants`, {
        type: 'MIN_DSCR',
        threshold: '1.25',
        frequencyMonths: 12,
        description: 'Annual DSCR ≥ 1.25x',
      }),
    );
    expect(cov.status).toBe('ACTIVE');
    const t = (body: Record<string, unknown>) =>
      f
        .as('opsMaker')
        .post(`/lending/loans/${loanId}/covenants/${cov.id}/tests`, {
          periodEnd: '2026-01-05',
          ...body,
        });
    const breach = expectOk(
      await t({
        annualNetOperatingIncome: '20000',
        evidence: 'FY2025 accounts',
      }),
    );
    expect(breach.status).toBe('BREACHED');
    expect(Number(breach.tests[0].value)).toBeLessThan(1.25);
    const cured = expectOk(await t({ annualNetOperatingIncome: '80000' }));
    expect(cured.status).toBe('ACTIVE');
    expectOk(await t({ annualNetOperatingIncome: '10000' }));
    expect(
      (
        await f
          .as('opsMaker')
          .post(`/lending/loans/${loanId}/covenants/${cov.id}/waive`, {
            reason: 'One-off',
          })
      ).status,
    ).toBe(403);
    expectOk(
      await f
        .as('opsChecker')
        .post(`/lending/loans/${loanId}/covenants/${cov.id}/waive`, {
          reason: 'One-off loss from flood; recovery plan agreed',
        }),
    );
    const list = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loanId}/covenants`),
    );
    expect(list[0].status).toBe('WAIVED');
    expect(list[0].tests[0].kind).toBe('WAIVER');
  });

  it('LT-16: whoever recorded the breaching test cannot waive it, even holding the waiver permission', async () => {
    // opsChecker holds both the testing and the waiving permission here.
    await grant(f, f.t1, 'opsChecker', 'LOAN_OPS_MAKER');
    await grant(f, f.t1, 'approver2', 'LOAN_OPS_CHECKER');
    const cov = expectOk(
      await f.as('opsMaker').post(`/lending/loans/${loanId}/covenants`, {
        type: 'MIN_DSCR',
        threshold: '1.25',
        frequencyMonths: 12,
        description: 'Annual DSCR ≥ 1.25x (maker-checker)',
      }),
    );
    const breach = expectOk(
      await f
        .as('opsChecker')
        .post(`/lending/loans/${loanId}/covenants/${cov.id}/tests`, {
          periodEnd: '2026-01-05',
          annualNetOperatingIncome: '10000',
          evidence: 'FY2025 accounts',
        }),
    );
    expect(breach.status).toBe('BREACHED');
    const own = await f
      .as('opsChecker')
      .post(`/lending/loans/${loanId}/covenants/${cov.id}/waive`, {
        reason: 'Waiving my own test',
      });
    expect(own.status).toBe(403);
    expect(own.body.blockedBy.map((b: any) => b.message).join(' ')).toMatch(
      /created or proposed/,
    );
    expectOk(
      await f
        .as('approver2')
        .post(`/lending/loans/${loanId}/covenants/${cov.id}/waive`, {
          reason: 'Independent waiver after review',
        }),
    );
  });

  it('LT-16: a financial-statements covenant needs no threshold and fails when nothing arrives', async () => {
    expect(
      (
        await f.as('opsMaker').post(`/lending/loans/${loanId}/covenants`, {
          type: 'FINANCIAL_STATEMENTS',
          threshold: '1',
          frequencyMonths: 6,
        })
      ).status,
    ).toBe(400);
    const cov = expectOk(
      await f.as('opsMaker').post(`/lending/loans/${loanId}/covenants`, {
        type: 'FINANCIAL_STATEMENTS',
        frequencyMonths: 6,
      }),
    );
    const r = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/loans/${loanId}/covenants/${cov.id}/tests`, {
          periodEnd: '2026-01-05',
          statementsReceived: false,
        }),
    );
    expect(r.status).toBe('BREACHED');
  });

  it('LT-16: an LTV covenant is tested against the pledged collateral', async () => {
    securedLoan = (
      await originateAndDisburse(
        f,
        securedProduct,
        {
          principal: '60000',
          numberOfInstalments: 60,
          disbursementDate: '2026-01-05',
        },
        {
          borrowerOver: { monthlyIncome: '20000' },
          collateral: {
            type: 'RESIDENTIAL_PROPERTY',
            description: 'Shophouse',
            marketValue: '100000',
            valuationDate: '2025-12-20',
            valuer: 'Valuer Co',
            method: 'MARKET',
          },
        },
      )
    ).loanId;
    const cov = expectOk(
      await f.as('opsMaker').post(`/lending/loans/${securedLoan}/covenants`, {
        type: 'MAX_LTV',
        threshold: '0.70',
        frequencyMonths: 12,
      }),
    );
    const r = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/loans/${securedLoan}/covenants/${cov.id}/tests`, {
          periodEnd: '2026-01-05',
        }),
    );
    expect(Number(r.tests[0].value)).toBeGreaterThan(0.5);
    expect(r.status).toBe(
      Number(r.tests[0].value) <= 0.7 ? 'ACTIVE' : 'BREACHED',
    );
  });
});
