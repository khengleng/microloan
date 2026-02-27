import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateLoanDto, ChangeLoanStatusDto } from './dto/create-loan.dto';
export declare class LoansService {
    private prisma;
    private audit;
    constructor(prisma: PrismaService, audit: AuditService);
    create(tenantId: string, userId: string, dto: CreateLoanDto): Promise<{
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
    }>;
    findAll(tenantId: string): Promise<({
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
    })[]>;
    findOne(tenantId: string, id: string): Promise<{
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
            principalAmount: import("node_modules/@microloan/db/prisma/client/runtime/library").Decimal;
            interestAmount: import("node_modules/@microloan/db/prisma/client/runtime/library").Decimal;
            totalAmount: import("node_modules/@microloan/db/prisma/client/runtime/library").Decimal;
            outstandingPrincipal: import("node_modules/@microloan/db/prisma/client/runtime/library").Decimal;
            paidPrincipal: import("node_modules/@microloan/db/prisma/client/runtime/library").Decimal;
            paidInterest: import("node_modules/@microloan/db/prisma/client/runtime/library").Decimal;
            isPaid: boolean;
        }[];
        repayments: {
            id: string;
            tenantId: string;
            createdAt: Date;
            updatedAt: Date;
            date: Date;
            loanId: string;
            amount: import("node_modules/@microloan/db/prisma/client/runtime/library").Decimal;
            principalPaid: import("node_modules/@microloan/db/prisma/client/runtime/library").Decimal;
            interestPaid: import("node_modules/@microloan/db/prisma/client/runtime/library").Decimal;
        }[];
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
    }>;
    changeStatus(tenantId: string, userId: string, id: string, dto: ChangeLoanStatusDto): Promise<{
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
    }>;
    remove(tenantId: string, userId: string, id: string): Promise<{
        success: boolean;
    }>;
}
