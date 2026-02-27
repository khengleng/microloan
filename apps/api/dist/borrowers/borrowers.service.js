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
let BorrowersService = class BorrowersService {
    prisma;
    audit;
    constructor(prisma, audit) {
        this.prisma = prisma;
        this.audit = audit;
    }
    async create(tenantId, userId, dto) {
        const b = await this.prisma.borrower.create({ data: { tenantId, ...dto } });
        await this.audit.logAction(tenantId, userId, 'CREATE', 'Borrower', b.id, dto);
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
            where: { id },
            data: dto,
        });
        await this.audit.logAction(tenantId, userId, 'UPDATE', 'Borrower', b.id, {
            old: b,
            new: updated,
        });
        return updated;
    }
};
exports.BorrowersService = BorrowersService;
exports.BorrowersService = BorrowersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService])
], BorrowersService);
//# sourceMappingURL=borrowers.service.js.map