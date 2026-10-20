/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: rows come from the untyped API and Prisma client. */
/**
 * Alternative data for thin-file borrowers (DECISIONS D-078, D-079):
 * consent, officer-captured data under maker-checker, internal behavioural
 * features, provider adapters that are unusable until integrated, and the
 * tenant wall on every new table.
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
import { PDF, activeProduct, docs, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

const terms = {
  principal: '1000',
  numberOfInstalments: 12,
  disbursementDate: '2026-01-05',
};
const inAYear = () => new Date(Date.now() + 365 * 86_400_000).toISOString();

d('Alternative data and consent (integration)', () => {
  let f: Fixture;
  let thin: string;
  let phone: string;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    await grant(f, f.t1, 'checker', 'RISK_COMPLIANCE');
    ({ productId: thin } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'ALT-THIN',
      (c) => {
        c.pricing.fees = [];
        c.scoring = { thinFile: { enabled: true } };
      },
    ));
    // A tenant scorecard on a provider input, run as a silent challenger.
    const phoneCard = {
      schemaVersion: 1,
      baseScore: 500,
      minScore: 300,
      maxScore: 850,
      grades: [
        { grade: 'A', minScore: 650 },
        { grade: 'B', minScore: 300 },
      ],
      characteristics: [
        {
          code: 'PHONE',
          label: 'Smartphone score',
          variable: 'smartphoneScore',
          type: 'LINEAR',
          linear: {
            centre: '500',
            weight: '0.5',
            reason: 'Smartphone score {value}.',
          },
          missing: { points: 0, reason: 'No smartphone score.' },
        },
      ],
    };
    const sc = expectOk(
      await f.as('analyst').post('/lending/scorecards', {
        code: 'PHONE_DATA',
        name: 'Smartphone data',
        definition: phoneCard,
      }),
    );
    const v = sc.versions[0].id;
    expectOk(
      await f.as('analyst').post(`/lending/scorecard-versions/${v}/submit`),
    );
    expectOk(
      await f.as('checker').post(`/lending/scorecard-versions/${v}/approve`),
    );
    expectOk(
      await f.as('checker').post(`/lending/scorecard-versions/${v}/activate`),
    );
    ({ productId: phone } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'ALT-PHONE',
      (c) => {
        c.pricing.fees = [];
        c.scoring = { challengerCode: 'PHONE_DATA' };
      },
    ));
  }, 120_000);
  afterAll(async () => f?.app.close());

  const customer = () => borrower(f, f.t1, f.b1, { monthlyIncome: '3000' });
  const document = async (borrowerId: string, typeCode = 'UTILITY_BILL') =>
    expectOk(
      await f.as('ro').post(`/lending/customers/${borrowerId}/documents`, {
        category: 'OTHER',
        typeCode,
        fileName: `${typeCode}.pdf`,
        mimeType: 'application/pdf',
        contentBase64: PDF,
      }),
    ).id as string;
  const consent = (
    borrowerId: string,
    source: string,
    over: Record<string, unknown> = {},
  ) =>
    f.as('ro').post(`/lending/customers/${borrowerId}/consents`, {
      source,
      purpose: 'Credit assessment of the loan application',
      scope: 'Bills of the last 12 months',
      method: 'RECORDED_VERBAL',
      expiresAt: inAYear(),
      ...over,
    });
  const utility = (borrowerId: string, documentId: string) =>
    f.as('ro').post(`/lending/customers/${borrowerId}/alternative-data`, {
      kind: 'UTILITY_BILLS',
      data: {
        utility: 'ELECTRICITY',
        issuer: 'EDC',
        accountReference: 'EDC-123',
        monthsObserved: 12,
        monthsOnTime: 12,
      },
      periodFrom: '2025-01-01',
      periodTo: '2025-12-31',
      documentId,
    });
  const score = async (productId: string, borrowerId: string) => {
    const app = expectOk(
      await f
        .as('ro')
        .post('/lending/applications', { borrowerId, productId, terms }),
    );
    await docs(f, app.id, ['ID_DOCUMENT']);
    expectOk(await f.as('ro').post(`/lending/applications/${app.id}/submit`));
    return expectOk(
      await f.as('analyst').get(`/lending/applications/${app.id}/scores`),
    );
  };

  it('nothing is captured without consent; consent is bounded and documented', async () => {
    const b = await customer();
    const doc = await document(b.id);
    const none = await utility(b.id, doc);
    expect(none.status).toBe(400);
    expect(none.body.code).toBe('CONSENT_REQUIRED');
    const tooLong = await consent(b.id, 'UTILITY_BILLS', {
      expiresAt: new Date(Date.now() + 900 * 86_400_000).toISOString(),
    });
    expect(tooLong.status).toBe(400);
    const unsigned = await consent(b.id, 'UTILITY_BILLS', {
      method: 'SIGNED_FORM',
    });
    expect(unsigned.status).toBe(400);
    const signed = expectOk(
      await consent(b.id, 'UTILITY_BILLS', {
        method: 'SIGNED_FORM',
        documentId: await document(b.id, 'CONSENT_FORM'),
      }),
    );
    expect(signed).toMatchObject({
      action: 'GRANT',
      source: 'UTILITY_BILLS',
      recordedBy: f.users.ro.id,
    });
    // Officers without the permission cannot record consent.
    expect(
      (
        await f.as('opsMaker').post(`/lending/customers/${b.id}/consents`, {
          source: 'UTILITY_BILLS',
          purpose: 'Credit assessment',
          method: 'RECORDED_VERBAL',
          expiresAt: inAYear(),
        })
      ).status,
    ).toBe(403);
  });

  it('officer-captured data counts only once a second person verifies it, and then feeds the thin-file score', async () => {
    const b = await customer();
    expectOk(await consent(b.id, 'UTILITY_BILLS'));
    const doc = await document(b.id);
    const rec = expectOk(await utility(b.id, doc));
    expect(rec.status).toBe('PENDING');
    // Pending data does not score.
    const pending = await score(thin, b.id);
    expect(pending.latest.inputs.features.utilityOnTimeRatio.value).toBeNull();
    // The officer who captured it cannot verify it.
    expect(
      (
        await f.as('ro').post(`/lending/alternative-data/${rec.id}/decision`, {
          approve: true,
        })
      ).status,
    ).toBe(403);
    await expect(
      f.system(() =>
        f.prisma.altDataRecord.update({
          where: { id: rec.id },
          data: {
            status: 'VERIFIED',
            verifiedBy: f.users.ro.id,
            verifiedAt: new Date(),
          },
        }),
      ),
    ).rejects.toThrow(/AltDataRecord_maker_checker_check/);
    const verified = expectOk(
      await f
        .as('analyst')
        .post(`/lending/alternative-data/${rec.id}/decision`, {
          approve: true,
        }),
    );
    expect(verified).toMatchObject({
      status: 'VERIFIED',
      verifiedBy: f.users.analyst.id,
    });
    // Frozen once decided.
    await expect(
      f.system(() =>
        f.prisma.altDataRecord.update({
          where: { id: rec.id },
          data: { data: { monthsObserved: 1 } },
        }),
      ),
    ).rejects.toThrow(/immutable/);
    const s = await score(thin, b.id);
    const x = s.latest.inputs.features;
    expect(x.utilityOnTimeRatio).toMatchObject({
      value: '1',
      source: 'OFFICER_VERIFIED',
      evidence: [rec.id],
    });
    expect(x.utilityOnTimeRatio.consentId).toBeTruthy();
    expect(s.latest.score).toBe(pending.latest.score + 70 + 30);
  });

  it('withdrawing consent stops future use and capture; history is append-only', async () => {
    const b = await customer();
    const g = expectOk(await consent(b.id, 'UTILITY_BILLS'));
    const rec = expectOk(await utility(b.id, await document(b.id)));
    expectOk(
      await f
        .as('analyst')
        .post(`/lending/alternative-data/${rec.id}/decision`, {
          approve: true,
        }),
    );
    expect(
      (await score(thin, b.id)).latest.inputs.features.utilityOnTimeRatio.value,
    ).toBe('1');
    expectOk(
      await f.as('ro').post(`/lending/consents/${g.id}/revoke`, {
        reason: 'Customer withdrew consent at the branch',
      }),
    );
    expect(
      (
        await f
          .as('ro')
          .post(`/lending/consents/${g.id}/revoke`, { reason: 'Again' })
      ).status,
    ).toBe(409);
    const after = (await score(thin, b.id)).latest.inputs.features
      .utilityOnTimeRatio;
    expect(after.value).toBeNull();
    expect(after.note).toMatch(/No consent in force/);
    expect((await utility(b.id, await document(b.id))).status).toBe(400);
    await expect(
      f.system(() =>
        f.prisma.altDataConsent.update({
          where: { id: g.id },
          data: { purpose: 'changed' },
        }),
      ),
    ).rejects.toThrow(/not allowed/);
    await expect(
      f.system(() => f.prisma.altDataConsent.delete({ where: { id: g.id } })),
    ).rejects.toThrow(/not allowed/);
    const view = expectOk(
      await f.as('analyst').get(`/lending/customers/${b.id}/alternative-data`),
    );
    expect(view.consents.map((c: any) => c.action).sort()).toEqual([
      'GRANT',
      'REVOKE',
    ]);
    expect(
      view.inForce.find((i: any) => i.source === 'UTILITY_BILLS').grantId,
    ).toBeNull();
  });

  it('internal behavioural features need their own consent', async () => {
    const b = await customer();
    const without = (await score(thin, b.id)).latest.inputs.features;
    expect(without.onTimeRepaymentRatio).toMatchObject({
      value: null,
      source: 'INTERNAL',
    });
    expect(without.onTimeRepaymentRatio.note).toMatch(/No consent/);
    expectOk(await consent(b.id, 'INTERNAL_BEHAVIOUR'));
    const withConsent = (await score(thin, b.id)).latest.inputs.features;
    expect(withConsent.instalmentsObserved).toMatchObject({
      value: 0,
      source: 'INTERNAL',
    });
    expect(withConsent.instalmentsObserved.consentId).toBeTruthy();
    // Thin-file selection itself uses only the lender's own core records.
    expect(withConsent.internalHistoryMonths).toMatchObject({
      value: 0,
      source: 'INTERNAL',
    });
  });

  it('a cash flow kept in riel is converted at the tenant’s rate before it is compared with a dollar instalment', async () => {
    const b = await customer();
    expectOk(await consent(b.id, 'BUSINESS_CASH_FLOW'));
    const rec = expectOk(
      await f.as('ro').post(`/lending/customers/${b.id}/alternative-data`, {
        kind: 'BUSINESS_CASH_FLOW',
        data: {
          method: 'SITE_VISIT',
          monthsObserved: 3,
          averageMonthlyInflow: '4100000',
          averageMonthlyOutflow: '3690000',
          currency: 'KHR',
        },
        periodFrom: '2025-10-01',
        periodTo: '2025-12-31',
        documentId: await document(b.id, 'CASH_BOOK'),
      }),
    );
    expectOk(
      await f
        .as('analyst')
        .post(`/lending/alternative-data/${rec.id}/decision`, {
          approve: true,
        }),
    );
    const noRate = (await score(thin, b.id)).latest.inputs.features
      .businessCashFlowCoverage;
    expect(noRate.value).toBeNull();
    expect(noRate.note).toMatch(/No KHR\/USD rate/);
    await f.system(() =>
      f.prisma.exchangeRate.create({
        data: {
          tenantId: f.t1,
          fromCurrency: 'USD',
          toCurrency: 'KHR',
          rate: '4100',
          effectiveDate: new Date(Date.UTC(2026, 0, 1)),
        },
      }),
    );
    const s = (await score(thin, b.id)).latest;
    // 410,000 KHR ÷ 4,100 = 100 USD a month against an instalment of about 90 USD.
    const coverage = s.inputs.features.businessCashFlowCoverage;
    expect(coverage.note).toMatch(/410000 KHR at 1\/4100/);
    expect(Number(coverage.value)).toBeGreaterThan(1);
    expect(Number(coverage.value)).toBeLessThan(1.2);
  });

  it('external providers are unusable until integrated: configured or not, nothing is fetched or invented', async () => {
    const list = expectOk(
      await f.as('admin1').get('/lending/alternative-data-providers'),
    );
    expect(
      list.sources.map((s: any) => [s.source, s.usable, s.reason]),
    ).toEqual([
      ['SMARTPHONE_DATA', false, 'NOT_CONFIGURED'],
      ['TELCO_DATA', false, 'NOT_CONFIGURED'],
      ['EWALLET_DATA', false, 'NOT_CONFIGURED'],
    ]);
    expect(list.implementedProviders).toEqual([]);
    // Only the public internet (D-144): internal addresses are refused in
    // every spelling. (Literals, so the test never depends on DNS.)
    for (const endpointUrl of [
      'https://169.254.169.254/latest/meta-data',
      'https://[::ffff:7f00:1]/v1',
      'https://[64:ff9b::a00:5]/v1',
      'https://2130706433/v1',
    ]) {
      const refused = await f
        .as('admin1')
        .post('/lending/alternative-data-providers', {
          source: 'SMARTPHONE_DATA',
          providerCode: 'CREDOLAB',
          endpointUrl,
          credentials: 'api-key-for-tests-only',
        });
      expect([endpointUrl, refused.status]).toEqual([endpointUrl, 400]);
    }
    const cfg = expectOk(
      await f.as('admin1').post('/lending/alternative-data-providers', {
        source: 'SMARTPHONE_DATA',
        providerCode: 'CREDOLAB',
        endpointUrl: 'https://93.184.215.14/v1',
        credentials: 'api-key-for-tests-only',
      }),
    );
    expect(cfg.credentials).toBeUndefined();
    expect(cfg.credentialsSet).toBe(true);
    // Asked of the database itself: the Prisma client decrypts field-encrypted values on the way out.
    const [stored]: { encrypted: boolean; plain: number }[] = await f.system(
      () =>
        f.prisma.$queryRawUnsafe(
          `SELECT credentials LIKE 'enc:v1:%' AS encrypted, position('api-key-for-tests-only' in credentials) AS plain FROM "AltDataProviderConfig" WHERE id = $1`,
          cfg.id,
        ),
    );
    expect(stored).toEqual({ encrypted: true, plain: 0 });
    expect(
      (
        await f
          .as('admin1')
          .post(`/lending/alternative-data-providers/${cfg.id}/decision`, {
            approve: true,
          })
      ).status,
    ).toBe(403);
    expectOk(
      await f
        .as('admin2')
        .post(`/lending/alternative-data-providers/${cfg.id}/decision`, {
          approve: true,
        }),
    );
    const after = expectOk(
      await f.as('admin1').get('/lending/alternative-data-providers'),
    );
    expect(after.sources[0]).toMatchObject({
      source: 'SMARTPHONE_DATA',
      usable: false,
      reason: 'NO_ADAPTER_IMPLEMENTATION',
    });
    expect(after.sources[0].capability).toBe('altdata.provider_smartphone');
    expect(
      lending.CAPABILITIES.find((c) => c.id === 'altdata.provider_smartphone')!
        .status,
    ).toBe('REQUIRES_INTEGRATION');

    const b = await customer();
    const noConsent = (await score(phone, b.id)).challenger.inputs.features
      .smartphoneScore;
    expect(noConsent).toMatchObject({ value: null, source: 'PROVIDER' });
    expect(noConsent.note).toMatch(/No consent/);
    expectOk(await consent(b.id, 'SMARTPHONE_DATA'));
    const s = await score(phone, b.id);
    expect(s.challenger.inputs.features.smartphoneScore.value).toBeNull();
    expect(s.challenger.inputs.features.smartphoneScore.note).toMatch(
      /no adapter/,
    );
    expect(s.challenger.drivesDecision).toBe(false);
  });

  it('every new table is walled off by row-level security', async () => {
    const tables = [
      'Scorecard',
      'ScorecardVersion',
      'ScoreEvaluation',
      'AltDataConsent',
      'AltDataRecord',
      'AltDataProviderConfig',
    ];
    const asOther = <T>(fn: (tx: any) => Promise<T>) =>
      f.prisma.$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe(
          `SELECT set_config('app.tenant_id', $1, true)`,
          f.t2,
        );
        return fn(tx);
      });
    for (const t of tables) {
      const [own]: { n: bigint }[] = await f.system(() =>
        f.prisma.$queryRawUnsafe(
          `SELECT count(*) AS n FROM "${t}" WHERE "tenantId" = $1`,
          f.t1,
        ),
      );
      expect(Number(own.n)).toBeGreaterThan(0);
      const [seen]: { n: bigint }[] = await asOther((tx) =>
        tx.$queryRawUnsafe(
          `SELECT count(*) AS n FROM "${t}" WHERE "tenantId" = $1`,
          f.t1,
        ),
      );
      expect(Number(seen.n)).toBe(0);
      const [flags]: { rls: boolean; forced: boolean }[] =
        await f.prisma.$queryRawUnsafe(
          'SELECT relrowsecurity AS rls, relforcerowsecurity AS forced FROM pg_class WHERE relname = $1',
          t,
        );
      expect(flags).toEqual({ rls: true, forced: true });
    }
    await expect(
      asOther((tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO "Scorecard" (id, "tenantId", code, name, "createdBy") VALUES (gen_random_uuid()::text, $1, 'WALL', 'Wall', 'x')`,
          f.t1,
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    // Through the API another tenant sees none of it.
    const victim = await f.system(() =>
      f.prisma.altDataConsent.findFirst({ where: { tenantId: f.t1 } }),
    );
    expect([403, 404]).toContain(
      (
        await f
          .as('t2admin')
          .get(`/lending/customers/${victim.borrowerId}/alternative-data`)
      ).status,
    );
  });
});
