import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as qrcode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { SystemContext } from '../prisma/tenant-context';
import type { PlanTierView } from '../plan-tiers/plan-tier.service';
import { buildKhqrPayload } from './khqr';
import { PlatformQrService } from './platform-qr.service';

/** How long an unpaid signup QR stays valid before it must be regenerated. */
const PAYMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SignupPaymentView = {
  reference: string;
  plan: string;
  amount: string;
  currency: string;
  status: string;
  expiresAt: Date;
  qrPayload: string;
  /** data: URI PNG, so the client needs no QR library of its own. */
  qrImage: string;
  organizationName: string;
};

/**
 * The payment gate on self-serve workspace signup.
 *
 * A paid workspace is created in PENDING_PAYMENT with a KHQR attached. Nobody
 * can authenticate into it — `JwtStrategy` already rejects any non-ACTIVE
 * tenant — until a SUPERADMIN confirms the transfer landed. There is no Bakong
 * settlement API to check against, so confirmation is a deliberate human step
 * rather than something this service can automate.
 */
@Injectable()
export class SignupPaymentService {
  private readonly logger = new Logger(SignupPaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly platformQr: PlatformQrService,
  ) {}

  /**
   * Whether paid signup can be offered. Now a DB question, because the
   * merchant profile comes from the operator's uploaded QR (falling back to
   * the KHQR_* env vars).
   */
  async isConfigured(): Promise<boolean> {
    return this.platformQr.isConfigured();
  }

  /**
   * Mint the payment record and QR for a newly provisioned tenant.
   * Runs inside the caller's transaction when one is supplied, so a failure to
   * build the QR rolls the whole signup back rather than stranding a tenant in
   * PENDING_PAYMENT with nothing to pay against.
   */
  async createForTenant(
    tenantId: string,
    tier: PlanTierView,
    tx?: { planPayment: { create: (args: unknown) => Promise<unknown> } },
  ): Promise<{
    reference: string;
    qrPayload: string;
    amount: number;
    currency: string;
  }> {
    const merchant = await this.platformQr.resolveMerchant();
    if (!merchant) {
      throw new ServiceUnavailableException(
        'Paid plans are unavailable: this platform has no KHQR merchant configured. ' +
          'Choose the FREE plan or contact platform support.',
      );
    }

    // Priced from the tier row the operator configured, read at mint time so a
    // price change takes effect on the next signup without a deploy.
    const { amount, currency } = tier;
    // 24 hex chars: unguessable enough to act as a bearer handle for an
    // unauthenticated applicant, short enough to read off a bank receipt.
    const reference = randomBytes(12).toString('hex').toUpperCase();

    // Minted fresh from the operator's merchant details with THIS plan's price
    // embedded — never a copy of whatever code they uploaded.
    const qrPayload = buildKhqrPayload(merchant, {
      amount,
      currency,
      billNumber: reference,
    });

    const data = {
      tenantId,
      plan: tier.name,
      amount,
      currency,
      reference,
      qrPayload,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + PAYMENT_TTL_MS),
    };

    const client = tx ?? this.prisma;
    await (client as typeof this.prisma).planPayment.create({
      data: data as never,
    });

    return { reference, qrPayload, amount, currency };
  }

  /**
   * Public status lookup for an applicant who cannot log in yet.
   *
   * Deliberately narrow: it returns the payment and the organization name and
   * nothing else — no user, no email, no tenant internals — because the
   * reference is the only credential the caller holds.
   */
  @SystemContext('pre-auth: applicant re-opening their signup payment QR')
  async findByReference(reference: string): Promise<SignupPaymentView> {
    const payment = await this.prisma.planPayment.findUnique({
      where: { reference },
      include: { tenant: { select: { name: true, status: true } } },
    });
    if (!payment) throw new NotFoundException('Payment reference not found.');

    const expired =
      payment.status === 'PENDING' && payment.expiresAt.getTime() < Date.now();

    return {
      reference: payment.reference,
      plan: payment.plan,
      amount: payment.amount.toString(),
      currency: payment.currency,
      status: expired ? 'EXPIRED' : payment.status,
      expiresAt: payment.expiresAt,
      qrPayload: payment.qrPayload,
      qrImage: await qrcode.toDataURL(payment.qrPayload, {
        width: 320,
        margin: 1,
      }),
      organizationName: payment.tenant.name,
    };
  }

  /** Render a payload the caller already holds, without a second DB read. */
  async renderQr(qrPayload: string): Promise<string> {
    return qrcode.toDataURL(qrPayload, { width: 320, margin: 1 });
  }
}
