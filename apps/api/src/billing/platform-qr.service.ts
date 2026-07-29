import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as qrcode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildKhqrPayload,
  khqrMerchantFromEnv,
  KhqrMerchant,
  parseKhqrPayload,
} from './khqr';
import { readQrFromImage, bufferFromUpload } from './qr-image';
import { PlanTierService } from '../plan-tiers/plan-tier.service';
import { runAsSystem } from '../prisma/tenant-context';

export type UploadKhqrInput = {
  /** Base64 image (optionally a data: URI). PNG or JPEG. */
  image?: string;
  /** Raw EMVCo payload, if the operator already has the text. */
  payload?: string;
};

/**
 * The platform operator's KHQR merchant profile.
 *
 * The operator uploads their own Bakong QR once; it is digested into merchant
 * details and every signup payment code is re-minted from those details with
 * the plan price embedded. The uploaded code's own amount is discarded — a
 * static merchant QR has none, and a dynamic one would otherwise pin every
 * plan to whatever figure happened to be on the screenshot.
 */
@Injectable()
export class PlatformQrService {
  private readonly logger = new Logger(PlatformQrService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly planTiers: PlanTierService,
  ) {}

  /** Digest an upload without persisting — used to preview before saving. */
  digest(input: UploadKhqrInput): {
    merchant: KhqrMerchant;
    payload: string;
    sourceType: string;
  } {
    const hasImage = Boolean(input.image?.trim());
    const hasPayload = Boolean(input.payload?.trim());
    if (!hasImage && !hasPayload) {
      throw new BadRequestException(
        'Provide either a QR image or the KHQR payload text.',
      );
    }

    let payload: string;
    let sourceType: string;
    try {
      if (hasImage) {
        payload = readQrFromImage(bufferFromUpload(input.image!));
        sourceType = 'IMAGE';
      } else {
        payload = input.payload!.trim();
        sourceType = 'PAYLOAD';
      }
    } catch (err) {
      // These messages are written for the operator ("crop the screenshot",
      // "checksum mismatch"), so surface them rather than a generic 400.
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Could not read that QR code.',
      );
    }

    let parsed;
    try {
      parsed = parseKhqrPayload(payload);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'That is not a valid KHQR code.',
      );
    }

    return {
      merchant: {
        bakongAccountId: parsed.bakongAccountId,
        merchantName: parsed.merchantName,
        merchantCity: parsed.merchantCity,
        merchantCategoryCode: parsed.merchantCategoryCode,
      },
      payload,
      sourceType,
    };
  }

  /** Digest, verify it can actually mint a payable code, then store it. */
  async upload(input: UploadKhqrInput, uploadedByUserId: string) {
    const { merchant, payload, sourceType } = this.digest(input);

    // Round-trip before saving: if these details cannot produce a valid
    // payload, that must fail here in front of the operator rather than
    // silently at a customer's phone during signup.
    let sample: string;
    try {
      sample = buildKhqrPayload(merchant, {
        amount: 1,
        currency: 'USD',
        billNumber: 'VALIDATE',
      });
    } catch (err) {
      throw new BadRequestException(
        `That QR was read, but a payment code cannot be generated from it: ` +
          `${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }

    const record = await this.prisma.$transaction(async (tx) => {
      // Only one active profile at a time; superseded rows stay for audit.
      await tx.platformPaymentQr.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });
      return tx.platformPaymentQr.create({
        data: {
          bakongAccountId: merchant.bakongAccountId,
          merchantName: merchant.merchantName,
          merchantCity: merchant.merchantCity,
          merchantCategoryCode: merchant.merchantCategoryCode ?? '6012',
          sourcePayload: payload,
          sourceType,
          uploadedByUserId,
          isActive: true,
        },
      });
    });

    this.logger.log(
      `Platform KHQR updated: ${merchant.merchantName} (${merchant.bakongAccountId})`,
    );

    return {
      id: record.id,
      merchant,
      sourceType,
      samplePayloadLength: sample.length,
      createdAt: record.createdAt,
    };
  }

  /** The active merchant profile, or null when none has been uploaded. */
  async active(): Promise<KhqrMerchant | null> {
    /*
     * Read as system.
     *
     * PlatformPaymentQr is PLATFORM_ONLY in the Prisma tenant guard, so a
     * tenant principal is denied it outright — correctly, since it is the
     * operator's own merchant profile. But a tenant admin upgrading their plan
     * legitimately needs two things derived from it: whether paid plans are
     * possible at all, and a payment code minted from those details. Without
     * this, `/billing/plan-change` died with
     * "Cross-tenant access is forbidden (PlatformPaymentQr.findFirst)".
     *
     * The wall is not weakened. This method is internal; what callers receive
     * is either a boolean (`isConfigured`) or a KHQR payload the payer has to
     * see in order to pay. The one route that returns the raw merchant profile
     * is `status()`, and that is behind PlatformGuard + SUPERADMIN.
     */
    const row = await runAsSystem(
      'platform KHQR merchant lookup: minting a payment code for a tenant',
      () =>
        this.prisma.platformPaymentQr.findFirst({
          where: { isActive: true },
          orderBy: { createdAt: 'desc' },
        }),
    );
    if (!row) return null;
    return {
      bakongAccountId: row.bakongAccountId,
      merchantName: row.merchantName,
      merchantCity: row.merchantCity,
      merchantCategoryCode: row.merchantCategoryCode,
    };
  }

  /**
   * Merchant details to mint with: the uploaded profile wins, with the KHQR_*
   * env vars kept as a fallback so existing deployments keep working.
   */
  async resolveMerchant(): Promise<KhqrMerchant | null> {
    const uploaded = await this.active();
    if (uploaded) return uploaded;
    const fromEnv = khqrMerchantFromEnv();
    return fromEnv.bakongAccountId && fromEnv.merchantName ? fromEnv : null;
  }

  /** Whether paid signup is possible at all right now. */
  async isConfigured(): Promise<boolean> {
    return (await this.resolveMerchant()) !== null;
  }

  /** Current status plus a live preview of each plan's payment code. */
  async status() {
    const uploaded = await this.active();
    const merchant = await this.resolveMerchant();
    return {
      configured: merchant !== null,
      source: uploaded ? 'UPLOAD' : merchant ? 'ENV' : 'NONE',
      merchant,
    };
  }

  /**
   * Render what a payer would actually scan for a given plan. Used by the
   * operator UI to confirm the uploaded QR produces a sane code before any
   * customer sees it.
   */
  async previewForPlan(planName: string) {
    const merchant = await this.resolveMerchant();
    if (!merchant) {
      throw new BadRequestException('No KHQR merchant is configured yet.');
    }

    // Retired tiers are previewable on purpose: the operator may still need to
    // check what an existing customer's renewal code looks like.
    const tier = await this.planTiers.byName(planName);
    if (!tier) {
      throw new BadRequestException(`No plan named ${planName} exists.`);
    }
    const { amount, currency } = tier;
    if (!(amount > 0)) {
      throw new BadRequestException(
        `${tier.displayName} is a free plan — it has no payment code.`,
      );
    }
    const plan = tier.name;
    const payload = buildKhqrPayload(merchant, {
      amount,
      currency,
      billNumber: 'PREVIEW',
    });
    return {
      plan,
      amount,
      currency,
      merchantName: merchant.merchantName,
      qrPayload: payload,
      qrImage: await qrcode.toDataURL(payload, { width: 320, margin: 1 }),
    };
  }

  async deactivate() {
    await this.prisma.platformPaymentQr.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });
    return { success: true };
  }
}
