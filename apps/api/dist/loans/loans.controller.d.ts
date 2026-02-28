import { LoansService } from './loans.service';
import { CreateLoanDto, ChangeLoanStatusDto } from './dto/create-loan.dto';
import type { JwtPayload } from '../auth/jwt.strategy';
export declare class LoansController {
    private readonly loansService;
    constructor(loansService: LoansService);
    create(user: JwtPayload, dto: CreateLoanDto): Promise<{
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
    }>;
    findAll(user: JwtPayload): Promise<({
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
    })[]>;
    findOne(user: JwtPayload, id: string): Promise<{
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
        repayments: {
            id: string;
            tenantId: string;
            loanId: string;
            amount: import("@prisma/client/runtime/library").Decimal;
            principalPaid: import("@prisma/client/runtime/library").Decimal;
            interestPaid: import("@prisma/client/runtime/library").Decimal;
            date: Date;
            createdAt: Date;
            updatedAt: Date;
        }[];
        documents: {
            id: string;
            tenantId: string;
            loanId: string;
            name: string;
            content: string;
            type: string;
            createdAt: Date;
        }[];
        schedules: {
            id: string;
            loanId: string;
            installmentNumber: number;
            dueDate: Date;
            principalAmount: import("@prisma/client/runtime/library").Decimal;
            interestAmount: import("@prisma/client/runtime/library").Decimal;
            totalAmount: import("@prisma/client/runtime/library").Decimal;
            outstandingPrincipal: import("@prisma/client/runtime/library").Decimal;
            paidPrincipal: import("@prisma/client/runtime/library").Decimal;
            paidInterest: import("@prisma/client/runtime/library").Decimal;
            isPaid: boolean;
            createdAt: Date;
            updatedAt: Date;
        }[];
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
    }>;
    changeStatus(user: JwtPayload, id: string, dto: ChangeLoanStatusDto): Promise<{
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
    }>;
    remove(user: JwtPayload, id: string): Promise<{
        success: boolean;
    }>;
    addDocument(user: JwtPayload, id: string, dto: {
        name: string;
        content: string;
        type: string;
    }): Promise<{
        id: string;
        tenantId: string;
        loanId: string;
        name: string;
        content: string;
        type: string;
        createdAt: Date;
    }>;
    removeDocument(user: JwtPayload, id: string, documentId: string): Promise<{
        success: boolean;
    }>;
}
