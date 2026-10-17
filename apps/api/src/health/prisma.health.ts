import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PrismaHealthIndicator extends HealthIndicator {
    constructor(private readonly prisma: PrismaService) {
        super();
    }

    /** True when `SELECT 1` answers within `timeoutMs`. */
    async ping(timeoutMs: number): Promise<boolean> {
        let timer: NodeJS.Timeout | undefined;
        try {
            const timeout = new Promise<boolean>((resolve) => {
                timer = setTimeout(() => resolve(false), timeoutMs);
            });
            const query = this.prisma.$queryRaw`SELECT 1`.then(() => true);
            return await Promise.race([query, timeout]);
        } catch {
            return false;
        } finally {
            if (timer) clearTimeout(timer);
        }
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
