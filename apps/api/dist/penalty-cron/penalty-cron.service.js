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
var PenaltyCronService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PenaltyCronService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const prisma_service_1 = require("../prisma/prisma.service");
const bot_service_1 = require("../bot/bot.service");
let PenaltyCronService = PenaltyCronService_1 = class PenaltyCronService {
    prisma;
    botService;
    logger = new common_1.Logger(PenaltyCronService_1.name);
    constructor(prisma, botService) {
        this.prisma = prisma;
        this.botService = botService;
    }
    async applyLatePenalties() {
        this.logger.log('Starting daily penalty and late fee calculation...');
        const now = new Date();
        const overdueSchedules = await this.prisma.repaymentSchedule.findMany({
            where: {
                isPaid: false,
                dueDate: { lt: now },
            },
            include: {
                loan: {
                    include: { borrower: true }
                }
            },
        });
        let count = 0;
        for (const schedule of overdueSchedules) {
            if (schedule.loan.status === 'CLOSED')
                continue;
            const penaltyAmount = 10.0;
            await this.prisma.repaymentSchedule.update({
                where: { id: schedule.id },
                data: {
                    penaltyAmount: { increment: penaltyAmount },
                    totalAmount: { increment: penaltyAmount },
                },
            });
            const daysOverdue = Math.floor((now.getTime() - schedule.dueDate.getTime()) / (1000 * 60 * 60 * 24));
            if (daysOverdue > 30 && schedule.loan.status !== 'DEFAULTED') {
                await this.prisma.loan.update({
                    where: { id: schedule.loan.id },
                    data: { status: 'DEFAULTED' },
                });
            }
            if (schedule.loan.borrower?.telegramChatId) {
                try {
                    const msg = `⚠️ **OVERDUE PAYMENT ALERT** ⚠️\n\nDear ${schedule.loan.borrower.firstName},\nYour payment of **$${schedule.totalAmount}** was due on ${new Date(schedule.dueDate).toLocaleDateString()}.\nAccumulated Penalty: **$${schedule.penaltyAmount}**.\n\nPlease pay immediately to avoid further penalties.`;
                    await this.botService.sendDisbursementAlert(schedule.loan.tenantId, schedule.loan.borrower.telegramChatId, msg);
                }
                catch (e) {
                    this.logger.error(`Failed to alert borrower ${schedule.loan.borrower.id} of late payment`, e);
                }
            }
            count++;
        }
        this.logger.log(`Completed applying penalties. Affected schedules: ${count}`);
    }
    async sendUpcomingReminders() {
        this.logger.log('Checking for upcoming repayments (next 2 days)...');
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const next2Days = new Date();
        next2Days.setDate(next2Days.getDate() + 2);
        const upcomingSchedules = await this.prisma.repaymentSchedule.findMany({
            where: {
                isPaid: false,
                dueDate: { gte: new Date(), lte: next2Days }
            },
            include: { loan: { include: { borrower: true } } }
        });
        for (const schedule of upcomingSchedules) {
            const borrower = schedule.loan.borrower;
            if (borrower.telegramChatId) {
                try {
                    const msg = `📅 **UPCOMING PAYMENT REMINDER** 📅\n\nHi ${borrower.firstName},\nYour next payment of **$${schedule.totalAmount}** is due on **${new Date(schedule.dueDate).toLocaleDateString()}**.\n\nThank you for choosing Magic Money!`;
                    await this.botService.sendDisbursementAlert(schedule.loan.tenantId, borrower.telegramChatId, msg);
                }
                catch (e) {
                    this.logger.error(`Failed to send upcoming reminder to ${borrower.id}`, e);
                }
            }
        }
    }
};
exports.PenaltyCronService = PenaltyCronService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_DAY_AT_MIDNIGHT),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], PenaltyCronService.prototype, "applyLatePenalties", null);
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_DAY_AT_9AM),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], PenaltyCronService.prototype, "sendUpcomingReminders", null);
exports.PenaltyCronService = PenaltyCronService = PenaltyCronService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)((0, common_1.forwardRef)(() => bot_service_1.BotService))),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        bot_service_1.BotService])
], PenaltyCronService);
//# sourceMappingURL=penalty-cron.service.js.map