import { operationalConfig, webOrigin } from './operational-config';
import { loadRuntimeConfig } from './runtime-config';

/**
 * Every value moved out of the code keeps the constant it replaced as its
 * default (docs/security/HARDCODING_AUDIT.md), and a malformed value is
 * refused rather than turned into NaN or a silent fallback.
 */
describe('operationalConfig', () => {
  it('defaults to the constants the code used before', () => {
    const c = operationalConfig({});
    expect(c.platformName).toBe('Magic Money');
    expect(c.webhooks).toEqual({
      maxAttempts: 15,
      disableAfterFailures: 50,
      timeoutMs: 10_000,
      batchSize: 100,
      fanOutBatchSize: 500,
    });
    expect(c.outbox).toEqual({ maxAttempts: 20, batchSize: 50 });
    expect(c.migration.maxRows).toBe(10_000);
    expect(c.auth).toEqual({
      maxFailedLogins: 5,
      lockoutMinutes: 30,
      mfaChallengeTtl: '5m',
      passwordResetMinutes: 60,
      refreshTtl: '30d',
      accessTtl: '15m',
    });
    expect(c.borrowerPortal).toEqual({
      tokenTtl: '2h',
      otpTtlSeconds: 300,
      otpMaxAttempts: 5,
      otpMaxPerWindow: 3,
      otpWindowMinutes: 15,
    });
    expect(c.signupPaymentTtlDays).toBe(7);
    expect(c.tenantErasureGraceDays).toBe(30);
    expect(c.rateLimitPerSecond).toBe(120);
    expect(c.bodyLimit).toBe('5mb');
    expect(c.authzCacheTtlMs).toBe(30_000);
    expect(c.regulatoryMaxAnnualRatePct).toBe(18);
    expect(c.documents).toEqual({
      uploadMaxBytes: 10 * 1024 * 1024,
      expiryReminderDays: 30,
    });
    expect(c.readinessDbTimeoutMs).toBe(2_000);
    expect(c.eod.maxCatchUpDays).toBe(31);
    expect(c.metricsRefreshSeconds).toBe(60);
    expect(c.sentryTracesSampleRate).toBe(0.1);
    expect(c.openAiModel).toBe('gpt-4o');
    expect(c.telegramPolling).toBe(true);
  });

  it('reads overrides from the environment', () => {
    const c = operationalConfig({
      PLATFORM_NAME: 'Acme Lending',
      LENDING_WEBHOOK_MAX_ATTEMPTS: '3',
      AUTH_LOCKOUT_MINUTES: '45',
      REGULATORY_MAX_ANNUAL_RATE_PCT: '24.5',
      TELEGRAM_POLLING_ENABLED: 'false',
    });
    expect(c.platformName).toBe('Acme Lending');
    expect(c.webhooks.maxAttempts).toBe(3);
    expect(c.auth.lockoutMinutes).toBe(45);
    expect(c.regulatoryMaxAnnualRatePct).toBe(24.5);
    expect(c.telegramPolling).toBe(false);
  });

  it.each([
    ['LENDING_WEBHOOK_MAX_ATTEMPTS', 'lots'],
    ['LENDING_WEBHOOK_MAX_ATTEMPTS', '0'],
    ['AUTH_MAX_FAILED_LOGINS', '2.5'],
    ['JWT_REFRESH_TTL', '7 days'],
    ['BORROWER_TOKEN_TTL', '0h'],
    ['API_BODY_LIMIT', 'huge'],
    ['TELEGRAM_POLLING_ENABLED', 'yes'],
    ['WEB_URL', 'not a url'],
    ['SENTRY_TRACES_SAMPLE_RATE', '2'],
  ])('refuses %s=%s', (name, value) => {
    expect(() => operationalConfig({ [name]: value })).toThrow(name);
  });

  it('builds links from WEB_URL, else the first CORS origin, never localhost in production', () => {
    expect(webOrigin({ WEB_URL: 'https://app.example.com/' })).toBe(
      'https://app.example.com',
    );
    expect(
      webOrigin({
        CORS_ORIGINS: 'https://web.example.com, https://b.example.com',
      }),
    ).toBe('https://web.example.com');
    expect(webOrigin({})).toBe('http://localhost:3000');
    expect(() => webOrigin({ NODE_ENV: 'production' })).toThrow('WEB_URL');
  });
});

describe('loadRuntimeConfig in production', () => {
  const base = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://db.example.test/app',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    JWT_REFRESH_TOKEN_PEPPER: 'c'.repeat(16),
    CORS_ORIGINS: 'https://web.example.com',
    REDIS_URL: 'redis://cache.example.test:6379',
  };
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  const withEnv = (env: Record<string, string>) => {
    process.env = { ...env };
    return () => loadRuntimeConfig();
  };

  it('starts with the required values', () => {
    expect(withEnv(base)()).toMatchObject({ isProduction: true });
  });
  it('refuses an S3 bucket without a region', () => {
    expect(withEnv({ ...base, AWS_S3_BUCKET_NAME: 'docs' })).toThrow(
      'AWS_REGION',
    );
  });
  it('refuses an e-mail provider without a sender', () => {
    expect(withEnv({ ...base, RESEND_API_KEY: 're_x' })).toThrow('EMAIL_FROM');
  });
  it('refuses a malformed operational value at boot', () => {
    expect(withEnv({ ...base, LENDING_OUTBOX_MAX_ATTEMPTS: 'many' })).toThrow(
      'LENDING_OUTBOX_MAX_ATTEMPTS',
    );
  });
});
