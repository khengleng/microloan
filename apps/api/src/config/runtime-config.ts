import { parseFieldEncryptionKey } from '../common/field-crypto';
import { operationalConfig } from './operational-config';

type RuntimeConfig = {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  corsOrigins: string[];
  redisUrl?: string;
  /** Shared with the web server; authenticates its X-Client-IP header. */
  webProxySecret?: string;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function assertMinLength(name: string, value: string, min: number) {
  if (value.length < min) {
    throw new Error(`${name} must be at least ${min} characters.`);
  }
}

function parsePort(raw?: string): number {
  if (!raw) return 3001;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error('PORT must be a valid TCP port (1-65535).');
  }
  return parsed;
}

function parseCorsOrigins(isProduction: boolean): string[] {
  const raw = process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '';
  const origins = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (isProduction) {
    if (origins.length === 0) {
      throw new Error('CORS_ORIGINS is required in production.');
    }
    if (origins.includes('*')) {
      throw new Error('CORS_ORIGINS cannot contain "*" in production.');
    }
  }

  return origins;
}

export function loadRuntimeConfig(): RuntimeConfig {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  const databaseUrl = required('DATABASE_URL');
  if (/sqlite/i.test(databaseUrl) && isProduction) {
    throw new Error('SQLite is not allowed in production. Use PostgreSQL.');
  }

  const jwtAccess = required('JWT_ACCESS_SECRET');
  const jwtRefresh = required('JWT_REFRESH_SECRET');
  assertMinLength('JWT_ACCESS_SECRET', jwtAccess, 32);
  assertMinLength('JWT_REFRESH_SECRET', jwtRefresh, 32);

  const pepper = required('JWT_REFRESH_TOKEN_PEPPER');
  assertMinLength('JWT_REFRESH_TOKEN_PEPPER', pepper, 16);

  if (isProduction) {
    // Dedicated secrets, never derived from the JWT secrets in production:
    // rotating JWT_ACCESS_SECRET must not make encrypted PII unreadable,
    // invalidate document links or orphan every service key.
    try {
      parseFieldEncryptionKey(required('FIELD_ENCRYPTION_KEY'));
    } catch (e) {
      throw new Error(
        `FIELD_ENCRYPTION_KEY is required in production and must be 32 bytes (base64 or 64-char hex): ${(e as Error).message}`,
      );
    }
    assertMinLength(
      'DOCUMENT_LINK_SECRET',
      required('DOCUMENT_LINK_SECRET'),
      32,
    );
    assertMinLength('SERVICE_KEY_PEPPER', required('SERVICE_KEY_PEPPER'), 32);
  }

  const port = parsePort(process.env.PORT);
  const corsOrigins = parseCorsOrigins(isProduction);
  const redisUrl = process.env.REDIS_URL?.trim();

  if (isProduction && (!redisUrl || !redisUrl.length)) {
    throw new Error(
      'REDIS_URL is required in production for distributed rate limiting.',
    );
  }

  // Optional but recommended: without it the API ignores X-Client-IP and sees
  // the web server's address for everything the web server forwards. When it
  // is set it must be a real secret, since it lets the holder name any IP.
  const webProxySecret = process.env.WEB_PROXY_SECRET?.trim() || undefined;
  if (webProxySecret) assertMinLength('WEB_PROXY_SECRET', webProxySecret, 32);

  // S3 is optional at process startup to allow controlled rollout.
  // Document endpoints enforce availability and return 503 when unconfigured.
  // When it is configured, the region must be stated rather than guessed.
  if (
    isProduction &&
    process.env.AWS_S3_BUCKET_NAME?.trim() &&
    !process.env.AWS_REGION?.trim()
  ) {
    throw new Error(
      'AWS_REGION is required in production when AWS_S3_BUCKET_NAME is set.',
    );
  }
  // Outgoing email needs a real sender address, not a development placeholder.
  if (
    isProduction &&
    process.env.RESEND_API_KEY?.trim() &&
    !process.env.EMAIL_FROM?.trim()
  ) {
    throw new Error(
      'EMAIL_FROM is required in production when RESEND_API_KEY is set.',
    );
  }

  // Every operational limit is parsed once here so a malformed value stops
  // the boot instead of surfacing as NaN in the middle of a job.
  operationalConfig();

  return {
    nodeEnv,
    isProduction,
    port,
    corsOrigins,
    redisUrl,
    webProxySecret,
  };
}
