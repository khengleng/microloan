import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLoanProductDto } from './dto/create-loan-product.dto';
import { UpdateLoanProductDto } from './dto/update-loan-product.dto';

@Injectable()
export class LoanProductsService {
    constructor(private readonly prisma: PrismaService) { }

    async create(tenantId: string, dto: CreateLoanProductDto) {
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

        return this.prisma.$transaction(async (tx) => {
            // If we are passing policies, we'll replace them all for simplicity
            if (policies) {
                await tx.loanPolicy.deleteMany({
                    where: { productId: id }
                });
            }

            return tx.loanProduct.update({
                where: { id },
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

    async remove(tenantId: string, id: string) {
        await this.findOne(tenantId, id);
        return this.prisma.loanProduct.delete({
            where: { id }
        });
    }
}
