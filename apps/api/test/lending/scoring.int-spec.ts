/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: rows come from the untyped API and Prisma client. */
/**
 * Configurable scorecards, decision strategy, champion/challenger and
 * monitoring (DECISIONS D-075…D-077, D-080).
 */
import { lending } from '@microloan/shared';
import {
  Fixture,
  TEST_DB,
  bootstrap,
  borrower,
  expectOk,
  grant,
} from './harness';
import { activeProduct, docs, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

const terms = {
  principal: '1000',
  numberOfInstalments: 12,
  disbursementDate: '2026-01-05',
};

d('Scorecards and decision strategy (integration)', () => {
  let f: Fixture;
  let plain: string;
  let challenged: string;
  let thin: string;
  let strict: string;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    // The risk reviewer approves scorecards (scorecard.approve).
    await grant(f, f.t1, 'checker', 'RISK_COMPLIANCE');
    const noFees = (c: any) => {
      c.pricing.fees = [];
    };
    ({ productId: plain } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'SC-PLAIN',
      noFees,
    ));
    ({ productId: challenged } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'SC-CHAL',
      (c) => {
        noFees(c);
        // The champion scores ~690; the thin-file challenger ~620, below the cut-off.
        c.scoring = {
          championCode: 'STANDARD_RETAIL',
          challengerCode: 'THIN_FILE',
          strategy: { declineBelowScore: 650 },
        };
      },
    ));
    ({ productId: thin } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'SC-THIN',
      (c) => {
        noFees(c);
        c.scoring = {
          thinFile: {
            enabled: true,
            scorecardCode: 'THIN_FILE',
            maxInternalHistoryMonths: 6,
          },
        };
      },
    ));
    ({ productId: strict } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'SC-STRICT',
      (c) => {
        noFees(c);
        c.eligibility.maxAgeAtMaturityYears = null;
        c.scoring = {
          strategy: {
            gradeRules: [
              {
                grade: 'A',
                outcome: 'AUTO_APPROVE',
                maxAmount: '500',
                rateAddOnBps: 0,
              },
              {
                grade: 'B',
                outcome: 'AUTO_APPROVE',
                maxAmount: '500',
                rateAddOnBps: 200,
              },
            ],
            knockouts: { writtenOff: true, maxAgeYears: 60 },
          },
        };
      },
    ));
  }, 120_000);
  afterAll(async () => f?.app.close());

  const submitted = async (
    productId: string,
    over: Record<string, unknown> = {},
    t = terms,
  ) => {
    const b = await borrower(f, f.t1, f.b1, {
      monthlyIncome: '3000',
      dateOfBirth: new Date(Date.UTC(1985, 3, 12)),
      ...over,
    });
    const app = expectOk(
      await f.as('ro').post('/lending/applications', {
        borrowerId: b.id,
        productId,
        terms: t,
      }),
    );
    await docs(f, app.id, ['ID_DOCUMENT']);
    const s = expectOk(
      await f.as('ro').post(`/lending/applications/${app.id}/submit`),
    );
    return {
      id: app.id as string,
      borrowerId: b.id as string,
      assessment: s.assessment,
    };
  };
  const recommend = async (id: string) =>
    expectOk(
      await f.as('analyst').post(`/lending/applications/${id}/recommend`, {
        recommendation: 'APPROVE',
        rationale: 'Scored and affordable',
      }),
    );

  it('with no tenant scorecard the standard template scores, exactly as before, and the evaluation is stored', async () => {
    const app = await submitted(plain);
    const m = app.assessment.metrics;
    expect(m.scorecard).toBe('STANDARD_RETAIL@template');
    expect(m.scoreOutcome).toBe('REFER');
    const s = expectOk(
      await f.as('analyst').get(`/lending/applications/${app.id}/scores`),
    );
    expect(s.evaluations).toHaveLength(1);
    const e = s.latest;
    expect(e).toMatchObject({
      role: 'CHAMPION',
      stage: 'APPLICATION',
      source: 'TEMPLATE',
      version: 0,
      scorecardCode: 'STANDARD_RETAIL',
      drivesDecision: true,
    });
    expect(e.score).toBe(m.creditScore);
    // The same inputs on the original formula give the same score.
    const x = e.inputs.features;
    const parity = lending.evaluateScorecard(
      lending.SCORECARD_TEMPLATE_BY_CODE.STANDARD_RETAIL.definition,
      Object.fromEntries(
        Object.entries(x).map(([k, v]: [string, any]) => [k, v.value]),
      ),
    );
    expect(parity.score).toBe(e.score);
    // Every input carries its source.
    expect(x.debtServiceRatio.source).toBe('APPLICATION');
    expect(x.closedLoans.source).toBe('INTERNAL');
    expect(x.bureauScore).toMatchObject({ value: null, source: 'BUREAU' });
    expect(s.customerExplanation.outcome).toBe('REFER');
    expect(JSON.stringify(s.customerExplanation)).not.toMatch(/points/);
  });

  it('a stored evaluation can be neither changed nor deleted', async () => {
    const app = await submitted(plain);
    const id = (
      await f.system(() =>
        f.prisma.scoreEvaluation.findFirst({
          where: { applicationId: app.id },
        }),
      )
    ).id;
    await expect(
      f.system(() =>
        f.prisma.scoreEvaluation.update({
          where: { id },
          data: { score: 850 },
        }),
      ),
    ).rejects.toThrow(/immutable|not allowed/);
    await expect(
      f.system(() => f.prisma.scoreEvaluation.delete({ where: { id } })),
    ).rejects.toThrow(/immutable|not allowed/);
  });

  it('a scorecard version needs a different approver, goes live on activation and then scores', async () => {
    const tpl = lending.SCORECARD_TEMPLATE_BY_CODE.STANDARD_RETAIL.definition;
    const invalid = await f.as('analyst').post('/lending/scorecards', {
      code: 'STANDARD_RETAIL',
      name: 'Bad',
      definition: { ...tpl, grades: [{ grade: 'A', minScore: 700 }] },
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe('SCORECARD_INVALID');

    const created = expectOk(
      await f.as('analyst').post('/lending/scorecards', {
        code: 'STANDARD_RETAIL',
        name: 'Our retail scorecard',
        templateCode: 'STANDARD_RETAIL',
      }),
    );
    const v1 = created.versions[0];
    expect(v1.status).toBe('DRAFT');
    // The maker edits the draft: a higher base score.
    expectOk(
      await f.as('analyst').put(`/lending/scorecard-versions/${v1.id}`, {
        definition: { ...tpl, baseScore: 500 },
        changeSummary: 'Base 500',
      }),
    );
    const notMine = await f
      .as('approver')
      .put(`/lending/scorecard-versions/${v1.id}`, { definition: tpl });
    expect(notMine.status).toBe(403);
    expectOk(
      await f.as('analyst').post(`/lending/scorecard-versions/${v1.id}/submit`),
    );
    // The maker cannot approve their own version; the product checker lacks the permission.
    expect(
      (
        await f
          .as('analyst')
          .post(`/lending/scorecard-versions/${v1.id}/approve`)
      ).status,
    ).toBe(403);
    expect(
      (await f.as('maker').post(`/lending/scorecard-versions/${v1.id}/approve`))
        .status,
    ).toBe(403);
    expectOk(
      await f
        .as('checker')
        .post(`/lending/scorecard-versions/${v1.id}/approve`),
    );
    // Approved is not yet in force.
    const before = await submitted(plain);
    expect(before.assessment.metrics.scorecard).toBe(
      'STANDARD_RETAIL@template',
    );
    expectOk(
      await f
        .as('checker')
        .post(`/lending/scorecard-versions/${v1.id}/activate`),
    );
    // Frozen once out of draft, at the database too.
    await expect(
      f.system(() =>
        f.prisma.scorecardVersion.update({
          where: { id: v1.id },
          data: { definition: tpl },
        }),
      ),
    ).rejects.toThrow(/immutable/);
    expect(
      (
        await f
          .as('analyst')
          .put(`/lending/scorecard-versions/${v1.id}`, { definition: tpl })
      ).status,
    ).toBe(409);

    const after = await submitted(plain);
    expect(after.assessment.metrics.scorecard).toBe('STANDARD_RETAIL@v1');
    expect(after.assessment.metrics.creditScore).toBe(
      Math.min(850, before.assessment.metrics.creditScore + 50),
    );
    const e = expectOk(
      await f.as('analyst').get(`/lending/applications/${after.id}/scores`),
    ).latest;
    expect(e).toMatchObject({
      source: 'TENANT',
      version: 1,
      scorecardVersionId: v1.id,
    });

    // A second version replaces the first on activation; the first is retired.
    const v2 = expectOk(
      await f.as('analyst').post(`/lending/scorecards/${created.id}/versions`, {
        definition: tpl,
        changeSummary: 'Back to template',
      }),
    );
    expectOk(
      await f.as('analyst').post(`/lending/scorecard-versions/${v2.id}/submit`),
    );
    expectOk(
      await f
        .as('checker')
        .post(`/lending/scorecard-versions/${v2.id}/approve`),
    );
    expectOk(
      await f
        .as('checker')
        .post(`/lending/scorecard-versions/${v2.id}/activate`),
    );
    const sc = expectOk(
      await f.as('analyst').get(`/lending/scorecards/${created.id}`),
    );
    expect(sc.versions.map((v: any) => [v.version, v.status])).toEqual([
      [2, 'ACTIVE'],
      [1, 'RETIRED'],
    ]);

    // Trying inputs stores nothing.
    const tried = expectOk(
      await f.as('analyst').post('/lending/scorecard-test', {
        versionId: v1.id,
        inputs: {
          debtServiceRatio: '0.25',
          ageYears: 30,
          worstCurrentDpd: 0,
        },
      }),
    );
    expect(tried.score).toBe(500 + 120 + 60 + 60);
    expect(
      (
        await f.as('ro').post('/lending/scorecard-test', {
          templateCode: 'THIN_FILE',
          inputs: {},
        })
      ).status,
    ).toBe(403);
  });

  it('a challenger is evaluated silently and stored, and never changes the decision', async () => {
    const app = await submitted(challenged);
    await recommend(app.id);
    const approved = expectOk(
      await f.as('approver').post(`/lending/applications/${app.id}/approve`, {
        rationale: 'Champion refers; officer approves',
      }),
    );
    expect(approved.application.status).toBe('APPROVED');
    const s = expectOk(
      await f.as('analyst').get(`/lending/applications/${app.id}/scores`),
    );
    const champions = s.evaluations.filter((e: any) => e.role === 'CHAMPION');
    const challengers = s.evaluations.filter(
      (e: any) => e.role === 'CHALLENGER',
    );
    expect(challengers.length).toBe(champions.length);
    expect(
      challengers.every(
        (e: any) =>
          e.drivesDecision === false && e.scorecardCode === 'THIN_FILE',
      ),
    ).toBe(true);
    // The challenger would have declined; the champion did not, and only the champion counted.
    expect(challengers[0].outcome).toBe('DECLINE');
    expect(champions[0].outcome).toBe('REFER');
    // The database refuses a challenger that claims to drive the decision.
    await expect(
      f.system(() =>
        f.prisma.scoreEvaluation.create({
          data: { ...strip(challengers[0]), drivesDecision: true },
        }),
      ),
    ).rejects.toThrow(/ScoreEvaluation_shadow_check/);
  });

  it('a thin-file borrower is scored on the thin-file scorecard', async () => {
    const app = await submitted(thin);
    expect(app.assessment.metrics.thinFile).toBe('yes');
    expect(app.assessment.metrics.scorecard).toBe('THIN_FILE@template');
    const e = expectOk(
      await f.as('analyst').get(`/lending/applications/${app.id}/scores`),
    ).latest;
    expect(e.thinFile).toBe(true);
    expect(e.inputs.features.utilityOnTimeRatio).toMatchObject({
      value: null,
      source: 'OFFICER_VERIFIED',
    });
  });

  it('a strategy decline, a grade limit and the minimum score block approval; AUTO_APPROVE still needs the approver', async () => {
    // Above the grade maximum: referred, and approval is blocked by the limit.
    const big = await submitted(strict);
    expect(big.assessment.metrics.scoreOutcome).toBe('REFER');
    await recommend(big.id);
    const blocked = await f
      .as('approver')
      .post(`/lending/applications/${big.id}/approve`, {
        rationale: 'Approve within policy',
      });
    expect(blocked.status).toBe(400);
    expect(blocked.body.issues.map((i: any) => i.code)).toContain(
      'GRADE_LIMIT',
    );
    // Within it: recommended for approval, but nothing is approved by itself.
    const small = await submitted(strict, {}, { ...terms, principal: '500' });
    expect(small.assessment.metrics.scoreOutcome).toBe('AUTO_APPROVE');
    const appRow = await f.system(() =>
      f.prisma.application.findFirst({ where: { id: small.id } }),
    );
    expect(appRow.status).toBe('SUBMITTED');
    // A knock-out declines whatever the score.
    const old = await submitted(
      strict,
      { dateOfBirth: new Date(Date.UTC(1958, 0, 1)) },
      { ...terms, principal: '500', numberOfInstalments: 6 },
    );
    expect(old.assessment.metrics.scoreOutcome).toBe('DECLINE');
    await recommend(old.id);
    const ko = await f
      .as('approver')
      .post(`/lending/applications/${old.id}/approve`, {
        rationale: 'Approve within policy',
      });
    expect(ko.status).toBe(400);
    expect(ko.body.issues.map((i: any) => i.code)).toContain('SCORE_STRATEGY');
  });

  it('credit staff re-run the score; others cannot', async () => {
    const app = await submitted(plain);
    const r = expectOk(
      await f.as('analyst').post(`/lending/applications/${app.id}/scores`),
    );
    expect(r.evaluation.stage).toBe('RESCORE');
    expect(
      (await f.as('ro').post(`/lending/applications/${app.id}/scores`)).status,
    ).toBe(403);
    expect([403, 404]).toContain(
      (await f.as('t2admin').get(`/lending/applications/${app.id}/scores`))
        .status,
    );
  });

  it('the monitoring report covers champions and challengers by version', async () => {
    const r = expectOk(
      await f
        .as('checker')
        .get(
          '/lending/scorecard-monitoring?badDaysPastDue=30&performanceMonths=6',
        ),
    );
    expect(r.parameters.badDaysPastDue).toBe(30);
    const keys = r.versions.map(
      (v: any) => `${v.scorecardCode}@${v.version}/${v.role}`,
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        'STANDARD_RETAIL@0/CHAMPION',
        'STANDARD_RETAIL@1/CHAMPION',
        'THIN_FILE@0/CHALLENGER',
      ]),
    );
    const t = r.versions.find(
      (v: any) => v.scorecardCode === 'STANDARD_RETAIL' && v.version === 0,
    );
    expect(t.byGrade.reduce((s: number, g: any) => s + g.count, 0)).toBe(
      t.applications,
    );
    expect(t.stability.recent).toBeDefined();
    expect((await f.as('ro').get('/lending/scorecard-monitoring')).status).toBe(
      403,
    );
  });
});

/** A stored row as create() input. */
function strip(row: any) {
  const rest = { ...row };
  delete rest.id;
  delete rest.createdAt;
  return rest;
}
