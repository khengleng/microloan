import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { buildKeyFacts, KeyFacts } from '@microloan/shared';
import { PrismaService } from '../prisma/prisma.service';

type SignParams = {
  where: any; // already tenant/borrower-scoped loan `where`
  tenantId: string;
  signerRole: 'BORROWER' | 'STAFF';
  signedByUserId?: string | null;
  signedByBorrowerId?: string | null;
  signatureName?: string | null;
  signatureImage?: string | null;
  ip?: string | null;
};

@Injectable()
export class AgreementsService {
  constructor(private readonly prisma: PrismaService) {}

  private async loadLoan(where: any) {
    return this.prisma.loan.findFirst({
      where,
      include: {
        schedules: { orderBy: { installmentNumber: 'asc' }, select: { totalAmount: true } },
        product: { select: { processingFeePct: true, adminFee: true, name: true } },
        borrower: { select: { firstName: true, lastName: true } },
        tenant: { select: { name: true, penaltyRatePerDay: true } },
      },
    });
  }

  private computeKfs(loan: any): KeyFacts {
    const installments: number[] = loan.schedules.map((s: any) => Number(s.totalAmount));
    const principal = Number(loan.principal);
    const charged = Number(loan.feeCharged || 0);

    // Prefer the fee actually charged at disbursement; otherwise estimate from
    // the product so a pre-disbursement Key Facts disclosure is still accurate.
    let processingFee = 0;
    let adminFee = 0;
    if (charged > 0) {
      processingFee = charged;
    } else if (loan.product) {
      processingFee = (principal * Number(loan.product.processingFeePct || 0)) / 100;
      adminFee = Number(loan.product.adminFee || 0);
    }
    const totalFees = Math.round((processingFee + adminFee) * 100) / 100;

    return buildKeyFacts({
      principal,
      netDisbursed: Math.round((principal - totalFees) * 100) / 100,
      installments,
      nominalAnnualRate: Number(loan.annualInterestRate),
      termMonths: loan.termMonths,
      processingFee,
      adminFee,
      currency: loan.currency,
    });
  }

  hashAgreement(loanId: string, kfs: KeyFacts): string {
    return createHash('sha256').update(JSON.stringify({ loanId, kfs })).digest('hex');
  }

  async keyFacts(where: any) {
    const loan = await this.loadLoan(where);
    if (!loan) throw new NotFoundException('Loan not found');
    const latest = await this.latest(loan.id);
    return {
      loanId: loan.id,
      organization: loan.tenant?.name ?? null,
      borrowerName: `${loan.borrower.firstName} ${loan.borrower.lastName}`.trim(),
      productName: loan.product?.name ?? null,
      penaltyPerDay: Number(loan.tenant?.penaltyRatePerDay ?? 0),
      keyFacts: this.computeKfs(loan),
      signed: !!latest,
      signedAt: latest?.signedAt ?? null,
      agreementHash: latest?.agreementHash ?? null,
    };
  }

  async sign(params: SignParams) {
    if (!params.signatureName?.trim() && !params.signatureImage?.trim()) {
      throw new BadRequestException('A typed name or drawn signature is required.');
    }
    const loan = await this.loadLoan(params.where);
    if (!loan) throw new NotFoundException('Loan not found');

    const kfs = this.computeKfs(loan);
    const version = (await this.prisma.loanAgreement.count({ where: { loanId: loan.id } })) + 1;

    return this.prisma.loanAgreement.create({
      data: {
        tenantId: params.tenantId ?? loan.tenantId,
        loanId: loan.id,
        version,
        keyFacts: kfs as any,
        agreementHash: this.hashAgreement(loan.id, kfs),
        signatureName: params.signatureName ?? null,
        signatureImage: params.signatureImage ?? null,
        signerRole: params.signerRole,
        signedByUserId: params.signedByUserId ?? null,
        signedByBorrowerId: params.signedByBorrowerId ?? null,
        ipAddress: params.ip ?? null,
      },
      select: {
        id: true, version: true, agreementHash: true, signedAt: true,
        signerRole: true, signatureName: true,
      },
    });
  }

  async latest(loanId: string) {
    return this.prisma.loanAgreement.findFirst({
      where: { loanId },
      orderBy: { version: 'desc' },
    });
  }
}
