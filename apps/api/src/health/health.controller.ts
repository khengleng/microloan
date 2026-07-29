import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { PrismaHealthIndicator } from './prisma.health';
import { Roles } from '../auth/roles.decorator';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/auth-scope.decorator';
@Controller('health')
export class HealthController {
    constructor(
        private health: HealthCheckService,
        private memory: MemoryHealthIndicator,
        private db: PrismaHealthIndicator,
    ) { }

    /**
     * Minimal public health check for load-balancer / uptime probes.
     * Does NOT expose internal metrics (heap, RSS) to anonymous callers.
     */
    @Public()
    @SkipThrottle()
    @Get()
    publicCheck() {
        return { status: 'ok' };
    }

    /**
     * Detailed health check with memory + DB diagnostics.
     * Restricted to authenticated SUPERADMIN users only.
     */
    @Roles('SUPERADMIN')
    @Get('detailed')
    @HealthCheck()
    detailedCheck() {
        return this.health.check([
            () => this.db.isHealthy('database'),
            () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),
            () => this.memory.checkRSS('memory_rss', 150 * 1024 * 1024),
        ]);
    }
}
