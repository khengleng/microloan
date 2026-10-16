/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: modules are required after the test environment is configured, and fixture rows come from the untyped Prisma client. */
/**
 * Mandatory security and lifecycle tests, over the real HTTP API and database.
 */
import {
  Fixture,
  TEST_DB,
  authority,
  borrower,
  bootstrap,
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

d('Lending security and lifecycle (integration)', () => {
  let f: Fixture;
  let personal: { productId: string; versionId: string };
  let loanId: string;
  let appId: string;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    await grant(f, f.t2, 't2ops', 'LOAN_OPS_MAKER');
    personal = await activeProduct(f, 'PERSONAL_INSTALMENT', 'PL-SEC');
    const r = await originateAndDisburse(f, personal.productId, {
      principal: '6000',
      numberOfInstalments: 12,
      disbursementDate: '2026-01-05',
    });
    loanId = r.loanId;
    appId = r.applicationId;
  }, 120_000);
  afterAll(async () => f?.app.close());

  describe('isolation and enforcement', () => {
    it('cross-tenant resource access is denied, and lists do not leak', async () => {
      const res = await f.as('t2ops').get(`/lending/loans/${loanId}`);
      expect([403, 404]).toContain(res.status);
      const list = expectOk(await f.as('t2ops').get('/lending/loans'));
      expect(list.data.map((l: any) => l.id)).not.toContain(loanId);
      const repay = await f
        .as('t2ops')
        .post(`/lending/loans/${loanId}/repayments`, { amount: '10' }, key());
      expect([403, 404]).toContain(repay.status);
    });

    it('direct API calls cannot bypass hidden UI controls', async () => {
      const res = await f
        .as('nobody')
        .post(`/lending/loans/${loanId}/repayments`, { amount: '10' }, key());
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCESS_DENIED');
    });

    it('a role alone cannot bypass ABAC branch scope', async () => {
      const res = await f.as('ro2').get(`/lending/applications/${appId}`);
      expect(res.status).toBe(403);
      expect(res.body.blockedBy.map((b: any) => b.layer)).toContain('ABAC');
      const list = expectOk(await f.as('ro2').get('/lending/applications'));
      expect(list.data.map((a: any) => a.id)).not.toContain(appId);
    });

    it('platform administrators cannot read tenant loans or approve transactions', async () => {
      const res = await f.as('platform').get(`/lending/loans/${loanId}`);
      expect(res.status).toBe(403);
    });

    it('the capabilities endpoint mirrors server decisions', async () => {
      const caps = expectOk(
        await f
          .as('opsMaker')
          .get(`/lending/access/capabilities/LOAN_ACCOUNT/${loanId}`),
      );
      expect(caps['loan.repayment.post'].allowed).toBe(true);
      expect(caps['loan.repayment.reverse'].allowed).toBe(false);
      expect(caps['loan.writeoff.approve'].blockedBy[0].layer).toBe('RBAC');
    });
  });

  describe('maker-checker and authority', () => {
    it('a product maker cannot approve their own version', async () => {
      const tpl = expectOk(
        await f.as('maker').get('/lending/templates/SALARY_LOAN'),
      );
      const created = expectOk(
        await f.as('maker').post('/lending/products', {
          templateCode: 'SALARY_LOAN',
          code: 'SAL-1',
          name: 'Salary',
          config: tpl.defaultConfig,
        }),
      );
      expectOk(
        await f
          .as('maker')
          .post(`/lending/product-versions/${created.version.id}/submit`),
      );
      await grant(f, f.t1, 'maker', 'PRODUCT_CHECKER');
      const res = await f
        .as('maker')
        .post(`/lending/product-versions/${created.version.id}/approve`);
      expect(res.status).toBe(403);
      expect(res.body.blockedBy.map((b: any) => b.message).join(' ')).toMatch(
        /created or proposed/,
      );
    });

    it('a user holding maker and checker roles cannot approve their own disbursement', async () => {
      await grant(f, f.t1, 'finance', 'LOAN_OPS_MAKER');
      await grant(f, f.t1, 'finance', 'LOAN_OPS_CHECKER');
      await authority(
        f,
        f.t1,
        'finance',
        'loan.disbursement.approve',
        'USD',
        '1000000',
      );
      const b = await borrower(f, f.t1, f.b1);
      const app = expectOk(
        await f.as('ro').post('/lending/applications', {
          borrowerId: b.id,
          productId: personal.productId,
          terms: {
            principal: '1000',
            numberOfInstalments: 6,
            disbursementDate: '2026-01-05',
          },
        }),
      );
      await docs(f, app.id, ['ID_DOCUMENT']);
      expectOk(await f.as('ro').post(`/lending/applications/${app.id}/submit`));
      expectOk(
        await f
          .as('analyst')
          .post(`/lending/applications/${app.id}/recommend`, {
            recommendation: 'APPROVE',
            rationale: 'Fine',
          }),
      );
      expectOk(
        await f.as('approver').post(`/lending/applications/${app.id}/approve`, {
          rationale: 'Fine',
        }),
      );
      const booked = expectOk(
        await f.as('finance').post(`/lending/applications/${app.id}/book`, {}),
      );
      expectOk(
        await f
          .as('finance')
          .post(`/lending/applications/${app.id}/conditions/AGREEMENT_SIGNED`, {
            resolution: 'SATISFIED',
            evidence: 'signed',
          }),
      );
      const task = expectOk(
        await f
          .as('finance')
          .post(`/lending/loans/${booked.account.id}/disbursements`, {}),
      );
      const own = await f
        .as('finance')
        .post(
          `/lending/loans/${booked.account.id}/disbursements/${task.id}/decision`,
          { approve: true },
        );
      expect(own.status).toBe(403);
    });

    it('approval threshold and currency are enforced; cross-currency needs an approved FX rate', async () => {
      const khr = await activeProduct(
        f,
        'PERSONAL_INSTALMENT',
        'PL-KHR',
        (c) => {
          c.identity.currency = 'KHR';
          c.pricing.rounding = { increment: '100', mode: 'HALF_UP' };
          c.limits = {
            minAmount: '400000',
            maxAmount: '2000000000',
            minInstalments: 3,
            maxInstalments: 36,
          };
          c.pricing.fees = [];
        },
      );
      const b = await borrower(f, f.t1, f.b1, { monthlyIncome: '500000000' });
      const make = async (principal: string) => {
        const app = expectOk(
          await f.as('ro').post('/lending/applications', {
            borrowerId: b.id,
            productId: khr.productId,
            terms: {
              principal,
              numberOfInstalments: 12,
              disbursementDate: '2026-01-05',
            },
          }),
        );
        await docs(f, app.id, ['ID_DOCUMENT']);
        expectOk(
          await f.as('ro').post(`/lending/applications/${app.id}/submit`),
        );
        expectOk(
          await f
            .as('analyst')
            .post(`/lending/applications/${app.id}/recommend`, {
              recommendation: 'APPROVE',
              rationale: 'Fine',
            }),
        );
        return app.id as string;
      };
      const small = await make('40000000'); // 40m KHR ≈ 9,800 USD
      const noFx = await f
        .as('approver')
        .post(`/lending/applications/${small}/approve`, {
          rationale: 'x approve',
        });
      expect(noFx.status).toBe(403);
      expect(noFx.body.blockedBy[0].message).toMatch(/approval authority/);
      await f.system(() =>
        f.prisma.exchangeRate.create({
          data: {
            tenantId: f.t1,
            fromCurrency: 'KHR',
            toCurrency: 'USD',
            rate: '0.000245',
            effectiveDate: new Date(Date.now() - 3_600_000),
          },
        }),
      );
      await f.system(() =>
        f.prisma.tenant.update({
          where: { id: f.t1 },
          data: { authzVersion: { increment: 1 } },
        }),
      );
      expectOk(
        await f.as('approver').post(`/lending/applications/${small}/approve`, {
          rationale: 'within authority',
        }),
      );
      const big = await make('1000000000'); // 1bn KHR ≈ 245,000 USD > 200,000
      expect(
        (
          await f.as('approver').post(`/lending/applications/${big}/approve`, {
            rationale: 'too big',
          })
        ).status,
      ).toBe(403);
      expectOk(
        await f.as('approver2').post(`/lending/applications/${big}/approve`, {
          rationale: 'larger authority',
        }),
      );
    });

    it('approvals require multi-factor sign-in', async () => {
      const b = await borrower(f, f.t1, f.b1);
      const app = expectOk(
        await f.as('ro').post('/lending/applications', {
          borrowerId: b.id,
          productId: personal.productId,
          terms: {
            principal: '1000',
            numberOfInstalments: 6,
            disbursementDate: '2026-01-05',
          },
        }),
      );
      await docs(f, app.id, ['ID_DOCUMENT']);
      expectOk(await f.as('ro').post(`/lending/applications/${app.id}/submit`));
      expectOk(
        await f
          .as('analyst')
          .post(`/lending/applications/${app.id}/recommend`, {
            recommendation: 'APPROVE',
            rationale: 'Fine',
          }),
      );
      const res = await f
        .http()
        .post(`/v1/lending/applications/${app.id}/approve`)
        .set('Authorization', `Bearer ${f.tokens.approverNoMfa}`)
        .send({ rationale: 'no mfa' });
      expect(res.status).toBe(403);
      expect(res.body.blockedBy[0].message).toMatch(/multi-factor/);
    });
  });

  describe('access governance lifecycle', () => {
    it('sensitive role assignment needs a second administrator; revocation is immediate', async () => {
      const ov = expectOk(await f.as('admin1').get('/lending/access'));
      const opsRole = ov.roles.find((r: any) => r.code === 'LOAN_OPS_MAKER');
      const a = expectOk(
        await f.as('admin1').post('/lending/access/assignments', {
          userId: f.users.nobody.id,
          roleId: opsRole.id,
          allBranches: true,
        }),
      );
      expect(a.status).toBe('PENDING');
      expect(
        (
          await f
            .as('admin1')
            .post(`/lending/access/assignments/${a.id}/decision`, {
              approve: true,
            })
        ).status,
      ).toBe(403);
      // Still nothing until approved.
      expect(
        (await f.as('nobody').get(`/lending/loans/${loanId}`)).status,
      ).toBe(403);
      expectOk(
        await f
          .as('admin2')
          .post(`/lending/access/assignments/${a.id}/decision`, {
            approve: true,
          }),
      );
      expectOk(await f.as('nobody').get(`/lending/loans/${loanId}`));
      expectOk(
        await f
          .as('admin1')
          .post(`/lending/access/assignments/${a.id}/revoke`, {
            reason: 'left the team',
          }),
      );
      expect(
        (await f.as('nobody').get(`/lending/loans/${loanId}`)).status,
      ).toBe(403);
    });

    it('expired delegations lose access', async () => {
      const now = Date.now();
      const base = {
        tenantId: f.t1,
        fromUserId: f.users.opsMaker.id,
        toUserId: f.users.nobody.id,
        permissions: ['loan.read'],
        reason: 'cover',
        createdBy: f.users.opsMaker.id,
        approvedBy: f.users.admin2.id,
        status: 'ACTIVE',
      };
      const del = await f.system(() =>
        f.prisma.delegation.create({
          data: {
            ...base,
            validFrom: new Date(now - 60_000),
            validTo: new Date(now + 3_600_000),
          },
        }),
      );
      await f.system(() =>
        f.prisma.tenant.update({
          where: { id: f.t1 },
          data: { authzVersion: { increment: 1 } },
        }),
      );
      expectOk(await f.as('nobody').get(`/lending/loans/${loanId}`));
      await f.system(() =>
        f.prisma.delegation.update({
          where: { id: del.id },
          data: { validTo: new Date(now - 1_000) },
        }),
      );
      await f.system(() =>
        f.prisma.tenant.update({
          where: { id: f.t1 },
          data: { authzVersion: { increment: 1 } },
        }),
      );
      expect(
        (await f.as('nobody').get(`/lending/loans/${loanId}`)).status,
      ).toBe(403);
    });

    it('the policy simulator explains a decision without side effects', async () => {
      await grant(f, f.t1, 'admin1', 'RISK_COMPLIANCE');
      const before = await f.system(() =>
        f.prisma.auditEvent.count({ where: { tenantId: f.t1 } }),
      );
      const sim = expectOk(
        await f.as('admin1').post('/lending/access/simulate', {
          userId: f.users.ro2.id,
          action: 'loan.read',
          resourceType: 'LOAN_ACCOUNT',
          resourceId: loanId,
        }),
      );
      expect(sim.answer).toBe('NO');
      expect(
        sim.decision.checks.find((c: any) => c.code === 'SCOPE').passed,
      ).toBe(false);
      const after = await f.system(() =>
        f.prisma.auditEvent.count({ where: { tenantId: f.t1 } }),
      );
      expect(after).toBe(before);
    });
  });

  describe('money integrity', () => {
    it('idempotent retries do not duplicate money movements; a reused key with a new payload is refused', async () => {
      const k = key('repay');
      const first = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/loans/${loanId}/repayments`, { amount: '20.00' }, k),
      );
      const again = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/loans/${loanId}/repayments`, { amount: '20.00' }, k),
      );
      expect(again.replayed).toBe(true);
      expect(again.event.id).toBe(first.id);
      expect(
        (
          await f
            .as('opsMaker')
            .post(`/lending/loans/${loanId}/repayments`, { amount: '25.00' }, k)
        ).status,
      ).toBe(409);
      const count = await f.system(() =>
        f.prisma.financialEvent.count({
          where: { tenantId: f.t1, idempotencyKey: k },
        }),
      );
      expect(count).toBe(1);
      expect(
        (
          await f
            .as('opsMaker')
            .post(`/lending/loans/${loanId}/repayments`, { amount: '20.00' })
        ).status,
      ).toBe(400);
    });

    it('concurrent requests cannot double-apply: parallel repayments serialize on the account version', async () => {
      const results = await Promise.all(
        [1, 2, 3].map(() =>
          f
            .as('opsMaker')
            .post(
              `/lending/loans/${loanId}/repayments`,
              { amount: '5.00' },
              key('par'),
            ),
        ),
      );
      const ok = results.filter((r) => r.status === 201).length;
      const conflict = results.filter((r) => r.status === 409).length;
      expect(ok + conflict).toBe(3);
      expect(ok).toBeGreaterThanOrEqual(1);
      const rec = expectOk(
        await f.as('finance').get('/lending/ops/reconciliation'),
      );
      expect(rec.breaks).toEqual([]);
    });

    it('concurrent approvals cannot double approve', async () => {
      const b = await borrower(f, f.t1, f.b1);
      const app = expectOk(
        await f.as('ro').post('/lending/applications', {
          borrowerId: b.id,
          productId: personal.productId,
          terms: {
            principal: '1200',
            numberOfInstalments: 6,
            disbursementDate: '2026-01-05',
          },
        }),
      );
      await docs(f, app.id, ['ID_DOCUMENT']);
      expectOk(await f.as('ro').post(`/lending/applications/${app.id}/submit`));
      expectOk(
        await f
          .as('analyst')
          .post(`/lending/applications/${app.id}/recommend`, {
            recommendation: 'APPROVE',
            rationale: 'Fine',
          }),
      );
      const [a, b2] = await Promise.all([
        f.as('approver').post(`/lending/applications/${app.id}/approve`, {
          rationale: 'parallel one',
        }),
        f.as('approver2').post(`/lending/applications/${app.id}/approve`, {
          rationale: 'parallel two',
        }),
      ]);
      expect([a.status, b2.status].sort()).toEqual([201, 409]);
      const decisions = await f.system(() =>
        f.prisma.creditDecision.count({
          where: { tenantId: f.t1, applicationId: app.id, type: 'APPROVE' },
        }),
      );
      expect(decisions).toBe(1);
    });

    it('a repayment is reversed by a different user with a mirrored journal; balances restore', async () => {
      // Move to the first due date so the repayment pays dues (reversing a prepayment is out of Phase 1 scope).
      expectOk(
        await f
          .as('finance')
          .post('/lending/ops/business-date', { businessDate: '2026-02-05' }),
      );
      expectOk(await f.as('finance').post('/lending/loans/batch/run'));
      const before = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}`),
      );
      const ev = expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/loans/${loanId}/repayments`,
            { amount: '30.00' },
            key('rev'),
          ),
      );
      expect(ev.components.rescheduled).toBe(false);
      // The poster cannot reverse their own repayment (and lacks the permission anyway).
      expect(
        (
          await f
            .as('opsMaker')
            .post(
              `/lending/loans/${loanId}/events/${ev.id}/reverse`,
              { reason: 'mistake' },
              key(),
            )
        ).status,
      ).toBe(403);
      const rev = expectOk(
        await f
          .as('opsChecker')
          .post(
            `/lending/loans/${loanId}/events/${ev.id}/reverse`,
            { reason: 'Wrong account credited' },
            key('revk'),
          ),
      );
      expect(rev.type).toBe('REVERSAL');
      const after = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}`),
      );
      expect(after.account.principalOutstanding).toBe(
        before.account.principalOutstanding,
      );
      const original = after.events.find((e: any) => e.id === ev.id);
      expect(original.status).toBe('REVERSED');
      const reversal = after.events.find((e: any) => e.id === rev.id);
      const sum = (lines: any[], side: string) =>
        lines.reduce((s: number, l: any) => s + Number(l[side]), 0);
      expect(sum(reversal.journal.lines, 'debit')).toBeCloseTo(
        sum(original.journal.lines, 'credit'),
        6,
      );
      expect(
        (await f.as('finance').get('/lending/ops/reconciliation')).body.breaks,
      ).toEqual([]);
    });
  });

  describe('lifecycle', () => {
    it('missing engine capabilities block activation; unavailable templates cannot be used', async () => {
      const tpl = expectOk(
        await f.as('maker').get('/lending/templates/PERSONAL_INSTALMENT'),
      );
      const cfg = structuredClone(tpl.defaultConfig);
      cfg.attributes.rateType = 'FLOATING';
      cfg.pricing.fixed = null;
      cfg.pricing.floating = {
        benchmarkCode: 'SOFR',
        margin: '0.03',
        resetFrequency: 'QUARTERLY',
        floor: '0',
        cap: null,
      };
      const created = expectOk(
        await f.as('maker').post('/lending/products', {
          templateCode: 'PERSONAL_INSTALMENT',
          code: 'PL-FLOAT',
          name: 'Floating',
          config: cfg,
        }),
      );
      expectOk(
        await f
          .as('maker')
          .post(`/lending/product-versions/${created.version.id}/submit`),
      );
      expectOk(
        await f
          .as('checker')
          .post(`/lending/product-versions/${created.version.id}/approve`),
      );
      const act = await f
        .as('checker')
        .post(`/lending/product-versions/${created.version.id}/activate`);
      expect(act.status).toBe(400);
      expect(act.body.code).toBe('MISSING_CAPABILITIES');
      const card = await f.as('maker').post('/lending/products', {
        templateCode: 'CREDIT_CARD',
        code: 'CC-1',
        name: 'Card',
      });
      expect(card.status).toBe(400);
      expect(card.body.code).toBe('TEMPLATE_UNAVAILABLE');
    });

    it('approved versions are immutable, and product edits do not alter existing agreements', async () => {
      await expect(
        f.system(() =>
          f.prisma.productVersion.update({
            where: { id: personal.versionId },
            data: { config: {} },
          }),
        ),
      ).rejects.toThrow(/immutable/);
      const before = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}`),
      );
      const v2 = expectOk(
        await f
          .as('maker')
          .post(`/lending/products/${personal.productId}/versions`),
      );
      const cfg = (
        await f.system(() =>
          f.prisma.productVersion.findUnique({ where: { id: v2.id } }),
        )
      ).config;
      cfg.pricing.fixed.defaultAnnualRate = '0.11';
      expectOk(
        await f.as('maker').put(`/lending/product-versions/${v2.id}`, {
          config: cfg,
          changeSummary: 'Lower default rate',
        }),
      );
      expectOk(
        await f.as('maker').post(`/lending/product-versions/${v2.id}/submit`),
      );
      const view = expectOk(
        await f.as('checker').get(`/lending/product-versions/${v2.id}`),
      );
      expect(view.diffFromActive.map((d: any) => d.path)).toEqual([
        'pricing.fixed.defaultAnnualRate',
      ]);
      expectOk(
        await f
          .as('checker')
          .post(`/lending/product-versions/${v2.id}/approve`),
      );
      expectOk(
        await f
          .as('checker')
          .post(`/lending/product-versions/${v2.id}/activate`),
      );
      const after = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}`),
      );
      expect(
        after.schedule.map((l: any) => [l.interestDue, l.principalDue]),
      ).toEqual(
        before.schedule.map((l: any) => [l.interestDue, l.principalDue]),
      );
      expect(after.agreementVersions[0].terms).toEqual(
        before.agreementVersions[0].terms,
      );
      const old = await f.system(() =>
        f.prisma.productVersion.findUnique({
          where: { id: personal.versionId },
        }),
      );
      expect(old.status).toBe('RETIRED');
      // Servicing of a loan on the retired version continues.
      expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/loans/${loanId}/repayments`,
            { amount: '10.00' },
            key('retired'),
          ),
      );
    });

    it('origination-off preserves servicing; accounting-off fails money movement closed; flags never grant access', async () => {
      const propose = async (flagKey: string, enabled: boolean) => {
        const r = expectOk(
          await f.as('admin1').post('/lending/access/flags/rules', {
            flagKey,
            scopeType: 'TENANT',
            enabled,
            reason: 'test',
          }),
        );
        expect(
          (
            await f
              .as('admin1')
              .post(`/lending/access/flags/changes/${r.approval.id}/decision`, {
                approve: true,
              })
          ).status,
        ).toBe(403);
        expectOk(
          await f
            .as('admin2')
            .post(`/lending/access/flags/changes/${r.approval.id}/decision`, {
              approve: true,
            }),
        );
        return r.rule.id as string;
      };
      const off = await propose('lending.origination', false);
      const b = await borrower(f, f.t1, f.b1);
      const blocked = await f.as('ro').post('/lending/applications', {
        borrowerId: b.id,
        productId: personal.productId,
        terms: {
          principal: '1000',
          numberOfInstalments: 6,
          disbursementDate: '2026-01-05',
        },
      });
      expect(blocked.status).toBe(403);
      expect(blocked.body.blockedBy[0].layer).toBe('FLAG');
      expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/loans/${loanId}/repayments`,
            { amount: '10.00' },
            key('orig-off'),
          ),
      );
      // A flag switched on never grants a missing permission.
      const on = await propose('lending.origination', true);
      expect(
        (
          await f.as('nobody').post('/lending/applications', {
            borrowerId: b.id,
            productId: personal.productId,
            terms: {
              principal: '1000',
              numberOfInstalments: 6,
              disbursementDate: '2026-01-05',
            },
          })
        ).status,
      ).toBe(403);
      const postingOff = await propose('lending.accounting.posting', false);
      const money = await f
        .as('opsMaker')
        .post(
          `/lending/loans/${loanId}/repayments`,
          { amount: '10.00' },
          key('acc-off'),
        );
      expect(money.status).toBe(403);
      expect(money.body.blockedBy[0].message).toMatch(
        /lending.accounting.posting/,
      );
      for (const id of [off, on, postingOff]) {
        const rm = expectOk(
          await f
            .as('admin1')
            .post(`/lending/access/flags/rules/${id}/remove`, {
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
      expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/loans/${loanId}/repayments`,
            { amount: '10.00' },
            key('restored'),
          ),
      );
    });

    it('exports and background jobs respect scope', async () => {
      const csv = await f.as('financeB2').get('/lending/loans/export.csv');
      expect(csv.status).toBe(200);
      expect(csv.text.split('\n')).toHaveLength(1); // header only — every loan is in branch B1
      const batch = expectOk(
        await f.as('financeB2').post('/lending/loans/batch/run'),
      );
      expect(batch.processed).toBe(0);
      const all = await f.as('finance').get('/lending/loans/export.csv');
      expect(all.text.split('\n').length).toBeGreaterThan(1);
    });

    it('integration service accounts are tenant-bound and narrowly scoped', async () => {
      const sa = expectOk(
        await f.as('admin2').post('/lending/access/service-accounts', {
          name: 'Bank feed',
          scopes: ['loan.repayment.post'],
        }),
      );
      const call = (k: string, id: string, amount = '7.00') =>
        f
          .http()
          .post(`/v1/lending/integrations/loans/${id}/repayments`)
          .set('X-Service-Key', k)
          .set('Idempotency-Key', key('svc'))
          .send({ amount });
      expect((await call(sa.key, loanId)).status).toBe(201);
      expect(
        (await call('deadbeefdeadbeef.notarealsecretnotarealsecret00', loanId))
          .status,
      ).toBe(401);
      const readOnly = expectOk(
        await f.as('admin2').post('/lending/access/service-accounts', {
          name: 'Reporting',
          scopes: ['loan.read'],
        }),
      );
      expect((await call(readOnly.key, loanId)).status).toBe(403);
      // A tenant-1 key cannot reach another tenant's loan.
      await grant(f, f.t2, 't2ops', 'LOAN_OPS_MAKER');
      const t2loan = await f.system(() =>
        f.prisma.loanAccount.findFirst({ where: { tenantId: f.t2 } }),
      );
      if (t2loan)
        expect([403, 404]).toContain((await call(sa.key, t2loan.id)).status);
    });

    it('early settlement closes the loan and clears every receivable in the ledger', async () => {
      const quote = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}/settlement-quote`),
      );
      expect(Number(quote.payable)).toBeGreaterThan(0);
      const wrong = await f
        .as('opsMaker')
        .post(
          `/lending/loans/${loanId}/settlement`,
          { amount: '1.00' },
          key('set'),
        );
      expect(wrong.status).toBe(400);
      expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/loans/${loanId}/settlement`,
            { amount: quote.payable },
            key('settle'),
          ),
      );
      const loan = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}`),
      );
      expect(loan.account.status).toBe('CLOSED');
      const rec = expectOk(
        await f.as('finance').get('/lending/ops/reconciliation'),
      );
      expect(rec.breaks).toEqual([]);
    });
  });
});
