import { cpus } from 'node:os';

/**
 * The Prisma pool size this process uses: `connection_limit` in the database
 * URL, or Prisma's default (physical CPUs × 2 + 1, approximated with logical
 * CPUs, so the estimate errs high).
 */
export function configuredPoolSize(
  url = process.env.DATABASE_URL ?? '',
): number {
  try {
    const n = Number(new URL(url).searchParams.get('connection_limit'));
    if (Number.isInteger(n) && n > 0) return n;
  } catch {
    // Not a URL: fall through to Prisma's default.
  }
  return Math.max(1, cpus().length) * 2 + 1;
}
