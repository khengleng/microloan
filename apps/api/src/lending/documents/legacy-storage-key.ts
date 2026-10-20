/**
 * Storage keys of documents filed on the original module's loans (the legacy
 * vault). The vault's own screens are gone (D-153); its files are read
 * through the customer document library, which links them.
 */

/** Every object a legacy document owns lives under its tenant's and loan's prefix. */
export function storagePrefix(tenantId: string, loanId: string): string {
  return `tenants/${tenantId}/loans/${loanId}/`;
}

/**
 * The S3 key a document may use, or null. A key outside the document's own
 * tenant and loan prefix (or one that tries to climb out of it) is never
 * signed or deleted, so a stored value can never reach another tenant's object.
 */
export function ownStorageKey(doc: {
  tenantId: string;
  loanId: string;
  content: string;
}): string | null {
  const key = doc.content;
  if (!key.startsWith(storagePrefix(doc.tenantId, doc.loanId))) return null;
  if (key.includes('..') || key.includes('//')) return null;
  return key;
}
