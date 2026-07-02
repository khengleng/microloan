import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { AuthzService } from '../authz/authz.service';
import { AuditService } from '../audit/audit.service';
import { Permission } from '../authz/permission.enum';
import type { JwtPayload } from '../auth/jwt.strategy';
import {
  CreatePaymentInstrumentDto,
  UpdatePaymentInstrumentDto,
} from './dto/payment-instrument.dto';

// Static-QR payment rail (display-only). Officers still post repayments
// manually; these instruments simply carry the collection QR + bank details we
// surface on loans, receipts and the borrower portal.
@Injectable()
export class PaymentInstrumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authz: AuthzService,
    private readonly audit: AuditService,
  ) {}

  /** Render a QR image (data URI) from the stored payload, or fall back to an
   *  uploaded image. Returns null when neither is present. */
  private async render(instrument: {
    qrPayload: string | null;
    qrImage: string | null;
  }): Promise<string | null> {
    if (instrument.qrPayload) {
      try {
        return await QRCode.toDataURL(instrument.qrPayload, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 320,
        });
      } catch {
        // Fall through to the uploaded image if the payload can't be rendered.
      }
    }
    return instrument.qrImage ?? null;
  }

  private async withRender<T extends { qrPayload: string | null; qrImage: string | null }>(
    instrument: T,
  ): Promise<T & { qrRendered: string | null }> {
    return { ...instrument, qrRendered: await this.render(instrument) };
  }

  private assertHasQr(dto: { qrPayload?: string; qrImage?: string }) {
    if (!dto.qrPayload?.trim() && !dto.qrImage?.trim()) {
      throw new BadRequestException(
        'Provide either a KHQR/QR payload string or an uploaded QR image.',
      );
    }
  }

  private async assertBranchInTenant(actor: JwtPayload, branchId?: string) {
    if (!branchId) return;
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId: actor.tenantId as string },
      select: { id: true },
    });
    if (!branch) throw new BadRequestException('Branch not found for this organization.');
  }

  async list(actor: JwtPayload) {
    this.authz.assertPermission(actor, Permission.CUSTOMER_VIEW);
    const items = await this.prisma.paymentInstrument.findMany({
      where: this.authz.scopeWhere(actor, {}),
      include: { branch: { select: { id: true, name: true } } },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return Promise.all(items.map((i) => this.withRender(i)));
  }

  async create(actor: JwtPayload, dto: CreatePaymentInstrumentDto) {
    this.authz.assertPermission(actor, Permission.CONFIG_UPDATE);
    this.assertHasQr(dto);
    await this.assertBranchInTenant(actor, dto.branchId);
    const tenantId = actor.tenantId as string;

    const created = await this.prisma.$transaction(async (tx) => {
      // Only one default per tenant.
      if (dto.isDefault) {
        await tx.paymentInstrument.updateMany({
          where: { tenantId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.paymentInstrument.create({
        data: {
          tenantId,
          branchId: dto.branchId ?? null,
          label: dto.label,
          bankName: dto.bankName ?? null,
          accountName: dto.accountName ?? null,
          accountNumber: dto.accountNumber ?? null,
          qrPayload: dto.qrPayload ?? null,
          qrImage: dto.qrImage ?? null,
          currency: (dto.currency as any) ?? 'USD',
          isActive: dto.isActive ?? true,
          isDefault: dto.isDefault ?? false,
        },
      });
    });

    await this.audit.logAction(
      tenantId,
      this.authz.actorId(actor as any),
      'CREATE',
      'PaymentInstrument',
      created.id,
      { label: created.label, bankName: created.bankName, branchId: created.branchId },
    );
    return this.withRender(created);
  }

  private async getOwned(actor: JwtPayload, id: string) {
    const item = await this.prisma.paymentInstrument.findFirst({
      where: this.authz.scopeWhere(actor, { id }),
    });
    if (!item) throw new NotFoundException('Payment instrument not found');
    return item;
  }

  async update(actor: JwtPayload, id: string, dto: UpdatePaymentInstrumentDto) {
    this.authz.assertPermission(actor, Permission.CONFIG_UPDATE);
    const existing = await this.getOwned(actor, id);
    // Only validate QR presence against the effective (merged) values.
    this.assertHasQr({
      qrPayload: dto.qrPayload ?? existing.qrPayload ?? undefined,
      qrImage: dto.qrImage ?? existing.qrImage ?? undefined,
    });
    await this.assertBranchInTenant(actor, dto.branchId);
    const tenantId = actor.tenantId as string;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.paymentInstrument.updateMany({
          where: { tenantId, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }
      return tx.paymentInstrument.update({
        where: { id },
        data: {
          label: dto.label,
          bankName: dto.bankName,
          accountName: dto.accountName,
          accountNumber: dto.accountNumber,
          qrPayload: dto.qrPayload,
          qrImage: dto.qrImage,
          currency: dto.currency as any,
          branchId: dto.branchId ?? null,
          isActive: dto.isActive,
          isDefault: dto.isDefault,
        },
      });
    });

    await this.audit.logAction(
      tenantId,
      this.authz.actorId(actor as any),
      'UPDATE',
      'PaymentInstrument',
      id,
      { label: updated.label },
    );
    return this.withRender(updated);
  }

  async remove(actor: JwtPayload, id: string) {
    this.authz.assertPermission(actor, Permission.CONFIG_UPDATE);
    await this.getOwned(actor, id);
    await this.prisma.paymentInstrument.delete({ where: { id } });
    await this.audit.logAction(
      actor.tenantId as string,
      this.authz.actorId(actor as any),
      'DELETE',
      'PaymentInstrument',
      id,
    );
    return { success: true };
  }

  /**
   * Resolve the QR to display for a given loan: prefer an active instrument
   * bound to the loan's branch, else the tenant default, else any active one.
   */
  async resolveForLoan(actor: JwtPayload, loanId: string) {
    this.authz.assertPermission(actor, Permission.CUSTOMER_VIEW);
    const loan = await this.prisma.loan.findFirst({
      where: this.authz.scopeWhere(actor, { id: loanId }),
      select: { id: true, branchId: true, tenantId: true, currency: true },
    });
    if (!loan) throw new NotFoundException('Loan not found');
    this.authz.assertBranchAccess(actor, loan.branchId);

    const active = await this.prisma.paymentInstrument.findMany({
      where: { tenantId: loan.tenantId, isActive: true },
      include: { branch: { select: { id: true, name: true } } },
    });
    if (active.length === 0) return null;

    const pick =
      active.find((i) => i.branchId && i.branchId === loan.branchId) ||
      active.find((i) => i.isDefault) ||
      active.find((i) => !i.branchId) ||
      active[0];

    return this.withRender(pick);
  }
}
