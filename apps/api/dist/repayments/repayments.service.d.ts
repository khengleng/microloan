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
        loanId: string;
        amount: import("@prisma/client/runtime/library").Decimal;
        principalPaid: import("@prisma/client/runtime/library").Decimal;
        interestPaid: import("@prisma/client/runtime/library").Decimal;
        date: Date;
        createdAt: Date;
        updatedAt: Date;
    }>;
    findAll(tenantId: string, loanId?: string): Promise<({
        loan: {
            borrower: {
                id: string;
                tenantId: string;
                firstName: string;
                lastName: string;
                phone: string | null;
                address: string | null;
                idNumber: string | null;
                telegramChatId: string | null;
                createdAt: Date;
                updatedAt: Date;
            };
        } & {
            id: string;
            tenantId: string;
            borrowerId: string;
            productId: string | null;
            creditRatingApplied: string | null;
            status: import("@microloan/db").$Enums.LoanStatus;
            principal: import("@prisma/client/runtime/library").Decimal;
            annualInterestRate: import("@prisma/client/runtime/library").Decimal;
            termMonths: number;
            interestMethod: import("@microloan/db").$Enums.InterestMethod;
            startDate: Date;
            createdAt: Date;
            updatedAt: Date;
        };
    } & {
        id: string;
        tenantId: string;
        loanId: string;
        amount: import("@prisma/client/runtime/library").Decimal;
        principalPaid: import("@prisma/client/runtime/library").Decimal;
        interestPaid: import("@prisma/client/runtime/library").Decimal;
        date: Date;
        createdAt: Date;
        updatedAt: Date;
    })[]>;
}
