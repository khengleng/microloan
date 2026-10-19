#!/usr/bin/env node

const required = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'JWT_REFRESH_TOKEN_PEPPER',
  'CORS_ORIGINS',
  'REDIS_URL',
];

let failed = false;

for (const key of required) {
  const value = process.env[key];
  if (!value || !value.trim()) {
    console.error(`Missing required env: ${key}`);
    failed = true;
  }
}

const access = process.env.JWT_ACCESS_SECRET || '';
const refresh = process.env.JWT_REFRESH_SECRET || '';
const pepper = process.env.JWT_REFRESH_TOKEN_PEPPER || '';
const cors = process.env.CORS_ORIGINS || '';

if (access.length < 32) {
  console.error('JWT_ACCESS_SECRET must be at least 32 characters.');
  failed = true;
}
if (refresh.length < 32) {
  console.error('JWT_REFRESH_SECRET must be at least 32 characters.');
  failed = true;
}
if (pepper.length < 16) {
  console.error('JWT_REFRESH_TOKEN_PEPPER must be at least 16 characters.');
  failed = true;
}

if (cors.split(',').map((x) => x.trim()).includes('*')) {
  console.error('CORS_ORIGINS cannot include "*".');
  failed = true;
}

// Optional but recommended (set on api AND web): without it the API cannot
// tell browsers apart behind the web server. When set, it must be strong.
const webProxySecret = (process.env.WEB_PROXY_SECRET || '').trim();
if (!webProxySecret) {
  console.warn('WEB_PROXY_SECRET is not set: the API will key throttles and audit on the web server IP.');
} else if (webProxySecret.length < 32) {
  console.error('WEB_PROXY_SECRET must be at least 32 characters.');
  failed = true;
}

if (process.env.NODE_ENV === 'production' && /sqlite/i.test(process.env.DATABASE_URL || '')) {
  console.error('SQLite is not allowed in production.');
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log('Production configuration checks passed.');
