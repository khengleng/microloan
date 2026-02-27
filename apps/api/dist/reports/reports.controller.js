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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportsController = void 0;
const common_1 = require("@nestjs/common");
const loans_service_1 = require("../loans/loans.service");
const borrowers_service_1 = require("../borrowers/borrowers.service");
const repayments_service_1 = require("../repayments/repayments.service");
const jwt_auth_guard_1 = require("../auth/jwt-auth.guard");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const prisma_service_1 = require("../prisma/prisma.service");
let ReportsController = class ReportsController {
    loansService;
    borrowersService;
    repaymentsService;
    prisma;
    constructor(loansService, borrowersService, repaymentsService, prisma) {
        this.loansService = loansService;
        this.borrowersService = borrowersService;
        this.repaymentsService = repaymentsService;
        this.prisma = prisma;
    }
    async getDashboardStats(user) {
        const tenantId = user.tenantId;
        const activeLoans = await this.prisma.loan.count({
            where: { tenantId, status: 'DISBURSED' }
        });
        const totalBorrowers = await this.prisma.borrower.count({
            where: { tenantId }
        });
        const currentDate = new Date();
        const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
        const repayments = await this.prisma.repayment.aggregate({
            where: {
                tenantId,
                date: { gte: firstDayOfMonth }
            },
            _sum: { amount: true }
        });
        const outstanding = await this.prisma.repaymentSchedule.aggregate({
            where: {
                loan: { tenantId, status: 'DISBURSED' },
                isPaid: false
            },
            _sum: { outstandingPrincipal: true }
        });
        const next7Days = new Date();
        next7Days.setDate(next7Days.getDate() + 7);
        const dueNext7 = await this.prisma.repaymentSchedule.aggregate({
            where: {
                loan: { tenantId, status: 'DISBURSED' },
                isPaid: false,
                dueDate: { gte: new Date(), lte: next7Days }
            },
            _sum: { totalAmount: true }
        });
        return {
            activeLoans,
            totalBorrowers,
            repaymentsThisMonth: repayments._sum.amount || 0,
            outstandingPrincipal: outstanding._sum.outstandingPrincipal || 0,
            dueNext7Days: dueNext7._sum.totalAmount || 0
        };
    }
    async exportLoanBook(user, res) {
        const loans = await this.loansService.findAll(user.tenantId);
        const header = 'id,borrower,principal,interestRate,term,method,status,startDate\n';
        const rows = loans
            .map((l) => `${l.id},${l.borrower.firstName} ${l.borrower.lastName},${l.principal},${l.annualInterestRate},${l.termMonths},${l.interestMethod},${l.status},${new Date(l.startDate).toISOString()}`)
            .join('\n');
        const csv = header + rows;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="loan_book.csv"');
        res.send(csv);
    }
    async exportRepayments(user, res) {
        const repayments = await this.repaymentsService.findAll(user.tenantId);
        const header = 'id,loanId,borrower,amount,date\n';
        const rows = repayments
            .map((r) => `${r.id},${r.loanId},${r.loan.borrower.firstName} ${r.loan.borrower.lastName},${r.amount},${new Date(r.date).toISOString()}`)
            .join('\n');
        const csv = header + rows;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="repayments.csv"');
        res.send(csv);
    }
    async getCashflow(user) {
        const tenantId = user.tenantId;
        const months = [];
        const now = new Date();
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            months.push({
                name: d.toLocaleString('default', { month: 'short' }),
                year: d.getFullYear(),
                month: d.getMonth(),
                disbursements: 0,
                collections: 0,
            });
        }
        const startDate = new Date(months[0].year, months[0].month, 1);
        const loans = await this.prisma.loan.findMany({
            where: {
                tenantId,
                startDate: { gte: startDate },
                status: { in: ['DISBURSED', 'CLOSED'] },
            },
        });
        const repayments = await this.prisma.repayment.findMany({
            where: {
                tenantId,
                date: { gte: startDate },
            },
        });
        months.forEach((m) => {
            m.disbursements = loans
                .filter((l) => l.startDate.getFullYear() === m.year &&
                l.startDate.getMonth() === m.month)
                .reduce((sum, l) => sum + Number(l.principal), 0);
            m.collections = repayments
                .filter((r) => r.date.getFullYear() === m.year && r.date.getMonth() === m.month)
                .reduce((sum, r) => sum + Number(r.amount), 0);
        });
        return months.map(({ name, disbursements, collections }) => ({
            name,
            disbursements,
            collections,
        }));
    }
};
exports.ReportsController = ReportsController;
__decorate([
    (0, common_1.Get)('dashboard'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ReportsController.prototype, "getDashboardStats", null);
__decorate([
    (0, common_1.Get)('loan-book'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ReportsController.prototype, "exportLoanBook", null);
__decorate([
    (0, common_1.Get)('repayments'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ReportsController.prototype, "exportRepayments", null);
__decorate([
    (0, common_1.Get)('cashflow'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ReportsController.prototype, "getCashflow", null);
exports.ReportsController = ReportsController = __decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Controller)('reports'),
    __metadata("design:paramtypes", [loans_service_1.LoansService,
        borrowers_service_1.BorrowersService,
        repayments_service_1.RepaymentsService,
        prisma_service_1.PrismaService])
], ReportsController);
//# sourceMappingURL=reports.controller.js.map