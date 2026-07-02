import { Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentInstrumentsService } from '../payment-instruments/payment-instruments.service';
import { AgreementsService } from '../agreements/agreements.service';
import type { BorrowerSession } from './borrower-jwt';
import { UploadKycDto } from './dto/borrower-auth.dto';
import { SignAgreementDto } from '../agreements/dto/sign-agreement.dto';

function outstandingOf(schedules: { totalAmount: any; paidPrincipal: any; paidInterest: any; paidPenalty: any }[]): number {
  return schedules.reduce(
    (a, s) =>
      a +
      Math.max(0, Number(s.totalAmount) - (Number(s.paidPrincipal) + Number(s.paidInterest) + Number(s.paidPenalty))),
    0,
  );
}

@Injectable()
export class BorrowerPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentInstruments: PaymentInstrumentsService,
    private readonly agreements: AgreementsService,
  ) {}

  keyFacts(session: BorrowerSession, loanId: string) {
    return this.agreements.keyFacts({ id: loanId, borrowerId: session.borrowerId });
  }

  signAgreement(session: BorrowerSession, loanId: string, dto: SignAgreementDto, ip?: string) {
    return this.agreements.sign({
      where: { id: loanId, borrowerId: session.borrowerId },
      tenantId: session.tenantId,
      signerRole: 'BORROWER',
      signedByBorrowerId: session.borrowerId,
      signatureName: dto.signatureName,
      signatureImage: dto.signatureImage,
      ip,
    });
  }

  async me(session: BorrowerSession) {
    const b = await this.prisma.borrower.findUnique({
      where: { id: session.borrowerId },
      select: {
        id: true, firstName: true, lastName: true, phone: true, email: true,
        kycStatus: true, tenant: { select: { name: true } },
      },
    });
    if (!b) throw new NotFoundException('Borrower not found');
    return { ...b, organization: b.tenant?.name ?? null, tenant: undefined };
  }

  async listLoans(session: BorrowerSession) {
    const loans = await this.prisma.loan.findMany({
      where: { borrowerId: session.borrowerId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, principal: true, status: true, currency: true,
        annualInterestRate: true, termMonths: true, startDate: true,
        schedules: {
          select: { dueDate: true, totalAmount: true, paidPrincipal: true, paidInterest: true, paidPenalty: true, isPaid: true },
          orderBy: { dueDate: 'asc' },
        },
      },
    });

    return loans.map((l) => {
      const outstanding = outstandingOf(l.schedules);
      const nextDue = l.schedules.find((s) => !s.isPaid);
      return {
        id: l.id,
        principal: Number(l.principal),
        status: l.status,
        currency: l.currency,
        annualInterestRate: Number(l.annualInterestRate),
        termMonths: l.termMonths,
        startDate: l.startDate,
        outstanding: Math.round(outstanding * 100) / 100,
        nextDueDate: nextDue?.dueDate ?? null,
        nextDueAmount: nextDue
          ? Math.round((Number(nextDue.totalAmount) - (Number(nextDue.paidPrincipal) + Number(nextDue.paidInterest) + Number(nextDue.paidPenalty))) * 100) / 100
          : null,
      };
    });
  }

  private async loadOwnedLoan(session: BorrowerSession, loanId: string) {
    const loan = await this.prisma.loan.findFirst({
      where: { id: loanId, borrowerId: session.borrowerId },
      include: {
        schedules: { orderBy: { installmentNumber: 'asc' } },
        repayments: { where: { reversedAt: null }, orderBy: { date: 'asc' } },
        borrower: { select: { firstName: true, lastName: true, phone: true } },
        tenant: { select: { name: true } },
      },
    });
    if (!loan) throw new NotFoundException('Loan not found');
    return loan;
  }

  async getLoan(session: BorrowerSession, loanId: string) {
    const loan = await this.loadOwnedLoan(session, loanId);
    return {
      id: loan.id,
      principal: Number(loan.principal),
      annualInterestRate: Number(loan.annualInterestRate),
      termMonths: loan.termMonths,
      interestMethod: loan.interestMethod,
      currency: loan.currency,
      status: loan.status,
      startDate: loan.startDate,
      outstanding: Math.round(outstandingOf(loan.schedules) * 100) / 100,
      schedules: loan.schedules.map((s) => ({
        installmentNumber: s.installmentNumber,
        dueDate: s.dueDate,
        principalAmount: Number(s.principalAmount),
        interestAmount: Number(s.interestAmount),
        penaltyAmount: Number(s.penaltyAmount),
        totalAmount: Number(s.totalAmount),
        isPaid: s.isPaid,
      })),
      repayments: loan.repayments.map((r) => ({
        id: r.id,
        date: r.date,
        amount: Number(r.amount),
        currency: r.currency,
      })),
    };
  }

  async statementPdf(session: BorrowerSession, loanId: string): Promise<Buffer> {
    const loan = await this.loadOwnedLoan(session, loanId);
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    const money = (n: number) => `${loan.currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    doc.fontSize(18).text(loan.tenant?.name ?? 'Loan Statement', { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(13).fillColor('#444').text('Loan Statement');
    doc.moveDown(0.8);
    doc.fillColor('#000').fontSize(10);
    doc.text(`Borrower: ${loan.borrower.firstName} ${loan.borrower.lastName}`);
    doc.text(`Loan ID: ${loan.id}`);
    doc.text(`Status: ${loan.status}`);
    doc.text(`Principal: ${money(Number(loan.principal))}   Rate: ${Number(loan.annualInterestRate)}%   Term: ${loan.termMonths} months`);
    doc.text(`Outstanding: ${money(Math.round(outstandingOf(loan.schedules) * 100) / 100)}`);
    doc.moveDown(0.8);

    doc.fontSize(11).fillColor('#000').text('Repayment Schedule', { underline: true });
    doc.moveDown(0.3).fontSize(9);
    loan.schedules.forEach((s) => {
      const paid = Number(s.paidPrincipal) + Number(s.paidInterest) + Number(s.paidPenalty);
      const due = Math.max(0, Number(s.totalAmount) - paid);
      doc.text(
        `#${s.installmentNumber}  ${new Date(s.dueDate).toISOString().slice(0, 10)}   Due ${money(Number(s.totalAmount))}   ${s.isPaid ? 'PAID' : `Outstanding ${money(due)}`}`,
      );
    });

    doc.moveDown(0.8).fontSize(11).text('Payments Received', { underline: true });
    doc.moveDown(0.3).fontSize(9);
    if (loan.repayments.length === 0) doc.text('No payments recorded yet.');
    loan.repayments.forEach((r) => {
      doc.text(`${new Date(r.date).toISOString().slice(0, 10)}   ${money(Number(r.amount))}   Receipt ${r.id}`);
    });

    doc.moveDown(1).fontSize(8).fillColor('#888').text(
      `Generated ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC. This statement is informational.`,
    );

    doc.end();
    return done;
  }

  async kyc(session: BorrowerSession) {
    const docs = await this.prisma.kycDocument.findMany({
      where: { borrowerId: session.borrowerId },
      select: { id: true, type: true, mimeType: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return { kycStatus: session.kycStatus, documents: docs };
  }

  async uploadKyc(session: BorrowerSession, dto: UploadKycDto) {
    const created = await this.prisma.kycDocument.create({
      data: {
        tenantId: session.tenantId,
        borrowerId: session.borrowerId,
        type: dto.type,
        content: dto.content,
        mimeType: dto.mimeType ?? null,
      },
      select: { id: true, type: true, createdAt: true },
    });
    // Re-open KYC for review if it had been rejected.
    await this.prisma.borrower.updateMany({
      where: { id: session.borrowerId, kycStatus: 'REJECTED' },
      data: { kycStatus: 'PENDING' },
    });
    return created;
  }

  async paymentQr(session: BorrowerSession) {
    return this.paymentInstruments.resolveForTenant(session.tenantId);
  }
}
