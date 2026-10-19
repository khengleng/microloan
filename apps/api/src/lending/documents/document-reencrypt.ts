import { chmod, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { encryptDocument, isEncryptedDocument } from './document-crypto';

export interface ReencryptResult {
  /** Files encrypted by this run. */
  encrypted: number;
  /** Files already encrypted, left as they were. */
  skipped: number;
  /** Files outside the library's key space, never touched. */
  ignored: number;
}

/** The storage key of a file under the document root, as LocalLibraryStorage uses it. */
function storageKeyOf(root: string, file: string): string {
  return relative(root, file).split(sep).join('/');
}

async function* files(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (entry.isFile()) yield full;
  }
}

/**
 * Encrypt, in place, every plaintext customer document under `root`
 * (DECISIONS D-137). Idempotent: files that already carry the encryption
 * header are skipped, so the run can be repeated or resumed after an
 * interruption. Each file is written to a temporary sibling and renamed over
 * the original, so a crash never leaves a half-written document. Only keys
 * the library itself writes (`tenants/…/customers/…`) are touched.
 */
export async function encryptDocumentsAtRest(
  root: string,
  kek: Buffer,
  opts: { dryRun?: boolean; log?: (line: string) => void } = {},
): Promise<ReencryptResult> {
  const result: ReencryptResult = { encrypted: 0, skipped: 0, ignored: 0 };
  for await (const file of files(root)) {
    const key = storageKeyOf(root, file);
    if (!/^tenants\/[^/]+\/customers\//.test(key) || key.endsWith('.enc-tmp')) {
      result.ignored++;
      continue;
    }
    const body = await readFile(file);
    if (isEncryptedDocument(body)) {
      result.skipped++;
      continue;
    }
    if (!opts.dryRun) {
      const tmp = `${file}.enc-tmp`;
      await writeFile(tmp, encryptDocument(body, key, kek), {
        mode: 0o600,
      });
      await rename(tmp, file);
      await chmod(file, 0o600);
    }
    opts.log?.(`${opts.dryRun ? 'would encrypt' : 'encrypted'} ${key}`);
    result.encrypted++;
  }
  return result;
}
