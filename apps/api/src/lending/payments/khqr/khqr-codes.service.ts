import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { lending } from '@microloan/shared';
import { LendingPrisma, Tx } from '../../common/lending-prisma';
import { AuditEventService } from '../../common/audit-event.service';
import {
  LendingActor,
  concurrentModification,
  requireTenant,
} from '../../common/util';
import { PolicyService } from '../../policy/policy.service';
import { tenantResource } from '../../policy/resources';
import {
  bufferFromUpload,
  imageType,
  readQrFromImage,
  renderQrDataUrl,
  renderQrPng,
} from '../../../common/qr-image';
import type {
  DecideBody,
  PreviewCodeBody,
  ProposeCodeBody,
} from './khqr.schemas';

type Currency = lending.KhqrCurrency;

/** What a borrower is shown to pay with: the code and its account details. */
export interface PayableCode {
  id: string;
  currency: string;
  branchId: string | null;
  merchantName: string;
  merchantCity: string;
  bakongAccountId: string;
  bankName: string | null;
  accountNumber: string | null;
  /** The EMVCo payload, when known (null for an undecodable uploaded image). */
  payload: string | null;
  /** `data:image/png;base64,…` of the code. */
  image: string;
}

interface CodeRow {
  id: string;
  tenantId: string;
  branchId: string | null;
  currency: string;
  source: string;
  bakongAccountId: string;
  merchantName: string;
  merchantCity: string;
  merchantCategoryCode: string;
  payload: string | null;
  imageData: string | null;
  bankName: string | null;
  accountNumber: string | null;
  status: string;
  makerId: string;
  checkerId: string | null;
  decidedAt: Date | null;
  reason: string;
  createdAt: Date;
}

/**
 * The lender's static KHQR repayment codes (D-160): one per currency for the
 * lender, optionally one per branch. A code is proposed by a holder of
 * khqr.manage — generated from the Bakong account details, or read from the
 * image the bank gave — and approved by a different person holding
 * tenant_settings.approve; approval retires the code it replaces. Every step
 * is audited. Nothing here learns of payments: borrowers pay the code, and
 * receipts are captured and reconciled separately (khqr-receipts.service).
 */
@Injectable()
export class KhqrCodesService {
  constructor(
    private readonly lp: LendingPrisma,
    private readonly policy: PolicyService,
    private readonly audit: AuditEventService,
  ) {}

  /** Codes in force, waiting, and the last decided ones, with their images. */
  async list(actor: LendingActor) {
    const tenantId = requireTenant(actor);
    await this.policy.enforce(actor, 'khqr.read', tenantResource(tenantId));
    return this.lp.tenantTx(tenantId, async (tx) => {
      const rows = await tx.khqrCode.findMany({
        where: { tenantId },
        orderBy: [{ createdAt: 'desc' }],
        take: 100,
      });
      const branches = await tx.branch.findMany({
        where: { tenantId },
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      });
      const shown = await Promise.all(rows.map((r) => this.view(r)));
      return {
        active: shown.filter((r) => r.status === 'ACTIVE'),
        pending: shown.filter((r) => r.status === 'PENDING'),
        history: shown
          .filter((r) => r.status === 'REJECTED' || r.status === 'RETIRED')
          .slice(0, 20),
        branches,
      };
    });
  }

  /** Read an uploaded image or payload and say what it holds; nothing is saved. */
  preview(actor: LendingActor, body: PreviewCodeBody) {
    requireTenant(actor);
    return this.readUpload(body.currency, body.image, body.payload);
  }

  async propose(actor: LendingActor, body: ProposeCodeBody) {
    const tenantId = requireTenant(actor);
    const currency = body.currency;
    let source: 'GENERATED' | 'UPLOADED_PAYLOAD' | 'UPLOADED_IMAGE';
    let merchant: lending.KhqrMerchant;
    let payload: string | null = null;
    let imageData: string | null = null;
    if (body.mode === 'GENERATE') {
      merchant = {
        bakongAccountId: body.bakongAccountId ?? '',
        merchantName: body.merchantName ?? '',
        merchantCity: body.merchantCity ?? '',
        merchantCategoryCode: body.merchantCategoryCode ?? '6012',
      };
      const problems = lending.khqrMerchantProblems(merchant);
      if (problems.length) throw new BadRequestException(problems.join(' '));
      payload = lending.buildStaticKhqrPayload(merchant, currency);
      source = 'GENERATED';
    } else {
      const read = await this.readUpload(currency, body.image, body.payload);
      if (read.decoded) {
        merchant = read.merchant;
        payload = read.payload;
        source = 'UPLOADED_PAYLOAD';
      } else {
        // The image could not be read: keep it, with the account details the
        // operator typed (checked like a generated code's, so the borrower is
        // shown something true).
        merchant = {
          bakongAccountId: body.bakongAccountId ?? '',
          merchantName: body.merchantName ?? '',
          merchantCity: body.merchantCity ?? '',
          merchantCategoryCode: body.merchantCategoryCode ?? '6012',
        };
        const problems = lending.khqrMerchantProblems(merchant);
        if (problems.length)
          throw new BadRequestException(
            `The QR in the image could not be read (${read.problem}). Enter the account details shown with it: ${problems.join(' ')}`,
          );
        imageData = read.image;
        source = 'UPLOADED_IMAGE';
      }
    }
    return this.lp.tenantTx(tenantId, async (tx) => {
      await this.policy.enforce(
        actor,
        'khqr.propose',
        tenantResource(tenantId),
        tx,
      );
      if (body.branchId) {
        const branch = await tx.branch.findFirst({
          where: { id: body.branchId, tenantId },
          select: { id: true },
        });
        if (!branch) throw new NotFoundException('Branch not found');
      }
      const slot = {
        tenantId,
        branchId: body.branchId ?? null,
        currency,
      };
      if (
        await tx.khqrCode.findFirst({ where: { ...slot, status: 'PENDING' } })
      )
        throw new ConflictException(
          `A ${currency} code for ${body.branchId ? 'this branch' : 'the lender'} is already waiting for approval; approve or reject it first.`,
        );
      const row = await tx.khqrCode.create({
        data: {
          ...slot,
          source,
          bakongAccountId: merchant.bakongAccountId,
          merchantName: merchant.merchantName,
          merchantCity: merchant.merchantCity,
          merchantCategoryCode: merchant.merchantCategoryCode ?? '6012',
          payload,
          imageData,
          bankName: body.bankName || null,
          accountNumber: body.accountNumber || null,
          makerId: actor.id,
          reason: body.reason,
        },
      });
      await this.audit.write(
        {
          actor,
          action: 'khqr.propose',
          resourceType: 'KhqrCode',
          resourceId: row.id,
          outcome: 'SUCCESS',
          details: {
            currency,
            branchId: row.branchId,
            source,
            bakongAccountId: row.bakongAccountId,
            merchantName: row.merchantName,
            reason: body.reason,
          },
        },
        tx,
      );
      return this.view(row);
    });
  }

  /** Approve (retiring the code it replaces) or reject a proposal; never its maker. */
  async decide(actor: LendingActor, id: string, body: DecideBody) {
    const tenantId = requireTenant(actor);
    return this.lp.tenantTx(tenantId, async (tx) => {
      const row = await tx.khqrCode.findFirst({ where: { id, tenantId } });
      if (!row) throw new NotFoundException('KHQR code not found');
      await this.policy.enforce(
        actor,
        'khqr.approve',
        tenantResource(tenantId, 'TENANT', tenantId, [row.makerId]),
        tx,
      );
      if (row.status !== 'PENDING')
        throw new ConflictException(
          `This code is already ${row.status.toLowerCase()}.`,
        );
      const now = new Date();
      if (body.approve)
        await tx.khqrCode.updateMany({
          where: {
            tenantId,
            branchId: row.branchId,
            currency: row.currency,
            status: 'ACTIVE',
          },
          data: { status: 'RETIRED' },
        });
      const res = await tx.khqrCode.updateMany({
        where: { id, tenantId, status: 'PENDING' },
        data: {
          status: body.approve ? 'ACTIVE' : 'REJECTED',
          checkerId: actor.id,
          decidedAt: now,
          ...(body.comment
            ? { reason: `${row.reason}\n— ${body.comment}`.slice(0, 1000) }
            : {}),
        },
      });
      if (res.count !== 1) throw concurrentModification('This KHQR proposal');
      await this.audit.write(
        {
          actor,
          action: body.approve ? 'khqr.approve' : 'khqr.reject',
          resourceType: 'KhqrCode',
          resourceId: id,
          outcome: 'SUCCESS',
          details: {
            currency: row.currency,
            branchId: row.branchId,
            bakongAccountId: row.bakongAccountId,
            comment: body.comment ?? null,
          },
        },
        tx,
      );
      const after = await tx.khqrCode.findFirstOrThrow({
        where: { id, tenantId },
      });
      return this.view(after);
    });
  }

  // ── What borrowers are shown ────────────────────────────────────────────

  /**
   * The code a loan is paid with: its branch's code in the loan currency,
   * else the lender's. Null when the lender has none in force.
   */
  async forLoan(
    tx: Tx,
    tenantId: string,
    loan: { branchId: string | null; currency: string },
  ): Promise<PayableCode | null> {
    const rows = await tx.khqrCode.findMany({
      where: {
        tenantId,
        currency: loan.currency,
        status: 'ACTIVE',
        OR: [
          { branchId: null },
          ...(loan.branchId ? [{ branchId: loan.branchId }] : []),
        ],
      },
    });
    const pick =
      rows.find((r) => loan.branchId && r.branchId === loan.branchId) ??
      rows.find((r) => r.branchId === null);
    return pick ? this.payable(pick) : null;
  }

  /**
   * Whether the lender has a static KHQR code in force, and for which
   * currencies (lender-wide or any branch). One indexed read inside the
   * caller's tenant transaction — for the go-live checklist.
   */
  async hasActiveStaticKhqr(
    tx: Tx,
    tenantId: string,
  ): Promise<{ active: boolean; currencies: string[] }> {
    const rows = await tx.khqrCode.findMany({
      where: { tenantId, status: 'ACTIVE' },
      select: { currency: true },
      distinct: ['currency'],
    });
    const currencies = rows.map((r) => r.currency).sort();
    return { active: currencies.length > 0, currencies };
  }

  /** The lender's codes in force (one per currency), for pages without a loan. */
  async forTenant(tx: Tx, tenantId: string): Promise<PayableCode[]> {
    const rows = await tx.khqrCode.findMany({
      where: { tenantId, status: 'ACTIVE', branchId: null },
      orderBy: { currency: 'desc' },
    });
    return Promise.all(rows.map((r) => this.payable(r)));
  }

  /** The code's image as PNG bytes, for PDFs and chat messages. */
  async png(code: PayableCode, width = 320): Promise<Buffer> {
    if (code.payload) return renderQrPng(code.payload, width);
    return bufferFromUpload(code.image);
  }

  // ── Plumbing ─────────────────────────────────────────────────────────────

  private async payable(r: CodeRow): Promise<PayableCode> {
    return {
      id: r.id,
      currency: r.currency,
      branchId: r.branchId,
      merchantName: r.merchantName,
      merchantCity: r.merchantCity,
      bakongAccountId: r.bakongAccountId,
      bankName: r.bankName,
      accountNumber: r.accountNumber,
      payload: r.payload,
      image: r.payload ? await renderQrDataUrl(r.payload) : (r.imageData ?? ''),
    };
  }

  private async view(r: CodeRow) {
    return {
      id: r.id,
      branchId: r.branchId,
      currency: r.currency,
      source: r.source,
      bakongAccountId: r.bakongAccountId,
      merchantName: r.merchantName,
      merchantCity: r.merchantCity,
      merchantCategoryCode: r.merchantCategoryCode,
      bankName: r.bankName,
      accountNumber: r.accountNumber,
      payload: r.payload,
      status: r.status,
      makerId: r.makerId,
      checkerId: r.checkerId,
      decidedAt: r.decidedAt,
      reason: r.reason,
      createdAt: r.createdAt,
      image: r.payload
        ? await renderQrDataUrl(r.payload)
        : (r.imageData ?? null),
    };
  }

  /**
   * Read the QR in an uploaded image (PNG/JPEG, decoded in-process) or a
   * pasted payload, and check it is a static code for `currency`. An image
   * that cannot be decoded is returned as is, for the operator to file with
   * typed details; a readable code that is not a static one is refused.
   */
  private async readUpload(
    currency: Currency,
    image?: string,
    payloadText?: string,
  ): Promise<
    | {
        decoded: true;
        merchant: lending.KhqrMerchant;
        payload: string;
        image: string;
      }
    | { decoded: false; problem: string; image: string }
  > {
    if (!image?.trim() && !payloadText?.trim())
      throw new BadRequestException(
        'Upload the QR image your bank gave you, or paste its payload text.',
      );
    let raw: string;
    let dataUri = '';
    if (payloadText?.trim()) raw = payloadText.trim();
    else {
      let buf: Buffer;
      try {
        buf = bufferFromUpload(image!);
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      const type = imageType(buf);
      if (!type)
        throw new BadRequestException('Upload the QR as a PNG or JPEG image.');
      dataUri = `data:${type};base64,${buf.toString('base64')}`;
      try {
        raw = readQrFromImage(buf);
      } catch (e) {
        return {
          decoded: false,
          problem: (e as Error).message,
          image: dataUri,
        };
      }
    }
    let parsed: lending.ParsedKhqr;
    try {
      parsed = lending.parseKhqrPayload(raw);
    } catch (e) {
      if (dataUri)
        return {
          decoded: false,
          problem: (e as Error).message,
          image: dataUri,
        };
      throw new BadRequestException((e as Error).message);
    }
    const problems = lending.staticKhqrProblems(parsed, currency);
    if (problems.length) throw new BadRequestException(problems.join(' '));
    const merchant = {
      bakongAccountId: parsed.bakongAccountId,
      merchantName: parsed.merchantName,
      merchantCity: parsed.merchantCity,
      merchantCategoryCode: parsed.merchantCategoryCode,
    };
    // Keep the bank's own payload (byte for byte what it printed), not a re-mint.
    const payload = raw.trim().replace(/[\r\n\t]+/g, '');
    if (!payload.startsWith('000201010211'))
      throw new BadRequestException(
        'The code does not start with the static KHQR header (000201010211).',
      );
    return {
      decoded: true,
      merchant,
      payload,
      image: await renderQrDataUrl(payload),
    };
  }
}
