import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BorrowersService } from '../borrowers/borrowers.service';
import { LoansService } from '../loans/loans.service';
export declare class BotService implements OnModuleInit, OnModuleDestroy {
    private readonly prisma;
    private readonly borrowersService;
    private readonly loansService;
    private bot;
    private openai;
    private readonly logger;
    private enabled;
    private conversations;
    private phoneToChatId;
    constructor(prisma: PrismaService, borrowersService: BorrowersService, loansService: LoansService);
    onModuleInit(): Promise<void>;
    handleOriginateLoan(chatId: number, args: any): Promise<void>;
    sendDisbursementAlert(phone: string | null, loanDetails: any): Promise<void>;
    onModuleDestroy(): void;
}
