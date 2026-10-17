import { ownStorageKey, storagePrefix } from './document-vault.service';

describe('document storage keys (tenant wall)', () => {
  const doc = (content: string) => ({ tenantId: 'tA', loanId: 'L1', content });

  it('accepts a key under the document’s own tenant and loan', () => {
    const key = `${storagePrefix('tA', 'L1')}123_file.pdf`;
    expect(ownStorageKey(doc(key))).toBe(key);
  });

  it.each([
    ['another tenant', 'tenants/tB/loans/L9/123_file.pdf'],
    ['another loan of the same tenant', 'tenants/tA/loans/L2/123_file.pdf'],
    [
      'a climb out of the prefix',
      'tenants/tA/loans/L1/../../tB/loans/L9/x.pdf',
    ],
    ['an empty segment', 'tenants/tA/loans/L1//x.pdf'],
    ['inline content', 'data:application/pdf;base64,AAAA'],
    ['a bare key', 'secrets/config.json'],
  ])('refuses %s', (_, key) => {
    expect(ownStorageKey(doc(key))).toBeNull();
  });
});
