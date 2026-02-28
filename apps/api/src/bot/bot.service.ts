import { Injectable, OnModuleInit, OnModuleDestroy, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Telegraf } from 'telegraf';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { BorrowersService } from '../borrowers/borrowers.service';
import { LoansService } from '../loans/loans.service';
import { InterestMethod } from '@microloan/shared';

const SYSTEM_PROMPT = `You are a highly efficient and friendly loan AI assistant for MicroLend. 
Your goals:
1. Collect info to originate loans: First Name, Last Name, Phone Number, Principal ($), Term (months).
2. Help users check their pending loan balance and next due dates.

Have a natural conversation. You can ask for info or answer questions about their account.
Use the \`originate_loan\` function to submit applications, and \`check_loan_balance\` to check their existing account info. Interpret the JSON returned by check_loan_balance and explain it in a user-friendly way (e.g., if it's DRAFT status, explain it is pending approval; if DISBURSED, emphasize their next payment amount and date).

IMPORTANT EXCEPTION TO DRAFTS: the check_loan_balance function returns the COMPLETE breakdown of the user's pending and paid repayment schedule. You MUST use this data if the user asks any questions about their full repayment schedule, interest breakdown, or pending amounts. Do not tell the user to check their agreement document.
`;

@Injectable()
export class BotService implements OnModuleInit, OnModuleDestroy {
    private bot: Telegraf;
    private openai: OpenAI;
    private readonly logger = new Logger(BotService.name);
    private enabled = false;

    // We will store simple conversational state per Telegram Chat ID
    private conversations: Record<number, any[]> = {};
    private phoneToChatId: Map<string, number> = new Map();

    constructor(
        private readonly prisma: PrismaService,
        private readonly borrowersService: BorrowersService,
        @Inject(forwardRef(() => LoansService))
        private readonly loansService: LoansService,
    ) { }

    async onModuleInit() {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const apiKey = process.env.OPENAI_API_KEY;

        if (!token || !apiKey) {
            this.logger.warn('TELEGRAM_BOT_TOKEN or OPENAI_API_KEY missing. Bot is disabled.');
            return;
        }

        this.bot = new Telegraf(token);
        this.openai = new OpenAI({ apiKey });
        this.enabled = true;

        this.bot.start((ctx) => {
            this.conversations[ctx.chat.id] = [
                { role: 'system', content: SYSTEM_PROMPT }
            ];
            ctx.reply('Welcome to MicroLend! Need a loan? Just tell me how much you need or ask me for help applying!');
        });

        this.bot.on('text', async (ctx) => {
            const chatId = ctx.chat.id;
            const text = ctx.message.text;

            if (!this.conversations[chatId]) {
                this.conversations[chatId] = [
                    { role: 'system', content: SYSTEM_PROMPT }
                ];
            }

            this.conversations[chatId].push({ role: 'user', content: text });
            try {
                await ctx.sendChatAction('typing');
                const response = await this.openai.chat.completions.create({
                    model: 'gpt-4o',
                    messages: this.conversations[chatId],
                    tools: [
                        {
                            type: 'function',
                            function: {
                                name: 'originate_loan',
                                description: 'Creates a DRAFT loan in the MicroLend system for the given user in a specified tenant',
                                parameters: {
                                    type: 'object',
                                    properties: {
                                        firstName: { type: 'string' },
                                        lastName: { type: 'string' },
                                        phone: { type: 'string' },
                                        principal: { type: 'number', description: 'The total loan requested amount' },
                                        termMonths: { type: 'number', description: 'Duration of the loan in months' },
                                    },
                                    required: ['firstName', 'lastName', 'phone', 'principal', 'termMonths']
                                }
                            }
                        },
                        {
                            type: 'function',
                            function: {
                                name: 'check_loan_balance',
                                description: 'Checks the user\'s current active loan balance and next payment due date.',
                                parameters: {
                                    type: 'object',
                                    properties: {}
                                }
                            }
                        }
                    ]
                });

                const choice = response.choices[0];
                if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
                    const toolCall = choice.message.tool_calls[0];
                    if (toolCall.type === 'function') {
                        const args = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};

                        let resultContent = '';
                        if (toolCall.function.name === 'originate_loan') {
                            await this.handleOriginateLoan(chatId, args);
                            resultContent = 'Successfully originated loan';
                        } else if (toolCall.function.name === 'check_loan_balance') {
                            resultContent = await this.checkLoanBalance(chatId);
                        }

                        this.conversations[chatId].push(choice.message as any);
                        this.conversations[chatId].push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: resultContent
                        });

                        // get the success bot reply
                        const followup = await this.openai.chat.completions.create({
                            model: 'gpt-4o',
                            messages: this.conversations[chatId]
                        });

                        const replyText = followup.choices[0].message.content || 'Done!';
                        this.conversations[chatId].push({ role: 'assistant', content: replyText });
                        ctx.reply(replyText);
                    }
                } else {
                    const aiResponse = choice.message.content || '...';
                    this.conversations[chatId].push({ role: 'assistant', content: aiResponse });
                    ctx.reply(aiResponse);
                }

            } catch (err) {
                this.logger.error('Error handling telegram message', err);
                ctx.reply('Sorry, I encountered an error processing your request.');
            }
        });

        this.bot.launch();
        this.logger.log('Telegram Bot successfully started.');
    }

    async handleOriginateLoan(chatId: number, args: any) {
        const defaultTenantId = process.env.BOT_DEFAULT_TENANT_ID;

        // Fallback: If no default tenant is configured, we can just find the first tenant available to use for demonstration.
        let tenantId = defaultTenantId;
        if (!tenantId) {
            const tenant = await this.prisma.tenant.findFirst();
            if (!tenant) throw new Error('No tenant found in the entire system');
            tenantId = tenant.id;
        }

        // Default System User for Audit Log
        const user = await this.prisma.user.findFirst({ where: { tenantId } });
        if (!user) throw new Error('No valid user found in tenant');
        const userId = user.id;

        // 1. Check or Create Borrower
        let borrower = await this.prisma.borrower.findFirst({
            where: { phone: args.phone, tenantId }
        });

        if (!borrower) {
            borrower = await this.borrowersService.create(tenantId, userId, {
                firstName: args.firstName,
                lastName: args.lastName,
                idNumber: 'BOT-' + Date.now().toString(),
                phone: args.phone,
                address: 'Telegram Client',
                telegramChatId: chatId.toString(),
            });
        } else if (!borrower.telegramChatId) {
            // Update existing borrower with chat id
            borrower = await this.prisma.borrower.update({
                where: { id: borrower.id },
                data: { telegramChatId: chatId.toString() }
            });
        }

        // Map phone to chatId so we can message them later
        if (args.phone) {
            this.phoneToChatId.set(args.phone.replace(/[^0-9+]/g, ''), chatId);
        }

        // 2. Create Loan
        await this.loansService.create(tenantId, userId, {
            borrowerId: borrower.id,
            principal: args.principal,
            annualInterestRate: 12, // assume 12%
            termMonths: args.termMonths,
            startDate: new Date().toISOString(),
            interestMethod: InterestMethod.FLAT,
        });
    }

    async checkLoanBalance(chatId: number): Promise<string> {
        const borrower = await this.prisma.borrower.findFirst({
            where: { telegramChatId: chatId.toString() },
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
                annualInterestRate: Number(l.annualInterestRate),
                termMonths: l.termMonths,
                interestMethod: l.interestMethod,
                nextPaymentAmount: nextPayment ? Number(nextPayment.totalAmount) : null,
                nextPaymentDueDate: nextPayment ? nextPayment.dueDate : null,
                allSchedules: l.schedules.map(s => ({
                    installmentNumber: s.installmentNumber,
                    dueDate: s.dueDate,
                    totalAmount: Number(s.totalAmount),
                    principalAmount: Number(s.principalAmount),
                    interestAmount: Number(s.interestAmount),
                    isPaid: s.isPaid
                }))
            };
        });

        return JSON.stringify({ loans: accountSummary });
    }

    async sendDisbursementAlert(phone: string | null, loanDetails: any) {
        if (!this.enabled || !this.bot) return;

        let chatId = loanDetails?.borrower?.telegramChatId;
        if (!chatId && phone) {
            const cleanPhone = phone.replace(/[^0-9+]/g, '');
            const borrower = await this.prisma.borrower.findFirst({ where: { phone: { contains: cleanPhone } } });
            if (borrower?.telegramChatId) chatId = borrower.telegramChatId;
        }

        if (chatId) {
            const message = `🎉 Good news! Your loan of **$${loanDetails.principal}** has been officially APPROVED and DISBURSED! Your repayment schedule is now active. Log into the MicroLend app for full details.`;
            await this.bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            this.logger.log(`Disbursement alert sent to Telegram chat ${chatId}`);
        } else {
            this.logger.warn(`Could not find Telegram ChatId for phone ${phone}`);
        }
    }

    @Cron(CronExpression.EVERY_DAY_AT_10AM)
    async sendLatePaymentAlerts() {
        this.logger.log('Running daily late payment checks...');
        if (!this.enabled || !this.bot) return;

        const lateSchedules = await this.prisma.repaymentSchedule.findMany({
            where: { isPaid: false, dueDate: { lt: new Date() } },
            include: { loan: { include: { borrower: true } } }
        });

        const notified = new Set();
        for (const schedule of lateSchedules) {
            const borrower = schedule.loan.borrower;
            if (borrower.telegramChatId && !notified.has(borrower.id)) {
                notified.add(borrower.id);
                try {
                    const msg = `⚠️ **URGENT NOTICE: LATE PAYMENT** ⚠️\n\nDear ${borrower.firstName},\nYour loan payment of **$${schedule.totalAmount}** which was due on ${new Date(schedule.dueDate).toLocaleDateString()} is past due.\n\nPlease remit payment immediately. Failure to do so will result in formal collection procedures beginning on your account.`;
                    await this.bot.telegram.sendMessage(borrower.telegramChatId, msg, { parse_mode: 'Markdown' });
                    this.logger.log(`Sent late payment alert to ${borrower.telegramChatId}`);
                } catch (e) {
                    this.logger.error(`Failed to send alert to ${borrower.telegramChatId}`, e);
                }
            }
        }
    }

    onModuleDestroy() {
        if (this.enabled && this.bot) {
            this.bot.stop('SIGINT');
        }
    }
}
