import { RepaymentsService } from './repayments.service';
import { PostRepaymentDto } from './dto/post-repayment.dto';
import type { JwtPayload } from '../auth/jwt.strategy';
export declare class RepaymentsController {
    private readonly repaymentsService;
    constructor(repaymentsService: RepaymentsService);
    create(user: JwtPayload, dto: PostRepaymentDto): Promise<{
        id: string;
        tenantId: string;
        createdAt: Date;
        updatedAt: Date;
        date: Date;
        loanId: string;
        amount: import("@prisma/client/runtime/library").Decimal;
    }>;
    findAll(user: JwtPayload, loanId?: string): Promise<({
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
            interestMethod: import("@prisma/client").$Enums.InterestMethod;
            status: import("@prisma/client").$Enums.LoanStatus;
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
