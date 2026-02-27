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
        amount: import("node_modules/@microloan/db/prisma/client/runtime/library").Decimal;
        principalPaid: import("node_modules/@microloan/db/prisma/client/runtime/library").Decimal;
        interestPaid: import("node_modules/@microloan/db/prisma/client/runtime/library").Decimal;
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
            principal: import("node_modules/@microloan/db/prisma/client/runtime/library").Decimal;
            annualInterestRate: import("node_modules/@microloan/db/prisma/client/runtime/library").Decimal;
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
        amount: import("node_modules/@microloan/db/prisma/client/runtime/library").Decimal;
        principalPaid: import("node_modules/@microloan/db/prisma/client/runtime/library").Decimal;
        interestPaid: import("node_modules/@microloan/db/prisma/client/runtime/library").Decimal;
    })[]>;
}
