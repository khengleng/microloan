import * as Sentry from '@sentry/node';

// Error tracking + light performance tracing. No-op unless SENTRY_DSN is set,
// so local/dev and un-provisioned deploys are unaffected.
let enabled = false;

export function initSentry(): boolean {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
    // Railway injects the commit SHA — ties errors to a release.
    release: process.env.RAILWAY_GIT_COMMIT_SHA || undefined,
  });
  enabled = true;
  return true;
}

export function sentryEnabled(): boolean {
  return enabled;
}

export { Sentry };
