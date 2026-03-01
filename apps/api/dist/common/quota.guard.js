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
exports.QuotaGuard = exports.CheckQuota = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const prisma_service_1 = require("../prisma/prisma.service");
const plan_limits_1 = require("./plan-limits");
const CheckQuota = (resource) => (0, common_1.SetMetadata)('quotaResource', resource);
exports.CheckQuota = CheckQuota;
let QuotaGuard = class QuotaGuard {
    reflector;
    prisma;
    constructor(reflector, prisma) {
        this.reflector = reflector;
        this.prisma = prisma;
    }
    async canActivate(context) {
        const resource = this.reflector.get('quotaResource', context.getHandler());
        if (!resource)
            return true;
        const req = context.switchToHttp().getRequest();
        const user = req.user;
        if (!user || user.role === 'SUPERADMIN')
            return true;
        const limits = (0, plan_limits_1.getQuotaLimits)(user.tenantPlan);
        let currentCount = 0;
        let limit = 0;
        switch (resource) {
            case 'users':
                currentCount = await this.prisma.user.count({ where: { tenantId: user.tenantId } });
                limit = limits.maxUsers;
                break;
            case 'borrowers':
                currentCount = await this.prisma.borrower.count({ where: { tenantId: user.tenantId } });
                limit = limits.maxBorrowers;
                break;
            case 'loanProducts':
                currentCount = await this.prisma.loanProduct.count({ where: { tenantId: user.tenantId } });
                limit = limits.maxLoanProducts;
                break;
            case 'loans':
                currentCount = await this.prisma.loan.count({ where: { tenantId: user.tenantId } });
                limit = limits.maxLoans;
                break;
        }
        if (currentCount >= limit) {
            throw new common_1.ForbiddenException(`Your organization has reached the maximum allowed limit of ${limit} ${resource} for the ${user.tenantPlan || 'FREE'} plan. Please upgrade to continue.`);
        }
        return true;
    }
};
exports.QuotaGuard = QuotaGuard;
exports.QuotaGuard = QuotaGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.Reflector, prisma_service_1.PrismaService])
], QuotaGuard);
//# sourceMappingURL=quota.guard.js.map