import { RepaymentsService } from './repayments.service';
import { PostRepaymentDto } from './dto/post-repayment.dto';
import type { JwtPayload } from '../auth/jwt.strategy';
export declare class RepaymentsController {
    private readonly repaymentsService;
    constructor(repaymentsService: RepaymentsService);
    create(user: JwtPayload, dto: PostRepaymentDto): Promise<{
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
    findAll(user: JwtPayload, loanId?: string): Promise<({
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
            status: import("@prisma/client").$Enums.LoanStatus;
            principal: import("@prisma/client/runtime/library").Decimal;
            annualInterestRate: import("@prisma/client/runtime/library").Decimal;
            termMonths: number;
            interestMethod: import("@prisma/client").$Enums.InterestMethod;
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
