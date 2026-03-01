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
exports.LoanProductsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let LoanProductsService = class LoanProductsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(tenantId, dto) {
        const { policies, ...productData } = dto;
        return this.prisma.loanProduct.create({
            data: {
                tenantId,
                ...productData,
                policies: {
                    create: policies || []
                }
            },
            include: {
                policies: true
            }
        });
    }
    async findAll(tenantId) {
        return this.prisma.loanProduct.findMany({
            where: { tenantId },
            include: { policies: true }
        });
    }
    async findOne(tenantId, id) {
        const product = await this.prisma.loanProduct.findUnique({
            where: { id, tenantId },
            include: { policies: true }
        });
        if (!product)
            throw new common_1.NotFoundException('Loan product not found');
        return product;
    }
    async update(tenantId, id, dto) {
        await this.findOne(tenantId, id);
        const { policies, ...productData } = dto;
        return this.prisma.$transaction(async (tx) => {
            if (policies) {
                await tx.loanPolicy.deleteMany({
                    where: { productId: id }
                });
            }
            return tx.loanProduct.update({
                where: { id, tenantId },
                data: {
                    ...productData,
                    ...(policies ? {
                        policies: {
                            create: policies
                        }
                    } : {})
                },
                include: { policies: true }
            });
        });
    }
    async remove(tenantId, id) {
        await this.findOne(tenantId, id);
        return this.prisma.loanProduct.delete({
            where: { id, tenantId }
        });
    }
};
exports.LoanProductsService = LoanProductsService;
exports.LoanProductsService = LoanProductsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], LoanProductsService);
//# sourceMappingURL=loan-products.service.js.map