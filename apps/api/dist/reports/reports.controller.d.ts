import { LoansService } from '../loans/loans.service';
import { BorrowersService } from '../borrowers/borrowers.service';
import { RepaymentsService } from '../repayments/repayments.service';
import type { JwtPayload } from '../auth/jwt.strategy';
import type { Response } from 'express';
export declare class ReportsController {
    private readonly loansService;
    private readonly borrowersService;
    private readonly repaymentsService;
    constructor(loansService: LoansService, borrowersService: BorrowersService, repaymentsService: RepaymentsService);
    exportLoanBook(user: JwtPayload, res: Response): Promise<void>;
    exportRepayments(user: JwtPayload, res: Response): Promise<void>;
}
