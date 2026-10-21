/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * The plan's quotas on the lending platform (D-167): running loans at
 * booking, products at creation, active staff at user creation; the tenant's
 * usage meter and the platform operator's usage per organisation.
 */
import { randomUUID } from 'node:crypto';
import {
  Fixture,
  TEST_DB,
  acceptKeyFacts,
  bootstrap,
  borrower,
  expectOk,
} from './harness';
import {
  activeProduct,
  docs,
  originateAndDisburse,
  standardRoles,
} from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Plan quotas on the lending platform (integration)', () => {
  let f: Fixture;
  const tier = `QUOTA_${randomUUID().slice(0, 8).toUpperCase()}`;
  let productId: string;

  const setTier = (data: Record<string, number | null>) =>
    f.system(() => f.prisma.planTier.update({ where: { name: tier }, data }));

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    await f.system(async () => {
      await f.prisma.planTier.create({
        data: {
          name: tier,
          displayName: 'Quota test',
          priceAmount: 0,
          maxUsers: null,
          maxBorrowers: null,
          maxLoanProducts: 1,
          maxLoans: 1,
          isActive: false,
        },
      });
      await f.prisma.tenant.update({
        where: { id: f.t1 },
        data: { plan: tier },
      });
    });
    productId = (
      await activeProduct(f, 'PERSONAL_INSTALMENT', 'PL-QUOTA', (c) => {
        c.pricing.fees = [];
      })
    ).productId;
  }, 120_000);
  afterAll(async () => {
    if (f)
      await f.system(async () => {
        await f.prisma.tenant.update({
          where: { id: f.t1 },
          data: { plan: 'ENTERPRISE' },
        });
        await f.prisma.planTier.delete({ where: { name: tier } });
      });
    await f?.app.close();
  });

  const terms = {
    principal: '1000',
    numberOfInstalments: 6,
    disbursementDate: '2026-01-05',
  };

  /** Application to the point of booking; returns the booking response. */
  async function toBooking() {
    const b = await borrower(f, f.t1, f.b1);
    const app = expectOk(
      await f
        .as('ro')
        .post('/lending/applications', { borrowerId: b.id, productId, terms }),
    );
    await docs(f, app.id, ['ID_DOCUMENT']);
    expectOk(await f.as('ro').post(`/lending/applications/${app.id}/submit`));
    expectOk(
      await f.as('analyst').post(`/lending/applications/${app.id}/recommend`, {
        recommendation: 'APPROVE',
        rationale: 'Affordable and within policy',
      }),
    );
    expectOk(
      await f.as('approver').post(`/lending/applications/${app.id}/approve`, {
        rationale: 'Approved within authority',
      }),
    );
    await acceptKeyFacts(f, app.id);
    return f.as('opsMaker').post(`/lending/applications/${app.id}/book`, {});
  }

  it('a second product is refused at the plan’s product ceiling, with the numbers', async () => {
    const tpl = expectOk(
      await f.as('maker').get('/lending/templates/PERSONAL_INSTALMENT'),
    );
    const res = await f.as('maker').post('/lending/products', {
      templateCode: 'PERSONAL_INSTALMENT',
      code: 'PL-QUOTA-2',
      name: 'Second product',
      config: tpl.defaultConfig,
    });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      resource: 'loanProducts',
      limit: 1,
      used: 1,
      plan: tier,
    });
    expect(res.body.message).toContain('Upgrade');
  });

  it('booking is refused once the running loans reach the ceiling; raising the tier lets it through', async () => {
    await originateAndDisburse(f, productId, terms);
    const refused = await toBooking();
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      resource: 'loans',
      limit: 1,
      used: 1,
    });
    // No in-process cache: the operator's change applies to the next request.
    await setTier({ maxLoans: 2 });
    const booked = await toBooking();
    expect(booked.status).toBe(201);
    expect(booked.body.account.status).toBe('BOOKED');
  }, 120_000);

  it('the tenant admin sees the usage meter; the operator sees every organisation', async () => {
    const usage = expectOk(await f.as('admin1').get('/billing/usage'));
    expect(usage).toMatchObject({ plan: tier, displayName: 'Quota test' });
    const by = Object.fromEntries(usage.items.map((i: any) => [i.resource, i]));
    expect(by.loans).toEqual({ resource: 'loans', used: 2, limit: 2 });
    expect(by.loanProducts).toEqual({
      resource: 'loanProducts',
      used: 1,
      limit: 1,
    });
    expect(by.users.limit).toBeNull();
    expect(by.users.used).toBeGreaterThan(0);
    // A loan officer is not a billing administrator.
    expect((await f.as('ro').get('/billing/usage')).status).toBe(403);

    const all = expectOk(
      await f.as('platform').get('/tenants/plan-usage/list'),
    );
    const mine = all.find((t: any) => t.tenantId === f.t1);
    expect(mine).toMatchObject({ plan: tier, overLimit: false });
    expect(mine.items.find((i: any) => i.resource === 'loans').used).toBe(2);
    expect((await f.as('admin1').get('/tenants/plan-usage/list')).status).toBe(
      403,
    );
  });

  it('a seat ceiling counts active staff only and refuses a new user when full', async () => {
    const active = await f.system(() =>
      f.prisma.user.count({ where: { tenantId: f.t1, isActive: true } }),
    );
    await setTier({ maxUsers: active });
    const res = await f.as('admin1').post('/users', {
      email: `quota-${randomUUID().slice(0, 8)}@test.local`,
      password: 'Quota-test-password-1!',
      role: 'LOAN_OFFICER',
    });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      resource: 'users',
    });
    await setTier({ maxUsers: null });
  });
});
