/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: rows and responses are untyped here. */
/**
 * Consumer disclosure and affordability (D-123…D-127): the pre-contract key
 * facts statement in English and Khmer, the customer's acceptance before
 * booking (staff-recorded signed form or the borrower portal), a new
 * statement when the terms change, the cooling-off cancellation, and the
 * debt-service ratio across the borrower's obligations.
 */
import { createHmac } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { lending } from '@microloan/shared';
import {
  Fixture,
  TEST_DB,
  acceptKeyFacts,
  bootstrap,
  borrower,
  expectOk,
  grant,
  key,
} from './harness';
import {
  activeProduct,
  docs,
  originateAndDisburse,
  standardRoles,
} from './setup';

const d = TEST_DB ? describe : describe.skip;

const TERMS = {
  principal: '3000',
  numberOfInstalments: 6,
  disbursementDate: '2026-01-05',
};

d('Consumer disclosure and affordability (integration)', () => {
  let f: Fixture;
  let productId: string;

  const borrowerToken = (borrowerId: string) =>
    new JwtService({
      secret: createHmac('sha256', process.env.JWT_ACCESS_SECRET!)
        .update('borrower-portal-v1')
        .digest('hex'),
    }).sign(
      { sub: borrowerId, typ: 'borrower', tenantId: f.t1 },
      { expiresIn: '1h' },
    );
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

  /** Application → submit → recommend → approve; returns the approved application. */
  const approved = async (
    over: { borrowerId?: string; product?: string; body?: object } = {},
  ) => {
    const b = over.borrowerId
      ? { id: over.borrowerId }
      : await borrower(f, f.t1, f.b1);
    const app = expectOk(
      await f.as('ro').post('/lending/applications', {
        borrowerId: b.id,
        productId: over.product ?? productId,
        terms: TERMS,
        ...(over.body ?? {}),
      }),
    );
    await docs(f, app.id, ['ID_DOCUMENT']);
    expectOk(await f.as('ro').post(`/lending/applications/${app.id}/submit`));
    expectOk(
      await f.as('analyst').post(`/lending/applications/${app.id}/recommend`, {
        recommendation: 'APPROVE',
        rationale: 'Affordable',
      }),
    );
    const res = expectOk(
      await f.as('approver').post(`/lending/applications/${app.id}/approve`, {
        rationale: 'Approved within authority',
      }),
    );
    expect(res.application.status).toBe('APPROVED');
    return { app, borrowerId: b.id as string, issued: res.keyFacts };
  };

  const settings = async (patch: Record<string, unknown>) => {
    const v = expectOk(
      await f.as('finance').post('/lending/ops/settings', {
        settings: patch,
        reason: 'consumer disclosure test',
      }),
    );
    expectOk(
      await f
        .as('nobody')
        .post(`/lending/ops/settings/${v.id}/decision`, { approve: true }),
    );
  };

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    await grant(f, f.t1, 'nobody', 'RISK_COMPLIANCE');
    ({ productId } = await activeProduct(f, 'PERSONAL_INSTALMENT', 'KFS-PL'));
    // A repayment code in force, so the statement says how to repay (D-160).
    await f.system(() =>
      f.prisma.khqrCode.create({
        data: {
          tenantId: f.t1,
          currency: 'USD',
          source: 'GENERATED',
          bakongAccountId: 'kfs_lender@devb',
          merchantName: 'Test Lender',
          merchantCity: 'Phnom Penh',
          payload: lending.buildStaticKhqrPayload(
            {
              bakongAccountId: 'kfs_lender@devb',
              merchantName: 'Test Lender',
              merchantCity: 'Phnom Penh',
            },
            'USD',
          ),
          status: 'ACTIVE',
          makerId: f.users.finance.id,
          checkerId: f.users.approver.id,
          decidedAt: new Date(),
        },
      }),
    );
    await settings({
      consumerProtection: {
        lenderLegalName: 'Test Lender Plc.',
        licenceNumber: 'MFI-0042',
        complaints: { phone: '+855 23 000 000', email: 'care@lender.test' },
      },
    });
  }, 120_000);
  afterAll(async () => f?.app.close());

  it('approval issues the statement in English and Khmer; booking is refused until the customer accepts it', async () => {
    const { app, issued } = await approved();
    expect(issued).toMatchObject({ version: 1, status: 'ISSUED' });
    expect(Object.keys(issued.documentIds).sort()).toEqual(['en', 'km']);
    // Percentages with two decimals; the totals reconcile.
    const k = issued.facts;
    expect(k.rates.nominalAnnualRatePct).toMatch(/^\d+\.\d{2}$/);
    expect(k.rates.effectiveAnnualRatePct).toMatch(/^\d+\.\d{2}$/);
    expect(Number(k.rates.effectiveAnnualRatePct)).toBeGreaterThan(
      Number(k.rates.nominalAnnualRatePct),
    );
    expect(Number(k.totals.costOfCredit)).toBeCloseTo(
      Number(k.totals.repayable) - Number(k.netDisbursement),
      4,
    );
    expect(Number(k.totals.costOfCredit)).toBeCloseTo(
      Number(k.totals.interest) + Number(k.totals.fees),
      4,
    );
    expect(issued.lender).toEqual({
      name: 'Test Lender Plc.',
      licenceNumber: 'MFI-0042',
    });
    expect(issued.coolingOff.days).toBe(7);
    expect(issued.warnings).toEqual([]);

    // The capability map explains the block; the server refuses it.
    const caps = expectOk(
      await f
        .as('opsMaker')
        .get(`/lending/access/capabilities/APPLICATION/${app.id}`),
    );
    expect(caps['loan.agreement.book'].allowed).toBe(false);
    expect(caps['loan.agreement.book'].blockedBy[0].layer).toBe('DISCLOSURE');
    const refused = await f
      .as('opsMaker')
      .post(`/lending/applications/${app.id}/book`, {});
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('KEY_FACTS_NOT_ACCEPTED');

    // A signed form is a document the customer signed, in their own library:
    // not an unknown id, and not the generated statement itself.
    for (const documentId of [
      '00000000-0000-4000-8000-000000000000',
      issued.documentIds.en,
    ]) {
      const wrong = await f
        .as('ro')
        .post(
          `/lending/applications/${app.id}/key-facts/${issued.id}/acceptance`,
          { method: 'SIGNED_FORM', documentId },
        );
      expect(wrong.status).toBe(400);
    }

    // The Khmer statement is a real Khmer document.
    const km = expectOk(
      await f
        .as('ro')
        .post(`/lending/documents/${issued.documentIds.km}/link`, {}),
    );
    const html = await f.http().get(`/v1${km.url}`);
    expect(html.text).toContain('lang="km"');
    expect(html.text).toContain('អត្រាការប្រាក់ប្រសិទ្ធភាពប្រចាំឆ្នាំ');
    expect(html.text).toContain(`${k.rates.effectiveAnnualRatePct}%`);
    // How to repay: the lender's static KHQR code (D-160).
    expect(html.text).toContain('របៀបសងប្រាក់');
    expect(html.text).toContain('kfs_lender@devb');
    expect(html.text).toContain('data:image/png;base64,');

    const accepted = await acceptKeyFacts(f, app.id);
    expect(accepted).toMatchObject({
      status: 'ACCEPTED',
      acceptanceMethod: 'SIGNED_FORM',
      acceptedByType: 'STAFF_ON_BEHALF',
    });
    const booked = expectOk(
      await f.as('opsMaker').post(`/lending/applications/${app.id}/book`, {}),
    );
    const view = expectOk(
      await f.as('ro').get(`/lending/applications/${app.id}/key-facts`),
    );
    expect(view.statements[0]).toMatchObject({
      status: 'BOOKED',
      loanAccountId: booked.account.id,
    });
  });

  it('changed terms need a new statement and a new acceptance', async () => {
    const { app } = await approved();
    const v1 = await acceptKeyFacts(f, app.id);
    // The approved terms are amended (a later approval at another rate).
    await f.system(async () => {
      const last = await f.prisma.creditDecision.findFirst({
        where: { applicationId: app.id, type: 'APPROVE' },
        orderBy: { createdAt: 'desc' },
      });
      await f.prisma.creditDecision.create({
        data: {
          tenantId: f.t1,
          applicationId: app.id,
          type: 'APPROVE',
          decidedBy: f.users.approver2.id,
          amount: last.amount,
          currency: last.currency,
          terms: { ...last.terms, annualRate: '0.12' },
          rationale: 'Rate reduced on review',
          assessment: {},
          policyDecision: {},
        },
      });
    });
    const stale = await f
      .as('opsMaker')
      .post(`/lending/applications/${app.id}/book`, {});
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('KEY_FACTS_STALE');
    const v2 = expectOk(
      await f.as('ro').post(`/lending/applications/${app.id}/key-facts`),
    );
    expect(v2.version).toBe(2);
    expect(v2.termsHash).not.toBe(v1.termsHash);
    expect(v2.facts.rates.nominalAnnualRatePct).toBe('12.00');
    // Generating again for the same terms returns the statement in force.
    const again = expectOk(
      await f.as('ro').post(`/lending/applications/${app.id}/key-facts`),
    );
    expect(again.id).toBe(v2.id);
    const list = expectOk(
      await f.as('ro').get(`/lending/applications/${app.id}/key-facts`),
    );
    expect(list.statements.map((s: any) => s.status)).toEqual([
      'ISSUED',
      'SUPERSEDED',
    ]);
    await acceptKeyFacts(f, app.id);
    expectOk(
      await f.as('opsMaker').post(`/lending/applications/${app.id}/book`, {}),
    );
  });

  it('the customer accepts in the borrower portal, only their own statement and only the version shown', async () => {
    const { app, borrowerId, issued } = await approved();
    const other = await borrower(f, f.t1, f.b1);
    const mine = expectOk(
      await portal(borrowerToken(borrowerId)).get('/key-facts'),
    ) as any[];
    expect(mine.map((s) => s.id)).toEqual([issued.id]);
    expect(mine[0].applicationReference).toBe(app.reference);
    expect(
      expectOk(await portal(borrowerToken(other.id)).get('/key-facts')),
    ).toEqual([]);
    const notMine = await portal(borrowerToken(other.id)).post(
      `/key-facts/${issued.id}/accept`,
      { termsHash: issued.termsHash },
    );
    expect(notMine.status).toBe(403);
    const changed = await portal(borrowerToken(borrowerId)).post(
      `/key-facts/${issued.id}/accept`,
      { termsHash: 'f'.repeat(64) },
    );
    expect(changed.status).toBe(409);
    const ok = expectOk(
      await portal(borrowerToken(borrowerId)).post(
        `/key-facts/${issued.id}/accept`,
        { termsHash: issued.termsHash },
      ),
    );
    expect(ok).toMatchObject({
      status: 'ACCEPTED',
      acceptanceMethod: 'PORTAL',
      acceptedByType: 'CUSTOMER',
    });
    expectOk(
      await f.as('opsMaker').post(`/lending/applications/${app.id}/book`, {}),
    );
  });

  it('the debt-service ratio counts the borrower’s other loans and declared debts elsewhere', async () => {
    const first = await originateAndDisburse(f, productId, TERMS);
    const app = expectOk(
      await f.as('ro').post('/lending/applications', {
        borrowerId: first.borrowerId,
        productId,
        terms: TERMS,
        declaredExternalMonthlyPayments: '200',
        declaredOtherLenders: 1,
      }),
    );
    expect(app.declaredOtherLenders).toBe(1);
    await docs(f, app.id, ['ID_DOCUMENT']);
    const sub = expectOk(
      await f.as('ro').post(`/lending/applications/${app.id}/submit`),
    );
    const m = sub.assessment.metrics;
    expect(m.otherLoans).toBe(1);
    expect(Number(m.otherLoansMonthlyPayment)).toBeGreaterThan(400);
    expect(Number(m.declaredExternalMonthlyPayments)).toBe(200);
    const income = 3000;
    const expected =
      (Number(m.averageMonthlyPayment) +
        Number(m.otherLoansMonthlyPayment) +
        200) /
      income;
    expect(Number(m.debtServiceRatio)).toBeCloseTo(expected, 2);
    expect(Number(m.debtServiceRatio)).toBeGreaterThan(
      Number(m.loanDebtServiceRatio),
    );
  });

  it('the scoring strategy refers an application whose income is unknown when it tests the debt-service ratio', async () => {
    const { productId: scored } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'KFS-SCORED',
      (c) => {
        c.eligibility.minMonthlyIncome = null;
        c.eligibility.maxDebtServiceRatio = null;
        c.scoring = {
          ...(c.scoring ?? {}),
          strategy: {
            ...(c.scoring?.strategy ?? {}),
            defaultOutcome: 'AUTO_APPROVE',
            gradeRules: [],
            knockouts: { maxDebtServiceRatio: '0.6' },
          },
        };
      },
    );
    const outcome = async (over: Record<string, unknown>) => {
      const b = await borrower(f, f.t1, f.b1, over);
      const app = expectOk(
        await f.as('ro').post('/lending/applications', {
          borrowerId: b.id,
          productId: scored,
          terms: TERMS,
        }),
      );
      await docs(f, app.id, ['ID_DOCUMENT']);
      const sub = expectOk(
        await f.as('ro').post(`/lending/applications/${app.id}/submit`),
      );
      return sub.assessment.metrics;
    };
    const known = await outcome({});
    expect(known.scoreOutcome).toBe('AUTO_APPROVE');
    const unknown = await outcome({ monthlyIncome: null });
    expect(unknown.debtServiceRatio).toBeUndefined();
    expect(unknown.scoreOutcome).toBe('REFER');
  });

  it('cooling-off: cancelled within the window by repaying the cash received, under maker-checker', async () => {
    const { loanId } = await originateAndDisburse(f, productId, TERMS);
    const status = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loanId}/cooling-off`),
    );
    expect(status).toMatchObject({
      days: 7,
      open: true,
      windowEndsOn: '2026-01-12',
    });
    // The lender's 1% processing fee (30.00) is refunded: the customer
    // repays the 2,970.00 they received, with no interest on the same day.
    expect(status.quote.coolingOff.feesRefunded).toBe('30');
    expect(status.quote.payable).toBe('2970');
    const req = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/loans/${loanId}/cooling-off-cancellations`, {
          reason: 'Customer changed their mind',
          customerReference: 'Letter 2026-01-05',
        }),
    );
    const taskId = req.task.id;
    // Not executable before approval; the maker cannot approve.
    const early = await f
      .as('opsMaker')
      .post(
        `/lending/loans/${loanId}/cooling-off-cancellations/${taskId}/execute`,
        { amount: '2970' },
        key('co'),
      );
    expect(early.status).toBe(409);
    expect(
      (
        await f
          .as('opsMaker')
          .post(
            `/lending/loans/${loanId}/cooling-off-cancellations/${taskId}/decision`,
            { approve: true },
          )
      ).status,
    ).toBe(403);
    expectOk(
      await f
        .as('opsChecker')
        .post(
          `/lending/loans/${loanId}/cooling-off-cancellations/${taskId}/decision`,
          { approve: true },
        ),
    );
    const wrongAmount = await f
      .as('opsMaker')
      .post(
        `/lending/loans/${loanId}/cooling-off-cancellations/${taskId}/execute`,
        { amount: '3000' },
        key('co'),
      );
    expect(wrongAmount.status).toBe(400);
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${loanId}/cooling-off-cancellations/${taskId}/execute`,
          { amount: '2970', externalReference: 'CASH-RETURN-1' },
          key('co'),
        ),
    );
    const loan = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loanId}`),
    );
    expect((loan.account ?? loan).status).toBe('CLOSED');
    const rec = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(rec.trialBalanceBalanced).toBe(true);
  });

  it('the lender-count rule refuses a borrower with too many lenders, or none declared', async () => {
    await settings({ affordability: { maxLendersPerBorrower: 2 } });
    try {
      const submit = async (declared?: number) => {
        const b = await borrower(f, f.t1, f.b1);
        const app = expectOk(
          await f.as('ro').post('/lending/applications', {
            borrowerId: b.id,
            productId,
            terms: TERMS,
            ...(declared === undefined
              ? {}
              : { declaredOtherLenders: declared }),
          }),
        );
        await docs(f, app.id, ['ID_DOCUMENT']);
        return f.as('ro').post(`/lending/applications/${app.id}/submit`);
      };
      const tooMany = await submit(2);
      expect(tooMany.status).toBe(400);
      expect(tooMany.body.issues.map((i: any) => i.code)).toContain('LENDERS');
      const undeclared = await submit();
      expect(undeclared.status).toBe(400);
      expect(undeclared.body.issues.map((i: any) => i.code)).toContain(
        'LENDERS',
      );
      const ok = expectOk(await submit(1));
      expect(ok.assessment.metrics.lenderCount).toBe(2);
    } finally {
      await settings({ affordability: { maxLendersPerBorrower: null } });
    }
  });

  it('cooling-off: refused once the window has passed', async () => {
    const { loanId } = await originateAndDisburse(f, productId, TERMS);
    expectOk(
      await f
        .as('finance')
        .post('/lending/ops/business-date', { businessDate: '2026-01-13' }),
    );
    const status = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loanId}/cooling-off`),
    );
    expect(status.open).toBe(false);
    const late = await f
      .as('opsMaker')
      .post(`/lending/loans/${loanId}/cooling-off-cancellations`, {
        reason: 'Too late',
      });
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('COOLING_OFF_EXPIRED');
  });
});
