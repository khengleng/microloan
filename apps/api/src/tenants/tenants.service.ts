import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenantsService {
    constructor(private readonly prisma: PrismaService) { }

    async findAll() {
        return this.prisma.tenant.findMany({
            include: {
                _count: {
                    select: {
                        users: true,
                        borrowers: true,
                        loans: true
                    }
                }
            }
        });
    }

    async findOne(id: string) {
        return this.prisma.tenant.findUnique({
            where: { id },
            include: {
                users: {
                    select: {
                        id: true,
                        email: true,
                        role: true,
                        createdAt: true
                    }
                }
            }
        });
    }

    async create(data: { name: string }) {
        return this.prisma.tenant.create({
            data
        });
    }

    async update(id: string, data: { name: string }) {
        return this.prisma.tenant.update({
            where: { id },
            data
        });
    }

    async remove(id: string) {
        // Warning: This will fail if there are related records due to foreign key constraints
        // In a real app, we might want soft delete or handle cleanup
        return this.prisma.tenant.delete({
            where: { id }
        });
    }
}
