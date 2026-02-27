import { LoansService } from '../loans/loans.service';
import { BorrowersService } from '../borrowers/borrowers.service';
import { RepaymentsService } from '../repayments/repayments.service';
import type { JwtPayload } from '../auth/jwt.strategy';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
export declare class ReportsController {
    private readonly loansService;
    private readonly borrowersService;
    private readonly repaymentsService;
    private readonly prisma;
    constructor(loansService: LoansService, borrowersService: BorrowersService, repaymentsService: RepaymentsService, prisma: PrismaService);
    getDashboardStats(user: JwtPayload): Promise<{
        activeLoans: number;
        totalBorrowers: number;
        repaymentsThisMonth: number | import("@prisma/client/runtime/library").Decimal;
        outstandingPrincipal: number | import("@prisma/client/runtime/library").Decimal;
        dueNext7Days: number | import("@prisma/client/runtime/library").Decimal;
    }>;
    exportLoanBook(user: JwtPayload, res: Response): Promise<void>;
    exportRepayments(user: JwtPayload, res: Response): Promise<void>;
}
