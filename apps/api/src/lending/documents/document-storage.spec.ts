import {
  DocumentStorageService,
  libraryKey,
  ownLibraryKey,
  safeFileName,
  sniffMatches,
} from './document-storage';
import { addYears, checklistStatus, retentionYearsFor } from './document-rules';

describe('customer document storage (DOC-2, DOC-8)', () => {
  it('keys are tenant-prefixed and never carry the client file name', () => {
    const key = libraryKey('tA', 'b1', 'd1', 3);
    expect(key).toMatch(
      /^tenants\/tA\/customers\/b1\/documents\/d1\/v3-[0-9a-f-]{36}$/,
    );
    expect(ownLibraryKey('tA', key)).toBe(key);
  });

  it.each([
    ['another tenant', 'tenants/tB/customers/b1/documents/d1/v1-x'],
    ['a climb out of the prefix', 'tenants/tA/customers/../../tB/customers/x'],
    ['an empty segment', 'tenants/tA/customers//x'],
    ['outside the customer area', 'tenants/tA/loans/L1/x'],
    ['unsafe characters', 'tenants/tA/customers/b1/x y'],
  ])('refuses %s', (_, key) => {
    expect(ownLibraryKey('tA', key)).toBeNull();
  });

  it('display names are sanitised', () => {
    expect(safeFileName('../../etc/passwd')).toBe('_.._etc_passwd');
    expect(safeFileName('')).toBe('document');
  });

  it('declared types must match the bytes', () => {
    expect(sniffMatches('application/pdf', Buffer.from('%PDF-1.7'))).toBe(true);
    expect(sniffMatches('image/png', Buffer.from('%PDF-1.7'))).toBe(false);
    expect(
      sniffMatches('image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])),
    ).toBe(true);
    expect(sniffMatches('application/zip', Buffer.from('PK'))).toBe(false);
  });

  describe('signed links', () => {
    const prev = process.env.JWT_ACCESS_SECRET;
    beforeAll(() => {
      process.env.JWT_ACCESS_SECRET =
        'unit-test-secret-of-sufficient-length-0123';
    });
    afterAll(() => {
      process.env.JWT_ACCESS_SECRET = prev;
    });
    const svc = new DocumentStorageService();
    const now = 1_800_000_000_000;
    const claims = {
      tenantId: 'tA',
      versionId: 'v1',
      actorId: 'u1',
      expiresAt: now + 60_000,
    };

    it('round-trips until it expires', () => {
      const t = svc.signLink(claims);
      expect(svc.verifyLink(t, now)).toEqual({
        tenantId: 'tA',
        versionId: 'v1',
        actorId: 'u1',
      });
      expect(svc.verifyLink(t, now + 61_000)).toBeNull();
    });

    it('refuses a token whose claims were changed', () => {
      const [, mac] = svc.signLink(claims).split('.');
      const body = Buffer.from(
        JSON.stringify({ t: 'tB', v: 'v1', a: 'u1', e: now + 60_000 }),
      ).toString('base64url');
      expect(svc.verifyLink(`${body}.${mac}`, now)).toBeNull();
      expect(svc.verifyLink('garbage', now)).toBeNull();
    });

    it('a link lives 30 s to 15 min', () => {
      process.env.DOCUMENT_LINK_TTL_SECONDS = '99999';
      expect(svc.linkTtlSeconds()).toBe(900);
      process.env.DOCUMENT_LINK_TTL_SECONDS = '1';
      expect(svc.linkTtlSeconds()).toBe(30);
      delete process.env.DOCUMENT_LINK_TTL_SECONDS;
      expect(svc.linkTtlSeconds()).toBe(300);
    });
  });
});

describe('document rules (DOC-3, DOC-7)', () => {
  it('a type rule beats a category rule, which beats the default', () => {
    const rules = [
      { scope: 'CATEGORY', code: 'KYC', retentionYears: 8 },
      { scope: 'TYPE', code: 'PASSPORT', retentionYears: 10 },
    ];
    expect(
      retentionYearsFor({ category: 'KYC', typeCode: 'PASSPORT' }, rules).years,
    ).toBe(10);
    expect(
      retentionYearsFor({ category: 'KYC', typeCode: 'SELFIE' }, rules).years,
    ).toBe(8);
    expect(
      retentionYearsFor({ category: 'LOAN', typeCode: 'X' }, rules),
    ).toEqual({
      years: 7,
      source: 'default',
    });
  });

  it('adds whole years, rolling 29 February to 28 February', () => {
    expect(addYears('2024-02-29', 1)).toBe('2025-02-28');
    expect(addYears('2026-01-05', 5)).toBe('2031-01-05');
  });

  it('checklist status from the library', () => {
    const d = (reviewStatus: string, expiresOn?: string) => ({
      reviewStatus,
      expiresOn: expiresOn ? new Date(`${expiresOn}T00:00:00Z`) : null,
    });
    const today = '2026-01-05';
    expect(checklistStatus([], today, false)).toBe('MISSING');
    expect(checklistStatus([], today, true)).toBe('REQUESTED');
    expect(checklistStatus([d('PENDING_REVIEW')], today, false)).toBe(
      'PENDING_REVIEW',
    );
    expect(checklistStatus([d('REJECTED'), d('ACCEPTED')], today, false)).toBe(
      'ACCEPTED',
    );
    expect(checklistStatus([d('REJECTED')], today, false)).toBe('REJECTED');
    expect(checklistStatus([d('ACCEPTED', '2026-01-04')], today, false)).toBe(
      'EXPIRED',
    );
    expect(checklistStatus([d('ACCEPTED', '2026-01-05')], today, false)).toBe(
      'ACCEPTED',
    );
  });
});
