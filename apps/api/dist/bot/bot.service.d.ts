import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BorrowersService } from '../borrowers/borrowers.service';
import { LoansService } from '../loans/loans.service';
export declare class BotService implements OnModuleInit, OnModuleDestroy {
    private readonly prisma;
    private readonly borrowersService;
    private readonly loansService;
    private bots;
    private openai;
    private readonly logger;
    private enabled;
    private conversations;
    constructor(prisma: PrismaService, borrowersService: BorrowersService, loansService: LoansService);
    onModuleInit(): Promise<void>;
    reloadAllBots(): Promise<void>;
    startBotForTenant(tenantId: string, token: string): Promise<void>;
    handleOriginateLoan(tenantId: string, chatId: number, args: any): Promise<void>;
    getLoanProducts(tenantId: string): Promise<string>;
    checkLoanBalance(tenantId: string, chatId: number): Promise<string>;
    sendDisbursementAlert(tenantId: string, chatId: string, message: string): Promise<void>;
    sendLatePaymentAlerts(): Promise<void>;
    onModuleDestroy(): void;
}
