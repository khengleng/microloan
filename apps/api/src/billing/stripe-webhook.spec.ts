import { BadRequestException } from '@nestjs/common';
import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { StripeWebhookService } from './stripe-webhook.service';
import { jsonBodyParserOptions } from './raw-body';

/**
 * The webhook could never verify: the parsed body was handed to Stripe's
 * verifier instead of the bytes Stripe signed (D-166). Signed here with
 * Stripe's own test helper — no network, no API key.
 */
describe('Stripe webhook signature', () => {
  const secret = `whsec_test_${randomUUID().replace(/-/g, '')}`;
  const payload = JSON.stringify({
    id: 'evt_unit',
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_unit' } },
  });
  const sign = (p: string, s = secret) =>
    Stripe.webhooks.generateTestHeaderString({ payload: p, secret: s });

  it('verifies the raw bytes Stripe signed', () => {
    const event = StripeWebhookService.verify(Buffer.from(payload), sign(payload), secret);
    expect(event).toMatchObject({ id: 'evt_unit', type: 'checkout.session.completed' });
  });

  it('refuses the same JSON re-serialised, a wrong secret, a missing header or body', () => {
    const reserialised = Buffer.from(JSON.stringify(JSON.parse(payload), null, 2));
    expect(() => StripeWebhookService.verify(reserialised, sign(payload), secret)).toThrow(
      BadRequestException,
    );
    expect(() =>
      StripeWebhookService.verify(Buffer.from(payload), sign(payload, 'whsec_other'), secret),
    ).toThrow(BadRequestException);
    expect(() => StripeWebhookService.verify(Buffer.from(payload), undefined, secret)).toThrow(
      BadRequestException,
    );
    expect(() => StripeWebhookService.verify(undefined, sign(payload), secret)).toThrow(
      BadRequestException,
    );
  });
});

describe('raw body capture', () => {
  const { verify, limit } = jsonBodyParserOptions('1mb');
  const buf = Buffer.from('{"a":1}');

  it('keeps the raw bytes for the webhook route only', () => {
    const hook: any = { originalUrl: '/v1/billing/webhook?x=1' };
    verify(hook, undefined, buf);
    expect(hook.rawBody).toBe(buf);
    const other: any = { originalUrl: '/v1/lending/loans' };
    verify(other, undefined, buf);
    expect(other.rawBody).toBeUndefined();
    expect(limit).toBe('1mb');
  });
});
