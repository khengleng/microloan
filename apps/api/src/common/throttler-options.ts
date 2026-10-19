import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import { operationalConfig } from '../config/operational-config';

/**
 * ThrottlerModule options.
 *
 * Must be the OBJECT form `{ throttlers, storage }`: @nestjs/throttler 6 reads
 * `storage` only from that form (`!Array.isArray(options) && options.storage`)
 * and silently ignores a `storage` key placed on an entry of the array form —
 * which is how rate limiting previously ran in memory, per instance, while
 * REDIS_URL was set.
 *
 * Counters live in Redis whenever it is configured (required in production),
 * so every API instance draws from the same budget. Only a single development
 * process without REDIS_URL counts in memory.
 */
export function throttlerOptions(
  redisUrl: string | undefined,
): ThrottlerModuleOptions {
  const throttlers = [
    {
      name: 'default',
      ttl: 1_000,
      limit: operationalConfig().rateLimitPerSecond,
    },
  ];
  if (!redisUrl) return { throttlers };

  // Runtime import avoids TS export-map issues with the legacy redis storage package.
  const { ThrottlerStorageRedisService } =
    require('nestjs-throttler-storage-redis') as {
      ThrottlerStorageRedisService: new (url?: string) => any;
    };
  return { throttlers, storage: new ThrottlerStorageRedisService(redisUrl) };
}
