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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RepaymentsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const audit_service_1 = require("../audit/audit.service");
const db_1 = require("@microloan/db");
let RepaymentsService = class RepaymentsService {
    prisma;
    audit;
    constructor(prisma, audit) {
        this.prisma = prisma;
        this.audit = audit;
    }
    async postRepayment(tenantId, userId, dto) {
        const loan = await this.prisma.loan.findUnique({
            where: { id: dto.loanId, tenantId },
            include: {
                schedules: {
                    where: { isPaid: false },
                    orderBy: { installmentNumber: 'asc' },
                },
            },
        });
        if (!loan)
            throw new common_1.NotFoundException('Loan not found');
        if (loan.status !== db_1.LoanStatus.DISBURSED) {
            throw new common_1.BadRequestException('Can only post repayments for disbursed loans');
        }
        if (dto.amount <= 0) {
            throw new common_1.BadRequestException('Repayment amount must be strictly greater than 0');
        }
        const totalDue = loan.schedules.reduce((acc, schedule) => {
            const dueInt = Math.max(0, Number(schedule.interestAmount) - Number(schedule.paidInterest));
            const duePrin = Math.max(0, Number(schedule.principalAmount) - Number(schedule.paidPrincipal));
            return acc + dueInt + duePrin;
        }, 0);
        if (dto.amount > totalDue + 0.01) {
            throw new common_1.BadRequestException(`Repayment amount cannot exceed the remaining balance of $${totalDue.toFixed(2)}`);
        }
        let remainingAmount = dto.amount;
        let totalInterestPaid = 0;
        let totalPrincipalPaid = 0;
        const updates = [];
        for (const schedule of loan.schedules) {
            if (remainingAmount <= 0)
                break;
            const scheduleInterest = Number(schedule.interestAmount);
            const schedulePrincipal = Number(schedule.principalAmount);
            const alreadyPaidInterest = Number(schedule.paidInterest);
            const alreadyPaidPrincipal = Number(schedule.paidPrincipal);
            const dueInterest = Math.max(0, scheduleInterest - alreadyPaidInterest);
            const duePrincipal = Math.max(0, schedulePrincipal - alreadyPaidPrincipal);
            let interestToPay = 0;
            let principalToPay = 0;
            if (dueInterest > 0) {
                interestToPay = Math.min(remainingAmount, dueInterest);
                remainingAmount -= interestToPay;
                totalInterestPaid += interestToPay;
            }
            if (remainingAmount > 0 && duePrincipal > 0) {
                principalToPay = Math.min(remainingAmount, duePrincipal);
                remainingAmount -= principalToPay;
                totalPrincipalPaid += principalToPay;
            }
            if (interestToPay > 0 || principalToPay > 0) {
                const newPaidInterest = alreadyPaidInterest + interestToPay;
                const newPaidPrincipal = alreadyPaidPrincipal + principalToPay;
                const isPaid = newPaidInterest + newPaidPrincipal >= Number(schedule.totalAmount);
                updates.push(this.prisma.repaymentSchedule.update({
                    where: { id: schedule.id },
                    data: {
                        paidInterest: newPaidInterest,
                        paidPrincipal: newPaidPrincipal,
                        isPaid,
                    },
                }));
            }
        }
        const [repayment] = await this.prisma.$transaction([
            this.prisma.repayment.create({
                data: {
                    tenantId,
                    loanId: dto.loanId,
                    amount: dto.amount,
                    interestPaid: totalInterestPaid,
                    principalPaid: totalPrincipalPaid,
                    date: new Date(dto.date),
                },
            }),
            ...updates,
        ]);
        await this.audit.logAction(tenantId, userId, 'CREATE', 'Repayment', repayment.id, {
            ...dto,
            allocatedInterest: totalInterestPaid,
            allocatedPrincipal: totalPrincipalPaid,
        });
        const unpaidCount = await this.prisma.repaymentSchedule.count({
            where: { loanId: dto.loanId, isPaid: false },
        });
        if (unpaidCount === 0 && (updates.length > 0 || loan.schedules.length === 0)) {
            await this.prisma.loan.update({
                where: { id: dto.loanId, tenantId },
                data: { status: db_1.LoanStatus.CLOSED },
            });
            await this.audit.logAction(tenantId, userId, 'UPDATE', 'Loan', loan.id, {
                action: 'Auto-closed due to full repayment',
            });
        }
        return repayment;
    }
    async findAll(tenantId, loanId) {
        return this.prisma.repayment.findMany({
            where: loanId ? { tenantId, loanId } : { tenantId },
            include: { loan: { include: { borrower: true } } },
            orderBy: { date: 'desc' },
        });
    }
};
exports.RepaymentsService = RepaymentsService;
exports.RepaymentsService = RepaymentsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService])
], RepaymentsService);
//# sourceMappingURL=repayments.service.js.map