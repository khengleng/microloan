import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

/**
 * Envelope encryption at rest for customer documents kept on local disk
 * (DECISIONS D-137). S3 objects are encrypted by the bucket (SSE); a file on
 * a mounted volume has no such protection, so the API encrypts it itself.
 *
 * Each file gets its own random 256-bit data key. The file is encrypted with
 * AES-256-GCM under that key, with the storage key (its path under the
 * document root) as additional authenticated data, so a file moved or
 * swapped to another path fails to decrypt. The data key is wrapped with
 * AES-256-GCM under a key-encryption key derived (HKDF-SHA256) from
 * DOCUMENT_ENCRYPTION_KEY, and stored in the file's header:
 *
 *   magic "MLDOCENC" | version 0x01 |
 *   wrap IV (12) | wrap tag (16) | wrapped data key (32) |
 *   data IV (12) | data tag (16) | ciphertext
 *
 * Files without the magic header are legacy plaintext and are returned as
 * they are, so a volume written before encryption stays readable until
 * scripts/encrypt-documents-at-rest.ts has re-encrypted it.
 *
 * Rotating DOCUMENT_ENCRYPTION_KEY means re-wrapping each file's data key;
 * the file bodies need not be re-encrypted. Keys are never generated here.
 */
export const DOCUMENT_MAGIC = Buffer.from('MLDOCENC', 'latin1');
const VERSION = 0x01;
const IV = 12;
const TAG = 16;
const KEY = 32;
const HEADER = DOCUMENT_MAGIC.length + 1 + IV + TAG + KEY + IV + TAG;
const KEK_INFO = 'microloan-document-at-rest-v1';

/** A 32-byte key given as 64 hex characters or as base64; throws otherwise. */
export function parseDocumentEncryptionKey(raw: string): Buffer {
  const value = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');
  const buf = Buffer.from(value, 'base64');
  if (buf.length === KEY) return buf;
  throw new Error(
    'DOCUMENT_ENCRYPTION_KEY must be 32 bytes (base64 or 64-char hex).',
  );
}

/** The key-encryption key derived from DOCUMENT_ENCRYPTION_KEY. */
export function deriveDocumentKek(raw: string): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      parseDocumentEncryptionKey(raw),
      Buffer.alloc(0),
      KEK_INFO,
      KEY,
    ),
  );
}

/**
 * The key-encryption key from the environment, or null when none is set.
 * Production refuses to run the disk store without one (runtime-config.ts
 * and DocumentStorageService); development stores plaintext with a warning.
 */
export function documentKekFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Buffer | null {
  const raw = env.DOCUMENT_ENCRYPTION_KEY?.trim();
  return raw ? deriveDocumentKek(raw) : null;
}

export function isEncryptedDocument(body: Buffer): boolean {
  return (
    body.length >= HEADER &&
    body.subarray(0, DOCUMENT_MAGIC.length).equals(DOCUMENT_MAGIC)
  );
}

export function encryptDocument(
  plain: Buffer,
  storageKey: string,
  kek: Buffer,
): Buffer {
  const dataKey = randomBytes(KEY);
  const wrapIv = randomBytes(IV);
  const wrap = createCipheriv('aes-256-gcm', kek, wrapIv);
  wrap.setAAD(DOCUMENT_MAGIC);
  const wrapped = Buffer.concat([wrap.update(dataKey), wrap.final()]);
  const wrapTag = wrap.getAuthTag();
  const dataIv = randomBytes(IV);
  const cipher = createCipheriv('aes-256-gcm', dataKey, dataIv);
  cipher.setAAD(Buffer.from(storageKey, 'utf8'));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const dataTag = cipher.getAuthTag();
  dataKey.fill(0);
  return Buffer.concat([
    DOCUMENT_MAGIC,
    Buffer.from([VERSION]),
    wrapIv,
    wrapTag,
    wrapped,
    dataIv,
    dataTag,
    body,
  ]);
}

/**
 * The plaintext of a stored file: decrypted when it carries the header,
 * returned unchanged when it is legacy plaintext. Throws when the file is
 * encrypted and no key (or the wrong key) is given, or when it was tampered
 * with or moved to another storage key.
 */
export function decryptDocument(
  stored: Buffer,
  storageKey: string,
  kek: Buffer | null,
): Buffer {
  if (!isEncryptedDocument(stored)) return stored;
  if (!kek)
    throw new Error(
      'This document is encrypted at rest and DOCUMENT_ENCRYPTION_KEY is not set.',
    );
  let at = DOCUMENT_MAGIC.length;
  const version = stored[at];
  at += 1;
  if (version !== VERSION)
    throw new Error(`Unknown document encryption version ${version}.`);
  const take = (n: number) => {
    const part = stored.subarray(at, at + n);
    at += n;
    return part;
  };
  const wrapIv = take(IV);
  const wrapTag = take(TAG);
  const wrapped = take(KEY);
  const dataIv = take(IV);
  const dataTag = take(TAG);
  const unwrap = createDecipheriv('aes-256-gcm', kek, wrapIv);
  unwrap.setAAD(DOCUMENT_MAGIC);
  unwrap.setAuthTag(wrapTag);
  const dataKey = Buffer.concat([unwrap.update(wrapped), unwrap.final()]);
  const decipher = createDecipheriv('aes-256-gcm', dataKey, dataIv);
  decipher.setAAD(Buffer.from(storageKey, 'utf8'));
  decipher.setAuthTag(dataTag);
  const plain = Buffer.concat([
    decipher.update(stored.subarray(at)),
    decipher.final(),
  ]);
  dataKey.fill(0);
  return plain;
}
