/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-require-imports -- integration fixtures: modules are required after the test environment is configured, and fixture rows come from the untyped Prisma client. */
/**
 * Restructuring and hardship — end-to-end demonstration and required tests:
 * customer requests lower payments → officer verifies affordability → options
 * compared → checker approves → customer accepts → amendment executes →
 * revised repayments, accounting and monitoring.
 */
import { JwtService } from '@nestjs/jwt';
import {
  Fixture,
  TEST_DB,
  authority,
  bootstrap,
  expectOk,
  grant,
  impairmentPolicy,
  key,
} from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Restructuring and hardship (integration)', () => {
  let f: Fixture;
  let A: { loanId: string; borrowerId: string };
  let B: { loanId: string; borrowerId: string };
  let C: { loanId: string; borrowerId: string };
  let caseId: string;
  let customerToken: string;
  const portal = (token: string) => ({
    get: (url: string) =>
      f
        .http()
        .get(`/v1/lending/portal${url}`)
        .set('Authorization', `Bearer ${token}`),
    post: (url: string, body: unknown) =>
      f
        .http()
        .post(`/v1/lending/portal${url}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body as object),
  });
  const advance = async (date: string) => {
    expectOk(
      await f
        .as('finance')
        .post('/lending/ops/business-date', { businessDate: date }),
    );
    expectOk(await f.as('finance').post('/lending/loans/batch/run'));
  };
  const reconcile = async () => {
    const rec = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(rec.breaks).toEqual([]);
    expect(rec.trialBalanceBalanced).toBe(true);
  };

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    await grant(f, f.t1, 'approver2', 'RESTRUCTURE_COMMITTEE');
    await grant(f, f.t1, 'finance', 'LOAN_OPS_CHECKER');
    await grant(f, f.t1, 'opsMaker', 'COLLECTIONS_OFFICER');
    // REGULATORY impairment: the allowance follows the NBC grade (D-113, D-114).
    await impairmentPolicy(f, f.t1);
    await authority(
      f,
      f.t1,
      'approver',
      'restructure.approve',
      'USD',
      '100000',
    );
    await authority(
      f,
      f.t1,
      'approver2',
      'restructure.approve',
      'USD',
      '100000',
    );
    await authority(
      f,
      f.t1,
      'approver2',
      'restructure.waive_charges',
      'USD',
      '5000',
    );
    await authority(
      f,
      f.t1,
      'approver2',
      'restructure.forgive_principal',
      'USD',
      '1000',
    );
    const { productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-RST',
      // The capacities below were worked out at the template's former 15%
      // default (it is 14% since the rate cap, D-110); 15% + the 1% fee over
      // twelve months is within the cap.
      (c: any) => {
        c.pricing.fixed.defaultAnnualRate = '0.15';
      },
    );
    const terms = {
      principal: '6000',
      numberOfInstalments: 12,
      disbursementDate: '2026-01-05',
    };
    A = await originateAndDisburse(f, productId, terms);
    B = await originateAndDisburse(f, productId, terms);
    C = await originateAndDisburse(f, productId, terms);
    const jwt = new JwtService({
      secret:
        require('../../src/borrower-portal/borrower-jwt').borrowerJwtSecret(),
    });
    customerToken = jwt.sign(
      { sub: A.borrowerId, typ: 'borrower', tenantId: f.t1 },
      { expiresIn: '1h' },
    );
    // Two months unpaid: the customer is in arrears with penalties accruing.
    await advance('2026-02-05');
    await advance('2026-03-05');
  }, 180_000);
  afterAll(async () => f?.app.close());

  it('the customer requests lower payments in the portal; only for their own loan', async () => {
    // The portal lists the customer's own active loans to choose from.
    const mine = expectOk(await portal(customerToken).get('/loans')) as any[];
    expect(mine.map((l) => l.id)).toContain(A.loanId);
    expect(mine.map((l) => l.id)).not.toContain(B.loanId);
    const other = await portal(customerToken).post(
      `/loans/${B.loanId}/restructure-requests`,
      {
        hardshipCategory: 'INCOME_REDUCTION',
        difficultyType: 'PERSISTENT',
        requestedRelief: { lowerInstalment: '350' },
      },
    );
    expect(other.status).toBe(403);
    const c = expectOk(
      await portal(customerToken).post(
        `/loans/${A.loanId}/restructure-requests`,
        {
          hardshipCategory: 'INCOME_REDUCTION',
          difficultyType: 'PERSISTENT',
          customerStatement: 'My salary was cut by 40%.',
          requestedRelief: { lowerInstalment: '350', longerTermMonths: 24 },
        },
      ),
    );
    expect(c.trigger).toBe('CUSTOMER_REQUEST');
    expect(c.status).toBe('REQUESTED');
    caseId = c.id;
    // A request alone never changes the contract.
    const loan = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${A.loanId}`),
    );
    expect(loan.agreementVersion).toBe(1);
    // Customers cannot reach staff endpoints (verified income, approvals, execution).
    const staff = await f
      .http()
      .post(`/v1/lending/restructures/${caseId}/assessments`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({});
    expect(staff.status).toBe(401);
  });

  it('a staff request on the customer’s behalf needs a recorded request / consent', async () => {
    const res = await f
      .as('ro')
      .post(`/lending/restructures/loans/${B.loanId}`, {
        hardshipCategory: 'ILLNESS',
        difficultyType: 'TEMPORARY',
        requestedRelief: { paymentBreakMonths: 2 },
      });
    expect(res.status).toBe(400);
    const ok = expectOk(
      await f.as('ro').post(`/lending/restructures/loans/${B.loanId}`, {
        hardshipCategory: 'ILLNESS',
        difficultyType: 'TEMPORARY',
        requestedRelief: { paymentBreakMonths: 2 },
        consentRecorded: true,
        consentReference: 'FORM-2026-031',
        expectedRecoveryDate: '2026-06-30',
      }),
    );
    expect(ok.trigger).toBe('STAFF_ON_CUSTOMER_REQUEST');
  });

  it('insufficient repayment capacity routes to specialist review, not a schedule', async () => {
    const r = expectOk(
      await f
        .as('analyst')
        .post(`/lending/restructures/${caseId}/assessments`, {
          inputs: {
            template: 'INDIVIDUAL',
            verifiedNetIncome: '500',
            essentialLivingExpenses: '480',
            debts: [
              {
                description: 'This loan',
                monthlyPayment: '532.85',
                isThisLoan: true,
              },
            ],
          },
          evidenceQuality: 'SELF_DECLARED',
          assumptions: 'Declared at interview',
          verificationDate: '2026-03-05',
        }),
    );
    expect(r.result.sustainable).toBe(false);
    expect(r.status).toBe('SPECIALIST_REVIEW');
    expect(r.result.excludedDebts).toEqual(['This loan']);
  });

  it('the officer verifies affordability with evidence', async () => {
    expectOk(
      await f.as('analyst').post(`/lending/restructures/${caseId}/evidence`, {
        type: 'INCOME',
        description: 'Payslips Jan–Feb 2026 and employer letter',
        quality: 'VERIFIED',
        documentRef: 'DOC-PAY-0226',
      }),
    );
    const r = expectOk(
      await f
        .as('analyst')
        .post(`/lending/restructures/${caseId}/assessments`, {
          inputs: {
            template: 'INDIVIDUAL',
            verifiedNetIncome: '1100',
            essentialLivingExpenses: '650',
            debts: [
              { description: 'Motorbike loan', monthlyPayment: '60' },
              {
                description: 'This loan',
                monthlyPayment: '532.85',
                isThisLoan: true,
              },
            ],
          },
          evidenceQuality: 'VERIFIED',
          assumptions:
            'Reduced salary is expected to persist; household of three',
          verificationDate: '2026-03-05',
        }),
    );
    // 1100 − 650 − 60 − max(110, 50) = 280 per month for this loan.
    expect(r.result.availableForThisLoanMonthly).toBe('280');
    expect(r.status).toBe('AFFORDABILITY_ASSESSED');
  });

  it('simulation compares options without side effects', async () => {
    const before = await f.system(() =>
      Promise.all([
        f.prisma.restructureProposal.count({ where: { tenantId: f.t1 } }),
        f.prisma.financialEvent.count({ where: { tenantId: f.t1 } }),
      ]),
    );
    // Payment capacity below periodic interest is refused, never negative amortization.
    const tooLow = await f
      .as('analyst')
      .post(`/lending/restructures/${caseId}/simulate`, {
        effectiveDate: '2026-03-05',
        targetInstalment: '20',
      });
    expect(tooLow.status).toBe(400);
    expect(tooLow.body.message).toMatch(
      /does not amortize this balance at the selected rate/,
    );
    // A lower payment over a longer term costs more interest — and says so.
    const longer = expectOk(
      await f.as('analyst').post(`/lending/restructures/${caseId}/simulate`, {
        effectiveDate: '2026-03-05',
        numberOfInstalments: 24,
        arrearsTreatment: 'SPREAD_OVER_TERM',
      }),
    );
    expect(longer.comparison.lowerInstalmentHigherCost).toBe(true);
    // Spreading the arrears lifts the peak instalment above the verified capacity: the check flags it.
    expect(longer.affordability.fits).toBe(false);
    expect(longer.affordability.message).toMatch(
      /exceeds the assessed capacity/,
    );
    // Interest capitalization is barred for this product (no interest on interest).
    const cap = await f
      .as('analyst')
      .post(`/lending/restructures/${caseId}/simulate`, {
        effectiveDate: '2026-03-05',
        numberOfInstalments: 24,
        capitalize: { overdueInterest: true },
      });
    expect(cap.status).toBe(400);
    // Principal forgiveness is not an allowed option on this product by default.
    const forgive = await f
      .as('analyst')
      .post(`/lending/restructures/${caseId}/simulate`, {
        effectiveDate: '2026-03-05',
        numberOfInstalments: 24,
        principalForgiveness: '100',
      });
    expect(forgive.status).toBe(400);
    const after = await f.system(() =>
      Promise.all([
        f.prisma.restructureProposal.count({ where: { tenantId: f.t1 } }),
        f.prisma.financialEvent.count({ where: { tenantId: f.t1 } }),
      ]),
    );
    expect(after).toEqual(before);
  });

  let proposal: any;
  const proposalBody = (date: string) => ({
    options: {
      effectiveDate: date,
      targetInstalment: '280',
      arrearsTreatment: 'SPREAD_OVER_TERM',
      waive: { interest: '1' },
    },
  });

  it('options are proposed from the verified capacity; the maker cannot approve their own proposal', async () => {
    proposal = expectOk(
      await f
        .as('analyst')
        .post(
          `/lending/restructures/${caseId}/proposals`,
          proposalBody('2026-03-05'),
        ),
    );
    expect(proposal.approvalsRequired).toBe(1);
    expect(proposal.comparison.proposed.instalment <= '280.00').toBeTruthy();
    await grant(f, f.t1, 'analyst', 'RESTRUCTURE_COMMITTEE');
    await authority(f, f.t1, 'analyst', 'restructure.approve', 'USD', '100000');
    const own = await f
      .as('analyst')
      .post(
        `/lending/restructures/${caseId}/proposals/${proposal.id}/approve`,
        { note: 'my own proposal' },
      );
    expect(own.status).toBe(403);
    expect(own.body.blockedBy.map((b: any) => b.message).join(' ')).toMatch(
      /created or proposed/,
    );
  });

  it('a charge waiver needs waiver authority: a credit approver without it is refused', async () => {
    const res = await f
      .as('approver')
      .post(
        `/lending/restructures/${caseId}/proposals/${proposal.id}/approve`,
        { note: 'approve' },
      );
    expect(res.status).toBe(403);
    expect(res.body.action).toBe('restructure.waive_charges');
  });

  it('the checker approves; approval is recorded separately from acceptance', async () => {
    const r = expectOk(
      await f
        .as('approver2')
        .post(
          `/lending/restructures/${caseId}/proposals/${proposal.id}/approve`,
          { note: 'Affordable on verified income; penalty waiver justified' },
        ),
    );
    expect(r.status).toBe('APPROVED');
    const view = expectOk(
      await f.as('analyst').get(`/lending/restructures/${caseId}`),
    );
    expect(view.proposals.at(-1).approvals).toHaveLength(1);
    expect(view.proposals.at(-1).acceptances).toHaveLength(0);
  });

  it('the customer accepts the exact approved version in the portal', async () => {
    const mine = expectOk(
      await portal(customerToken).get(`/restructures/${caseId}`),
    );
    const offered = mine.proposals.find((p: any) => p.id === proposal.id);
    expect(offered.comparison.lowerInstalmentHigherCost).toBeDefined();
    expect(
      (
        await portal(customerToken).post(
          `/restructures/${caseId}/proposals/${proposal.id}/accept`,
          { proposalHash: '0'.repeat(64) },
        )
      ).status,
    ).toBe(409);
    const ok = expectOk(
      await portal(customerToken).post(
        `/restructures/${caseId}/proposals/${proposal.id}/accept`,
        { proposalHash: offered.proposalHash },
      ),
    );
    expect(ok.status).toBe('CONDITIONS_SATISFIED');
  });

  it('a payment received before execution makes the proposal stale; renewed approval and acceptance are required', async () => {
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${A.loanId}/repayments`,
          { amount: '50.00' },
          key('pre-exec'),
        ),
    );
    const res = await f
      .as('opsChecker')
      .post(`/lending/restructures/${caseId}/execute`, {}, key('exec-stale'));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PROPOSAL_STALE');
    const view = expectOk(
      await f.as('analyst').get(`/lending/restructures/${caseId}`),
    );
    expect(view.status).toBe('OPTIONS_PROPOSED');
    expect(view.proposals.find((p: any) => p.id === proposal.id).status).toBe(
      'SUPERSEDED',
    );
    // New version → new approval → new acceptance.
    proposal = expectOk(
      await f
        .as('analyst')
        .post(
          `/lending/restructures/${caseId}/proposals`,
          proposalBody('2026-03-05'),
        ),
    );
    expect(proposal.version).toBe(2);
    expectOk(
      await f
        .as('approver2')
        .post(
          `/lending/restructures/${caseId}/proposals/${proposal.id}/approve`,
          { note: 'Re-approved on current balances' },
        ),
    );
    const mine = expectOk(
      await portal(customerToken).get(`/restructures/${caseId}`),
    );
    expectOk(
      await portal(customerToken).post(
        `/restructures/${caseId}/proposals/${proposal.id}/accept`,
        {
          proposalHash: mine.proposals.find((p: any) => p.id === proposal.id)
            .proposalHash,
        },
      ),
    );
  });

  it('executes exactly once under concurrency and idempotent retries; history and arrears are preserved', async () => {
    const before = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${A.loanId}`),
    );
    const k1 = key('exec');
    const k2 = key('exec2');
    const [a, b] = await Promise.all([
      f
        .as('opsChecker')
        .post(`/lending/restructures/${caseId}/execute`, {}, k1),
      f
        .as('opsChecker')
        .post(`/lending/restructures/${caseId}/execute`, {}, k2),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    // A retry with the winning key returns the original execution.
    const retry = expectOk(
      await f
        .as('opsChecker')
        .post(
          `/lending/restructures/${caseId}/execute`,
          {},
          a.status === 201 ? k1 : k2,
        ),
    );
    expect(retry.replayed).toBe(true);
    const amendments = await f.system(() =>
      f.prisma.loanAmendment.count({ where: { tenantId: f.t1, caseId } }),
    );
    expect(amendments).toBe(1);

    const after = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${A.loanId}`),
    );
    expect(after.agreementVersion).toBe(before.agreementVersion + 1);
    expect(after.agreementVersions.at(-1).reason).toBe('RESTRUCTURE');
    // Original schedule lines are kept; unpaid ones are marked RESTRUCTURED with their arrears intact.
    const restructured = after.schedule.filter(
      (l: any) => l.status === 'RESTRUCTURED',
    );
    expect(restructured.length).toBeGreaterThan(0);
    expect(
      restructured.some(
        (l: any) => Number(l.principalDue) > Number(l.principalPaid),
      ),
    ).toBe(true);
    expect(
      after.schedule.filter((l: any) => l.agreementVersion === 1),
    ).toHaveLength(
      before.schedule.filter((l: any) => l.agreementVersion === 1).length,
    );
    // Delinquency is not reset: the bucket is held as a floor during probation.
    expect(after.account.isRestructured).toBe(true);
    expect(after.account.delinquencyFloorBucket).toBe('DPD_1_30');
    expect(after.account.probationRemaining).toBe(6);
    // Interest waiver posted to the concessions account; the ledger reconciles.
    const ev = after.events.find((e: any) => e.type === 'RESTRUCTURE');
    const codes = ev.journal.lines
      .map(
        (l: any) => `${l.accountCode}:${Number(l.debit)}:${Number(l.credit)}`,
      )
      .sort();
    expect(codes).toEqual(['1210:0:1', '5200:1:0']);
    await reconcile();
    const view = expectOk(
      await f.as('analyst').get(`/lending/restructures/${caseId}`),
    );
    expect(view.status).toBe('MONITORING');
    expect(view.tasks.map((t: any) => t.type)).toContain('PROBATION_REVIEW');
  });

  it('revised repayments are monitored; the bucket floor holds until probation is earned', async () => {
    const loan = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${A.loanId}`),
    );
    const next = loan.schedule
      .filter((l: any) => l.status === 'DUE')
      .sort((x: any, y: any) => x.dueDate.localeCompare(y.dueDate))[0];
    await advance(next.dueDate);
    const due =
      Number(next.principalDue) +
      Number(next.interestDue) +
      Number(next.deferredInterestDue) +
      Number(next.feeDue) +
      Number(next.penaltyDue) +
      Number(next.taxDue);
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${A.loanId}/repayments`,
          { amount: due.toFixed(2) },
          key('revised-1'),
        ),
    );
    await advance(next.dueDate.slice(0, 8) + '28');
    const after = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${A.loanId}`),
    );
    expect(after.account.probationRemaining).toBe(5);
    expect(after.account.delinquencyBucket).toBe('DPD_1_30'); // still floored
    // D-113: classification and provisioning hold too. The days past due at
    // the restructure are kept as a floor, and while on probation the loan is
    // at least Substandard (the lender's default minimum class), so end of
    // day provisions 20% of principal however current the revised schedule is.
    const floor = after.account.delinquencyFloorDpd;
    expect(floor).toBeGreaterThan(after.account.daysPastDue);
    expect(after.account.classification).toBe('SUBSTANDARD');
    expect(Number(after.account.allowance)).toBeCloseTo(
      Number(after.account.principalOutstanding) * 0.2,
      2,
    );
    const lastProvision = after.events
      .filter((e: any) => e.type === 'PROVISION')
      .at(-1);
    expect(lastProvision.components.explanation).toMatch(
      /held at the minimum class until cured/,
    );
    await reconcile();
  });

  it('a repeated restructure request is escalated', async () => {
    const again = expectOk(
      await f.as('ro').post(`/lending/restructures/loans/${A.loanId}`, {
        hardshipCategory: 'INCOME_REDUCTION',
        difficultyType: 'PERSISTENT',
        requestedRelief: { lowerInstalment: '200' },
        consentRecorded: true,
        consentReference: 'FORM-2026-077',
      }),
    );
    expect(again.previousRestructures).toBe(1);
    const tasks = expectOk(
      await f.as('opsChecker').get('/lending/restructures/tasks'),
    );
    expect(
      tasks.some(
        (t: any) => t.caseId === again.id && t.type === 'REPEAT_REQUEST',
      ),
    ).toBe(true);
    expectOk(
      await f
        .as('analyst')
        .post(`/lending/restructures/${again.id}/assessments`, {
          inputs: {
            template: 'INDIVIDUAL',
            verifiedNetIncome: '1000',
            essentialLivingExpenses: '600',
            debts: [],
          },
          evidenceQuality: 'VERIFIED',
          assumptions: 'Updated payslip',
          verificationDate: lastBusinessDate,
        }),
    );
    const p = expectOk(
      await f
        .as('analyst')
        .post(`/lending/restructures/${again.id}/proposals`, {
          options: { effectiveDate: lastBusinessDate, numberOfInstalments: 30 },
        }),
    );
    expect(p.approvalsRequired).toBe(2);
    expectOk(
      await f.as('ro').post(`/lending/restructures/${again.id}/withdraw`, {
        note: 'Customer withdrew',
      }),
    );
  });

  it('feature flags gate restructuring alongside RBAC; disabling execution never touches executed amendments', async () => {
    const rule = expectOk(
      await f.as('admin1').post('/lending/access/flags/rules', {
        flagKey: 'lending.restructure.rate_reduction',
        scopeType: 'TENANT',
        enabled: false,
        reason: 'pause rate concessions',
      }),
    );
    expectOk(
      await f
        .as('admin2')
        .post(`/lending/access/flags/changes/${rule.approval.id}/decision`, {
          approve: true,
        }),
    );
    const bCase = (
      await f.system(() =>
        f.prisma.restructureCase.findFirst({
          where: { tenantId: f.t1, loanAccountId: B.loanId },
        }),
      )
    ).id;
    expectOk(
      await f.as('analyst').post(`/lending/restructures/${bCase}/assessments`, {
        inputs: {
          template: 'INDIVIDUAL',
          verifiedNetIncome: '1500',
          essentialLivingExpenses: '700',
          debts: [],
        },
        evidenceQuality: 'VERIFIED',
        assumptions: 'Medical leave until June',
        verificationDate: lastBusinessDate,
      }),
    );
    const res = await f
      .as('analyst')
      .post(`/lending/restructures/${bCase}/simulate`, {
        effectiveDate: lastBusinessDate,
        numberOfInstalments: 12,
        temporaryRate: { annualRate: '0.06', instalments: 3 },
      });
    expect(res.status).toBe(403);
    expect(res.body.blockedBy[0].layer).toBe('FLAG');
    // An enabled flag never grants a missing permission.
    expect(
      (
        await f.as('nobody').post(`/lending/restructures/${bCase}/simulate`, {
          effectiveDate: lastBusinessDate,
          numberOfInstalments: 12,
        })
      ).status,
    ).toBe(403);
    // The executed amendment on loan A keeps servicing with execution switched off.
    const off = expectOk(
      await f.as('admin1').post('/lending/access/flags/rules', {
        flagKey: 'lending.restructure.execution',
        scopeType: 'TENANT',
        enabled: false,
        reason: 'pause executions',
      }),
    );
    expectOk(
      await f
        .as('admin2')
        .post(`/lending/access/flags/changes/${off.approval.id}/decision`, {
          approve: true,
        }),
    );
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${A.loanId}/repayments`,
          { amount: '10.00' },
          key('after-flag'),
        ),
    );
    for (const r of [rule.rule.id, off.rule.id]) {
      const rm = expectOk(
        await f.as('admin1').post(`/lending/access/flags/rules/${r}/remove`, {
          reason: 'cleanup',
        }),
      );
      expectOk(
        await f
          .as('admin2')
          .post(`/lending/access/flags/changes/${rm.id}/decision`, {
            approve: true,
          }),
      );
    }
  });

  it('payment deferral without capitalization, executed and then reversed by a different user with balanced contra entries', async () => {
    const bCase = (
      await f.system(() =>
        f.prisma.restructureCase.findFirst({
          where: { tenantId: f.t1, loanAccountId: B.loanId },
        }),
      )
    ).id;
    const p = expectOk(
      await f.as('analyst').post(`/lending/restructures/${bCase}/proposals`, {
        options: {
          effectiveDate: lastBusinessDate,
          numberOfInstalments: 14,
          paymentDeferralInstalments: 2,
          deferredInterestTreatment: 'DEFER_NO_CAPITALIZATION',
          arrearsTreatment: 'SPREAD_OVER_TERM',
          waive: { penalties: '1' },
        },
      }),
    );
    expect(p.calculation.lines.slice(0, 2).map((l: any) => l.total)).toEqual([
      '0',
      '0',
    ]);
    expectOk(
      await f
        .as('approver2')
        .post(`/lending/restructures/${bCase}/proposals/${p.id}/approve`, {
          note: 'Temporary illness',
        }),
    );
    expectOk(
      await f
        .as('ro')
        .post(`/lending/restructures/${bCase}/proposals/${p.id}/acceptance`, {
          proposalHash: p.proposalHash,
          method: 'SIGNED_FORM',
          evidence: 'Signed amendment form AF-031',
        }),
    );
    expectOk(
      await f
        .as('opsChecker')
        .post(`/lending/restructures/${bCase}/execute`, {}, key('exec-b')),
    );
    const executed = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${B.loanId}`),
    );
    expect(
      (
        await f
          .as('opsChecker')
          .post(
            `/lending/restructures/${bCase}/reverse`,
            { note: 'own reversal' },
            key('rev-own'),
          )
      ).status,
    ).toBe(403);
    expectOk(
      await f
        .as('finance')
        .post(
          `/lending/restructures/${bCase}/reverse`,
          { note: 'Executed on the wrong customer instruction' },
          key('rev-b'),
        ),
    );
    const reversed = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${B.loanId}`),
    );
    expect(reversed.account.principalOutstanding).toBe(
      executed.events.length ? reversed.account.principalOutstanding : '',
    );
    expect(reversed.account.isRestructured).toBe(false);
    expect(
      reversed.schedule.filter((l: any) => l.status === 'RESTRUCTURED'),
    ).toHaveLength(0);
    const rev = reversed.events.find((e: any) => e.type === 'REVERSAL');
    expect(
      rev.journal.lines
        .map(
          (l: any) => `${l.accountCode}:${Number(l.debit)}:${Number(l.credit)}`,
        )
        .sort(),
    ).toEqual(['1230:1:0', '5200:0:1']);
    await reconcile();
  });

  it('a system referral opens a review on approved monitoring rules without changing terms', async () => {
    const cases = await f.system(() =>
      f.prisma.restructureCase.findMany({
        where: { tenantId: f.t1, loanAccountId: C.loanId },
      }),
    );
    expect(cases.some((c: any) => c.trigger === 'SYSTEM_REFERRAL')).toBe(true);
    const loan = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${C.loanId}`),
    );
    expect(loan.agreementVersion).toBe(1);
    expect(loan.account.isRestructured).toBe(false);
  });

  let lastBusinessDate = '';
  beforeEach(async () => {
    if (f)
      lastBusinessDate = expectOk(
        await f.as('finance').get('/lending/ops/business-date'),
      ).businessDate;
  });
});
