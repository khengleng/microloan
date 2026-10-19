import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../auth/auth-scope.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { MetricsAccessGuard } from './metrics-access.guard';
import { MetricsService } from './metrics.service';

/**
 * Prometheus scrape endpoint: GET /v1/metrics.
 *
 * Not a user endpoint, so it bypasses the staff JWT (`@Public`) and is
 * protected instead by MetricsAccessGuard: a configured bearer token, or a
 * direct request from the private network. Unconfigured, it answers 404.
 * The body holds aggregates only — counts, durations and pool figures; no
 * tenant, user or record id appears in any label.
 */
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @SkipThrottle()
  @UseGuards(MetricsAccessGuard)
  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async scrape(): Promise<string> {
    // Prisma's own pool figures (open, busy and idle connections, queries
    // waiting for one) are in-process counters: reading them queries nothing.
    let pool = '';
    try {
      pool = await this.prisma.$metrics.prometheus();
    } catch {
      pool = '';
    }
    return this.metrics.render(pool ? `\n${pool}` : '');
  }
}
