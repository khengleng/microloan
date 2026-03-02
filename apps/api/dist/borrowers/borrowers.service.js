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
exports.BorrowersService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const audit_service_1 = require("../audit/audit.service");
const mask_1 = require("../common/mask");
let BorrowersService = class BorrowersService {
    prisma;
    audit;
    constructor(prisma, audit) {
        this.prisma = prisma;
        this.audit = audit;
    }
    async create(tenantId, userId, dto) {
        const b = await this.prisma.borrower.create({ data: { tenantId, ...dto } });
        await this.audit.logAction(tenantId, userId, 'CREATE', 'Borrower', b.id, (0, mask_1.maskBorrowerDto)(dto));
        return b;
    }
    async findAll(tenantId) {
        return this.prisma.borrower.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
        });
    }
    async findOne(tenantId, id) {
        const b = await this.prisma.borrower.findUnique({
            where: { id, tenantId },
        });
        if (!b)
            throw new common_1.NotFoundException('Borrower not found');
        return b;
    }
    async update(tenantId, userId, id, dto) {
        const b = await this.prisma.borrower.findUnique({
            where: { id, tenantId },
        });
        if (!b)
            throw new common_1.NotFoundException('Borrower not found');
        const updated = await this.prisma.borrower.update({
            where: { id, tenantId },
            data: dto,
        });
        await this.audit.logAction(tenantId, userId, 'UPDATE', 'Borrower', b.id, {
            before: (0, mask_1.maskBorrowerForAudit)(b),
            after: (0, mask_1.maskBorrowerDto)(dto),
        });
        return updated;
    }
    async remove(tenantId, userId, id) {
        const b = await this.prisma.borrower.findUnique({
            where: { id, tenantId },
            include: { _count: { select: { loans: true } } },
        });
        if (!b)
            throw new common_1.NotFoundException('Borrower not found');
        if (b._count.loans > 0) {
            throw new Error('Cannot delete borrower with associated loans');
        }
        await this.prisma.borrower.delete({ where: { id, tenantId } });
        await this.audit.logAction(tenantId, userId, 'DELETE', 'Borrower', id, (0, mask_1.maskBorrowerForAudit)(b));
        return { success: true };
    }
    async checkCrossTenantCredit(tenantId, userId, query) {
        if (!query.idNumber && !query.phone) {
            throw new common_1.BadRequestException('Provide at least an ID Number or Phone to search.');
        }
        await this.audit.logAction(tenantId, userId, 'SEARCH', 'Borrower', 'CROSS_ORG_SEARCH', {
            event: 'CROSS_TENANT_CHECK',
            query: { idNumber: query.idNumber ? '***' : null, phone: query.phone ? '***' : null },
            action: 'Search across all organizations for credit risk'
        });
        const borrowers = await this.prisma.borrower.findMany({
            where: {
                OR: [
                    query.idNumber ? { idNumber: query.idNumber } : {},
                    query.phone ? { phone: query.phone } : {},
                ].filter(q => Object.keys(q).length > 0)
            },
            include: {
                tenant: { select: { name: true } },
                loans: {
                    select: { status: true, principal: true, createdAt: true }
                }
            }
        });
        return borrowers.map(b => {
            const isOwnTenant = b.tenantId === tenantId;
            return {
                organization: isOwnTenant ? 'Your Organization' : 'Another Organization',
                loans: isOwnTenant
                    ? b.loans.map(l => ({ status: l.status, date: l.createdAt }))
                    : [{ summary: `${b.loans.length} loan(s) found at another lender` }],
            };
        });
    }
};
exports.BorrowersService = BorrowersService;
exports.BorrowersService = BorrowersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService])
], BorrowersService);
//# sourceMappingURL=borrowers.service.js.map