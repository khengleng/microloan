import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { PrismaHealthIndicator } from './prisma.health';

@Controller('health')
export class HealthController {
    constructor(
        private health: HealthCheckService,
        private memory: MemoryHealthIndicator,
        private db: PrismaHealthIndicator,
    ) { }

    @Get()
    @HealthCheck()
    check() {
        return this.health.check([
            // Database connection health
            () => this.db.isHealthy('database'),

            // The process should not use more than 150MB memory
            () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),

            // The process should not have more than 150MB RSS memory allocated
            () => this.memory.checkRSS('memory_rss', 150 * 1024 * 1024),
        ]);
    }
}
