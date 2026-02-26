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
let ReportsController = class ReportsController {
    loansService;
    borrowersService;
    repaymentsService;
    constructor(loansService, borrowersService, repaymentsService) {
        this.loansService = loansService;
        this.borrowersService = borrowersService;
        this.repaymentsService = repaymentsService;
    }
    async exportLoanBook(user, res) {
        const loans = await this.loansService.findAll(user.tenantId);
        const header = 'id,borrower,principal,interestRate,term,method,status,startDate\n';
        const rows = loans.map(l => `${l.id},${l.borrower.firstName} ${l.borrower.lastName},${l.principal},${l.annualInterestRate},${l.termMonths},${l.interestMethod},${l.status},${new Date(l.startDate).toISOString()}`).join('\n');
        const csv = header + rows;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="loan_book.csv"');
        res.send(csv);
    }
    async exportRepayments(user, res) {
        const repayments = await this.repaymentsService.findAll(user.tenantId);
        const header = 'id,loanId,borrower,amount,date\n';
        const rows = repayments.map(r => `${r.id},${r.loanId},${r.loan.borrower.firstName} ${r.loan.borrower.lastName},${r.amount},${new Date(r.date).toISOString()}`).join('\n');
        const csv = header + rows;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="repayments.csv"');
        res.send(csv);
    }
};
exports.ReportsController = ReportsController;
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
exports.ReportsController = ReportsController = __decorate([
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    (0, common_1.Controller)('reports'),
    __metadata("design:paramtypes", [loans_service_1.LoansService,
        borrowers_service_1.BorrowersService,
        repayments_service_1.RepaymentsService])
], ReportsController);
//# sourceMappingURL=reports.controller.js.map