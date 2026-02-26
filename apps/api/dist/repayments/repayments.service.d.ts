import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PostRepaymentDto } from './dto/post-repayment.dto';
export declare class RepaymentsService {
    private prisma;
    private audit;
    constructor(prisma: PrismaService, audit: AuditService);
    postRepayment(tenantId: string, userId: string, dto: PostRepaymentDto): Promise<{
        id: string;
        tenantId: string;
        createdAt: Date;
        updatedAt: Date;
        date: Date;
        loanId: string;
        amount: import("@prisma/client/runtime/library").Decimal;
    }>;
    findAll(tenantId: string, loanId?: string): Promise<({
        loan: {
            borrower: {
                id: string;
                tenantId: string;
                createdAt: Date;
                updatedAt: Date;
                firstName: string;
                lastName: string;
                phone: string | null;
                address: string | null;
                idNumber: string | null;
            };
        } & {
            id: string;
            tenantId: string;
            createdAt: Date;
            updatedAt: Date;
            borrowerId: string;
            principal: import("@prisma/client/runtime/library").Decimal;
            annualInterestRate: import("@prisma/client/runtime/library").Decimal;
            termMonths: number;
            startDate: Date;
            interestMethod: import("@microloan/db").$Enums.InterestMethod;
            status: import("@microloan/db").$Enums.LoanStatus;
        };
    } & {
        id: string;
        tenantId: string;
        createdAt: Date;
        updatedAt: Date;
        date: Date;
        loanId: string;
        amount: import("@prisma/client/runtime/library").Decimal;
    })[]>;
}
