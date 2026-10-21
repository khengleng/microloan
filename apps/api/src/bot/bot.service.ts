import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Markup, Telegraf, Telegram } from 'telegraf';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { lending } from '@microloan/shared';
import { decryptField, blindIndex } from '../common/field-crypto';
import { SystemContext, TenantScopedByArg } from '../prisma/tenant-context';
import { phoneCandidates, verifiedOwnPhone } from './telegram-link';
import { JobClaimService } from '../prisma/job-claim.service';
import { operationalConfig } from '../config/operational-config';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';
import { KhqrHowToPayService } from '../lending/payments/khqr/khqr-how-to-pay.service';
import { KhqrCodesService } from '../lending/payments/khqr/khqr-codes.service';
import { howToPayShort } from '../lending/payments/khqr/how-to-pay';

/** The tenant's local time zone for the daily customer notices (as the end-of-day jobs). */
const JOB_TIME_ZONE = process.env.LENDING_EOD_TZ || 'Asia/Phnom_Penh';

/**
 * What the chat says when a customer asks to apply (D-155): the chat
 * application wrote loans into the original module, which has no write paths
 * any more; applying is done with a loan officer until a chat application
 * on the lending platform exists.
 */
export const CHAT_APPLICATIONS_PAUSED =
    'Applying for a loan in this chat is paused. Please contact your loan officer or visit a branch to apply.';

/** How long one instance's claim to poll a tenant's bot lasts; renewed every third of it. */
const POLLING_LEASE_MS = 90_000;

const systemPrompt = (platformName: string) => `You are a friendly loan assistant for ${platformName}.
Your goals:
1. Help customers check their loan balance, what they owe and when the next instalment is due, using \`check_loan_balance\`. Interpret the JSON it returns and explain it in plain words. When it includes \`howToPay\`, tell the customer to pay with the lender's KHQR code (merchant and Bakong account given) and to write the loan reference in the payment remark; a payment is credited once the lender has checked it.
2. Tell customers which loan products the lender offers, using \`get_loan_products\`.
3. If a customer wants to apply for a loan, explain that applications are made with a loan officer or at a branch; never collect application details in the chat.
Never ask for or accept a phone number in chat — the customer's identity comes only from the phone number they share with the "Share my phone number" button.
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
        private readonly claims: JobClaimService,
        private readonly tenantSettings: TenantSettingsService,
        // Optional only so the unit tests can build the service without them.
        private readonly howToPay?: KhqrHowToPayService,
        private readonly khqrCodes?: KhqrCodesService,
    ) { }

    /**
     * How to repay one loan (D-160): a line for the message and the lender's
     * static KHQR code as a picture, or nothing when no code is in force.
     */
    private async payment(tenantId: string, loanId: string): Promise<{ line: string; qr: Buffer | null; howToPay: Record<string, string> | null }> {
        if (!this.howToPay) return { line: '', qr: null, howToPay: null };
        try {
            const info = await this.howToPay.loanInfo(tenantId, loanId);
            if (!info.code) return { line: '', qr: null, howToPay: null };
            return {
                line: howToPayShort(info.reference, info.code),
                qr: this.khqrCodes ? await this.khqrCodes.png(info.code) : null,
                howToPay: {
                    payTo: info.code.merchantName,
                    bakongAccountId: info.code.bakongAccountId,
                    currency: info.code.currency,
                    writeInRemark: info.reference,
                },
            };
        } catch (e) {
            this.logger.warn(`How-to-pay for loan ${loanId} unavailable: ${(e as Error).message}`);
            return { line: '', qr: null, howToPay: null };
        }
    }

    /** Whether the tenant lets customers apply for loans from the chat (default off, D-132). */
    private async loanApplicationsAllowed(tenantId: string): Promise<boolean> {
        try {
            return (await this.tenantSettings.get(tenantId)).telegramBot.allowLoanApplications;
        } catch {
            return false;
        }
    }

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
                `Welcome to ${platformName}! To see your loans, first tap "Share my phone number" below so we can confirm who you are.`,
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
                // The application tool is offered only where the tenant turned it on.
                const canApply = await this.loanApplicationsAllowed(tenantId);
                const response = await this.openai.chat.completions.create({
                    model,
                    messages: conversation,
                    tools: [
                        ...(canApply ? [{
                            type: 'function' as const,
                            function: {
                                name: 'originate_loan',
                                description: `Asks to apply for a loan with ${platformName}`,
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
                        }] : []),
                        {
                            type: 'function',
                            function: {
                                name: 'check_loan_balance',
                                description: 'Checks the customer\'s loans: balance, amount overdue and the next instalment.',
                                parameters: { type: 'object', properties: {} }
                            }
                        },
                        {
                            type: 'function',
                            function: {
                                name: 'get_loan_products',
                                description: 'Lists the loan products the lender currently offers.',
                                parameters: { type: 'object', properties: {} }
                            }
                        }
                    ]
                });

                const choice = response.choices[0];
                if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
                    const toolCall: any = choice.message.tool_calls[0];

                    let resultContent = '';
                    const functionName = toolCall.function?.name;
                    if (functionName === 'originate_loan') {
                        resultContent = await this.handleOriginateLoan(tenantId);
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

    /**
     * A loan application from the chat (D-132). Until D-155 it created a loan
     * in the original module, which has no write paths any more. The tool is
     * still offered only where the tenant turned on
     * `telegramBot.allowLoanApplications`, and it answers that applying in
     * the chat is paused: nothing is recorded.
     */
    @TenantScopedByArg(0)
    async handleOriginateLoan(tenantId: string): Promise<string> {
        if (!(await this.loanApplicationsAllowed(tenantId))) {
            return JSON.stringify({
                error: 'Loan applications by chat are not available. Please contact a loan officer to apply.',
            });
        }
        return JSON.stringify({ error: CHAT_APPLICATIONS_PAUSED });
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

    /** The lending products with an active version: name, family and default rate. */
    @TenantScopedByArg(0)
    async getLoanProducts(tenantId: string): Promise<string> {
        const products = await this.prisma.lendingProduct.findMany({
            where: { tenantId, versions: { some: { status: 'ACTIVE' } } },
            select: {
                name: true,
                familyCode: true,
                versions: {
                    where: { status: 'ACTIVE' },
                    orderBy: { version: 'desc' },
                    take: 1,
                    select: { pricing: { select: { defaultAnnualRate: true, interestMethod: true } } },
                },
            },
            orderBy: { name: 'asc' },
        });
        return JSON.stringify(
            products.map((p) => {
                const pricing = p.versions[0]?.pricing;
                return {
                    name: p.name,
                    family: p.familyCode,
                    annualRatePct: pricing?.defaultAnnualRate
                        ? lending.D(pricing.defaultAnnualRate.toString()).times(100).toDecimalPlaces(2).toString()
                        : null,
                    interestMethod: pricing?.interestMethod ?? null,
                };
            }),
        );
    }

    /** The linked customer's lending loans: balance, overdue and the next instalment. */
    @TenantScopedByArg(0)
    async checkLoanBalance(tenantId: string, chatId: number): Promise<string> {
        const borrower = await this.prisma.borrower.findFirst({
            where: { telegramChatId: chatId.toString(), tenantId },
            select: { id: true },
        });
        if (!borrower) {
            return JSON.stringify({ error: 'Unable to find an active account or loan for you.' });
        }
        const loans = await this.prisma.loanAccount.findMany({
            where: { tenantId, borrowerId: borrower.id, status: { in: ['BOOKED', 'ACTIVE'] } },
            orderBy: { createdAt: 'asc' },
            select: {
                id: true,
                reference: true,
                status: true,
                currency: true,
                bookedPrincipal: true,
                principalOutstanding: true,
                interestReceivable: true,
                feesReceivable: true,
                penaltyReceivable: true,
                daysPastDue: true,
                instalments: {
                    where: { status: 'DUE' },
                    orderBy: { dueDate: 'asc' },
                    select: INSTALMENT_OWED,
                },
            },
        });
        if (!loans.length) {
            return JSON.stringify({ error: 'Unable to find an active account or loan for you.' });
        }
        const businessDate = await this.businessDate(tenantId);
        const out: (ReturnType<typeof loanSummary> & { howToPay: Record<string, string> | null })[] = [];
        for (const l of loans)
            out.push({ ...loanSummary(l, businessDate), howToPay: (await this.payment(tenantId, l.id)).howToPay });
        return JSON.stringify({ loans: out });
    }

    /** The tenant's business date (YYYY-MM-DD); its calendar date until finance has set one. */
    private async businessDate(tenantId: string): Promise<string> {
        const row = await this.prisma.tenantBusinessDate.findUnique({ where: { tenantId } });
        return row ? toDay(row.businessDate) : new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
    }

    @TenantScopedByArg(0)
    async sendDisbursementAlert(tenantId: string, chatId: string, message: string) {
        const telegram = await this.sender(tenantId);
        if (telegram) {
            await telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        }
    }

    /**
     * Daily (LATE_ALERT_CRON, default 10:00; it replaces LEGACY_LATE_ALERT_CRON):
     * a notice to every linked customer whose lending loan has an
     * instalment unpaid on or before the tenant's business date. Every
     * instance runs the cron; each tenant's notices are claimed once per day,
     * so a customer gets one notice, not one per instance.
     */
    @Cron(process.env.LATE_ALERT_CRON || CronExpression.EVERY_DAY_AT_10AM, { timeZone: JOB_TIME_ZONE })
    @SystemContext('cron: scans overdue lending loans of tenants with a bot')
    async sendLatePaymentAlerts() {
        if (!this.enabled) return;
        await this.forEachBotTenant('lending.late-payment-alerts', async (tenantId, telegram, businessDate) => {
            const due = { status: 'DUE', dueDate: { lte: dayStart(businessDate) } };
            const loans = await this.prisma.loanAccount.findMany({
                where: { tenantId, status: 'ACTIVE', instalments: { some: due } },
                select: {
                    id: true,
                    reference: true,
                    currency: true,
                    borrowerId: true,
                    instalments: { where: due, orderBy: { dueDate: 'asc' }, select: INSTALMENT_OWED },
                },
            });
            for (const l of loans) {
                const open = l.instalments.filter((i) => owedOn(i).gt(0));
                if (!open.length) continue;
                const owed = open.reduce((t, i) => t.plus(owedOn(i)), lending.D(0));
                const pay = await this.payment(tenantId, l.id);
                await this.notify(tenantId, telegram, l.borrowerId, (name) =>
                    `⚠️ **LATE PAYMENT NOTICE** ⚠️\n\nDear ${name},\n**${owed.toFixed(2)} ${l.currency}** on loan ${l.reference} is overdue (since ${toDay(open[0].dueDate)}).\n\nPlease pay as soon as possible.${pay.line ? `\n\n${pay.line}` : ''}`,
                    pay.qr,
                );
            }
        });
    }

    /**
     * Daily (REMINDER_CRON, default 8:00; it replaces LEGACY_REMINDER_CRON):
     * a reminder to every linked customer with a lending instalment due the
     * day after the business date. Claimed once per tenant and day.
     */
    @Cron(process.env.REMINDER_CRON || CronExpression.EVERY_DAY_AT_8AM, { timeZone: JOB_TIME_ZONE })
    @SystemContext('cron: scans lending instalments due tomorrow of tenants with a bot')
    async sendDueReminders() {
        if (!this.enabled) return;
        await this.forEachBotTenant('lending.due-tomorrow-reminders', async (tenantId, telegram, businessDate) => {
            const lines = await this.prisma.scheduleInstalment.findMany({
                where: {
                    tenantId,
                    status: 'DUE',
                    dueDate: dayStart(lending.addDays(businessDate, 1)),
                    loanAccount: { status: 'ACTIVE' },
                },
                select: { ...INSTALMENT_OWED, loanAccount: { select: { id: true, reference: true, currency: true, borrowerId: true } } },
            });
            for (const i of lines) {
                const owed = owedOn(i);
                if (owed.lte(0)) continue;
                const pay = await this.payment(tenantId, i.loanAccount.id);
                await this.notify(tenantId, telegram, i.loanAccount.borrowerId, (name) =>
                    `🔔 **Payment Reminder**\n\nDear ${name},\nYour instalment of **${owed.toFixed(2)} ${i.loanAccount.currency}** on loan ${i.loanAccount.reference} is due tomorrow (${toDay(i.dueDate)}).\n\nPlease pay on time to avoid late charges. Thank you!${pay.line ? `\n\n${pay.line}` : ''}`,
                    pay.qr,
                );
            }
        });
    }

    /** Run a daily notice job for each tenant with a bot whose run this instance claimed. */
    private async forEachBotTenant(
        job: string,
        run: (tenantId: string, telegram: Telegram, businessDate: string) => Promise<void>,
    ) {
        const tenants = await this.prisma.tenant.findMany({
            where: { telegramBotToken: { not: null } },
            select: { id: true },
        });
        const runKey = new Date().toISOString().slice(0, 10);
        for (const { id: tenantId } of tenants) {
            try {
                if (!(await this.claims.once(tenantId, job, runKey))) continue;
                const telegram = await this.sender(tenantId);
                if (!telegram) continue;
                await run(tenantId, telegram, await this.businessDate(tenantId));
            } catch (e) {
                this.logger.error(`${job} failed for tenant ${tenantId}`, e);
            }
        }
    }

    /** Message a borrower linked to a chat; a failure is logged, never thrown. */
    private async notify(tenantId: string, telegram: Telegram, borrowerId: string, text: (firstName: string) => string, qr: Buffer | null = null) {
        const borrower = await this.prisma.borrower.findFirst({
            where: { id: borrowerId, tenantId, telegramChatId: { not: null } },
            select: { id: true, firstName: true, telegramChatId: true },
        });
        if (!borrower?.telegramChatId) return;
        try {
            await telegram.sendMessage(borrower.telegramChatId, text(borrower.firstName), { parse_mode: 'Markdown' });
            // The lender's KHQR code to scan, right under the notice (D-160).
            if (qr) await telegram.sendPhoto(borrower.telegramChatId, { source: qr }, { caption: 'KHQR' });
        } catch (e) {
            this.logger.error(`Failed to notify ${borrower.id} via bot ${tenantId}`, e);
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

/** The instalment fields that make up what is still owed on it. */
const INSTALMENT_OWED = {
    dueDate: true,
    principalDue: true,
    interestDue: true,
    feeDue: true,
    taxDue: true,
    penaltyDue: true,
    principalPaid: true,
    interestPaid: true,
    feePaid: true,
    taxPaid: true,
    penaltyPaid: true,
} as const;

type Amount = { toString(): string } | string | number;

export interface OwedLine {
    dueDate: Date;
    principalDue: Amount;
    interestDue: Amount;
    feeDue: Amount;
    taxDue: Amount;
    penaltyDue: Amount;
    principalPaid: Amount;
    interestPaid: Amount;
    feePaid: Amount;
    taxPaid: Amount;
    penaltyPaid: Amount;
}

const D = (v: Amount) => lending.D(v.toString());

/** Due less paid on one instalment, every component. */
export function owedOn(i: OwedLine) {
    return D(i.principalDue)
        .plus(D(i.interestDue))
        .plus(D(i.feeDue))
        .plus(D(i.taxDue))
        .plus(D(i.penaltyDue))
        .minus(D(i.principalPaid))
        .minus(D(i.interestPaid))
        .minus(D(i.feePaid))
        .minus(D(i.taxPaid))
        .minus(D(i.penaltyPaid));
}

/** What the chat tells a customer about one loan on the business date. Exported for its unit test. */
export function loanSummary(
    l: {
        reference: string;
        status: string;
        currency: string;
        bookedPrincipal: Amount;
        principalOutstanding: Amount;
        interestReceivable: Amount;
        feesReceivable: Amount;
        penaltyReceivable: Amount;
        daysPastDue: number;
        instalments: OwedLine[];
    },
    businessDate: string,
) {
    const open = l.instalments.filter((i) => owedOn(i).gt(0));
    const overdue = open.filter((i) => toDay(i.dueDate) <= businessDate);
    const next = open.find((i) => toDay(i.dueDate) > businessDate);
    return {
        reference: l.reference,
        status: l.status,
        currency: l.currency,
        amountBorrowed: D(l.bookedPrincipal).toFixed(2),
        balance: D(l.principalOutstanding)
            .plus(D(l.interestReceivable))
            .plus(D(l.feesReceivable))
            .plus(D(l.penaltyReceivable))
            .toFixed(2),
        daysPastDue: l.daysPastDue,
        amountOverdue: overdue.reduce((t, i) => t.plus(owedOn(i)), lending.D(0)).toFixed(2),
        nextPaymentAmount: next ? owedOn(next).toFixed(2) : null,
        nextPaymentDueDate: next ? toDay(next.dueDate) : null,
    };
}

function toDay(d: Date): string {
    return d.toISOString().slice(0, 10);
}

function dayStart(day: string): Date {
    return new Date(`${day}T00:00:00.000Z`);
}
