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
const schedule_1 = require("@nestjs/schedule");
const telegraf_1 = require("telegraf");
const openai_1 = __importDefault(require("openai"));
const prisma_service_1 = require("../prisma/prisma.service");
const borrowers_service_1 = require("../borrowers/borrowers.service");
const loans_service_1 = require("../loans/loans.service");
const SYSTEM_PROMPT = `You are a highly efficient and friendly loan AI assistant for Microloan. 
Your goals:
1. BEFORE offering a loan or starting an application, ALWAYS call \`get_loan_products\` to see what loan types are available (e.g., Daily, Weekly, Mortgage).
2. Ask the user which product they want, and state the rules (min/max terms, interest rate).
3. Collect info to originate loans: First Name, Last Name, Phone Number, Principal ($), Term (months), and the chosen productId.
4. Help users check their pending loan balance and next due dates using \`check_loan_balance\`.

Have a natural conversation. You can ask for info or answer questions about their account.
Use the \`originate_loan\` function to submit applications, and \`check_loan_balance\` to check their existing account info. Interpret the JSON returned by check_loan_balance and explain it in a user-friendly way.
`;
let BotService = BotService_1 = class BotService {
    prisma;
    borrowersService;
    loansService;
    bots = new Map();
    openai;
    logger = new common_1.Logger(BotService_1.name);
    enabled = false;
    conversations = {};
    constructor(prisma, borrowersService, loansService) {
        this.prisma = prisma;
        this.borrowersService = borrowersService;
        this.loansService = loansService;
    }
    async onModuleInit() {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            this.logger.warn('OPENAI_API_KEY missing. Bots are disabled.');
            return;
        }
        this.openai = new openai_1.default({ apiKey });
        this.enabled = true;
        await this.reloadAllBots();
    }
    async reloadAllBots() {
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
                await this.startBotForTenant(tenant.id, tenant.telegramBotToken);
            }
            catch (err) {
                this.logger.error(`Failed to start bot for tenant ${tenant.id}`, err);
            }
        }
    }
    async startBotForTenant(tenantId, token) {
        if (this.bots.has(tenantId)) {
            this.bots.get(tenantId)?.stop('SIGINT');
        }
        const bot = new telegraf_1.Telegraf(token);
        bot.start((ctx) => {
            const conversationId = `${tenantId}:${ctx.chat.id}`;
            this.conversations[conversationId] = [
                { role: 'system', content: SYSTEM_PROMPT }
            ];
            ctx.reply('Welcome to Microloan! Need a loan? Just tell me how much you need or ask me for help applying!');
        });
        bot.on('text', async (ctx) => {
            const chatId = ctx.chat.id;
            const text = ctx.message.text;
            const conversationId = `${tenantId}:${chatId}`;
            if (!this.conversations[conversationId]) {
                this.conversations[conversationId] = [
                    { role: 'system', content: SYSTEM_PROMPT }
                ];
            }
            this.conversations[conversationId].push({ role: 'user', content: text });
            try {
                await ctx.sendChatAction('typing');
                const response = await this.openai.chat.completions.create({
                    model: 'gpt-4o',
                    messages: this.conversations[conversationId],
                    tools: [
                        {
                            type: 'function',
                            function: {
                                name: 'originate_loan',
                                description: 'Creates a DRAFT loan in the Microloan system',
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
                    const toolCall = choice.message.tool_calls[0];
                    const args = toolCall.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};
                    let resultContent = '';
                    const functionName = toolCall.function?.name;
                    if (functionName === 'originate_loan') {
                        await this.handleOriginateLoan(tenantId, chatId, args);
                        resultContent = 'Successfully originated loan';
                    }
                    else if (functionName === 'check_loan_balance') {
                        resultContent = await this.checkLoanBalance(tenantId, chatId);
                    }
                    else if (functionName === 'get_loan_products') {
                        resultContent = await this.getLoanProducts(tenantId);
                    }
                    this.conversations[conversationId].push(choice.message);
                    this.conversations[conversationId].push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: resultContent
                    });
                    const followup = await this.openai.chat.completions.create({
                        model: 'gpt-4o',
                        messages: this.conversations[conversationId]
                    });
                    const replyText = followup.choices[0].message.content || 'Done!';
                    this.conversations[conversationId].push({ role: 'assistant', content: replyText });
                    ctx.reply(replyText);
                }
                else {
                    const aiResponse = choice.message.content || '...';
                    this.conversations[conversationId].push({ role: 'assistant', content: aiResponse });
                    ctx.reply(aiResponse);
                }
            }
            catch (err) {
                this.logger.error(`Error handling telegram message for tenant ${tenantId}`, err);
                ctx.reply('Sorry, I encountered an error processing your request.');
            }
        });
        bot.launch();
        this.bots.set(tenantId, bot);
        this.logger.log(`Telegram Bot started for tenant: ${tenantId}`);
    }
    async handleOriginateLoan(tenantId, chatId, args) {
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
                address: 'Telegram Client',
                telegramChatId: chatId.toString(),
            });
        }
        else if (!borrower.telegramChatId) {
            borrower = await this.prisma.borrower.update({
                where: { id: borrower.id },
                data: { telegramChatId: chatId.toString() }
            });
        }
        const product = await this.prisma.loanProduct.findFirst({
            where: { id: args.productId, tenantId },
            include: { policies: true }
        });
        if (!product)
            throw new Error('Invalid loan product ID');
        let policy = product.policies.find(p => p.creditRating === 'GOOD') || product.policies[0];
        if (!policy)
            throw new Error('Selected product has no valid interest policies.');
        await this.loansService.create(tenantId, userId, {
            borrowerId: borrower.id,
            principal: args.principal,
            annualInterestRate: Number(policy.interestRate),
            termMonths: args.termMonths,
            startDate: new Date().toISOString(),
            interestMethod: product.interestMethod,
            productId: product.id,
            creditRatingApplied: policy.creditRating,
        });
    }
    async getLoanProducts(tenantId) {
        const products = await this.prisma.loanProduct.findMany({
            where: { isActive: true, tenantId },
            include: { policies: true }
        });
        return JSON.stringify(products);
    }
    async checkLoanBalance(tenantId, chatId) {
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
    async sendDisbursementAlert(tenantId, chatId, message) {
        const bot = this.bots.get(tenantId);
        if (bot) {
            await bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        }
    }
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
                }
                catch (e) {
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
};
exports.BotService = BotService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_DAY_AT_10AM),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], BotService.prototype, "sendLatePaymentAlerts", null);
exports.BotService = BotService = BotService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, common_1.Inject)((0, common_1.forwardRef)(() => loans_service_1.LoansService))),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        borrowers_service_1.BorrowersService,
        loans_service_1.LoansService])
], BotService);
//# sourceMappingURL=bot.service.js.map