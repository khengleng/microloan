import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  decryptDocument,
  deriveDocumentKek,
  encryptDocument,
  isEncryptedDocument,
  parseDocumentEncryptionKey,
} from './document-crypto';
import { encryptDocumentsAtRest } from './document-reencrypt';
import { DocumentStorageService, LocalLibraryStorage } from './document-storage';

// Test keys only: never real key material.
const TEST_KEY = Buffer.alloc(32, 3).toString('base64');
const OTHER_KEY = 'cd'.repeat(32);
const KEY = 'tenants/tA/customers/b1/documents/d1/v1-0001';

describe('document encryption at rest (D-137)', () => {
  const kek = deriveDocumentKek(TEST_KEY);
  const plain = Buffer.from('%PDF-1.4 national id of Sok Dara');

  it('round-trips through a per-file data key and hides the content', () => {
    const stored = encryptDocument(plain, KEY, kek);
    expect(isEncryptedDocument(stored)).toBe(true);
    expect(stored.includes(Buffer.from('Sok Dara'))).toBe(false);
    expect(decryptDocument(stored, KEY, kek).equals(plain)).toBe(true);
    // A fresh data key and IV every time.
    expect(encryptDocument(plain, KEY, kek).equals(stored)).toBe(false);
  });

  it('refuses the wrong key, a moved file and tampering', () => {
    const stored = encryptDocument(plain, KEY, kek);
    expect(() =>
      decryptDocument(stored, KEY, deriveDocumentKek(OTHER_KEY)),
    ).toThrow();
    expect(() => decryptDocument(stored, `${KEY}-moved`, kek)).toThrow();
    const tampered = Buffer.from(stored);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decryptDocument(tampered, KEY, kek)).toThrow();
    expect(() => decryptDocument(stored, KEY, null)).toThrow(
      /DOCUMENT_ENCRYPTION_KEY/,
    );
  });

  it('passes legacy plaintext through unchanged', () => {
    expect(decryptDocument(plain, KEY, kek).equals(plain)).toBe(true);
    expect(decryptDocument(plain, KEY, null).equals(plain)).toBe(true);
  });

  it('accepts 32-byte keys as base64 or hex only', () => {
    expect(parseDocumentEncryptionKey(OTHER_KEY)).toHaveLength(32);
    expect(() => parseDocumentEncryptionKey('short')).toThrow(
      'DOCUMENT_ENCRYPTION_KEY',
    );
  });

  describe('on the local-disk store', () => {
    let root: string;
    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), 'doc-crypto-'));
    });
    afterEach(async () => rm(root, { recursive: true, force: true }));

    const plaintextFile = async (key: string, body: Buffer) => {
      await mkdir(dirname(join(root, key)), { recursive: true });
      await writeFile(join(root, key), body);
    };

    it('writes encrypted files and reads them back', async () => {
      const store = new LocalLibraryStorage(root, kek);
      await store.put(KEY, plain);
      const onDisk = await readFile(join(root, KEY));
      expect(isEncryptedDocument(onDisk)).toBe(true);
      expect((await store.get(KEY)).equals(plain)).toBe(true);
    });

    it('still reads a plaintext file written before encryption', async () => {
      await plaintextFile(KEY, plain);
      const store = new LocalLibraryStorage(root, kek);
      expect((await store.get(KEY)).equals(plain)).toBe(true);
    });

    it('the re-encrypt run is idempotent and leaves files readable', async () => {
      const second = 'tenants/tA/customers/b2/documents/d2/v1-0002';
      await plaintextFile(KEY, plain);
      await plaintextFile(second, Buffer.from('%PDF-1.4 second'));
      await plaintextFile('tenants/tA/other/x', Buffer.from('not a document'));
      const store = new LocalLibraryStorage(root, kek);
      await store.put('tenants/tA/customers/b3/documents/d3/v1-0003', plain);

      const dry = await encryptDocumentsAtRest(root, kek, { dryRun: true });
      expect(dry).toEqual({ encrypted: 2, skipped: 1, ignored: 1 });
      expect(isEncryptedDocument(await readFile(join(root, KEY)))).toBe(false);

      const first = await encryptDocumentsAtRest(root, kek);
      expect(first).toEqual({ encrypted: 2, skipped: 1, ignored: 1 });
      const again = await encryptDocumentsAtRest(root, kek);
      expect(again).toEqual({ encrypted: 0, skipped: 3, ignored: 1 });

      expect(isEncryptedDocument(await readFile(join(root, KEY)))).toBe(true);
      expect((await store.get(KEY)).equals(plain)).toBe(true);
      expect((await store.get(second)).toString()).toBe('%PDF-1.4 second');
      // Files outside the library's keys are never touched.
      expect(
        (await readFile(join(root, 'tenants/tA/other/x'))).toString(),
      ).toBe('not a document');
    });
  });

  describe('production', () => {
    const saved = { ...process.env };
    afterEach(() => {
      process.env = { ...saved };
    });

    it('refuses the disk store without DOCUMENT_ENCRYPTION_KEY', () => {
      process.env = {
        ...saved,
        NODE_ENV: 'production',
        DOCUMENT_STORAGE_DIR: join(tmpdir(), 'doc-crypto-prod'),
        AWS_ACCESS_KEY_ID: '',
        AWS_SECRET_ACCESS_KEY: '',
        AWS_S3_BUCKET_NAME: '',
      };
      delete process.env.DOCUMENT_ENCRYPTION_KEY;
      expect(() => new DocumentStorageService().storage()).toThrow(
        'DOCUMENT_ENCRYPTION_KEY',
      );
    });
  });
});
