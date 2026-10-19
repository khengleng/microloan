import {
  envBool,
  envDuration,
  envInt,
  envNumber,
  envOptional,
  envString,
  envUrl,
  parseDurationMs,
} from './env';

/**
 * Deployment-level operational settings: limits, retry policies, timeouts and
 * security windows that belong to the platform operator rather than to a
 * lender (lender rules live in product configuration and in the tenant's
 * lending settings). Every value is read from the environment, validated, and
 * defaults to the value the code used before it was configurable — so an
 * unset variable changes nothing. Documented in `.env.example`.
 *
 * Read on demand (it is a few env lookups): nothing is cached in the process,
 * and `loadRuntimeConfig()` calls it once at boot so a malformed value stops
 * the API from starting.
 */
export function operationalConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    /** The platform's name in emails, chat messages, authenticator labels and the webhook User-Agent. */
    platformName: envString('PLATFORM_NAME', 'Magic Money', env),
    /** The web app's public origin, for links in emails and Stripe redirects. */
    webUrl: envUrl('WEB_URL', env),

    webhooks: {
      maxAttempts: envInt(
        'LENDING_WEBHOOK_MAX_ATTEMPTS',
        15,
        { min: 1, max: 100 },
        env,
      ),
      disableAfterFailures: envInt(
        'LENDING_WEBHOOK_DISABLE_AFTER_FAILURES',
        50,
        { min: 1, max: 100_000 },
        env,
      ),
      timeoutMs: envInt(
        'LENDING_WEBHOOK_TIMEOUT_MS',
        10_000,
        { min: 1_000, max: 120_000 },
        env,
      ),
      batchSize: envInt(
        'LENDING_WEBHOOK_BATCH_SIZE',
        100,
        { min: 1, max: 5_000 },
        env,
      ),
      fanOutBatchSize: envInt(
        'LENDING_WEBHOOK_FANOUT_BATCH_SIZE',
        500,
        { min: 1, max: 10_000 },
        env,
      ),
    },
    outbox: {
      maxAttempts: envInt(
        'LENDING_OUTBOX_MAX_ATTEMPTS',
        20,
        { min: 1, max: 1_000 },
        env,
      ),
      batchSize: envInt(
        'LENDING_OUTBOX_BATCH_SIZE',
        50,
        { min: 1, max: 5_000 },
        env,
      ),
    },
    /**
     * How long one instance owns an outbox message or webhook delivery it is
     * sending; another instance may pick it up only after this.
     */
    deliveryLeaseSeconds: envInt(
      'LENDING_DELIVERY_LEASE_SECONDS',
      120,
      { min: 30, max: 3_600 },
      env,
    ),

    migration: {
      maxRows: envInt(
        'LENDING_MIGRATION_MAX_ROWS',
        10_000,
        { min: 1, max: 1_000_000 },
        env,
      ),
    },

    auth: {
      maxFailedLogins: envInt(
        'AUTH_MAX_FAILED_LOGINS',
        5,
        { min: 1, max: 100 },
        env,
      ),
      lockoutMinutes: envInt(
        'AUTH_LOCKOUT_MINUTES',
        30,
        { min: 1, max: 1_440 },
        env,
      ),
      mfaChallengeTtl: envDuration('AUTH_MFA_CHALLENGE_TTL', '5m', env),
      passwordResetMinutes: envInt(
        'AUTH_PASSWORD_RESET_MINUTES',
        60,
        { min: 5, max: 1_440 },
        env,
      ),
      /** Used only when JWT_REFRESH_TTL is unset; a malformed JWT_REFRESH_TTL fails at boot. */
      refreshTtl: envDuration('JWT_REFRESH_TTL', '30d', env),
      accessTtl: envDuration('JWT_ACCESS_TTL', '15m', env),
    },
    borrowerPortal: {
      tokenTtl: envDuration('BORROWER_TOKEN_TTL', '2h', env),
      otpTtlSeconds: envInt(
        'BORROWER_OTP_TTL_SECONDS',
        300,
        { min: 60, max: 3_600 },
        env,
      ),
      otpMaxAttempts: envInt(
        'BORROWER_OTP_MAX_ATTEMPTS',
        5,
        { min: 1, max: 20 },
        env,
      ),
      otpMaxPerWindow: envInt(
        'BORROWER_OTP_MAX_PER_WINDOW',
        3,
        { min: 1, max: 50 },
        env,
      ),
      otpWindowMinutes: envInt(
        'BORROWER_OTP_WINDOW_MINUTES',
        15,
        { min: 1, max: 1_440 },
        env,
      ),
    },

    signupPaymentTtlDays: envInt(
      'SIGNUP_PAYMENT_TTL_DAYS',
      7,
      { min: 1, max: 90 },
      env,
    ),
    tenantErasureGraceDays: envInt(
      'TENANT_ERASURE_GRACE_DAYS',
      30,
      { min: 0, max: 3_650 },
      env,
    ),

    /** Global per-client request budget per second (per user when signed in, per IP otherwise). */
    rateLimitPerSecond: envInt(
      'RATE_LIMIT_PER_SECOND',
      120,
      { min: 1, max: 100_000 },
      env,
    ),
    /** Largest JSON / form body accepted, in the body-parser's notation. */
    bodyLimit: bodyLimit(envString('API_BODY_LIMIT', '5mb', env)),

    /** How long a built authorization subject or tenant context is reused when its version is unchanged. */
    authzCacheTtlMs: envInt(
      'LENDING_AUTHZ_CACHE_TTL_MS',
      30_000,
      { min: 0, max: 600_000 },
      env,
    ),
    /** Bound on each of those in-process memo maps; expired entries are swept past it. */
    authzCacheMaxEntries: envInt(
      'LENDING_AUTHZ_CACHE_MAX_ENTRIES',
      5_000,
      { min: 10, max: 1_000_000 },
      env,
    ),

    /**
     * The regulator's ceiling on the annual nominal interest rate (percent).
     * A lender may set a lower cap, never a higher one. Default: the NBC cap.
     */
    regulatoryMaxAnnualRatePct: envNumber(
      'REGULATORY_MAX_ANNUAL_RATE_PCT',
      18,
      { min: 0.01, max: 1_000 },
      env,
    ),

    documents: {
      /** Largest legacy document-vault upload. */
      uploadMaxBytes: envInt(
        'DOCUMENT_UPLOAD_MAX_BYTES',
        10 * 1024 * 1024,
        { min: 1_024, max: 1_073_741_824 },
        env,
      ),
      /** Lead time of document-expiry reminders. */
      expiryReminderDays: envInt(
        'DOCUMENT_EXPIRY_REMINDER_DAYS',
        30,
        { min: 1, max: 365 },
        env,
      ),
    },
    /**
     * Longest a legacy provisioning run's transaction may take (it reads the
     * book and posts under one per-tenant lock, D-101).
     */
    legacyProvisioningTimeoutMs: envInt(
      'LEGACY_PROVISIONING_TX_TIMEOUT_MS',
      120_000,
      { min: 5_000, max: 3_600_000 },
      env,
    ),
    /** How long the readiness probe waits for the database. */
    readinessDbTimeoutMs: envInt(
      'READINESS_DB_TIMEOUT_MS',
      2_000,
      { min: 100, max: 60_000 },
      env,
    ),
    eod: {
      /** Most business days end of day catches up in one run after downtime. */
      maxCatchUpDays: envInt(
        'LENDING_EOD_MAX_CATCHUP_DAYS',
        31,
        { min: 1, max: 3_660 },
        env,
      ),
      /** Loans in parallel (capped by the pool in batch-scope.ts); validated here only. */
      concurrency: envInt(
        'LENDING_EOD_CONCURRENCY',
        4,
        { min: 1, max: 256 },
        env,
      ),
    },
    /** Seconds between metrics gauge refreshes. */
    metricsRefreshSeconds: envInt(
      'LENDING_METRICS_REFRESH_SECONDS',
      60,
      { min: 10, max: 86_400 },
      env,
    ),
    sentryTracesSampleRate: envNumber(
      'SENTRY_TRACES_SAMPLE_RATE',
      0.1,
      { min: 0, max: 1 },
      env,
    ),

    email: {
      apiUrl: envUrl('EMAIL_API_URL', env) ?? 'https://api.resend.com/emails',
      from: envOptional('EMAIL_FROM', env),
    },
    openAiModel: envString('OPENAI_MODEL', 'gpt-4o', env),
    telegramPolling: envBool('TELEGRAM_POLLING_ENABLED', true, env),
  };
}

export type OperationalConfig = ReturnType<typeof operationalConfig>;

function bodyLimit(v: string): string {
  if (!/^\d+(b|kb|mb)$/i.test(v))
    throw new Error(`API_BODY_LIMIT must look like 512kb or 5mb (got "${v}").`);
  return v;
}

/** Milliseconds of a validated duration setting. */
export function durationMs(name: string, value: string): number {
  return parseDurationMs(name, value);
}

/**
 * The web origin for links in emails and payment redirects: WEB_URL, else the
 * first CORS origin (the web app), else — outside production only — the local
 * development server. Production requires CORS_ORIGINS, so it never falls
 * through to a localhost link.
 */
export function webOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const url = operationalConfig(env).webUrl;
  if (url) return url;
  const cors = (env.CORS_ORIGINS || env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)[0];
  if (cors) return cors.replace(/\/+$/, '');
  if (env.NODE_ENV === 'production')
    throw new Error('WEB_URL (or CORS_ORIGINS) is required in production.');
  return 'http://localhost:3000';
}
