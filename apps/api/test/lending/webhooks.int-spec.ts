/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-require-imports -- integration fixtures: modules are required after the test environment is configured, and fixture rows come from the untyped API responses. */
/**
 * Webhooks: an organisation's lending events delivered to its own systems,
 * signed, retried, activated only by a second administrator, and never sent
 * into private networks.
 */
import { createHmac } from 'node:crypto';
import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { Fixture, TEST_DB, bootstrap, expectOk, key } from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Webhooks (integration)', () => {
  let f: Fixture;
  let server: Server;
  let url: string;
  let webhooks: any;
  let failNext = 0;
  const received: { headers: IncomingMessage['headers']; body: string }[] = [];

  beforeAll(async () => {
    process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS = 'true';
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (failNext > 0) {
          failNext--;
          res.statusCode = 500;
          return res.end('boom');
        }
        received.push({ headers: req.headers, body });
        res.statusCode = 204;
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
    f = await bootstrap();
    await standardRoles(f);
    const {
      WebhooksService,
    } = require('../../src/lending/integrations/webhooks.service');
    webhooks = f.app.get(WebhooksService);
  }, 90_000);
  afterAll(async () => {
    delete process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS;
    await f?.app.close();
    await new Promise((r) => server.close(r));
  });

  let endpoint: any;
  let secret: string;

  it('private-network endpoints are refused outside development', async () => {
    delete process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS;
    const res = await f
      .as('admin1')
      .post('/lending/webhooks', { url, topics: ['lending.disbursed'] });
    expect(res.status).toBe(400);
    const internal = await f.as('admin1').post('/lending/webhooks', {
      url: 'https://10.0.0.5/hook',
      topics: ['lending.disbursed'],
    });
    expect(internal.status).toBe(400);
    // Internal addresses spelled as IPv6 (D-144): IPv4-mapped in hex,
    // IPv4-compatible, NAT64 and 6to4 all reach an IPv4 host.
    for (const hook of [
      'https://[::ffff:7f00:1]/hook',
      'https://[::7f00:1]/hook',
      'https://[64:ff9b::a9fe:a9fe]/hook',
      'https://[2002:a00:5::]/hook',
    ]) {
      const res6 = await f.as('admin1').post('/lending/webhooks', {
        url: hook,
        topics: ['lending.disbursed'],
      });
      expect([hook, res6.status]).toEqual([hook, 400]);
    }
    process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS = 'true';
  });

  it('an endpoint shows its secret once and waits for a second administrator', async () => {
    expect(
      (
        await f
          .as('admin1')
          .post('/lending/webhooks', { url, topics: ['lending.nope'] })
      ).status,
    ).toBe(400);
    const created = expectOk(
      await f.as('admin1').post('/lending/webhooks', {
        url,
        topics: ['lending.disbursed', 'lending.repayment'],
        description: 'Core banking',
      }),
    );
    expect(created.status).toBe('PENDING_APPROVAL');
    expect(created.secret).toMatch(/^whsec_/);
    secret = created.secret;
    const list = expectOk(await f.as('admin1').get('/lending/webhooks'));
    expect(JSON.stringify(list)).not.toContain(secret);
    expect(
      (
        await f
          .as('admin1')
          .post(`/lending/webhooks/${created.id}/decision`, { approve: true })
      ).status,
    ).toBe(403);
    endpoint = expectOk(
      await f
        .as('admin2')
        .post(`/lending/webhooks/${created.id}/decision`, { approve: true }),
    );
    expect(endpoint.status).toBe('ACTIVE');
    expect((await f.as('ro').get('/lending/webhooks')).status).toBe(403);
  });

  it('a disbursement reaches the endpoint, signed with the secret', async () => {
    const { productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-HOOK',
      (c) => {
        c.pricing.fees = [];
      },
    );
    const { loanId } = await originateAndDisburse(f, productId, {
      principal: '1000',
      numberOfInstalments: 6,
      disbursementDate: '2026-01-05',
    });
    // Two API instances running the delivery tick at once: each delivery is
    // claimed before it is sent, so the event arrives once.
    const WebhooksService = webhooks.constructor;
    const other = new WebhooksService(
      webhooks.prisma,
      webhooks.lp,
      webhooks.policy,
      webhooks.audit,
    );
    await Promise.all([webhooks.runOnce(), other.runOnce()]);
    const hits = received.filter(
      (r) => JSON.parse(r.body).type === 'lending.disbursed',
    );
    expect(hits).toHaveLength(1);
    const hit = hits[0];
    expect(hit).toBeTruthy();
    const body = JSON.parse(hit.body);
    expect(body.data.loanAccountId).toBe(loanId);
    const ts = Number(hit.headers['x-webhook-timestamp']);
    const expected = `v1=${createHmac('sha256', secret).update(`${ts}.${hit.body}`).digest('hex')}`;
    expect(hit.headers['x-webhook-signature']).toBe(expected);
    // Each event is delivered once, however often the job runs.
    const before = received.length;
    await webhooks.runOnce();
    expect(received.length).toBe(before);
  });

  it('a failed delivery is retried later; the history shows each attempt; a test event can be sent', async () => {
    failNext = 1;
    const ping = expectOk(
      await f.as('admin1').post(`/lending/webhooks/${endpoint.id}/ping`),
    );
    expect(ping.status).toBe('PENDING');
    expect(ping.responseStatus).toBe(500);
    expect(ping.attempts).toBe(1);
    const list = expectOk(
      await f.as('admin1').get(`/lending/webhooks/${endpoint.id}/deliveries`),
    );
    expect(list.some((x: any) => x.topic === 'webhook.ping')).toBe(true);
    const again = expectOk(
      await f.as('admin1').post(`/lending/webhooks/${endpoint.id}/ping`),
    );
    expect(again.status).toBe('SENT');
  });

  it('a rotated secret signs the next delivery; a switched-off endpoint receives nothing', async () => {
    const r = expectOk(
      await f
        .as('admin1')
        .post(`/lending/webhooks/${endpoint.id}/rotate-secret`),
    );
    expect(r.secret).not.toBe(secret);
    const ping = expectOk(
      await f.as('admin1').post(`/lending/webhooks/${endpoint.id}/ping`),
    );
    expect(ping.status).toBe('SENT');
    const last = received[received.length - 1];
    const ts = Number(last.headers['x-webhook-timestamp']);
    expect(last.headers['x-webhook-signature']).toBe(
      `v1=${createHmac('sha256', r.secret).update(`${ts}.${last.body}`).digest('hex')}`,
    );

    expectOk(
      await f.as('admin1').post(`/lending/webhooks/${endpoint.id}/disable`),
    );
    expect(
      (await f.as('admin1').post(`/lending/webhooks/${endpoint.id}/ping`))
        .status,
    ).toBe(409);
    expectOk(
      await f.as('admin1').post(`/lending/webhooks/${endpoint.id}/enable`),
    );
    expectOk(
      await f
        .as('admin2')
        .post(`/lending/webhooks/${endpoint.id}/decision`, { approve: true }),
    );
    void key;
  });
});
