/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports -- integration fixtures: API responses are untyped. */
/**
 * The go-live setup checklist (D-171…D-175), end to end:
 *
 *  - a brand-new organisation: every item to do (or blocked on an earlier one);
 *  - a configured, demo-like organisation: almost every item done, the rest
 *    explained, and the waivable ones markable "not applicable" by a tenant
 *    administrator (stored, audited) — never the ones every lender needs;
 *  - who may read and mark it; the platform operator's overview;
 *  - one organisation's checklist never reflects another's data, and RLS
 *    holds behind it.
 */
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  Fixture,
  TEST_DB,
  bootstrap,
  expectOk,
  grant,
  impairmentPolicy,
  lendingSettings,
} from './harness';
import { activeProduct, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

const LIST = [
  'name,type,source,list_date,aliases,country,date_of_birth',
  'Fictional Sanctioned Person,SANCTION,Test sanctions list (fictional),2026-01-02,,KP,1970-05-01',
].join('\n');

const item = (status: any, key: string) =>
  status.items.find((i: any) => i.key === key);

d('Go-live setup checklist (integration)', () => {
  let f: Fixture;
  let t3: string;
  let t3Token: string;
  const t3get = (url: string) =>
    request(f.app.getHttpServer())
      .get(`/v1${url}`)
      .set('Authorization', `Bearer ${t3Token}`);
  const status = async (who: string) =>
    expectOk(await f.as(who).get('/lending/setup/status'));
  const del = (who: string, url: string) =>
    f
      .http()
      .delete(`/v1${url}`)
      .set('Authorization', `Bearer ${f.tokens[who]}`);

  beforeAll(async () => {
    f = await bootstrap();
    // A brand-new organisation: one enrolled administrator, nothing else.
    const suffix = randomUUID().slice(0, 8);
    const admin = await f.system(async () => {
      const t = await f.prisma.tenant.create({
        data: { name: `Brand New ${suffix}`, status: 'ACTIVE' },
      });
      t3 = t.id;
      return f.prisma.user.create({
        data: {
          email: `newadmin-${suffix}@test.local`,
          tenantId: t.id,
          role: 'TENANT_ADMIN',
          passwordHash: 'x',
          twoFactorEnabled: true,
        },
      });
    });
    t3Token = new JwtService({ secret: process.env.JWT_ACCESS_SECRET }).sign(
      {
        sub: admin.id,
        email: admin.email,
        role: 'TENANT_ADMIN',
        tenantId: t3,
        branchId: null,
        amr: 'mfa',
        mfaAt: Math.floor(Date.now() / 1000),
      },
      { expiresIn: '1h' },
    );

    // The demo-like organisation (tenant 1).
    await standardRoles(f);
    await grant(f, f.t1, 'checker', 'RISK_COMPLIANCE');
    await grant(f, f.t1, 'admin2', 'RISK_COMPLIANCE');
    await activeProduct(f, 'PERSONAL_INSTALMENT', 'PL-SETUP');
    await impairmentPolicy(f, f.t1);
    await lendingSettings(f, f.t1, {
      consumerProtection: {
        lenderLegalName: 'Test Lender Plc',
        licenceNumber: 'MFI-TEST-001',
        complaints: {
          phone: '+855 23 000 000',
          email: 'complaints@lender.test',
          address: 'Street 1, Phnom Penh',
        },
      },
      operations: { alertEmails: ['ops@lender.test'] },
    });
    expectOk(await f.as('finance').get('/lending/ops/ledger-accounts'));
    const list = expectOk(
      await f.as('checker').post('/lending/aml/watch-lists', {
        listCode: 'SETUP_LIST',
        name: 'Setup list',
        fileName: 'list.csv',
        content: LIST,
      }),
    );
    expectOk(
      await f
        .as('admin2')
        .post(`/lending/aml/watch-lists/${list.id}/decision`, { approve: true }),
    );
  }, 180_000);
  afterAll(async () => f?.app.close());

  it('a brand-new organisation: everything still to do, with the reasons', async () => {
    const s = expectOk(await t3get('/lending/setup/status'));
    expect(s.progress.complete).toBe(false);
    expect(s.progress.percent).toBeLessThanOrEqual(15);
    const by = Object.fromEntries(s.items.map((i: any) => [i.key, i]));
    for (const key of [
      'consumer_protection',
      'branches',
      'staff_roles',
      'approval_authorities',
      'business_date',
      'chart_of_accounts',
      'opening_balances',
      'products',
      'impairment_policy',
      'aml_watch_list',
      'aml_settings',
      'alert_emails',
    ])
      expect([key, by[key].status]).toEqual([key, 'TODO']);
    // Waiting on an earlier step, not on this one.
    expect(by.scorecards.status).toBe('BLOCKED');
    expect(by.feature_flags.status).toBe('BLOCKED');
    // Its one administrator is enrolled; single currency needs no FX rate.
    expect(by.admin_mfa.status).toBe('DONE');
    expect(by.fx_rates.reasons[0].code).toBe('singleCurrency');
    expect(by.payment_khqr.status).toBe('NOT_CHECKED');
    expect(by.learning.status).toBe('INFO');
    expect(by.staff_roles.facts.counts.TENANT_ADMIN).toBe(1);
    expect(by.consumer_protection.reasons[0]).toMatchObject({
      code: 'disclosureMissing',
    });
    // Reading the checklist sets nothing up by itself.
    const bd = await f.system(() =>
      f.prisma.tenantBusinessDate.findFirst({ where: { tenantId: t3 } }),
    );
    expect(bd).toBeNull();
  });

  it('a configured organisation: mostly done, and what is left is explained', async () => {
    const s = await status('admin1');
    const by = Object.fromEntries(s.items.map((i: any) => [i.key, i]));
    for (const key of [
      'consumer_protection',
      'branches',
      'staff_roles',
      'admin_mfa',
      'approval_authorities',
      'fx_rates',
      'chart_of_accounts',
      'products',
      'impairment_policy',
      'aml_watch_list',
      'aml_settings',
      'alert_emails',
      'feature_flags',
    ])
      expect([key, by[key].status, by[key].reasons]).toEqual([
        key,
        'DONE',
        key === 'fx_rates' ? [expect.objectContaining({ code: 'singleCurrency' })] : [],
      ]);
    expect(by.products.facts.products).toEqual(['PL-SETUP']);
    // The fixture's business date (2026-01-05) is far behind the calendar.
    expect(by.business_date.status).toBe('TODO');
    expect(by.business_date.reasons[0].code).toBe('businessDateBehind');
    expect(by.opening_balances.status).toBe('TODO');
    // The template's champion scorecard is not one of the lender's own.
    expect(by.scorecards.status).toBe('TODO');
    expect(by.scorecards.reasons[0].code).toBe('scorecardOnTemplate');
    expect(s.progress.percent).toBeGreaterThanOrEqual(75);
    expect(s.progress.complete).toBe(false);
  });

  it('marks waivable items not applicable, audited; never the ones every lender needs', async () => {
    const reason = 'New lender: no existing loan book to migrate';
    const marked = expectOk(
      await f
        .as('admin1')
        .put('/lending/setup/items/opening_balances/not-applicable', { reason }),
    );
    expect(marked).toMatchObject({ key: 'opening_balances', reason });
    expectOk(
      await f.as('admin1').put('/lending/setup/items/scorecards/not-applicable', {
        reason: 'We accept the default retail scorecard for launch',
      }),
    );
    const s = await status('admin1');
    expect(item(s, 'opening_balances')).toMatchObject({
      status: 'NOT_APPLICABLE',
      waiver: { reason, markedBy: f.users.admin1.id },
    });
    expect(item(s, 'scorecards').status).toBe('NOT_APPLICABLE');

    // Every lender needs an impairment policy; unknown items do not exist.
    const refused = await f
      .as('admin1')
      .put('/lending/setup/items/impairment_policy/not-applicable', {
        reason: 'We would rather not',
      });
    expect(refused.status).toBe(400);
    expect(
      (
        await f
          .as('admin1')
          .put('/lending/setup/items/no_such_item/not-applicable', { reason })
      ).status,
    ).toBe(404);
    // A reason is required.
    expect(
      (
        await f
          .as('admin1')
          .put('/lending/setup/items/fx_rates/not-applicable', { reason: '' })
      ).status,
    ).toBe(400);
    // Finance reads the checklist but cannot mark it.
    expect((await f.as('finance').get('/lending/setup/status')).status).toBe(200);
    expect(
      (
        await f
          .as('finance')
          .put('/lending/setup/items/fx_rates/not-applicable', { reason })
      ).status,
    ).toBe(403);
    // Loan officers do not see it at all.
    expect((await f.as('ro').get('/lending/setup/status')).status).toBe(403);

    const audit = await f.system(() =>
      f.prisma.auditEvent.findMany({
        where: { tenantId: f.t1, action: 'tenant_setup.not_applicable' },
      }),
    );
    expect(audit.map((a: any) => a.details.item).sort()).toEqual([
      'opening_balances',
      'scorecards',
    ]);

    // Clearing the mark puts the item back, audited.
    expectOk(
      await del('admin1', '/lending/setup/items/scorecards/not-applicable'),
    );
    expect(item(await status('admin1'), 'scorecards').status).toBe('TODO');
    const cleared = await f.system(() =>
      f.prisma.auditEvent.count({
        where: { tenantId: f.t1, action: 'tenant_setup.applicable' },
      }),
    );
    expect(cleared).toBe(1);
  });

  it('reflects real changes on the next read: a pending role, the business date', async () => {
    // A risk officer's assignment withdrawn → the role is missing again.
    await f.system(() =>
      f.prisma.roleAssignment.updateMany({
        where: {
          tenantId: f.t1,
          userId: { in: [f.users.checker.id, f.users.admin2.id] },
          role: { code: 'RISK_COMPLIANCE' },
        },
        data: { status: 'PENDING' },
      }),
    );
    let s = await status('admin1');
    expect(item(s, 'staff_roles').status).toBe('BLOCKED');
    expect(item(s, 'staff_roles').reasons[0]).toMatchObject({
      code: 'roleAwaitingApproval',
      params: { role: 'RISK_COMPLIANCE' },
    });
    await f.system(() =>
      f.prisma.roleAssignment.updateMany({
        where: { tenantId: f.t1, status: 'PENDING', role: { code: 'RISK_COMPLIANCE' } },
        data: { status: 'ACTIVE' },
      }),
    );

    // Business date caught up to the calendar → done.
    await f.system(() =>
      f.prisma.tenantBusinessDate.update({
        where: { tenantId: f.t1 },
        data: { businessDate: new Date(Date.now()) },
      }),
    );
    s = await status('admin1');
    expect(item(s, 'staff_roles').status).toBe('DONE');
    expect(item(s, 'business_date').status).toBe('DONE');
    expect(item(s, 'business_date').facts.timeZone).toEqual(expect.any(String));
  });

  it('keeps each organisation to its own data', async () => {
    // Tenant 2 has none of tenant 1's configuration.
    const other = await status('t2admin');
    for (const key of ['products', 'impairment_policy', 'aml_watch_list', 'consumer_protection'])
      expect([key, item(other, key).status]).toEqual([key, 'TODO']);
    expect(item(other, 'opening_balances').status).toBe('TODO');
    expect(item(other, 'opening_balances').waiver).toBeNull();
    // Tenant 2 marking an item touches only its own checklist.
    expectOk(
      await f.as('t2admin').put('/lending/setup/items/alert_emails/not-applicable', {
        reason: 'Alerts go to the platform operator only for now',
      }),
    );
    expect(item(await status('admin1'), 'alert_emails').waiver).toBeNull();
    // Row-level security holds behind the guard: tenant 1's context cannot see tenant 2's mark.
    const { runAsTenant } = require('../../src/prisma/tenant-context');
    const seen = await runAsTenant(f.t1, () =>
      f.prisma.$transaction((tx: any) =>
        tx.$queryRawUnsafe(
          'SELECT count(*)::int AS n FROM "GoLiveSetupWaiver" WHERE "tenantId" = $1',
          f.t2,
        ),
      ),
    );
    expect(seen[0].n).toBe(0);
    // Platform administrators have no tenant checklist.
    expect((await f.as('platform').get('/lending/setup/status')).status).toBe(403);
  });

  it('shows the platform operator each organisation’s progress, counts only', async () => {
    const res = expectOk(await f.as('platform').get('/platform/setup-progress'));
    const one = res.tenants.find((t: any) => t.tenantId === f.t1);
    const fresh = res.tenants.find((t: any) => t.tenantId === t3);
    expect(one.progress.percent).toBeGreaterThan(fresh.progress.percent);
    expect(fresh.open.map((o: any) => o.key)).toContain('products');
    expect(Object.keys(one)).toEqual(['tenantId', 'name', 'status', 'progress', 'open']);
    // Tenant staff cannot read it.
    expect((await f.as('admin1').get('/platform/setup-progress')).status).toBe(403);
  });
});
