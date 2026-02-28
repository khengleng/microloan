import { LoanProductsService } from './loan-products.service';
import { CreateLoanProductDto } from './dto/create-loan-product.dto';
import { UpdateLoanProductDto } from './dto/update-loan-product.dto';
import type { JwtPayload } from '../auth/jwt.strategy';
export declare class LoanProductsController {
    private readonly loanProductsService;
    constructor(loanProductsService: LoanProductsService);
    create(user: JwtPayload, createLoanProductDto: CreateLoanProductDto): Promise<{
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
    findAll(user: JwtPayload): Promise<({
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
    findOne(user: JwtPayload, id: string): Promise<{
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
    update(user: JwtPayload, id: string, updateLoanProductDto: UpdateLoanProductDto): Promise<{
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
    remove(user: JwtPayload, id: string): Promise<{
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
