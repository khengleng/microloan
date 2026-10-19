import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthCheck, HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { PrismaHealthIndicator } from './prisma.health';
import { Roles } from '../auth/roles.decorator';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/auth-scope.decorator';
import { operationalConfig } from '../config/operational-config';
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
     * Liveness: the process is up and serving. Never touches the database, so
     * a database outage does not get healthy instances restarted.
     */
    @Public()
    @SkipThrottle()
    @Get('live')
    live() {
        return { status: 'ok' };
    }

    /**
     * Readiness: this instance can serve traffic — it reaches the database
     * within READINESS_DB_TIMEOUT_MS (default 2000). Answers 503 otherwise, so
     * a load balancer takes the instance out of rotation. Reports no detail
     * beyond up/down.
     */
    @Public()
    @SkipThrottle()
    @Get('ready')
    async ready() {
        const up = await this.db.ping(operationalConfig().readinessDbTimeoutMs);
        if (!up) {
            throw new ServiceUnavailableException({ status: 'unavailable', checks: { database: 'down' } });
        }
        return { status: 'ok', checks: { database: 'up' } };
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
