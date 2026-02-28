import { PrismaService } from '../prisma/prisma.service';
import { CreateLoanProductDto } from './dto/create-loan-product.dto';
import { UpdateLoanProductDto } from './dto/update-loan-product.dto';
export declare class LoanProductsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(tenantId: string, dto: CreateLoanProductDto): Promise<{
        policies: {
            id: string;
            productId: string;
            creditRating: string;
            interestRate: import("@prisma/client/runtime/library").Decimal;
            minTermMonths: number | null;
            maxTermMonths: number | null;
            minPrincipal: import("@prisma/client/runtime/library").Decimal | null;
            maxPrincipal: import("@prisma/client/runtime/library").Decimal | null;
            createdAt: Date;
            updatedAt: Date;
        }[];
    } & {
        id: string;
        tenantId: string;
        name: string;
        description: string | null;
        interestMethod: import("@prisma/client").$Enums.InterestMethod;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
    }>;
    findAll(tenantId: string): Promise<({
        policies: {
            id: string;
            productId: string;
            creditRating: string;
            interestRate: import("@prisma/client/runtime/library").Decimal;
            minTermMonths: number | null;
            maxTermMonths: number | null;
            minPrincipal: import("@prisma/client/runtime/library").Decimal | null;
            maxPrincipal: import("@prisma/client/runtime/library").Decimal | null;
            createdAt: Date;
            updatedAt: Date;
        }[];
    } & {
        id: string;
        tenantId: string;
        name: string;
        description: string | null;
        interestMethod: import("@prisma/client").$Enums.InterestMethod;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
    })[]>;
    findOne(tenantId: string, id: string): Promise<{
        policies: {
            id: string;
            productId: string;
            creditRating: string;
            interestRate: import("@prisma/client/runtime/library").Decimal;
            minTermMonths: number | null;
            maxTermMonths: number | null;
            minPrincipal: import("@prisma/client/runtime/library").Decimal | null;
            maxPrincipal: import("@prisma/client/runtime/library").Decimal | null;
            createdAt: Date;
            updatedAt: Date;
        }[];
    } & {
        id: string;
        tenantId: string;
        name: string;
        description: string | null;
        interestMethod: import("@prisma/client").$Enums.InterestMethod;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
    }>;
    update(tenantId: string, id: string, dto: UpdateLoanProductDto): Promise<{
        policies: {
            id: string;
            productId: string;
            creditRating: string;
            interestRate: import("@prisma/client/runtime/library").Decimal;
            minTermMonths: number | null;
            maxTermMonths: number | null;
            minPrincipal: import("@prisma/client/runtime/library").Decimal | null;
            maxPrincipal: import("@prisma/client/runtime/library").Decimal | null;
            createdAt: Date;
            updatedAt: Date;
        }[];
    } & {
        id: string;
        tenantId: string;
        name: string;
        description: string | null;
        interestMethod: import("@prisma/client").$Enums.InterestMethod;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
    }>;
    remove(tenantId: string, id: string): Promise<{
        id: string;
        tenantId: string;
        name: string;
        description: string | null;
        interestMethod: import("@prisma/client").$Enums.InterestMethod;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
    }>;
}
