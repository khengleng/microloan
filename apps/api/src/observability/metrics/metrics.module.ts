import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { HttpMetricsMiddleware } from './http-metrics.middleware';
import { MetricsAccessGuard } from './metrics-access.guard';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/** Prometheus metrics: the registry, HTTP timing and the scrape endpoint. */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, MetricsAccessGuard, HttpMetricsMiddleware],
  exports: [MetricsService],
})
export class MetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(HttpMetricsMiddleware).forRoutes('*');
  }
}
