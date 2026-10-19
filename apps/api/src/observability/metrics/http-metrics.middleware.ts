import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service';

/**
 * Times every HTTP request and counts it by method, route pattern and status
 * class. The label is the matched route (`/v1/lending/loans/:id`), never the
 * raw URL, so ids in paths do not reach the metrics; a request that matched
 * no route is labelled `unmatched`.
 */
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const start = process.hrtime.bigint();
    res.once('finish', () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const route = (req as Request & { route?: { path?: unknown } }).route
        ?.path;
      this.metrics.observeHttp(
        req.method,
        typeof route === 'string'
          ? `${req.baseUrl ?? ''}${route}`
          : 'unmatched',
        res.statusCode,
        seconds,
      );
    });
    next();
  }
}
