import { PrismaService } from '../prisma/prisma.service';
import { User } from '@microloan/db';
export declare class UsersService {
    private prisma;
    constructor(prisma: PrismaService);
    findOneByEmail(email: string): Promise<User | null>;
    findById(id: string): Promise<User | null>;
}
