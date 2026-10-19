#!/usr/bin/env node

const required = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'JWT_REFRESH_TOKEN_PEPPER',
  'CORS_ORIGINS',
  'REDIS_URL',
  // Dedicated secrets: production never derives them from the JWT secrets
  // (apps/api/src/config/runtime-config.ts refuses to boot without them).
  'FIELD_ENCRYPTION_KEY',
  'DOCUMENT_LINK_SECRET',
  'SERVICE_KEY_PEPPER',
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

const fieldKey = (process.env.FIELD_ENCRYPTION_KEY || '').trim();
if (fieldKey) {
  const isHex = /^[0-9a-fA-F]{64}$/.test(fieldKey);
  if (!isHex && Buffer.from(fieldKey, 'base64').length !== 32) {
    console.error('FIELD_ENCRYPTION_KEY must be 32 bytes (base64 or 64-char hex).');
    failed = true;
  }
}
// Customer documents on a disk volume are encrypted by the API with a key
// derived from DOCUMENT_ENCRYPTION_KEY: required whenever S3 is not configured.
const s3Configured = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET_NAME'].every((k) =>
  (process.env[k] || '').trim(),
);
const documentKey = (process.env.DOCUMENT_ENCRYPTION_KEY || '').trim();
if (!s3Configured && !documentKey) {
  console.error('Missing required env: DOCUMENT_ENCRYPTION_KEY (documents are stored on disk because S3 is not configured).');
  failed = true;
}
if (documentKey) {
  const isHex = /^[0-9a-fA-F]{64}$/.test(documentKey);
  if (!isHex && Buffer.from(documentKey, 'base64').length !== 32) {
    console.error('DOCUMENT_ENCRYPTION_KEY must be 32 bytes (base64 or 64-char hex).');
    failed = true;
  }
}
for (const key of ['DOCUMENT_LINK_SECRET', 'SERVICE_KEY_PEPPER']) {
  const value = process.env[key] || '';
  if (value && value.trim().length < 32) {
    console.error(`${key} must be at least 32 characters.`);
    failed = true;
  }
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
