import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaHealthIndicator extends HealthIndicator {
    constructor(private readonly prisma: PrismaService) {
        super();
    }

    async isHealthy(key: string): Promise<HealthIndicatorResult> {
        try {
            // Execute a simple query to ensure the DB connection is alive
            await this.prisma.$queryRaw`SELECT 1`;
            return this.getStatus(key, true);
        } catch (e) {
            throw new HealthCheckError('Prisma check failed', this.getStatus(key, false, { message: e.message }));
        }
    }
}
