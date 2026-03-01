import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateLoanDto, ChangeLoanStatusDto } from './dto/create-loan.dto';
import { BotService } from '../bot/bot.service';
export declare class LoansService {
    private prisma;
    private audit;
    private bot;
    constructor(prisma: PrismaService, audit: AuditService, bot: BotService);
    create(tenantId: string, userId: string, dto: CreateLoanDto): Promise<{
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
    }>;
    findAll(tenantId: string): Promise<({
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
    })[]>;
    findOne(tenantId: string, id: string): Promise<{
        borrower: {
            loans: {
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
            }[];
        } & {
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
    }>;
    changeStatus(tenantId: string, userId: string, userRole: string, id: string, dto: ChangeLoanStatusDto): Promise<{
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
    }>;
    remove(tenantId: string, userId: string, id: string): Promise<{
        success: boolean;
    }>;
    addDocument(tenantId: string, userId: string, loanId: string, dto: {
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
    removeDocument(tenantId: string, userId: string, loanId: string, documentId: string): Promise<{
        success: boolean;
    }>;
}
