/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses and Prisma client. */
/**
 * The NBC interest-rate cap (Prakas B7-017-109) on the lending platform:
 * the cap in force is the lowest of the regulatory ceiling, the lender's cap
 * and the product's cap, and it is enforced on product versions, applications,
 * bookings, restructures and floating-rate resets (DECISIONS D-105…D-112).
 */
import { acceptKeyFacts, TEST_DB, expectOk } from './harness';
import { Journey, lending } from './e2e/journey';

const d = TEST_DB ? describe : describe.skip;

d('Interest-rate cap (integration)', () => {
  let j: Journey;

  beforeAll(async () => {
    j = await Journey.start({
      businessDate: '2026-01-05',
      flags: [
        'lending.pricing.floating_rate',
        'lending.restructure.rate_reduction',
      ],
    });
  }, 120_000);
  afterAll(async () => j?.close());

  /** The lender's own cap (Tenant.maxAnnualInterestRatePct), in percent. */
  const lenderCap = (pct: string) =>
    j.f.system(() =>
      j.f.prisma.tenant.update({
        where: { id: j.f.t1 },
        data: { maxAnnualInterestRatePct: pct },
      }),
    );

  /** Maker-checker change of the lender's `rateCap` settings. */
  async function rateCapSettings(rateCap: Record<string, boolean>) {
    const v = expectOk(
      await j.as('finance').post('/lending/ops/settings', {
        settings: { rateCap },
        reason: 'Compliance decision on the rate cap',
      }),
    );
    expectOk(
      await j
        .as('nobody')
        .post(`/lending/ops/settings/${v.id}/decision`, { approve: true }),
    );
  }

  async function draft(
    templateCode: string,
    code: string,
    mutate?: (c: any) => void,
  ) {
    const tpl = expectOk(
      await j.as('maker').get(`/lending/templates/${templateCode}`),
    );
    const config = structuredClone(tpl.defaultConfig);
    mutate?.(config);
    const created = expectOk(
      await j.as('maker').post('/lending/products', {
        templateCode,
        code,
        name: `${code} product`,
        config,
      }),
    );
    return {
      productId: created.product.id as string,
      versionId: created.version.id as string,
    };
  }
  const step = (who: string, versionId: string, action: string) =>
    j.as(who).post(`/lending/product-versions/${versionId}/${action}`);

  async function application(
    productId: string,
    terms: Record<string, unknown>,
  ) {
    const borrowerId = await j.onboard({ monthlyIncome: 5000 });
    const app = expectOk(
      await j
        .as('ro')
        .post('/lending/applications', { borrowerId, productId, terms }),
    );
    await j.uploadDocs(app.id, ['ID_DOCUMENT']);
    return app.id as string;
  }

  let personal: { productId: string; versionId: string };

  it('the product version shows the cap in force and the rates the version can charge', async () => {
    personal = await draft('PERSONAL_INSTALMENT', 'CAP-PL');
    const v = expectOk(
      await j
        .as('maker')
        .get(`/lending/product-versions/${personal.versionId}`),
    );
    expect(v.rateCap.cap).toMatchObject({
      annualRate: '0.18',
      source: 'REGULATOR',
    });
    expect(v.rateCap.policy).toEqual({
      includeFeesInEffectiveRate: true,
      penaltyRateMustFitCap: true,
    });
    expect(v.rateCap.findings).toEqual([]);
    expect(v.rateCap.worstComparableRate).toBe('0.18');
    // The 1% fee on the shortest, smallest loan at the highest rate: an
    // advisory here, refused at booking.
    expect(Number(v.rateCap.worstEffectiveRate)).toBeGreaterThan(0.18);
    expect(v.rateCap.advisories[0].code).toBe('EFFECTIVE_RATE');
  });

  it("a version above the lender's cap cannot be submitted, and a cap lowered after submission stops approval", async () => {
    await lenderCap('16');
    const refused = await step('maker', personal.versionId, 'submit');
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('RATE_CAP_EXCEEDED');
    expect(refused.body.message).toBe(
      "CAP-PL version 1 cannot be submitted: The maximum annual rate (18.00%) exceeds the lender's interest-rate cap of 16.00%.",
    );
    expect(refused.body.findings[0]).toMatchObject({
      code: 'CONTRACT_RATE',
      path: 'pricing.fixed.maxAnnualRate',
      rate: '0.18',
      cap: '0.16',
      capSource: 'TENANT',
    });
    await lenderCap('18');
    expectOk(await step('maker', personal.versionId, 'submit'));
    await lenderCap('17');
    const approval = await step('checker', personal.versionId, 'approve');
    expect(approval.status).toBe(400);
    expect(approval.body.message).toMatch(
      /cannot be approved: The maximum annual rate \(18\.00%\) exceeds the lender's interest-rate cap of 17\.00%/,
    );
    await lenderCap('18');
    expectOk(await step('checker', personal.versionId, 'approve'));
    expectOk(await step('checker', personal.versionId, 'activate'));
  });

  it("a floating product's own cap, and a flat rate's reducing-balance equivalent, must fit", async () => {
    const floating = await draft('PERSONAL_INSTALMENT', 'CAP-FL', (c) => {
      c.attributes.rateType = 'FLOATING';
      c.pricing.fixed = null;
      c.pricing.floating = {
        benchmarkCode: 'NBC_BASE',
        margin: '0.04',
        resetFrequency: 'QUARTERLY',
        floor: null,
        cap: '0.20',
      };
    });
    const fl = await step('maker', floating.versionId, 'submit');
    expect(fl.status).toBe(400);
    expect(fl.body.message).toMatch(
      /The floating rate's own cap \(20\.00%\) exceeds the regulatory ceiling \(REGULATORY_MAX_ANNUAL_RATE_PCT\) of 18\.00%/,
    );
    const flat = await draft('MURABAHA', 'CAP-MRB', (c) => {
      c.pricing.fixed.maxAnnualRate = '0.15';
    });
    const res = await step('maker', flat.versionId, 'submit');
    expect(res.status).toBe(400);
    expect(res.body.findings[0].code).toBe('FLAT_EQUIVALENT_RATE');
    expect(res.body.message).toMatch(
      /over 60 instalment\(s\), the reducing-balance equivalent of the maximum flat rate 15\.00% \(24\.\d\d%, computed\) exceeds/,
    );
  });

  it('penalty interest above the cap blocks a version until the lender decides it does not count', async () => {
    const p = await draft('SALARY_LOAN', 'CAP-PEN', (c) => {
      c.pricing.penalty.annualRate = '0.24';
    });
    const refused = await step('maker', p.versionId, 'submit');
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(
      /The penalty interest rate \(24\.00%\) exceeds the regulatory ceiling/,
    );
    await rateCapSettings({ penaltyRateMustFitCap: false });
    expectOk(await step('maker', p.versionId, 'submit'));
    await rateCapSettings({});
  });

  it('fees count toward the effective rate at submission unless the lender decides otherwise', async () => {
    const appId = await application(personal.productId, {
      principal: '1000',
      numberOfInstalments: 6,
      annualRate: '0.18',
      disbursementDate: '2026-01-05',
    });
    const refused = await j
      .as('ro')
      .post(`/lending/applications/${appId}/submit`);
    expect(refused.status).toBe(400);
    const issue = refused.body.issues.find((i: any) => i.code === 'RATE_CAP');
    expect(issue.message).toMatch(
      /^The effective annual rate including fees \(2\d\.\d\d%, computed\) exceeds the regulatory ceiling \(REGULATORY_MAX_ANNUAL_RATE_PCT\) of 18\.00%\.$/,
    );
    await rateCapSettings({ includeFeesInEffectiveRate: false });
    const ok = expectOk(
      await j.as('ro').post(`/lending/applications/${appId}/submit`),
    );
    // The approver sees the cap that applied and the computed rates.
    expect(ok.assessment.metrics).toMatchObject({
      rateCap: '0.18',
      rateCapSource: 'REGULATOR',
      rateCapComparableRate: '0.18',
    });
    expect(Number(ok.assessment.metrics.rateCapEffectiveRate)).toBeGreaterThan(
      0.2,
    );
    await rateCapSettings({});
  });

  it('booking is refused when the cap was lowered after approval', async () => {
    const appId = await application(personal.productId, {
      principal: '3000',
      numberOfInstalments: 12,
      disbursementDate: '2026-01-05',
    });
    expectOk(await j.as('ro').post(`/lending/applications/${appId}/submit`));
    expectOk(
      await j.as('analyst').post(`/lending/applications/${appId}/recommend`, {
        recommendation: 'APPROVE',
        rationale: 'Within policy',
      }),
    );
    for (const who of ['approver', 'approver2']) {
      const a = expectOk(
        await j.as(who).post(`/lending/applications/${appId}/approve`, {
          rationale: 'Approved',
        }),
      );
      if ((a.application ?? a).status === 'APPROVED') break;
    }
    await lenderCap('13');
    await acceptKeyFacts(j, appId);
    const refused = await j
      .as('opsMaker')
      .post(`/lending/applications/${appId}/book`, {});
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('RATE_CAP_EXCEEDED');
    expect(refused.body.message).toMatch(
      /^Application .+ cannot be booked: The annual interest rate \(14\.00%\) exceeds the lender's interest-rate cap of 13\.00%\./,
    );
    await lenderCap('18');
    const booked = expectOk(
      await j.as('opsMaker').post(`/lending/applications/${appId}/book`, {}),
    );
    const agreement = await j.f.system(() =>
      j.f.prisma.agreementVersion.findFirst({
        where: { tenantId: j.f.t1, agreement: { applicationId: appId } },
      }),
    );
    // The booking records the cap it was checked against.
    expect(agreement.calculation.rateCap).toMatchObject({
      cap: '0.18',
      capSource: 'REGULATOR',
      comparableRate: '0.14',
      basis: 'CONTRACT',
    });
    expect(booked.account.status).toBe('BOOKED');
  });

  describe('restructuring', () => {
    let loanId: string;
    let caseId: string;

    beforeAll(async () => {
      ({ loanId } = await j.originate(personal.productId, {
        principal: '6000',
        numberOfInstalments: 12,
        disbursementDate: '2026-01-05',
      }));
      const c = expectOk(
        await j.as('ro').post(`/lending/restructures/loans/${loanId}`, {
          hardshipCategory: 'ILLNESS',
          difficultyType: 'TEMPORARY',
          requestedRelief: { paymentBreakMonths: 2 },
          consentRecorded: true,
          consentReference: 'FORM-CAP-1',
        }),
      );
      caseId = c.id;
      expectOk(
        await j
          .as('analyst')
          .post(`/lending/restructures/${caseId}/assessments`, {
            inputs: {
              template: 'INDIVIDUAL',
              verifiedNetIncome: '2000',
              essentialLivingExpenses: '600',
              debts: [
                {
                  description: 'This loan',
                  monthlyPayment: '540',
                  isThisLoan: true,
                },
              ],
            },
            evidenceQuality: 'VERIFIED',
            assumptions: 'Payslips',
            verificationDate: '2026-01-05',
          }),
      );
    }, 120_000);

    it('a temporary rate above the cap is refused', async () => {
      const res = await j
        .as('analyst')
        .post(`/lending/restructures/${caseId}/simulate`, {
          effectiveDate: '2026-01-05',
          numberOfInstalments: 12,
          temporaryRate: { annualRate: '0.20', instalments: 3 },
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('RATE_CAP_EXCEEDED');
      expect(res.body.message).toBe(
        'This restructure cannot be proposed: The temporary restructure rate (20.00%) exceeds the regulatory ceiling (REGULATORY_MAX_ANNUAL_RATE_PCT) of 18.00%.',
      );
    });

    it('a proposal whose rate the cap no longer allows cannot be approved', async () => {
      const p = expectOk(
        await j
          .as('analyst')
          .post(`/lending/restructures/${caseId}/proposals`, {
            options: {
              effectiveDate: '2026-01-05',
              numberOfInstalments: 12,
              temporaryRate: { annualRate: '0.10', instalments: 3 },
            },
          }),
      );
      await lenderCap('12');
      const res = await j
        .as('approver2')
        .post(`/lending/restructures/${caseId}/proposals/${p.id}/approve`, {
          note: 'Temporary relief',
        });
      await lenderCap('18');
      expect(res.status).toBe(400);
      expect(res.body.message).toBe(
        "This restructure cannot be approved: The restructured annual rate (14.00%) exceeds the lender's interest-rate cap of 12.00%.",
      );
      expectOk(
        await j
          .as('approver2')
          .post(`/lending/restructures/${caseId}/proposals/${p.id}/approve`, {
            note: 'Temporary relief',
          }),
      );
    });
  });

  it('a floating reset above the cap is held at the cap, not refused', async () => {
    const observe = async (observationDate: string, rate: string) =>
      expectOk(
        await j.as('finance').post('/lending/ops/rates', {
          benchmarkCode: 'NBC_BASE',
          observationDate,
          rate,
          source: 'Central bank publication',
        }),
      );
    await observe('2026-01-01', '0.05');
    const fl = await draft('PERSONAL_INSTALMENT', 'CAP-FLT', (c) => {
      c.attributes.rateType = 'FLOATING';
      c.pricing.fixed = null;
      c.pricing.floating = {
        benchmarkCode: 'NBC_BASE',
        margin: '0.04',
        resetFrequency: 'QUARTERLY',
        floor: null,
        cap: null,
      };
    });
    for (const [who, action] of [
      ['maker', 'submit'],
      ['checker', 'approve'],
      ['checker', 'activate'],
    ])
      expectOk(await step(who, fl.versionId, action));
    const { loanId } = await j.originate(fl.productId, {
      principal: '6000',
      numberOfInstalments: 12,
      disbursementDate: '2026-01-05',
    });
    await j.moveTo('2026-04-07', { batch: false });
    await observe('2026-04-01', '0.20'); // 20% + 4% = 24%
    const applied = expectOk(
      await j.as('opsMaker').post(`/lending/loans/${loanId}/rate-resets`),
    );
    expect(applied.applied[0]).toMatchObject({
      bound: 'REGULATORY_CAP',
      indicatedRate: '0.24',
      newAnnualRate: '0.18',
    });
    const live = Journey.due(await j.loan(loanId));
    expect(live.length).toBeGreaterThan(0);
    for (const l of live)
      expect(new lending.D(l.annualRate).lte('0.18')).toBe(true);
  }, 120_000);
});
