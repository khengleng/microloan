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
      mfaRequiredSuperadmin: true,
      mfaStepUpMinutes: 15,
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

  it('alert monitor: log-only with no recipients, documented defaults, addresses validated (D-150)', () => {
    expect(operationalConfig({}).alerts).toEqual({
      emailTo: [],
      checkIntervalMinutes: 10,
      reminderHours: 6,
      eodMaxLagDays: 1,
      monthEndCloseDays: 10,
      backlogMaxAgeMinutes: 30,
      jobFailureLookbackHours: 24,
      dbConnectionsPct: 80,
    });
    expect(
      operationalConfig({
        ALERT_EMAIL_TO: ' Ops@Example.com, oncall@example.com,ops@example.com ',
      }).alerts.emailTo,
    ).toEqual(['ops@example.com', 'oncall@example.com']);
    expect(() =>
      operationalConfig({ ALERT_EMAIL_TO: 'ops@example.com; other' }),
    ).toThrow('ALERT_EMAIL_TO');
    expect(() =>
      operationalConfig({ ALERT_CHECK_INTERVAL_MINUTES: '0' }),
    ).toThrow('ALERT_CHECK_INTERVAL_MINUTES');
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
    FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    DOCUMENT_LINK_SECRET: 'd'.repeat(32),
    SERVICE_KEY_PEPPER: 'e'.repeat(32),
    // A test key, not a real one.
    DOCUMENT_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  };
  const without = (name: keyof typeof base) => {
    const env: Record<string, string> = { ...base };
    delete env[name];
    return env;
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
  it.each([
    'FIELD_ENCRYPTION_KEY',
    'DOCUMENT_LINK_SECRET',
    'SERVICE_KEY_PEPPER',
  ] as const)(
    'refuses to start without %s (no derivation from the JWT secrets)',
    (name) => {
      expect(withEnv(without(name))).toThrow(name);
    },
  );
  it('accepts a 64-character hex encryption key', () => {
    expect(
      withEnv({ ...base, FIELD_ENCRYPTION_KEY: 'ab'.repeat(32) })(),
    ).toMatchObject({ isProduction: true });
  });
  it('refuses an encryption key that is not 32 bytes', () => {
    expect(
      withEnv({
        ...base,
        FIELD_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString('base64'),
      }),
    ).toThrow('FIELD_ENCRYPTION_KEY');
    expect(withEnv({ ...base, FIELD_ENCRYPTION_KEY: 'not-a-key' })).toThrow(
      'FIELD_ENCRYPTION_KEY',
    );
  });
  it('refuses a short document link secret or service key pepper', () => {
    expect(withEnv({ ...base, DOCUMENT_LINK_SECRET: 'short' })).toThrow(
      'DOCUMENT_LINK_SECRET',
    );
    expect(withEnv({ ...base, SERVICE_KEY_PEPPER: 'short' })).toThrow(
      'SERVICE_KEY_PEPPER',
    );
  });
  it('refuses to store documents on disk without DOCUMENT_ENCRYPTION_KEY', () => {
    expect(withEnv(without('DOCUMENT_ENCRYPTION_KEY'))).toThrow(
      'DOCUMENT_ENCRYPTION_KEY',
    );
  });
  it('does not need DOCUMENT_ENCRYPTION_KEY when S3 holds the documents', () => {
    expect(
      withEnv({
        ...without('DOCUMENT_ENCRYPTION_KEY'),
        AWS_ACCESS_KEY_ID: 'AKIA-TEST',
        AWS_SECRET_ACCESS_KEY: 'test-secret',
        AWS_S3_BUCKET_NAME: 'docs',
        AWS_REGION: 'ap-southeast-1',
      })(),
    ).toMatchObject({ isProduction: true });
  });
  it('refuses a document encryption key that is not 32 bytes', () => {
    expect(withEnv({ ...base, DOCUMENT_ENCRYPTION_KEY: 'not-a-key' })).toThrow(
      'DOCUMENT_ENCRYPTION_KEY',
    );
  });
  it('does not require the dedicated secrets outside production', () => {
    const env = { ...base, NODE_ENV: 'development' } as Record<string, string>;
    delete env.FIELD_ENCRYPTION_KEY;
    delete env.DOCUMENT_LINK_SECRET;
    delete env.SERVICE_KEY_PEPPER;
    expect(withEnv(env)()).toMatchObject({ isProduction: false });
  });
  it('refuses a malformed operational value at boot', () => {
    expect(withEnv({ ...base, LENDING_OUTBOX_MAX_ATTEMPTS: 'many' })).toThrow(
      'LENDING_OUTBOX_MAX_ATTEMPTS',
    );
  });
});
