"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var BotService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BotService = void 0;
const common_1 = require("@nestjs/common");
const telegraf_1 = require("telegraf");
const openai_1 = __importDefault(require("openai"));
const prisma_service_1 = require("../prisma/prisma.service");
const borrowers_service_1 = require("../borrowers/borrowers.service");
const loans_service_1 = require("../loans/loans.service");
const shared_1 = require("@microloan/shared");
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
let BotService = BotService_1 = class BotService {
    prisma;
    borrowersService;
    loansService;
    bot;
    openai;
    logger = new common_1.Logger(BotService_1.name);
    enabled = false;
    conversations = {};
    phoneToChatId = new Map();
    constructor(prisma, borrowersService, loansService) {
        this.prisma = prisma;
        this.borrowersService = borrowersService;
        this.loansService = loansService;
    }
    async onModuleInit() {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const apiKey = process.env.OPENAI_API_KEY;
        if (!token || !apiKey) {
            this.logger.warn('TELEGRAM_BOT_TOKEN or OPENAI_API_KEY missing. Bot is disabled.');
            return;
        }
        this.bot = new telegraf_1.Telegraf(token);
        this.openai = new openai_1.default({ apiKey });
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
                        await this.handleOriginateLoan(chatId, args);
                        this.conversations[chatId].push(choice.message);
                        this.conversations[chatId].push({
                            role: 'tool',
                            tool_call_id: toolCall.id,
                            content: 'Successfully originated loan'
                        });
                        const followup = await this.openai.chat.completions.create({
                            model: 'gpt-4o',
                            messages: this.conversations[chatId]
                        });
                        const replyText = followup.choices[0].message.content || 'Done!';
                        this.conversations[chatId].push({ role: 'assistant', content: replyText });
                        ctx.reply(replyText);
                    }
                }
                else {
                    const aiResponse = choice.message.content || '...';
                    this.conversations[chatId].push({ role: 'assistant', content: aiResponse });
                    ctx.reply(aiResponse);
                }
            }
            catch (err) {
                this.logger.error('Error handling telegram message', err);
                ctx.reply('Sorry, I encountered an error processing your request.');
            }
        });
        this.bot.launch();
        this.logger.log('Telegram Bot successfully started.');
    }
    async handleOriginateLoan(chatId, args) {
        const defaultTenantId = process.env.BOT_DEFAULT_TENANT_ID;
        let tenantId = defaultTenantId;
        if (!tenantId) {
            const tenant = await this.prisma.tenant.findFirst();
            if (!tenant)
                throw new Error('No tenant found in the entire system');
            tenantId = tenant.id;
        }
        const user = await this.prisma.user.findFirst({ where: { tenantId } });
        if (!user)
            throw new Error('No valid user found in tenant');
        const userId = user.id;
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
        if (args.phone) {
            this.phoneToChatId.set(args.phone.replace(/[^0-9+]/g, ''), chatId);
        }
        await this.loansService.create(tenantId, userId, {
            borrowerId: borrower.id,
            principal: args.principal,
            annualInterestRate: 12,
            termMonths: args.termMonths,
            startDate: new Date().toISOString(),
            interestMethod: shared_1.InterestMethod.FLAT,
        });
    }
    async sendDisbursementAlert(phone, loanDetails) {
        if (!this.enabled || !this.bot || !phone)
            return;
        const cleanPhone = phone.replace(/[^0-9+]/g, '');
        const chatId = this.phoneToChatId.get(cleanPhone);
        if (chatId) {
            const message = `🎉 Good news! Your loan of **$${loanDetails.principal}** has been officially DISBURSED! Your repayment schedule is now active. Log into the MicroLend app for full details.`;
            await this.bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            this.logger.log(`Disbursement alert sent to Telegram chat ${chatId}`);
        }
        else {
            this.logger.warn(`Could not find Telegram ChatId for phone ${phone}`);
        }
    }
    onModuleDestroy() {
        if (this.enabled && this.bot) {
            this.bot.stop('SIGINT');
        }
    }
};
exports.BotService = BotService;
exports.BotService = BotService = BotService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, common_1.Inject)((0, common_1.forwardRef)(() => loans_service_1.LoansService))),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        borrowers_service_1.BorrowersService,
        loans_service_1.LoansService])
], BotService);
//# sourceMappingURL=bot.service.js.map