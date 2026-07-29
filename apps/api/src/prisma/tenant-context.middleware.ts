import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { runWithRequestContext } from './tenant-context';

/**
 * Installs the per-request tenant-context holder.
 *
 * Runs as Express middleware — i.e. before guards — so the holder exists by
 * the time `JwtStrategy.validate` resolves the principal and publishes it via
 * `setRequestContext`. An interceptor would be too late (guards query the DB)
 * and would also risk losing the async context across the RxJS subscribe
 * boundary; Express `next()` keeps the whole downstream chain inside the
 * AsyncLocalStorage scope.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(_req: Request, _res: Response, next: NextFunction): void {
    runWithRequestContext(() => next());
  }
}
