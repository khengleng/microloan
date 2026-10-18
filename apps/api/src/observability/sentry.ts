import * as Sentry from '@sentry/node';
import { operationalConfig } from '../config/operational-config';

// Error tracking + light performance tracing. No-op unless SENTRY_DSN is set,
// so local/dev and un-provisioned deploys are unaffected.
let enabled = false;

export function initSentry(): boolean {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: operationalConfig().sentryTracesSampleRate,
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
