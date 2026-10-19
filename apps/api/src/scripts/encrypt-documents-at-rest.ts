/**
 * One-off, idempotent: encrypt customer documents already stored in the clear
 * on the local-disk document store (DOCUMENT_STORAGE_DIR). Files that are
 * already encrypted are skipped, so it is safe to re-run.
 *
 * Run with the SAME DOCUMENT_ENCRYPTION_KEY the API uses, on the machine (or
 * container) that mounts the volume:
 *
 *   DOCUMENT_STORAGE_DIR=/data/documents pnpm encrypt:documents [--dry-run]
 *
 * The API reads both encrypted and legacy plaintext files, so it can keep
 * serving while this runs.
 */
import { documentKekFromEnv } from '../lending/documents/document-crypto';
import { encryptDocumentsAtRest } from '../lending/documents/document-reencrypt';

async function main() {
  const root = process.env.DOCUMENT_STORAGE_DIR?.trim();
  if (!root) throw new Error('Set DOCUMENT_STORAGE_DIR to the document volume.');
  const kek = documentKekFromEnv();
  if (!kek) throw new Error('Set DOCUMENT_ENCRYPTION_KEY (the key the API uses).');
  const dryRun = process.argv.includes('--dry-run');
  const r = await encryptDocumentsAtRest(root, kek, {
    dryRun,
    // eslint-disable-next-line no-console
    log: (line) => console.log(`[encrypt-documents] ${line}`),
  });
  // eslint-disable-next-line no-console
  console.log(
    `[encrypt-documents] ${dryRun ? 'dry run: ' : ''}${r.encrypted} encrypted, ${r.skipped} already encrypted, ${r.ignored} ignored.`,
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`[encrypt-documents] failed: ${(err as Error).message}`);
  process.exit(1);
});
