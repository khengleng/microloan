import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Settings } from '../../config/s3';

/**
 * Object storage for the customer document library (DOC-2).
 *
 * Files never live in the database. With S3 configured they go to the
 * bucket (server-side encrypted) and downloads are S3 pre-signed URLs; without
 * it a local-disk store is used (development, or a mounted volume named by
 * DOCUMENT_STORAGE_DIR) and downloads go through a short-lived signed link
 * served by the API. Production refuses to start writing to a temporary
 * directory.
 *
 * Keys are always `tenants/<tenant>/customers/<borrower>/documents/<doc>/v<n>-<uuid>`:
 * the client's file name never shapes a key, and a key outside the caller's
 * own tenant prefix is never read, signed or deleted.
 */
export interface LibraryStorage {
  readonly provider: 'S3' | 'LOCAL_DISK';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** A provider-signed URL, or null when the API must serve the bytes itself. */
  presign(
    key: string,
    ttlSeconds: number,
    fileName: string,
  ): Promise<string | null>;
}

export const ALLOWED_DOCUMENT_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
/** Generated documents (letters, key facts) may also be HTML. */
export const GENERATED_DOCUMENT_MIME = new Set([
  ...ALLOWED_DOCUMENT_MIME,
  'text/html',
]);
/** Uploads arrive base64-encoded in a JSON body capped at 5 MB. */
export const MAX_DOCUMENT_BYTES = 3.5 * 1024 * 1024;

export function tenantPrefix(tenantId: string): string {
  return `tenants/${tenantId}/`;
}

export function libraryKey(
  tenantId: string,
  borrowerId: string,
  documentId: string,
  version: number,
): string {
  return `${tenantPrefix(tenantId)}customers/${borrowerId}/documents/${documentId}/v${version}-${randomUUID()}`;
}

/**
 * The key a version may use, or null. Only keys under the tenant's own
 * customer prefix, made of safe characters and without a climb or an empty
 * segment, are ever read, signed or deleted.
 */
export function ownLibraryKey(tenantId: string, key: string): string | null {
  if (!key.startsWith(`${tenantPrefix(tenantId)}customers/`)) return null;
  if (key.includes('..') || key.includes('//')) return null;
  if (!/^[A-Za-z0-9/_.-]+$/.test(key)) return null;
  return key;
}

/** A display name: safe characters only, never used for storage. */
export function safeFileName(
  name: string | null | undefined,
  fallback = 'document',
): string {
  const s = (name ?? '')
    .replace(/[^\w.\- ]/g, '_')
    .replace(/^[.\s]+/, '')
    .slice(0, 120);
  return s || fallback;
}

/** Magic numbers: the declared type must match the bytes. */
export function sniffMatches(mime: string, bytes: Buffer): boolean {
  const head = bytes.subarray(0, 16);
  switch (mime) {
    case 'application/pdf':
      return head.subarray(0, 5).toString('latin1') === '%PDF-';
    case 'image/png':
      return head
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/jpeg':
      return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case 'image/webp':
      return (
        head.subarray(0, 4).toString('latin1') === 'RIFF' &&
        head.subarray(8, 12).toString('latin1') === 'WEBP'
      );
    case 'text/html':
      return true;
    default:
      return false;
  }
}

class S3LibraryStorage implements LibraryStorage {
  readonly provider = 'S3' as const;
  private settings = s3Settings();
  private client = new S3Client({
    region: this.settings.region,
    credentials: this.settings.credentials,
  });
  private bucket = this.settings.bucket;
  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: 'AES256',
      }),
    );
  }
  async get(key: string) {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  async delete(key: string) {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
  async presign(key: string, ttlSeconds: number, fileName: string) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${fileName.replace(/"/g, '')}"`,
      }),
      { expiresIn: ttlSeconds },
    );
  }
}

class LocalLibraryStorage implements LibraryStorage {
  readonly provider = 'LOCAL_DISK' as const;
  constructor(private readonly root: string) {}
  private path(key: string): string {
    const full = resolve(this.root, key);
    if (!full.startsWith(resolve(this.root) + sep))
      throw new Error('Storage key escapes the document root');
    return full;
  }
  async put(key: string, body: Buffer) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body, { flag: 'wx' });
  }
  async get(key: string) {
    return readFile(this.path(key));
  }
  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
  async presign() {
    return null;
  }
}

@Injectable()
export class DocumentStorageService {
  private readonly logger = new Logger(DocumentStorageService.name);
  private readonly s3 = s3Settings().configured;
  private store: LibraryStorage | null = null;

  /** The configured store. Production needs S3 or an explicit volume. */
  storage(): LibraryStorage {
    if (this.store) return this.store;
    if (this.s3) {
      this.store = new S3LibraryStorage();
    } else {
      const dir = process.env.DOCUMENT_STORAGE_DIR;
      if (!dir && process.env.NODE_ENV === 'production')
        throw new ServiceUnavailableException(
          'Document storage is not configured: set S3 credentials or DOCUMENT_STORAGE_DIR.',
        );
      const root = dir || join(tmpdir(), 'microloan-customer-documents');
      if (!dir)
        this.logger.warn(
          `Customer documents are stored on local disk under ${root} (development only).`,
        );
      else if (process.env.NODE_ENV === 'production')
        // A local directory is visible to one machine only: with several API
        // instances it must be a volume they all mount, or uploads made on
        // one are missing on the others. S3 has no such limit.
        this.logger.warn(
          `Customer documents are stored under DOCUMENT_STORAGE_DIR=${root}; every API instance must mount the same volume.`,
        );
      this.store = new LocalLibraryStorage(root);
    }
    return this.store;
  }

  /** Download links live this long (seconds): DOCUMENT_LINK_TTL_SECONDS, 30..900, default 300. */
  linkTtlSeconds(): number {
    const n = Number(process.env.DOCUMENT_LINK_TTL_SECONDS || 300);
    return Math.min(900, Math.max(30, Number.isFinite(n) ? n : 300));
  }

  // ── API-served links (local store, legacy content) ────────────────────────

  private secret(): Buffer {
    const base =
      process.env.DOCUMENT_LINK_SECRET || process.env.JWT_ACCESS_SECRET;
    if (!base)
      throw new ServiceUnavailableException(
        'Document links are not configured.',
      );
    // Derived, so a document link can never be replayed as a session token.
    return createHmac('sha256', base).update('document-links-v1').digest();
  }

  /** A signed, expiring token naming one version of one tenant's document. */
  signLink(claims: {
    tenantId: string;
    versionId: string;
    actorId: string;
    expiresAt: number;
  }): string {
    const body = Buffer.from(
      JSON.stringify({
        t: claims.tenantId,
        v: claims.versionId,
        a: claims.actorId,
        e: claims.expiresAt,
      }),
    ).toString('base64url');
    const mac = createHmac('sha256', this.secret())
      .update(body)
      .digest('base64url');
    return `${body}.${mac}`;
  }

  /** The claims of a valid, unexpired token; null otherwise. */
  verifyLink(
    token: string,
    nowMs: number,
  ): { tenantId: string; versionId: string; actorId: string } | null {
    if (!/^[A-Za-z0-9_-]{10,600}\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const [body, mac] = token.split('.');
    const expected = createHmac('sha256', this.secret()).update(body).digest();
    const actual = Buffer.from(mac, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return null;
    let claims: { t?: unknown; v?: unknown; a?: unknown; e?: unknown };
    try {
      claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    const expired = typeof claims.e !== 'number' || claims.e < nowMs;
    if (
      expired ||
      typeof claims.t !== 'string' ||
      typeof claims.v !== 'string' ||
      typeof claims.a !== 'string'
    )
      return null;
    return { tenantId: claims.t, versionId: claims.v, actorId: claims.a };
  }
}
