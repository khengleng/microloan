import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import * as XLSX from 'xlsx';
import * as PDFDocument from 'pdfkit';

@Injectable()
export class ExportsService {
    constructor(
        private prisma: PrismaService,
        private audit: AuditService,
    ) { }

    async exportLoansToExcel(tenantId: string, actorId: string): Promise<Buffer> {
        const loans = await this.prisma.loan.findMany({
            where: { tenantId },
            include: { borrower: true, product: true },
        });

        const data = loans.map((l) => ({
            'Loan ID': l.id,
            'Borrower First Name': l.borrower.firstName,
            'Borrower Last Name': l.borrower.lastName,
            'Borrower Phone': l.borrower.phone,
            'Product': l.product?.name || 'N/A',
            'Status': l.status,
            'Principal': Number(l.principal),
            'Interest Rate': Number(l.annualInterestRate),
            'Term (Months)': l.termMonths,
            'Start Date': l.startDate,
            'Interest Method': l.interestMethod,
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, 'Loans');

        await this.audit.logAction(tenantId, actorId, 'READ', 'Export', 'Excel', { event: 'LOANS_EXPORTED' });

        return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    }

    async exportRepaymentsToExcel(tenantId: string, actorId: string): Promise<Buffer> {
        const repayments = await this.prisma.repayment.findMany({
            where: { tenantId },
            include: { loan: { include: { borrower: true } } },
        });

        const data = repayments.map((r) => ({
            'Repayment ID': r.id,
            'Loan ID': r.loanId,
            'Borrower Name': `${r.loan?.borrower?.firstName || ''} ${r.loan?.borrower?.lastName || ''}`,
            'Amount': Number(r.amount),
            'Principal Paid': Number(r.principalPaid),
            'Interest Paid': Number(r.interestPaid),
            'Penalty Paid': Number(r.penaltyPaid),
            'Date': r.date,
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, 'Repayments');

        await this.audit.logAction(tenantId, actorId, 'READ', 'Export', 'Excel', { event: 'REPAYMENTS_EXPORTED' });

        return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    }
}
