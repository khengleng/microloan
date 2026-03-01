import { PrismaService } from '../prisma/prisma.service';
export declare class PenaltyCronService {
    private prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    applyLatePenalties(): Promise<void>;
}
