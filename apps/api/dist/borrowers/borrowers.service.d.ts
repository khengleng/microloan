import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateBorrowerDto, UpdateBorrowerDto } from './dto/create-borrower.dto';
export declare class BorrowersService {
    private prisma;
    private audit;
    constructor(prisma: PrismaService, audit: AuditService);
    create(tenantId: string, userId: string, dto: CreateBorrowerDto): Promise<{
        id: string;
        tenantId: string;
        createdAt: Date;
        updatedAt: Date;
        firstName: string;
        lastName: string;
        phone: string | null;
        address: string | null;
        idNumber: string | null;
    }>;
    findAll(tenantId: string): Promise<{
        id: string;
        tenantId: string;
        createdAt: Date;
        updatedAt: Date;
        firstName: string;
        lastName: string;
        phone: string | null;
        address: string | null;
        idNumber: string | null;
    }[]>;
    findOne(tenantId: string, id: string): Promise<{
        id: string;
        tenantId: string;
        createdAt: Date;
        updatedAt: Date;
        firstName: string;
        lastName: string;
        phone: string | null;
        address: string | null;
        idNumber: string | null;
    }>;
    update(tenantId: string, userId: string, id: string, dto: UpdateBorrowerDto): Promise<{
        id: string;
        tenantId: string;
        createdAt: Date;
        updatedAt: Date;
        firstName: string;
        lastName: string;
        phone: string | null;
        address: string | null;
        idNumber: string | null;
    }>;
}
