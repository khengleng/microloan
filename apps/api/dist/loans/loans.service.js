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
exports.LoansService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const audit_service_1 = require("../audit/audit.service");
const shared_1 = require("@microloan/shared");
const db_1 = require("@microloan/db");
let LoansService = class LoansService {
    prisma;
    audit;
    constructor(prisma, audit) {
        this.prisma = prisma;
        this.audit = audit;
    }
    async create(tenantId, userId, dto) {
        const borrower = await this.prisma.borrower.findUnique({ where: { id: dto.borrowerId, tenantId } });
        if (!borrower)
            throw new common_1.NotFoundException('Borrower not found');
        const params = {
            principal: dto.principal,
            annualInterestRate: dto.annualInterestRate,
            termMonths: dto.termMonths,
            startDate: new Date(dto.startDate),
            interestMethod: dto.interestMethod,
        };
        const scheduleItems = (0, shared_1.calculateRepaymentSchedule)(params);
        const loan = await this.prisma.$transaction(async (tx) => {
            const createdLoan = await tx.loan.create({
                data: {
                    tenantId,
                    borrowerId: dto.borrowerId,
                    principal: dto.principal,
                    annualInterestRate: dto.annualInterestRate,
                    termMonths: dto.termMonths,
                    startDate: new Date(dto.startDate),
                    interestMethod: dto.interestMethod,
                    status: db_1.LoanStatus.DRAFT,
                }
            });
            if (scheduleItems.length > 0) {
                await tx.repaymentSchedule.createMany({
                    data: scheduleItems.map(item => ({
                        loanId: createdLoan.id,
                        installmentNumber: item.installmentNumber,
                        dueDate: item.dueDate,
                        principalAmount: item.principalAmount,
                        interestAmount: item.interestAmount,
                        totalAmount: item.totalAmount,
                        outstandingPrincipal: item.outstandingPrincipal,
                    }))
                });
            }
            return createdLoan;
        });
        await this.audit.logAction(tenantId, userId, 'CREATE', 'Loan', loan.id, dto);
        return loan;
    }
    async findAll(tenantId) {
        return this.prisma.loan.findMany({
            where: { tenantId },
            include: { borrower: true },
            orderBy: { createdAt: 'desc' }
        });
    }
    async findOne(tenantId, id) {
        const loan = await this.prisma.loan.findUnique({
            where: { id, tenantId },
            include: {
                borrower: true,
                schedules: { orderBy: { installmentNumber: 'asc' } },
                repayments: { orderBy: { date: 'asc' } }
            }
        });
        if (!loan)
            throw new common_1.NotFoundException('Loan not found');
        return loan;
    }
    async changeStatus(tenantId, userId, id, dto) {
        const loan = await this.prisma.loan.findUnique({ where: { id, tenantId } });
        if (!loan)
            throw new common_1.NotFoundException('Loan not found');
        if (loan.status === db_1.LoanStatus.CLOSED) {
            throw new common_1.BadRequestException('Cannot change status of a closed loan');
        }
        const updated = await this.prisma.loan.update({
            where: { id },
            data: { status: dto.status },
        });
        await this.audit.logAction(tenantId, userId, 'UPDATE', 'Loan', loan.id, { old: loan.status, new: dto.status });
        return updated;
    }
};
exports.LoansService = LoansService;
exports.LoansService = LoansService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, audit_service_1.AuditService])
], LoansService);
//# sourceMappingURL=loans.service.js.map