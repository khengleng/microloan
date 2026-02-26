import { LoansService } from './loans.service';
import { CreateLoanDto, ChangeLoanStatusDto } from './dto/create-loan.dto';
import type { JwtPayload } from '../auth/jwt.strategy';
export declare class LoansController {
    private readonly loansService;
    constructor(loansService: LoansService);
    create(user: JwtPayload, dto: CreateLoanDto): Promise<{
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
    }>;
    findAll(user: JwtPayload): Promise<({
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
    })[]>;
    findOne(user: JwtPayload, id: string): Promise<{
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
        schedules: {
            id: string;
            createdAt: Date;
            updatedAt: Date;
            installmentNumber: number;
            loanId: string;
            dueDate: Date;
            principalAmount: import("@prisma/client/runtime/library").Decimal;
            interestAmount: import("@prisma/client/runtime/library").Decimal;
            totalAmount: import("@prisma/client/runtime/library").Decimal;
            outstandingPrincipal: import("@prisma/client/runtime/library").Decimal;
            isPaid: boolean;
        }[];
        repayments: {
            id: string;
            tenantId: string;
            createdAt: Date;
            updatedAt: Date;
            date: Date;
            loanId: string;
            amount: import("@prisma/client/runtime/library").Decimal;
        }[];
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
    }>;
    changeStatus(user: JwtPayload, id: string, dto: ChangeLoanStatusDto): Promise<{
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
    }>;
}
