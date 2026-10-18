/**
 * Typed, validated reads of deployment configuration.
 *
 * Every environment-specific value the API reads goes through one of these,
 * so a malformed value fails loudly (at boot, through
 * `loadOperationalConfig()` in operational-config.ts) instead of turning into
 * NaN, an empty string or a silent default. Each variable is documented in
 * `.env.example`; `node scripts/config-audit.mjs` fails CI when one is not.
 */

export class ConfigError extends Error {}

type Env = NodeJS.ProcessEnv;

function raw(name: string, env: Env): string | undefined {
  const v = env[name];
  return v === undefined || v.trim() === '' ? undefined : v.trim();
}

/** A string, or the default when unset. */
export function envString(
  name: string,
  fallback: string,
  env: Env = process.env,
): string {
  return raw(name, env) ?? fallback;
}

/** A string that may be absent. */
export function envOptional(
  name: string,
  env: Env = process.env,
): string | undefined {
  return raw(name, env);
}

/** An integer within [min, max], or the default when unset. */
export function envInt(
  name: string,
  fallback: number,
  bounds: { min: number; max: number },
  env: Env = process.env,
): number {
  const v = raw(name, env);
  if (v === undefined) return fallback;
  const n = Number(v.replace(/_/g, ''));
  if (!Number.isInteger(n) || n < bounds.min || n > bounds.max)
    throw new ConfigError(
      `${name} must be a whole number from ${bounds.min} to ${bounds.max} (got "${v}").`,
    );
  return n;
}

/** A decimal number within [min, max], or the default when unset. */
export function envNumber(
  name: string,
  fallback: number,
  bounds: { min: number; max: number },
  env: Env = process.env,
): number {
  const v = raw(name, env);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < bounds.min || n > bounds.max)
    throw new ConfigError(
      `${name} must be a number from ${bounds.min} to ${bounds.max} (got "${v}").`,
    );
  return n;
}

/** "true" / "false", or the default when unset. */
export function envBool(
  name: string,
  fallback: boolean,
  env: Env = process.env,
): boolean {
  const v = raw(name, env);
  if (v === undefined) return fallback;
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new ConfigError(`${name} must be "true" or "false" (got "${v}").`);
}

/** A duration such as "90s", "15m", "2h", "30d" or plain seconds, in milliseconds. */
export function parseDurationMs(name: string, value: string): number {
  const m = /^(\d+)\s*([smhd])?$/i.exec(value.trim());
  if (!m)
    throw new ConfigError(
      `${name} must be a duration like 90s, 15m, 2h or 30d (got "${value}").`,
    );
  const n = Number(m[1]);
  const unit = (m[2] ?? 's').toLowerCase();
  const factor = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]!;
  if (n <= 0) throw new ConfigError(`${name} must be longer than zero.`);
  return n * factor;
}

/** A duration string (validated), or the default when unset. */
export function envDuration(
  name: string,
  fallback: string,
  env: Env = process.env,
): string {
  const v = raw(name, env) ?? fallback;
  parseDurationMs(name, v);
  return v;
}

/** An absolute http(s) URL without a trailing slash. */
export function envUrl(
  name: string,
  env: Env = process.env,
): string | undefined {
  const v = raw(name, env);
  if (v === undefined) return undefined;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new ConfigError(`${name} must be an absolute URL (got "${v}").`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:')
    throw new ConfigError(`${name} must be an http(s) URL.`);
  return v.replace(/\/+$/, '');
}
