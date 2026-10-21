/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-require-imports -- integration fixtures: fixture rows come from the untyped Prisma client; services are required after the environment is configured. */
/**
 * The Stripe webhook end to end (D-166): signed over the raw body with
 * Stripe's own test signing helper (no network), applied once per event id,
 * and never reactivating a suspended or erasure-pending organisation — those
 * wait for the platform operator as NEEDS_REVIEW and raise an alert.
 */
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { Fixture, TEST_DB, bootstrap, expectOk } from './harness';

const d = TEST_DB ? describe : describe.skip;

d('Stripe webhook (integration)', () => {
  let f: Fixture;
  const secret = `whsec_test_${randomUUID().replace(/-/g, '')}`;
  const saved = process.env.STRIPE_WEBHOOK_SECRET;
  const events: string[] = [];
  const customer = `cus_${randomUUID().slice(0, 12)}`;

  beforeAll(async () => {
    f = await bootstrap();
    process.env.STRIPE_WEBHOOK_SECRET = secret;
    await f.system(() =>
      f.prisma.tenant.update({
        where: { id: f.t1 },
        data: { stripeCustomerId: customer },
      }),
    );
  }, 60_000);
  afterAll(async () => {
    if (saved === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = saved;
    if (f)
      await f.system(() =>
        f.prisma.stripeWebhookEvent.deleteMany({
          where: { id: { in: events } },
        }),
      );
    await f?.app.close();
  });

  const event = (
    type: string,
    object: Record<string, unknown>,
    id?: string,
  ) => {
    const evtId = id ?? `evt_${randomUUID().replace(/-/g, '')}`;
    if (!events.includes(evtId)) events.push(evtId);
    return JSON.stringify({
      id: evtId,
      object: 'event',
      api_version: '2024-12-18.acacia',
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      type,
      data: { object },
    });
  };
  const checkout = (tenantId: string, plan: string, cust = customer) => ({
    id: `cs_${randomUUID().slice(0, 12)}`,
    object: 'checkout.session',
    payment_status: 'paid',
    customer: cust,
    subscription: `sub_${randomUUID().slice(0, 12)}`,
    metadata: { tenantId, plan },
  });
  const deliver = (payload: string, signature?: string) => {
    let r = f
      .http()
      .post('/v1/billing/webhook')
      .set('Content-Type', 'application/json');
    r = r.set(
      'Stripe-Signature',
      signature ??
        Stripe.webhooks.generateTestHeaderString({ payload, secret }),
    );
    return r.send(payload);
  };
  const tenant = (id: string) =>
    f.system(() => f.prisma.tenant.findUnique({ where: { id } }));
  const row = (id: string) =>
    f.system(() => f.prisma.stripeWebhookEvent.findUnique({ where: { id } }));
  const idOf = (payload: string) => JSON.parse(payload).id as string;

  it('refuses a delivery whose signature does not match the raw body', async () => {
    const payload = event(
      'checkout.session.completed',
      checkout(f.t1, 'BASIC'),
    );
    const forged = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_not_the_endpoint_secret',
    });
    expect((await deliver(payload, forged)).status).toBe(400);
    // Same bytes re-ordered (what re-serialising the parsed body would send).
    const reordered = JSON.stringify(
      Object.fromEntries(Object.entries(JSON.parse(payload)).reverse()),
    );
    const sig = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect((await deliver(reordered, sig)).status).toBe(400);
    expect(await row(idOf(payload))).toBeNull();
    expect((await tenant(f.t1))!.plan).toBe('ENTERPRISE');
  });

  it('applies a paid checkout to an active organisation once, however often it is delivered', async () => {
    const payload = event(
      'checkout.session.completed',
      checkout(f.t1, 'BASIC'),
    );
    const res = await deliver(payload);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      received: true,
      duplicate: false,
      outcome: 'PROCESSED',
    });
    const t = await tenant(f.t1);
    expect(t).toMatchObject({ plan: 'BASIC', status: 'ACTIVE' });
    expect(t!.stripeSubscriptionId).toMatch(/^sub_/);
    expect(await row(idOf(payload))).toMatchObject({
      outcome: 'PROCESSED',
      tenantRef: f.t1,
      type: 'checkout.session.completed',
    });

    // The operator moves the plan by hand; a redelivery must not undo it.
    await f.system(() =>
      f.prisma.tenant.update({
        where: { id: f.t1 },
        data: { plan: 'ENTERPRISE' },
      }),
    );
    const again = await deliver(payload);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ duplicate: true, outcome: 'PROCESSED' });
    expect((await tenant(f.t1))!.plan).toBe('ENTERPRISE');
  });

  it('never reactivates a suspended or erasure-pending organisation: recorded for review', async () => {
    await f.system(() =>
      f.prisma.tenant.update({
        where: { id: f.t2 },
        data: { status: 'SUSPENDED', stripeCustomerId: `${customer}_2` },
      }),
    );
    const suspended = event(
      'checkout.session.completed',
      checkout(f.t2, 'PROFESSIONAL', `${customer}_2`),
    );
    expect((await deliver(suspended)).body).toMatchObject({
      outcome: 'NEEDS_REVIEW',
    });
    expect(await tenant(f.t2)).toMatchObject({
      status: 'SUSPENDED',
      plan: 'PROFESSIONAL',
    });
    expect((await row(idOf(suspended)))!.detail).toContain('NOT reactivated');

    await f.system(() =>
      f.prisma.tenant.update({
        where: { id: f.t2 },
        data: { deletedAt: new Date(), plan: 'ENTERPRISE' },
      }),
    );
    const erasing = event(
      'checkout.session.completed',
      checkout(f.t2, 'BASIC', `${customer}_2`),
    );
    expect((await deliver(erasing)).body).toMatchObject({
      outcome: 'NEEDS_REVIEW',
    });
    expect(await tenant(f.t2)).toMatchObject({
      status: 'SUSPENDED',
      plan: 'ENTERPRISE',
    });
    await f.system(() =>
      f.prisma.tenant.update({
        where: { id: f.t2 },
        data: { status: 'ACTIVE', deletedAt: null },
      }),
    );

    // A plan that is not a tier, and a customer that is not the organisation's.
    const unknownPlan = event(
      'checkout.session.completed',
      checkout(f.t1, 'PRO'),
    );
    expect((await deliver(unknownPlan)).body).toMatchObject({
      outcome: 'NEEDS_REVIEW',
    });
    const otherCustomer = event(
      'checkout.session.completed',
      checkout(f.t1, 'BASIC', 'cus_someone_else'),
    );
    expect((await deliver(otherCustomer)).body).toMatchObject({
      outcome: 'NEEDS_REVIEW',
    });
    expect((await tenant(f.t1))!.plan).toBe('ENTERPRISE');
  });

  it('the operator is alerted until each event is marked reviewed', async () => {
    const {
      OperationalAlertService,
    } = require('../../src/lending/monitoring/operational-alerts.service');
    const monitor = f.app.get(OperationalAlertService);
    const finding = async () =>
      (await monitor.platformFindings()).find(
        (x: any) => x.key === 'billing.webhook_review',
      );
    expect((await finding())?.details.count).toBeGreaterThanOrEqual(4);

    const waiting = expectOk(
      await f.as('platform').get('/billing/webhook-events'),
    );
    const mine = waiting.filter((e: any) => events.includes(e.id));
    expect(mine).toHaveLength(4);
    expect((await f.as('admin1').get('/billing/webhook-events')).status).toBe(
      403,
    );
    for (const e of mine) {
      const done = expectOk(
        await f.as('platform').post(`/billing/webhook-events/${e.id}/review`),
      );
      expect(done.reviewedBy).toBe(f.users.platform.id);
    }
    expect(
      (
        await f
          .as('platform')
          .post(`/billing/webhook-events/${mine[0].id}/review`)
      ).status,
    ).toBe(404);
    expect(await finding()).toBeUndefined();
  });

  it('a failed payment suspends only an active organisation; unknown events are ignored', async () => {
    const ignored = event('customer.created', {
      id: customer,
      object: 'customer',
    });
    expect((await deliver(ignored)).body).toMatchObject({ outcome: 'IGNORED' });

    const failed = event('invoice.payment_failed', {
      id: `in_${randomUUID().slice(0, 12)}`,
      object: 'invoice',
      customer,
    });
    expect((await deliver(failed)).body).toMatchObject({
      outcome: 'PROCESSED',
    });
    expect((await tenant(f.t1))!.status).toBe('SUSPENDED');
    const failedAgain = event('invoice.payment_failed', {
      id: `in_${randomUUID().slice(0, 12)}`,
      object: 'invoice',
      customer,
    });
    expect((await deliver(failedAgain)).body).toMatchObject({
      outcome: 'IGNORED',
    });
    await f.system(() =>
      f.prisma.tenant.update({
        where: { id: f.t1 },
        data: { status: 'ACTIVE' },
      }),
    );
  });
});
