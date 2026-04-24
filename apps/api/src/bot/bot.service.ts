import { Injectable, OnModuleInit, OnModuleDestroy, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Telegraf } from 'telegraf';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { BorrowersService } from '../borrowers/borrowers.service';
import { LoansService } from '../loans/loans.service';
import { InterestMethod } from '@microloan/shared';

const SYSTEM_PROMPT = `You are a highly efficient and friendly loan AI assistant for Magic Money. 
Your goals:
1. BEFORE offering a loan or starting an application, ALWAYS call \`get_loan_products\` to see what loan types are available (e.g., Daily, Weekly, Mortgage).
2. Ask the user which product they want, and state the rules (min/max terms, interest rate).
3. Collect info to originate loans: First Name, Last Name, Phone Number, Principal ($), Term (months), and the chosen productId.
4. Help users check their pending loan balance and next due dates using \`check_loan_balance\`.

Have a natural conversation. You can ask for info or answer questions about their account.
Use the \`originate_loan\` function to submit applications, and \`check_loan_balance\` to check their existing account info. Interpret the JSON returned by check_loan_balance and explain it in a user-friendly way.
`;

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
    private bots: Map<string, Telegraf> = new Map();
    private openai: OpenAI;
    private readonly logger = new Logger(BotService.name);
    private enabled = false;

    constructor(
        private readonly prisma: PrismaService,
        private readonly borrowersService: BorrowersService,
        @Inject(forwardRef(() => LoansService))
        private readonly loansService: LoansService,
    ) { }

    async onModuleInit() {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            this.logger.warn('OPENAI_API_KEY missing. Bots are disabled.');
            return;
        }

        this.openai = new OpenAI({ apiKey });
        this.enabled = true;

        // Initialize bots for all tenants that have a token
        await this.reloadAllBots();
    }

    async reloadAllBots() {
        // Stop existing bots
        for (const [tenantId, bot] of this.bots.entries()) {
            bot.stop('SIGINT');
            this.logger.log(`Stopped bot for tenant: ${tenantId}`);
        }
        this.bots.clear();

        const tenants = await this.prisma.tenant.findMany({
            where: { telegramBotToken: { not: null } }
        });

        for (const tenant of tenants) {
            try {
                await this.startBotForTenant(tenant.id, tenant.telegramBotToken!);
            } catch (err) {
                this.logger.error(`Failed to start bot for tenant ${tenant.id}`, err);
            }
        }
    }

    async startBotForTenant(tenantId: string, token: string) {
        if (this.bots.has(tenantId)) {
            this.bots.get(tenantId)?.stop('SIGINT');
        }

        const bot = new Telegraf(token);

        bot.start((ctx) => {
            ctx.reply('Welcome to Magic Money! Need a loan? Just tell me how much you need or ask me for help applying!');
        });

        bot.on('text', async (ctx) => {
            const chatId = ctx.chat.id;
            const text = ctx.message.text;
            const conversation: any[] = [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: text },
            ];
            try {
                await ctx.sendChatAction('typing');
                const response = await this.openai.chat.completions.create({
                    model: 'gpt-4o',
                    messages: conversation,
                    tools: [
                        {
                            type: 'function',
                            function: {
                                name: 'originate_loan',
                                description: 'Creates a DRAFT loan in the Magic Money system',
                                parameters: {
                                    type: 'object',
                                    properties: {
                                        firstName: { type: 'string' },
                                        lastName: { type: 'string' },
                                        phone: { type: 'string' },
                                        principal: { type: 'number' },
                                        termMonths: { type: 'number' },
                                        productId: { type: 'string' },
                                    },
                                    required: ['firstName', 'lastName', 'phone', 'principal', 'termMonths', 'productId']
                                }
                            }
                        },
                        {
                            type: 'function',
                            function: {
                                name: 'check_loan_balance',
                                description: 'Checks the user\'s current active loan balance.',
                                parameters: { type: 'object', properties: {} }
                            }
                        },
                        {
                            type: 'function',
                            function: {
                                name: 'get_loan_products',
                                description: 'Fetches the list of active loan products.',
                                parameters: { type: 'object', properties: {} }
                            }
                        }
                    ]
                });

                const choice = response.choices[0];
                if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
                    const toolCall: any = choice.message.tool_calls[0];
                    const args = toolCall.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};

                    let resultContent = '';
                    const functionName = toolCall.function?.name;
                    if (functionName === 'originate_loan') {
                        await this.handleOriginateLoan(tenantId, chatId, args);
                        resultContent = 'Successfully originated loan';
                    } else if (functionName === 'check_loan_balance') {
                        resultContent = await this.checkLoanBalance(tenantId, chatId);
                    } else if (functionName === 'get_loan_products') {
                        resultContent = await this.getLoanProducts(tenantId);
                    }

                    conversation.push(choice.message as any);
                    conversation.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: resultContent
                    });

                    const followup = await this.openai.chat.completions.create({
                        model: 'gpt-4o',
                        messages: conversation
                    });

                    const replyText = followup.choices[0].message.content || 'Done!';
                    ctx.reply(replyText);
                } else {
                    const aiResponse = choice.message.content || '...';
                    ctx.reply(aiResponse);
                }
            } catch (err) {
                this.logger.error(`Error handling telegram message for tenant ${tenantId}`, err);
                ctx.reply('Sorry, I encountered an error processing your request.');
            }
        });

        bot.launch();
        this.bots.set(tenantId, bot);
        this.logger.log(`Telegram Bot started for tenant: ${tenantId}`);
    }

    async handleOriginateLoan(tenantId: string, chatId: number, args: any) {
        // Find a valid user in this tenant for audit log
        const user = await this.prisma.user.findFirst({ where: { tenantId } });
        if (!user) throw new Error('No valid user found in tenant');
        const userId = user.id;

        // 1. Check or Create Borrower
        let borrower = await this.prisma.borrower.findFirst({
            where: { phone: args.phone, tenantId }
        });

        if (!borrower) {
            borrower = await this.borrowersService.create({
                sub: userId,
                id: userId,
                role: 'TENANT_ADMIN',
                tenantId,
                branchId: null,
                permissions: [],
            } as any, {
                firstName: args.firstName,
                lastName: args.lastName,
                idNumber: 'BOT-' + Date.now().toString(),
                phone: args.phone,
                address: 'Telegram Client',
                telegramChatId: chatId.toString(),
            });
        } else if (!borrower.telegramChatId) {
            borrower = await this.prisma.borrower.update({
                where: { id: borrower.id },
                data: { telegramChatId: chatId.toString() }
            });
        }

        // Validate Product and Policy
        const product = await this.prisma.loanProduct.findFirst({
            where: { id: args.productId, tenantId },
            include: { policies: true }
        });

        if (!product) throw new Error('Invalid loan product ID');

        let policy = product.policies.find(p => p.creditRating === 'GOOD') || product.policies[0];
        if (!policy) throw new Error('Selected product has no valid interest policies.');

        // 2. Create Loan
        await this.loansService.create({
            sub: userId,
            id: userId,
            role: 'TENANT_ADMIN',
            tenantId,
            branchId: borrower.branchId || null,
            permissions: [],
        } as any, {
            borrowerId: borrower.id,
            principal: args.principal,
            annualInterestRate: Number(policy.interestRate),
            termMonths: args.termMonths,
            startDate: new Date().toISOString(),
            interestMethod: product.interestMethod as InterestMethod,
            productId: product.id,
            creditRatingApplied: policy.creditRating,
        });
    }

    async getLoanProducts(tenantId: string): Promise<string> {
        const products = await this.prisma.loanProduct.findMany({
            where: { isActive: true, tenantId },
            include: { policies: true }
        });
        return JSON.stringify(products);
    }

    async checkLoanBalance(tenantId: string, chatId: number): Promise<string> {
        const borrower = await this.prisma.borrower.findFirst({
            where: { telegramChatId: chatId.toString(), tenantId },
            include: { loans: { include: { schedules: { orderBy: { dueDate: 'asc' } } } } }
        });

        if (!borrower || borrower.loans.length === 0) {
            return JSON.stringify({ error: "Unable to find an active account or loan for you." });
        }

        const accountSummary = borrower.loans.map(l => {
            const nextPayment = l.schedules.find(s => !s.isPaid);
            return {
                id: l.id,
                status: l.status,
                principalAmount: Number(l.principal),
                nextPaymentAmount: nextPayment ? Number(nextPayment.totalAmount) : null,
                nextPaymentDueDate: nextPayment ? nextPayment.dueDate : null,
            };
        });

        return JSON.stringify({ loans: accountSummary });
    }

    async sendDisbursementAlert(tenantId: string, chatId: string, message: string) {
        const bot = this.bots.get(tenantId);
        if (bot) {
            await bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        }
    }

    @Cron(CronExpression.EVERY_DAY_AT_10AM)
    async sendLatePaymentAlerts() {
        this.logger.log('Running daily late payment checks across all tenants...');
        const lateSchedules = await this.prisma.repaymentSchedule.findMany({
            where: { isPaid: false, dueDate: { lt: new Date() } },
            include: { loan: { include: { borrower: true, tenant: true } } }
        });

        for (const schedule of lateSchedules) {
            const bot = this.bots.get(schedule.loan.tenantId);
            const borrower = schedule.loan.borrower;
            if (bot && borrower.telegramChatId) {
                try {
                    const msg = `⚠️ **LATE PAYMENT NOTICE** ⚠️\n\nDear ${borrower.firstName},\nYour payment of **$${schedule.totalAmount}** was due on ${new Date(schedule.dueDate).toLocaleDateString()}.\n\nPlease pay as soon as possible.`;
                    await bot.telegram.sendMessage(borrower.telegramChatId, msg, { parse_mode: 'Markdown' });
                } catch (e) {
                    this.logger.error(`Failed to alert ${borrower.id} via bot ${schedule.loan.tenantId}`, e);
                }
            }
        }
    }

    onModuleDestroy() {
        for (const bot of this.bots.values()) {
            bot.stop('SIGINT');
        }
    }
}
