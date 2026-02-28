import { BorrowersService } from './borrowers.service';
import { CreateBorrowerDto, UpdateBorrowerDto } from './dto/create-borrower.dto';
import type { JwtPayload } from '../auth/jwt.strategy';
export declare class BorrowersController {
    private readonly borrowersService;
    constructor(borrowersService: BorrowersService);
    create(user: JwtPayload, dto: CreateBorrowerDto): Promise<{
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
    }>;
    findAll(user: JwtPayload): Promise<{
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
    }[]>;
    findOne(user: JwtPayload, id: string): Promise<{
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
    }>;
    update(user: JwtPayload, id: string, dto: UpdateBorrowerDto): Promise<{
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
    }>;
    remove(user: JwtPayload, id: string): Promise<{
        success: boolean;
    }>;
}
