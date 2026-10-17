import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { createHmac, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Prisma } from '@microloan/db';
import { PrismaService } from '../../prisma/prisma.service';
import { runAsSystem } from '../../prisma/tenant-context';
import { LendingPrisma } from '../common/lending-prisma';
import { AuditEventService } from '../common/audit-event.service';
import { LendingActor, requireTenant } from '../common/util';
import { PolicyService } from '../policy/policy.service';
import { publicExplanation } from '../policy/decision';
import { tenantResource } from '../policy/resources';
import { decryptField, encryptField } from '../../common/field-crypto';

type Json = Prisma.InputJsonValue;

/** The events an organisation can subscribe to, with what each means. */
export const WEBHOOK_TOPICS: { topic: string; description: string }[] = [
  { topic: 'lending.disbursed', description: 'A loan was paid out.' },
  { topic: 'lending.repayment', description: 'A repayment was posted.' },
  { topic: 'lending.settled', description: 'A loan was settled early.' },
  {
    topic: 'lending.loan_closed',
    description: 'A loan was repaid in full and closed.',
  },
  {
    topic: 'lending.payment_returned',
    description: 'A repayment bounced or was returned.',
  },
  { topic: 'lending.restructured', description: 'A loan was restructured.' },
  {
    topic: 'lending.collection.notice',
    description:
      'An arrears SMS or notice was raised by the collections ladder.',
  },
  {
    topic: 'lending.auto_debit.failed',
    description: 'A direct debit was refused by the bank.',
  },
  {
    topic: 'lending.guarantor.demand',
    description: 'A guarantor was called to pay.',
  },
  {
    topic: 'lending.covenant.breached',
    description: 'A covenant test failed.',
  },
  {
    topic: 'lending.period.ready_for_approval',
    description: 'A month-end close is waiting for approval.',
  },
  { topic: 'lending.loan_sold', description: 'A loan was sold.' },
  {
    topic: 'lending.repossession_sold',
    description: 'Repossessed collateral was sold.',
  },
  {
    topic: 'lending.trade.lc_issued',
    description: 'A letter of credit was issued.',
  },
  { topic: 'webhook.ping', description: 'A test event sent from the console.' },
];
const KNOWN = new Set(WEBHOOK_TOPICS.map((t) => t.topic));

const MAX_ATTEMPTS = 15;
const DISABLE_AFTER_FAILURES = 50;

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80'))
      return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? privateAddress(mapped[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

/** Sign a delivery the way receivers verify it: HMAC-SHA256 over "timestamp.body". */
export function signWebhook(secret: string, timestamp: number, body: string) {
  return `v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

/**
 * Webhooks: the organisation's own systems receive its lending events.
 *
 * - Endpoints are HTTPS URLs on the public internet; addresses on private,
 *   loopback or link-local networks are refused (no requests into our own
 *   network), checked when registered and again before each delivery.
 * - One administrator registers an endpoint; another activates it, since it
 *   sends customer and loan data outside the platform.
 * - Every event already goes through the transactional outbox; each message
 *   is fanned out to the matching active endpoints once, then delivered with
 *   a signature, retried with backoff, and given up after 15 attempts. An
 *   endpoint that keeps failing is switched off.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
  ) {}

  private access(tenantId: string, makers: string[] = []) {
    return tenantResource(tenantId, 'ACCESS', 'access', makers);
  }

  private allowPrivate() {
    return (
      process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS === 'true' &&
      process.env.NODE_ENV !== 'production'
    );
  }

  /** Refuse anything but a public HTTPS endpoint. */
  async checkUrl(raw: string) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new BadRequestException('The endpoint is not a valid URL.');
    }
    const relaxed = this.allowPrivate();
    if (url.protocol !== 'https:' && !(relaxed && url.protocol === 'http:'))
      throw new BadRequestException('Webhook endpoints must use HTTPS.');
    if (url.username || url.password)
      throw new BadRequestException(
        'Put credentials in the signing secret, not the URL.',
      );
    if (relaxed) return url;
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host)
      ? [host]
      : (await lookup(host, { all: true }).catch(() => [])).map(
          (a) => a.address,
        );
    if (!addresses.length)
      throw new BadRequestException(`${host} does not resolve.`);
    if (addresses.some(privateAddress))
      throw new BadRequestException(
        'Webhook endpoints must be on the public internet.',
      );
    return url;
  }

  private view<T extends { secret: string }>(e: T) {
    const { secret: _s, ...rest } = e;
    return rest;
  }

  private async can(
    actor: LendingActor,
    action: string,
    makers: string[] = [],
  ) {
    const d = publicExplanation(
      await this.policy.decide(
        actor,
        action,
        this.access(requireTenant(actor), makers),
      ),
    );
    return {
      allowed: d.allowed,
      reason: d.blockedBy.map((b) => b.message).join(' '),
    };
  }

  // ── Endpoints ─────────────────────────────────────────────────────────────

  async list(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'integration.webhook.read',
      this.access(tenantId),
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const rows = await tx.webhookEndpoint.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'asc' },
      });
      const stats = await tx.webhookDelivery.groupBy({
        by: ['endpointId', 'status'],
        where: {
          tenantId,
          createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
        },
        _count: { _all: true },
      });
      return {
        topics: WEBHOOK_TOPICS,
        endpoints: rows.map((e) => ({
          ...this.view(e),
          lastWeek: Object.fromEntries(
            stats
              .filter((s) => s.endpointId === e.id)
              .map((s) => [s.status, s._count._all]),
          ),
        })),
        permissions: {
          manage: await this.can(actor, 'integration.webhook.manage'),
          approve: await this.can(actor, 'integration.webhook.approve'),
        },
      };
    });
  }

  async create(
    actor: LendingActor,
    body: { url: string; description?: string; topics: string[] },
  ) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'integration.webhook.manage',
      this.access(tenantId),
    );
    const url = await this.checkUrl(body.url);
    const topics = body.topics.includes('*')
      ? ['*']
      : [...new Set(body.topics)];
    const unknown = topics.filter((t) => t !== '*' && !KNOWN.has(t));
    if (unknown.length)
      throw new BadRequestException(`Unknown event(s): ${unknown.join(', ')}.`);
    if (!topics.length)
      throw new BadRequestException('Choose at least one event.');
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    return this.lp.tenantTx(tenantId, async (tx) => {
      const row = await tx.webhookEndpoint.create({
        data: {
          tenantId,
          url: url.toString(),
          description: (body.description ?? '').slice(0, 200),
          topics,
          secret: encryptField(secret)!,
          secretPrefix: secret.slice(0, 10),
          createdBy: actor.id,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'integration.webhook.manage',
          resourceType: 'WebhookEndpoint',
          resourceId: row.id,
          outcome: 'SUCCESS',
          details: { url: url.origin, topics },
        },
        tx,
      );
      // The secret is shown once; only its prefix is kept visible.
      return { ...this.view(row), secret };
    });
  }

  async decide(actor: LendingActor, id: string, body: { approve: boolean }) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const e = await tx.webhookEndpoint.findFirst({ where: { id, tenantId } });
      if (!e) throw new NotFoundException('Webhook endpoint not found');
      await this.policy.enforce(
        actor,
        'integration.webhook.approve',
        this.access(tenantId, [e.createdBy]),
        tx,
      );
      if (e.status !== 'PENDING_APPROVAL')
        throw new ConflictException(
          'This endpoint is not waiting for approval.',
        );
      if (body.approve) await this.checkUrl(e.url);
      const row = await tx.webhookEndpoint.update({
        where: { id },
        data: body.approve
          ? {
              status: 'ACTIVE',
              approvedBy: actor.id,
              consecutiveFailures: 0,
              disabledReason: '',
            }
          : { status: 'DISABLED', disabledReason: 'Not approved' },
      });
      await this.audit.write(
        {
          actor,
          action: 'integration.webhook.approve',
          resourceType: 'WebhookEndpoint',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { approve: body.approve },
        },
        tx,
      );
      return this.view(row);
    });
  }

  async disable(actor: LendingActor, id: string) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'integration.webhook.manage',
      this.access(tenantId),
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const res = await tx.webhookEndpoint.updateMany({
        where: { id, tenantId, status: { not: 'DISABLED' } },
        data: {
          status: 'DISABLED',
          disabledReason: `Switched off by ${actor.id}`,
        },
      });
      if (res.count !== 1)
        throw new ConflictException('This endpoint is already off.');
      await this.audit.write(
        {
          actor,
          action: 'integration.webhook.manage',
          resourceType: 'WebhookEndpoint',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { disabled: true },
        },
        tx,
      );
      return { id, status: 'DISABLED' };
    });
  }

  /** Turning an endpoint back on is a new approval by a second administrator. */
  async reenable(actor: LendingActor, id: string) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'integration.webhook.manage',
      this.access(tenantId),
    );
    return this.lp.tenantTx(tenantId, async (tx) => {
      const res = await tx.webhookEndpoint.updateMany({
        where: { id, tenantId, status: 'DISABLED' },
        data: {
          status: 'PENDING_APPROVAL',
          createdBy: actor.id,
          approvedBy: null,
          disabledReason: '',
        },
      });
      if (res.count !== 1)
        throw new ConflictException(
          'Only a switched-off endpoint can be turned back on.',
        );
      return { id, status: 'PENDING_APPROVAL' };
    });
  }

  async rotateSecret(actor: LendingActor, id: string) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'integration.webhook.manage',
      this.access(tenantId),
    );
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    return this.lp.tenantTx(tenantId, async (tx) => {
      const res = await tx.webhookEndpoint.updateMany({
        where: { id, tenantId },
        data: {
          secret: encryptField(secret)!,
          secretPrefix: secret.slice(0, 10),
        },
      });
      if (res.count !== 1)
        throw new NotFoundException('Webhook endpoint not found');
      await this.audit.write(
        {
          actor,
          action: 'integration.webhook.manage',
          resourceType: 'WebhookEndpoint',
          resourceId: id,
          outcome: 'SUCCESS',
          details: { rotated: true },
        },
        tx,
      );
      return { id, secret };
    });
  }

  /** Queue a test event to one endpoint and send it now. */
  async ping(actor: LendingActor, id: string) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'integration.webhook.manage',
      this.access(tenantId),
    );
    const delivery = await this.lp.tenantTx(tenantId, async (tx) => {
      const e = await tx.webhookEndpoint.findFirst({ where: { id, tenantId } });
      if (!e) throw new NotFoundException('Webhook endpoint not found');
      if (e.status !== 'ACTIVE')
        throw new ConflictException('Only an active endpoint can be tested.');
      return tx.webhookDelivery.create({
        data: {
          tenantId,
          endpointId: id,
          topic: 'webhook.ping',
          payload: {
            message: 'Test event from the lending console',
            sentBy: actor.id,
          } as Json,
        },
      });
    });
    await this.deliver(delivery.id);
    return this.lp.tenantTx(tenantId, (tx) =>
      tx.webhookDelivery.findFirst({ where: { id: delivery.id, tenantId } }),
    );
  }

  async deliveries(actor: LendingActor, id: string, q: { status?: string }) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'integration.webhook.read',
      this.access(tenantId),
    );
    return this.lp.tenantTx(tenantId, (tx) =>
      tx.webhookDelivery.findMany({
        where: {
          tenantId,
          endpointId: id,
          ...(q.status ? { status: q.status } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );
  }

  async retry(actor: LendingActor, id: string, deliveryId: string) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(
      actor,
      'integration.webhook.manage',
      this.access(tenantId),
    );
    const res = await this.lp.tenantTx(tenantId, (tx) =>
      tx.webhookDelivery.updateMany({
        where: { id: deliveryId, tenantId, endpointId: id, status: 'FAILED' },
        data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date() },
      }),
    );
    if (res.count !== 1)
      throw new ConflictException('Only a failed delivery can be retried.');
    await this.deliver(deliveryId);
    return this.lp.tenantTx(tenantId, (tx) =>
      tx.webhookDelivery.findFirst({ where: { id: deliveryId, tenantId } }),
    );
  }

  // ── Fan-out and delivery ──────────────────────────────────────────────────

  @Interval('lending-webhooks', 15_000)
  async tick() {
    if (
      process.env.LENDING_WEBHOOKS_DISABLED === 'true' ||
      process.env.NODE_ENV === 'test'
    )
      return;
    await this.runOnce().catch((e) =>
      this.logger.warn(`Webhook run failed: ${(e as Error).message}`),
    );
  }

  /** Fan out new outbox messages, then send what is due. Safe to call from tests. */
  async runOnce() {
    if (this.running) return;
    this.running = true;
    try {
      await this.fanOut();
      const due = await runAsSystem('webhook delivery', () =>
        this.prisma.webhookDelivery.findMany({
          where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } },
          orderBy: { nextAttemptAt: 'asc' },
          take: 100,
          select: { id: true },
        }),
      );
      for (const d of due) await this.deliver(d.id);
    } finally {
      this.running = false;
    }
  }

  private async fanOut() {
    await runAsSystem('webhook fan-out', async () => {
      const endpoints = await this.prisma.webhookEndpoint.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, tenantId: true, topics: true },
      });
      const tenants = [...new Set(endpoints.map((e) => e.tenantId))];
      // Organisations without an active endpoint have nothing to send.
      await this.prisma.outboxMessage.updateMany({
        where: { webhooksQueuedAt: null, tenantId: { notIn: tenants } },
        data: { webhooksQueuedAt: new Date() },
      });
      for (let round = 0; round < 50; round++) {
        const messages = await this.prisma.outboxMessage.findMany({
          where: { webhooksQueuedAt: null, tenantId: { in: tenants } },
          orderBy: { createdAt: 'asc' },
          take: 500,
        });
        if (!messages.length) return;
        const data: Prisma.WebhookDeliveryCreateManyInput[] = [];
        for (const m of messages)
          for (const e of endpoints)
            if (
              e.tenantId === m.tenantId &&
              (e.topics.includes('*') || e.topics.includes(m.topic))
            )
              data.push({
                tenantId: m.tenantId,
                endpointId: e.id,
                outboxMessageId: m.id,
                topic: m.topic,
                payload: m.payload as Json,
              });
        if (data.length)
          await this.prisma.webhookDelivery.createMany({
            data,
            skipDuplicates: true,
          });
        await this.prisma.outboxMessage.updateMany({
          where: { id: { in: messages.map((m) => m.id) } },
          data: { webhooksQueuedAt: new Date() },
        });
        if (messages.length < 500) return;
      }
    });
  }

  private async deliver(deliveryId: string) {
    await runAsSystem('webhook delivery', async () => {
      const d = await this.prisma.webhookDelivery.findFirst({
        where: { id: deliveryId },
        include: { endpoint: true },
      });
      if (!d || d.status !== 'PENDING') return;
      const e = d.endpoint;
      if (e.status !== 'ACTIVE') {
        await this.prisma.webhookDelivery.update({
          where: { id: d.id },
          data: { status: 'FAILED', lastError: 'Endpoint is not active' },
        });
        return;
      }
      const body = JSON.stringify({
        id: d.outboxMessageId ?? d.id,
        type: d.topic,
        createdAt: d.createdAt.toISOString(),
        data: d.payload,
      });
      const ts = Math.floor(Date.now() / 1000);
      const started = Date.now();
      let status: number | null = null;
      let error = '';
      try {
        await this.checkUrl(e.url);
        const res = await fetch(e.url, {
          method: 'POST',
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'MagicMoney-Webhooks/1',
            'X-Webhook-Id': d.outboxMessageId ?? d.id,
            'X-Webhook-Delivery': d.id,
            'X-Webhook-Timestamp': String(ts),
            'X-Webhook-Signature': signWebhook(
              decryptField(e.secret)!,
              ts,
              body,
            ),
          },
          body,
        });
        status = res.status;
        if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
      } catch (err) {
        error = (err as Error).message.slice(0, 300);
      }
      const ok = !error;
      const attempts = d.attempts + 1;
      await this.prisma.webhookDelivery.update({
        where: { id: d.id },
        data: {
          attempts,
          responseStatus: status,
          durationMs: Date.now() - started,
          lastError: error,
          ...(ok
            ? { status: 'SENT', deliveredAt: new Date() }
            : {
                status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
                nextAttemptAt: new Date(
                  Date.now() +
                    Math.min(
                      6 * 3_600_000,
                      30_000 * 2 ** Math.min(attempts, 10),
                    ),
                ),
              }),
        },
      });
      const failures = ok ? 0 : e.consecutiveFailures + 1;
      await this.prisma.webhookEndpoint.update({
        where: { id: e.id },
        data: {
          lastDeliveryAt: new Date(),
          consecutiveFailures: failures,
          ...(ok ? { lastSuccessAt: new Date() } : {}),
          ...(failures >= DISABLE_AFTER_FAILURES
            ? {
                status: 'DISABLED',
                disabledReason: `Switched off after ${failures} failed deliveries in a row`,
              }
            : {}),
        },
      });
    });
  }
}
