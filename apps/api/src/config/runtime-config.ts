type RuntimeConfig = {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  corsOrigins: string[];
  redisUrl?: string;
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

  const port = parsePort(process.env.PORT);
  const corsOrigins = parseCorsOrigins(isProduction);
  const redisUrl = process.env.REDIS_URL?.trim();

  if (isProduction && (!redisUrl || !redisUrl.length)) {
    throw new Error('REDIS_URL is required in production for distributed rate limiting.');
  }

  if (isProduction) {
    const requiredS3 = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET_NAME', 'AWS_REGION'] as const;
    for (const key of requiredS3) {
      required(key);
    }
  }

  return {
    nodeEnv,
    isProduction,
    port,
    corsOrigins,
    redisUrl,
  };
}
