import { Injectable, OnModuleInit, OnModuleDestroy, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Markup, Telegraf, Telegram } from 'telegraf';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { LoansService } from '../loans/loans.service';
import { InterestMethod, formatCurrency, Currency as SharedCurrency } from '@microloan/shared';
import { decryptField, blindIndex } from '../common/field-crypto';
import { SystemContext, TenantScopedByArg } from '../prisma/tenant-context';
import { phoneCandidates, verifiedOwnPhone } from './telegram-link';
import { JobClaimService } from '../prisma/job-claim.service';
import { operationalConfig } from '../config/operational-config';

/** How long one instance's claim to poll a tenant's bot lasts; renewed every third of it. */
const POLLING_LEASE_MS = 90_000;

const systemPrompt = (platformName: string) => `You are a highly efficient and friendly loan AI assistant for ${platformName}. 
Your goals:
1. BEFORE offering a loan or starting an application, ALWAYS call \`get_loan_products\` to see what loan types are available (e.g., Daily, Weekly, Mortgage).
2. Ask the user which product they want, and state the rules (min/max terms, interest rate).
3. Collect info to originate loans: Principal ($), Term (months), and the chosen productId. Never ask for or accept a phone number in chat — the customer's identity comes only from the phone number they share with the "Share my phone number" button.
4. Help users check their pending loan balance and next due dates using \`check_loan_balance\`.

Have a natural conversation. You can ask for info or answer questions about their account.
Use the \`originate_loan\` function to submit applications, and \`check_loan_balance\` to check their existing account info. Interpret the JSON returned by check_loan_balance and explain it in a user-friendly way.
`;

/**
 * Telegram bots, one per tenant that configured a token.
 *
 * Several API instances may run. Telegram lets exactly one client poll a bot
 * for updates, so each tenant's polling is leased in the database
 * (ScheduledJobClaim, renewed every 30 s): one instance polls, and another
 * takes over within 90 s if it stops. Sending — alerts and reminders — works
 * from any instance with the token read from the database, so a token
 * changed on one instance is used by all of them at once. `pollers` is only
 * the live connections this instance holds, not state: it is rebuilt from the
 * database and the leases.
 */
@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
    private pollers: Map<string, { bot: Telegraf; tokenHash: string | null }> = new Map();
    private openai: OpenAI;
    private readonly logger = new Logger(BotService.name);
    private renewTimer: NodeJS.Timeout | null = null;

    /** Bots run only with OPENAI_API_KEY set (as before): the client exists exactly then. */
    private get enabled(): boolean {
        return !!this.openai;
    }

    constructor(
        private readonly prisma: PrismaService,
        @Inject(forwardRef(() => LoansService))
        private readonly loansService: LoansService,
        private readonly claims: JobClaimService,
    ) { }

    @SystemContext('startup: loads bot tokens for every tenant')
    async onModuleInit() {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            this.logger.warn('OPENAI_API_KEY missing. Bots are disabled.');
            return;
        }

        this.openai = new OpenAI({ apiKey });

        if (!operationalConfig().telegramPolling) {
            this.logger.log('TELEGRAM_POLLING_ENABLED=false: this instance sends bot messages but does not poll.');
            return;
        }
        // Take or renew the polling lease for every tenant's bot now and
        // every third of the lease, so a stopped instance is replaced.
        await this.reloadAllBots();
        if (process.env.NODE_ENV !== 'test') {
            this.renewTimer = setInterval(() => void this.reloadAllBots(), POLLING_LEASE_MS / 3);
            this.renewTimer.unref();
        }
    }

    /** Start, keep or stop polling each tenant's bot according to the leases. */
    @SystemContext('bot polling: enumerates tenants with a configured bot')
    async reloadAllBots() {
        if (!this.enabled) return;
        const tenants = await this.prisma.tenant.findMany({
            where: { telegramBotToken: { not: null } },
            select: { id: true, telegramBotToken: true, telegramBotTokenHash: true },
        });
        const withBot = new Set(tenants.map((t) => t.id));
        for (const [tenantId] of this.pollers)
            if (!withBot.has(tenantId)) await this.stopPolling(tenantId);
        for (const tenant of tenants) {
            try {
                const leased = await this.claims.lease(tenant.id, 'telegram.polling', 'leader', POLLING_LEASE_MS);
                const running = this.pollers.get(tenant.id);
                if (!leased) {
                    if (running) await this.stopPolling(tenant.id);
                    continue;
                }
                if (!running || running.tokenHash !== tenant.telegramBotTokenHash)
                    await this.launch(tenant.id, decryptField(tenant.telegramBotToken)!, tenant.telegramBotTokenHash);
            } catch (err) {
                this.logger.error(`Failed to start bot for tenant ${tenant.id}`, err);
            }
        }
    }

    /** After a token change: poll with the new token if this instance holds (or can take) the lease. */
    @TenantScopedByArg(0)
    async startBotForTenant(tenantId: string, token: string) {
        if (!this.enabled || !operationalConfig().telegramPolling) return;
        if (!(await this.claims.lease(tenantId, 'telegram.polling', 'leader', POLLING_LEASE_MS))) return;
        const row = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true, telegramBotTokenHash: true },
        });
        await this.launch(tenantId, token, row?.telegramBotTokenHash ?? null);
    }

    private async stopPolling(tenantId: string) {
        const running = this.pollers.get(tenantId);
        if (!running) return;
        running.bot.stop('SIGINT');
        this.pollers.delete(tenantId);
        this.logger.log(`Stopped bot polling for tenant: ${tenantId}`);
    }

    private async launch(tenantId: string, token: string, tokenHash: string | null) {
        await this.stopPolling(tenantId);
        const platformName = operationalConfig().platformName;
        const model = operationalConfig().openAiModel;

        const bot = new Telegraf(token);

        const shareContact = Markup.keyboard([
            Markup.button.contactRequest('Share my phone number'),
        ]).oneTime().resize();

        bot.start((ctx) => {
            ctx.reply(
                `Welcome to ${platformName}! To see your loans or apply, first tap "Share my phone number" below so we can confirm who you are.`,
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
                { role: 'system', content: systemPrompt(platformName) },
                { role: 'user', content: text },
            ];
            try {
                await ctx.sendChatAction('typing');
                const response = await this.openai.chat.completions.create({
                    model,
                    messages: conversation,
                    tools: [
                        {
                            type: 'function',
                            function: {
                                name: 'originate_loan',
                                description: `Creates a DRAFT loan in the ${platformName} system`,
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
                        model,
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

        // Polling runs in the background; a failure (e.g. another client
        // polling the same token) is logged, never an unhandled rejection.
        bot.launch().catch((err) =>
            this.logger.error(`Telegram polling stopped for tenant ${tenantId}: ${(err as Error).message}`),
        );
        this.pollers.set(tenantId, { bot, tokenHash });
        this.logger.log(`Telegram Bot started for tenant: ${tenantId}`);
    }

    /** A Telegram client for sending with the tenant's current token, or null without one (or when bots are off). */
    private async sender(tenantId: string): Promise<Telegram | null> {
        if (!this.enabled) return null;
        const row = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true, telegramBotToken: true },
        });
        const token = row?.telegramBotToken ? decryptField(row.telegramBotToken) : null;
        return token ? new Telegram(token) : null;
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
        const telegram = await this.sender(tenantId);
        if (telegram) {
            await telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        }
    }

    /**
     * Daily (LEGACY_LATE_ALERT_CRON, default 10:00). Every instance runs the
     * cron; each tenant's alerts are claimed once per day, so a borrower gets
     * one notice, not one per instance.
     */
    @Cron(process.env.LEGACY_LATE_ALERT_CRON || CronExpression.EVERY_DAY_AT_10AM)
    @SystemContext('cron: scans overdue loans across all tenants')
    async sendLatePaymentAlerts() {
        if (!this.enabled) return;
        this.logger.log('Running daily late payment checks across all tenants...');
        const lateSchedules = await this.prisma.repaymentSchedule.findMany({
            where: { isPaid: false, dueDate: { lt: new Date() } },
            include: { loan: { include: { borrower: true, tenant: true } } }
        });

        const runKey = new Date().toISOString().slice(0, 10);
        const senders = new Map<string, Telegram | null>();
        for (const schedule of lateSchedules) {
            const tenantId = schedule.loan.tenantId;
            if (!senders.has(tenantId)) {
                const mine = await this.claims.once(tenantId, 'legacy.late-payment-alerts', runKey);
                senders.set(tenantId, mine ? await this.sender(tenantId) : null);
            }
            const telegram = senders.get(tenantId);
            const borrower = schedule.loan.borrower;
            if (telegram && borrower.telegramChatId) {
                try {
                    const amount = formatCurrency(Number(schedule.totalAmount), schedule.loan.currency as unknown as SharedCurrency);
                    const msg = `⚠️ **LATE PAYMENT NOTICE** ⚠️\n\nDear ${borrower.firstName},\nYour payment of **${amount}** was due on ${new Date(schedule.dueDate).toLocaleDateString()}.\n\nPlease pay as soon as possible.`;
                    await telegram.sendMessage(borrower.telegramChatId, msg, { parse_mode: 'Markdown' });
                } catch (e) {
                    this.logger.error(`Failed to alert ${borrower.id} via bot ${tenantId}`, e);
                }
            }
        }
    }

    async onModuleDestroy() {
        if (this.renewTimer) clearInterval(this.renewTimer);
        for (const tenantId of [...this.pollers.keys()]) {
            await this.stopPolling(tenantId);
            // Hand the lease back so another instance takes over at once.
            await this.claims.release(tenantId, 'telegram.polling', 'leader').catch(() => undefined);
        }
    }
}
