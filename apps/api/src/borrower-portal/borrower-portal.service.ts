import { Injectable, NotFoundException } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { lending } from '@microloan/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentInstrumentsService } from '../payment-instruments/payment-instruments.service';
import type { BorrowerSession } from './borrower-jwt';
import { UploadKycDto } from './dto/borrower-auth.dto';
import { encryptField } from '../common/field-crypto';
import { CustomerDocumentsService } from '../lending/documents/customer-documents.service';

type Amount = { toString(): string } | string | number;
const D = (v: Amount) => lending.D(v.toString());

/** The instalment fields that make up what is still owed on it. */
const OWED = {
  number: true,
  dueDate: true,
  principalDue: true,
  interestDue: true,
  feeDue: true,
  taxDue: true,
  penaltyDue: true,
  principalPaid: true,
  interestPaid: true,
  feePaid: true,
  taxPaid: true,
  penaltyPaid: true,
  status: true,
} as const;

interface Line {
  number: number;
  dueDate: Date;
  principalDue: Amount;
  interestDue: Amount;
  feeDue: Amount;
  taxDue: Amount;
  penaltyDue: Amount;
  principalPaid: Amount;
  interestPaid: Amount;
  feePaid: Amount;
  taxPaid: Amount;
  penaltyPaid: Amount;
  status: string;
}

const dueOn = (i: Line) =>
  D(i.principalDue).plus(D(i.interestDue)).plus(D(i.feeDue)).plus(D(i.taxDue)).plus(D(i.penaltyDue));
const paidOn = (i: Line) =>
  D(i.principalPaid).plus(D(i.interestPaid)).plus(D(i.feePaid)).plus(D(i.taxPaid)).plus(D(i.penaltyPaid));
const owedOn = (i: Line) => {
  const owed = dueOn(i).minus(paidOn(i));
  return owed.gt(0) ? owed : lending.D(0);
};
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Money in from the customer, as the lending dashboard counts it. */
const RECEIPTS = ['REPAYMENT', 'PREPAYMENT', 'SETTLEMENT'];

/**
 * The borrower portal's own pages. Loans are the customer's loans on the
 * lending platform (D-155); loans of the original module are no longer shown
 * here — they are moved across with the loan-book migration.
 */
@Injectable()
export class BorrowerPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentInstruments: PaymentInstrumentsService,
    private readonly library: CustomerDocumentsService,
  ) {}

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
    const loans = await this.prisma.loanAccount.findMany({
      where: { tenantId: session.tenantId, borrowerId: session.borrowerId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        reference: true,
        bookedPrincipal: true,
        status: true,
        currency: true,
        disbursementDate: true,
        maturityDate: true,
        daysPastDue: true,
        instalments: { where: { status: 'DUE' }, orderBy: { dueDate: 'asc' }, select: OWED },
      },
    });
    return loans.map((l) => {
      const open = l.instalments.filter((i) => owedOn(i).gt(0));
      const next = open[0];
      return {
        id: l.id,
        reference: l.reference,
        principal: D(l.bookedPrincipal).toNumber(),
        status: l.status,
        currency: l.currency,
        startDate: l.disbursementDate,
        maturityDate: l.maturityDate,
        daysPastDue: l.daysPastDue,
        outstanding: open.reduce((t, i) => t.plus(owedOn(i)), lending.D(0)).toDecimalPlaces(2).toNumber(),
        nextDueDate: next?.dueDate ?? null,
        nextDueAmount: next ? owedOn(next).toDecimalPlaces(2).toNumber() : null,
      };
    });
  }

  private async loadOwnedLoan(session: BorrowerSession, loanId: string) {
    const loan = await this.prisma.loanAccount.findFirst({
      where: { id: loanId, tenantId: session.tenantId, borrowerId: session.borrowerId },
      select: {
        id: true,
        reference: true,
        bookedPrincipal: true,
        currency: true,
        status: true,
        disbursementDate: true,
        maturityDate: true,
        instalments: {
          where: { status: { not: 'SUPERSEDED' } },
          orderBy: [{ dueDate: 'asc' }, { number: 'asc' }],
          select: OWED,
        },
      },
    });
    if (!loan) throw new NotFoundException('Loan not found');
    const receipts = await this.prisma.financialEvent.findMany({
      where: {
        tenantId: session.tenantId,
        loanAccountId: loan.id,
        type: { in: RECEIPTS },
        status: 'POSTED',
      },
      orderBy: { valueDate: 'asc' },
      select: { id: true, valueDate: true, amount: true, currency: true },
    });
    const [borrower, tenant] = await Promise.all([
      this.prisma.borrower.findFirst({
        where: { id: session.borrowerId, tenantId: session.tenantId },
        select: { firstName: true, lastName: true },
      }),
      this.prisma.tenant.findFirst({ where: { id: session.tenantId }, select: { name: true } }),
    ]);
    return { loan, receipts, borrower, tenant };
  }

  async getLoan(session: BorrowerSession, loanId: string) {
    const { loan, receipts } = await this.loadOwnedLoan(session, loanId);
    return {
      id: loan.id,
      reference: loan.reference,
      principal: D(loan.bookedPrincipal).toNumber(),
      currency: loan.currency,
      status: loan.status,
      startDate: loan.disbursementDate,
      maturityDate: loan.maturityDate,
      outstanding: loan.instalments.reduce((t, i) => t.plus(owedOn(i)), lending.D(0)).toDecimalPlaces(2).toNumber(),
      schedules: loan.instalments.map((i) => ({
        installmentNumber: i.number,
        dueDate: i.dueDate,
        principalAmount: D(i.principalDue).toNumber(),
        interestAmount: D(i.interestDue).toNumber(),
        feeAmount: D(i.feeDue).plus(D(i.taxDue)).toNumber(),
        penaltyAmount: D(i.penaltyDue).toNumber(),
        totalAmount: dueOn(i).toDecimalPlaces(2).toNumber(),
        isPaid: owedOn(i).lte(0),
      })),
      repayments: receipts.map((r) => ({
        id: r.id,
        date: r.valueDate,
        amount: D(r.amount).toNumber(),
        currency: r.currency,
      })),
    };
  }

  async statementPdf(session: BorrowerSession, loanId: string): Promise<Buffer> {
    const { loan, receipts, borrower, tenant } = await this.loadOwnedLoan(session, loanId);
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    const money = (n: Amount) => `${loan.currency} ${D(n).toFixed(2)}`;
    const outstanding = loan.instalments.reduce((t, i) => t.plus(owedOn(i)), lending.D(0));

    doc.fontSize(18).text(tenant?.name ?? 'Loan Statement', { align: 'left' });
    doc.moveDown(0.3);
    doc.fontSize(13).fillColor('#444').text('Loan Statement');
    doc.moveDown(0.8);
    doc.fillColor('#000').fontSize(10);
    doc.text(`Borrower: ${borrower?.firstName ?? ''} ${borrower?.lastName ?? ''}`.trim());
    doc.text(`Loan: ${loan.reference}`);
    doc.text(`Status: ${loan.status}`);
    doc.text(`Amount borrowed: ${money(loan.bookedPrincipal)}`);
    doc.text(`Outstanding: ${money(outstanding)}`);
    doc.moveDown(0.8);

    doc.fontSize(11).fillColor('#000').text('Repayment Schedule', { underline: true });
    doc.moveDown(0.3).fontSize(9);
    loan.instalments.forEach((i) => {
      const owed = owedOn(i);
      doc.text(
        `#${i.number}  ${day(i.dueDate)}   Due ${money(dueOn(i))}   ${owed.lte(0) ? 'PAID' : `Outstanding ${money(owed)}`}`,
      );
    });

    doc.moveDown(0.8).fontSize(11).text('Payments Received', { underline: true });
    doc.moveDown(0.3).fontSize(9);
    if (receipts.length === 0) doc.text('No payments recorded yet.');
    receipts.forEach((r) => {
      doc.text(`${day(r.valueDate)}   ${money(r.amount)}   Receipt ${r.id}`);
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
    // DOC-1/DOC-2: an inline file goes to the customer's document library
    // (object storage); the KycDocument row only points at it.
    const filed = await this.library.fileKycFromPortal(
      session,
      dto.type,
      dto.content,
      dto.mimeType,
    );
    if (filed) {
      await this.prisma.borrower.updateMany({
        where: { id: session.borrowerId, kycStatus: 'REJECTED' },
        data: { kycStatus: 'PENDING' },
      });
      return { id: filed.kycDocumentId, type: dto.type, createdAt: filed.createdAt, documentId: filed.documentId };
    }
    const created = await this.prisma.kycDocument.create({
      data: {
        tenantId: session.tenantId,
        borrowerId: session.borrowerId,
        type: dto.type,
        content: encryptField(dto.content) as string,
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
