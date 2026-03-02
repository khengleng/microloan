import { Controller, Get, UseGuards } from '@nestjs/common';
import { HealthCheck, HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { PrismaHealthIndicator } from './prisma.health';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SkipThrottle } from '@nestjs/throttler';

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
    @SkipThrottle()
    @Get()
    publicCheck() {
        return { status: 'ok' };
    }

    /**
     * Detailed health check with memory + DB diagnostics.
     * Restricted to authenticated SUPERADMIN users only.
     */
    @UseGuards(JwtAuthGuard, RolesGuard)
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
