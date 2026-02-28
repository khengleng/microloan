import { Injectable, OnModuleInit, OnModuleDestroy, Logger, Inject, forwardRef } from '@nestjs/common';
import { Telegraf } from 'telegraf';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { BorrowersService } from '../borrowers/borrowers.service';
import { LoansService } from '../loans/loans.service';
import { InterestMethod } from '@microloan/shared';

const SYSTEM_PROMPT = `You are a highly efficient and friendly loan origination AI assistant for MicroLend. 
Your goal is to collect the necessary information from customers asking for a loan:
- First Name
- Last Name
- Phone Number
- Principal Amount ($)
- Term (months)

Have a natural conversation. You can ask for one or two pieces of information at a time.
Once you have ALL the information, confirm the details with the user briefly, and then use the \`originate_loan\` function to submit the loan application to the backend system.
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
                        }
                    ]
                });

                const choice = response.choices[0];
                if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
                    const toolCall = choice.message.tool_calls[0];
                    if (toolCall.type === 'function' && toolCall.function.name === 'originate_loan') {
                        const args = JSON.parse(toolCall.function.arguments);

                        // Execute the system logic
                        await this.handleOriginateLoan(chatId, args);

                        this.conversations[chatId].push(choice.message as any);
                        this.conversations[chatId].push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: 'Successfully originated loan'
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
                address: 'Telegram Client'
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

    async sendDisbursementAlert(phone: string | null, loanDetails: any) {
        if (!this.enabled || !this.bot || !phone) return;

        const cleanPhone = phone.replace(/[^0-9+]/g, '');
        const chatId = this.phoneToChatId.get(cleanPhone);

        if (chatId) {
            const message = `🎉 Good news! Your loan of **$${loanDetails.principal}** has been officially DISBURSED! Your repayment schedule is now active. Log into the MicroLend app for full details.`;
            await this.bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            this.logger.log(`Disbursement alert sent to Telegram chat ${chatId}`);
        } else {
            this.logger.warn(`Could not find Telegram ChatId for phone ${phone}`);
        }
    }

    onModuleDestroy() {
        if (this.enabled && this.bot) {
            this.bot.stop('SIGINT');
        }
    }
}
