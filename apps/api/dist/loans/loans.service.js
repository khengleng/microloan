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
exports.LoansService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const audit_service_1 = require("../audit/audit.service");
const shared_1 = require("@microloan/shared");
const db_1 = require("@microloan/db");
const bot_service_1 = require("../bot/bot.service");
let LoansService = class LoansService {
    prisma;
    audit;
    bot;
    constructor(prisma, audit, bot) {
        this.prisma = prisma;
        this.audit = audit;
        this.bot = bot;
    }
    async create(tenantId, userId, dto) {
        const borrower = await this.prisma.borrower.findUnique({
            where: { id: dto.borrowerId, tenantId },
        });
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
                },
            });
            if (scheduleItems.length > 0) {
                await tx.repaymentSchedule.createMany({
                    data: scheduleItems.map((item) => ({
                        loanId: createdLoan.id,
                        installmentNumber: item.installmentNumber,
                        dueDate: item.dueDate,
                        principalAmount: item.principalAmount,
                        interestAmount: item.interestAmount,
                        totalAmount: item.totalAmount,
                        outstandingPrincipal: item.outstandingPrincipal,
                    })),
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
            orderBy: { createdAt: 'desc' },
        });
    }
    async findOne(tenantId, id) {
        const loan = await this.prisma.loan.findUnique({
            where: { id, tenantId },
            include: {
                borrower: true,
                schedules: { orderBy: { installmentNumber: 'asc' } },
                repayments: { orderBy: { date: 'asc' } },
                documents: { orderBy: { createdAt: 'desc' } },
            },
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
            include: { borrower: true },
        });
        if (updated.status === db_1.LoanStatus.DISBURSED && loan.status !== db_1.LoanStatus.DISBURSED) {
            try {
                await this.bot.sendDisbursementAlert(updated.borrower.phone, updated);
            }
            catch (error) {
                console.error('Failed to send telegram disbursement alert', error);
            }
        }
        await this.audit.logAction(tenantId, userId, 'UPDATE', 'Loan', loan.id, {
            old: loan.status,
            new: dto.status,
        });
        return updated;
    }
    async remove(tenantId, userId, id) {
        const loan = await this.prisma.loan.findUnique({ where: { id, tenantId } });
        if (!loan)
            throw new common_1.NotFoundException('Loan not found');
        if (loan.status !== db_1.LoanStatus.DRAFT) {
            throw new common_1.BadRequestException('Only draft loans can be deleted');
        }
        await this.prisma.loan.delete({ where: { id } });
        await this.audit.logAction(tenantId, userId, 'DELETE', 'Loan', id, loan);
        return { success: true };
    }
    async addDocument(tenantId, userId, loanId, dto) {
        const loan = await this.prisma.loan.findUnique({ where: { id: loanId, tenantId } });
        if (!loan)
            throw new common_1.NotFoundException('Loan not found');
        if (dto.content.length > 5 * 1024 * 1024) {
            throw new common_1.BadRequestException('File is too large. Limit is 5MB.');
        }
        const document = await this.prisma.document.create({
            data: {
                tenantId,
                loanId,
                name: dto.name,
                content: dto.content,
                type: dto.type,
            },
        });
        await this.audit.logAction(tenantId, userId, 'CREATE', 'Document', document.id, { loanId, name: dto.name });
        return document;
    }
    async removeDocument(tenantId, userId, loanId, documentId) {
        const document = await this.prisma.document.findUnique({
            where: { id: documentId, tenantId, loanId },
        });
        if (!document)
            throw new common_1.NotFoundException('Document not found');
        await this.prisma.document.delete({ where: { id: documentId } });
        await this.audit.logAction(tenantId, userId, 'DELETE', 'Document', documentId, { loanId, name: document.name });
        return { success: true };
    }
};
exports.LoansService = LoansService;
exports.LoansService = LoansService = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, common_1.Inject)((0, common_1.forwardRef)(() => bot_service_1.BotService))),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService,
        bot_service_1.BotService])
], LoansService);
//# sourceMappingURL=loans.service.js.map