import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLoanProductDto } from './dto/create-loan-product.dto';
import { UpdateLoanProductDto } from './dto/update-loan-product.dto';
import { checkInterestRateCap, normalizeCurrency } from '@microloan/shared';
import { Currency } from '@microloan/db';

@Injectable()
export class LoanProductsService {
    constructor(private readonly prisma: PrismaService) { }

    // Feature #1: reject any policy rate above the tenant's cap (<= NBC 18%).
    private async assertPolicyRates(tenantId: string, policies?: { interestRate: number; creditRating: string }[]) {
        if (!policies || policies.length === 0) return;
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { maxAnnualInterestRatePct: true },
        });
        const cap = tenant ? Number(tenant.maxAnnualInterestRatePct) : undefined;
        for (const p of policies) {
            const result = checkInterestRateCap(Number(p.interestRate), cap);
            if (!result.ok) {
                throw new BadRequestException(
                    `Policy "${p.creditRating}": ${result.message}`,
                );
            }
        }
    }

    async create(tenantId: string, dto: CreateLoanProductDto) {
        const { policies, ...productData } = dto;
        await this.assertPolicyRates(tenantId, policies);

        return this.prisma.loanProduct.create({
            data: {
                tenantId,
                ...productData,
                currency: productData.currency
                    ? (normalizeCurrency(productData.currency) as unknown as Currency)
                    : undefined,
                policies: {
                    create: policies || []
                }
            },
            include: {
                policies: true
            }
        });
    }

    async findAll(tenantId: string) {
        return this.prisma.loanProduct.findMany({
            where: { tenantId },
            include: { policies: true }
        });
    }

    async findOne(tenantId: string, id: string) {
        const product = await this.prisma.loanProduct.findUnique({
            where: { id, tenantId },
            include: { policies: true }
        });
        if (!product) throw new NotFoundException('Loan product not found');
        return product;
    }

    async update(tenantId: string, id: string, dto: UpdateLoanProductDto) {
        await this.findOne(tenantId, id); // Ensure it exists

        const { policies, ...productData } = dto;
        await this.assertPolicyRates(tenantId, policies as any);

        return this.prisma.$transaction(async (tx) => {
            // If we are passing policies, we'll replace them all for simplicity
            if (policies) {
                await tx.loanPolicy.deleteMany({
                    where: { productId: id }
                });
            }

            return tx.loanProduct.update({
                where: { id, tenantId },
                data: {
                    ...productData,
                    currency: productData.currency
                        ? (normalizeCurrency(productData.currency) as unknown as Currency)
                        : undefined,
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

    async remove(tenantId: string, id: string) {
        await this.findOne(tenantId, id);
        return this.prisma.loanProduct.delete({
            where: { id, tenantId }
        });
    }
}
