import { Injectable, OnModuleInit, OnModuleDestroy, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Markup, Telegraf } from 'telegraf';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { LoansService } from '../loans/loans.service';
import { InterestMethod } from '@microloan/shared';
import { decryptField, blindIndex } from '../common/field-crypto';
import { SystemContext, TenantScopedByArg } from '../prisma/tenant-context';
import { phoneCandidates, verifiedOwnPhone } from './telegram-link';

const SYSTEM_PROMPT = `You are a highly efficient and friendly loan AI assistant for Magic Money. 
Your goals:
1. BEFORE offering a loan or starting an application, ALWAYS call \`get_loan_products\` to see what loan types are available (e.g., Daily, Weekly, Mortgage).
2. Ask the user which product they want, and state the rules (min/max terms, interest rate).
3. Collect info to originate loans: Principal ($), Term (months), and the chosen productId. Never ask for or accept a phone number in chat — the customer's identity comes only from the phone number they share with the "Share my phone number" button.
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
        @Inject(forwardRef(() => LoansService))
        private readonly loansService: LoansService,
    ) { }

    @SystemContext('startup: loads bot tokens for every tenant')
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

    @SystemContext('startup: enumerates tenants with a configured bot')
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
                await this.startBotForTenant(tenant.id, decryptField(tenant.telegramBotToken!)!);
            } catch (err) {
                this.logger.error(`Failed to start bot for tenant ${tenant.id}`, err);
            }
        }
    }

    @TenantScopedByArg(0)
    async startBotForTenant(tenantId: string, token: string) {
        if (this.bots.has(tenantId)) {
            this.bots.get(tenantId)?.stop('SIGINT');
        }

        const bot = new Telegraf(token);

        const shareContact = Markup.keyboard([
            Markup.button.contactRequest('Share my phone number'),
        ]).oneTime().resize();

        bot.start((ctx) => {
            ctx.reply(
                'Welcome to Magic Money! To see your loans or apply, first tap "Share my phone number" below so we can confirm who you are.',
                shareContact,
            );
        });

        // The only way a chat becomes linked to a borrower: a contact the user
        // shared from their own Telegram account (see telegram-link.ts).
        bot.on('contact', async (ctx) => {
            try {
                const phone = verifiedOwnPhone(ctx.message.contact, ctx.from?.id);
                if (!phone) {
                    await ctx.reply('Please share your own number using the "Share my phone number" button.', shareContact);
                    return;
                }
                await ctx.reply(await this.linkVerifiedPhone(tenantId, ctx.chat.id, phone), Markup.removeKeyboard());
            } catch (err) {
                this.logger.error(`Error linking telegram contact for tenant ${tenantId}`, err);
                await ctx.reply('Sorry, I could not verify your number right now.');
            }
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
                                        principal: { type: 'number' },
                                        termMonths: { type: 'number' },
                                        productId: { type: 'string' },
                                    },
                                    required: ['principal', 'termMonths', 'productId']
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
                        resultContent = await this.handleOriginateLoan(tenantId, chatId, args);
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

    @TenantScopedByArg(0)
    async handleOriginateLoan(tenantId: string, chatId: number, args: any): Promise<string> {
        // Find a valid user in this tenant for audit log
        const user = await this.prisma.user.findFirst({ where: { tenantId } });
        if (!user) throw new Error('No valid user found in tenant');
        const userId = user.id;

        // The applicant is the borrower this chat was linked to by a verified
        // contact share — never whoever the conversation claims to be.
        const borrower = await this.prisma.borrower.findFirst({
            where: { telegramChatId: chatId.toString(), tenantId },
        });
        if (!borrower) {
            return JSON.stringify({
                error: 'This chat is not linked to a customer yet. Ask the user to tap "Share my phone number" (send /start to show the button). New customers must register with a loan officer first.',
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
        return JSON.stringify({ ok: true, message: 'Application submitted for review.' });
    }

    /**
     * Link this chat to the borrower whose stored phone matches a number the
     * user verified by sharing their own contact. A borrower already linked to
     * a different chat is left alone — relinking goes through staff.
     */
    @TenantScopedByArg(0)
    async linkVerifiedPhone(tenantId: string, chatId: number, phoneDigits: string): Promise<string> {
        const hashes = phoneCandidates(phoneDigits).map((p) => blindIndex(p, 'phone') as string);
        const borrower = await this.prisma.borrower.findFirst({
            where: { tenantId, phoneHash: { in: hashes } },
        });
        if (!borrower) {
            return 'Thanks! We could not find a customer with this number. Please visit a loan officer to register.';
        }
        const chat = chatId.toString();
        if (borrower.telegramChatId && borrower.telegramChatId !== chat) {
            return 'This number is already linked to another Telegram account. Please contact your loan officer.';
        }
        if (borrower.telegramChatId !== chat) {
            await this.prisma.borrower.update({
                where: { id: borrower.id },
                data: { telegramChatId: chat },
            });
        }
        return `Thanks ${borrower.firstName}, your number is verified. You can now ask about your loans or apply.`;
    }

    @TenantScopedByArg(0)
    async getLoanProducts(tenantId: string): Promise<string> {
        const products = await this.prisma.loanProduct.findMany({
            where: { isActive: true, tenantId },
            include: { policies: true }
        });
        return JSON.stringify(products);
    }

    @TenantScopedByArg(0)
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

    @TenantScopedByArg(0)
    async sendDisbursementAlert(tenantId: string, chatId: string, message: string) {
        const bot = this.bots.get(tenantId);
        if (bot) {
            await bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        }
    }

    @Cron(CronExpression.EVERY_DAY_AT_10AM)
    @SystemContext('cron: scans overdue loans across all tenants')
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
