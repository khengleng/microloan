import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from 'crypto';

/**
 * Application-layer field encryption for sensitive data at rest (AES-256-GCM).
 *
 * Used for non-searchable secrets whose plaintext must never be readable from a
 * DB dump/snapshot: TOTP seeds, uploaded KYC images, the Telegram bot token.
 *
 * - Ciphertext is self-describing: `enc:v1:<iv>:<tag>:<ciphertext>` (all base64).
 * - `decryptField` passes through values WITHOUT the prefix unchanged, so legacy
 *   plaintext rows keep working until they are re-saved or backfilled.
 * - Key: `FIELD_ENCRYPTION_KEY` (32 bytes, base64 or hex). If unset, a stable key
 *   is derived from `JWT_ACCESS_SECRET` (with a warning) so deploys never break;
 *   set a dedicated key before rotating the JWT secret.
 */
const PREFIX = 'enc:v1:';
let cachedKey: Buffer | null = null;
let warned = false;

function resolveKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.FIELD_ENCRYPTION_KEY?.trim();
  if (raw) {
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      cachedKey = Buffer.from(raw, 'hex');
      return cachedKey;
    }
    const buf = Buffer.from(raw, 'base64');
    if (buf.length === 32) {
      cachedKey = buf;
      return cachedKey;
    }
    throw new Error('FIELD_ENCRYPTION_KEY must be 32 bytes (base64 or 64-char hex).');
  }

  const base = process.env.JWT_ACCESS_SECRET;
  if (!base) {
    throw new Error('Field encryption requires FIELD_ENCRYPTION_KEY or JWT_ACCESS_SECRET.');
  }
  if (!warned) {
    // eslint-disable-next-line no-console
    console.warn(
      '[field-crypto] FIELD_ENCRYPTION_KEY not set — deriving a key from JWT_ACCESS_SECRET. ' +
        'Set a dedicated FIELD_ENCRYPTION_KEY before rotating JWT_ACCESS_SECRET or decryption will break.',
    );
    warned = true;
  }
  cachedKey = scryptSync(base, 'field-encryption-v1', 32);
  return cachedKey;
}

export function isEncrypted(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

export function encryptField(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === '') return plaintext ?? null;
  if (isEncrypted(plaintext)) return plaintext; // idempotent
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', resolveKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

/**
 * Deterministic blind index (HMAC-SHA256) for exact-match lookup and uniqueness
 * over an ENCRYPTED column. Same input → same token, so it can back a WHERE
 * lookup and a UNIQUE constraint without exposing the plaintext. Derived from
 * the encryption key with a distinct label so it can't be confused with it.
 */
let cachedIndexKey: Buffer | null = null;
function indexKey(): Buffer {
  if (!cachedIndexKey) cachedIndexKey = createHmac('sha256', resolveKey()).update('blind-index-v1').digest();
  return cachedIndexKey;
}

export function normalizeForIndex(value: string, kind: 'phone' | 'id' | 'raw' = 'raw'): string {
  if (kind === 'phone') return value.replace(/[\s\-()]/g, '');
  if (kind === 'id') return value.trim().toUpperCase();
  return value.trim();
}

export function blindIndex(value: string | null | undefined, kind: 'phone' | 'id' | 'raw' = 'raw'): string | null {
  if (value == null || value === '') return null;
  return createHmac('sha256', indexKey()).update(normalizeForIndex(String(value), kind)).digest('hex');
}

export function decryptField(value: string | null | undefined): string | null {
  if (value == null) return null;
  if (!isEncrypted(value)) return value; // legacy plaintext — pass through
  const parts = value.slice(PREFIX.length).split(':');
  if (parts.length !== 3) return value;
  const [ivB, tagB, ctB] = parts;
  const decipher = createDecipheriv('aes-256-gcm', resolveKey(), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]);
  return pt.toString('utf8');
}
