/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * Customer document library (DOC-1..10): one library per customer, files in
 * object storage, checklist, review by another user, versions, expiry,
 * retention and legal hold, audited access, generated documents and the
 * borrower portal's requested documents.
 */
import { createHmac } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import {
  Fixture,
  TEST_DB,
  bootstrap,
  borrower,
  expectOk,
  grant,
  key,
} from './harness';
import {
  PDF,
  activeProduct,
  originateAndDisburse,
  standardRoles,
} from './setup';

const d = TEST_DB ? describe : describe.skip;

const pdf = (text: string) =>
  Buffer.from(`%PDF-1.4 ${text}`).toString('base64');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('png body'),
]);

d('Customer documents (integration)', () => {
  let f: Fixture;
  let productId: string;

  const borrowerToken = (borrowerId: string, tenantId: string) =>
    new JwtService({
      secret: createHmac('sha256', process.env.JWT_ACCESS_SECRET!)
        .update('borrower-portal-v1')
        .digest('hex'),
    }).sign(
      { sub: borrowerId, typ: 'borrower', tenantId },
      { expiresIn: '1h' },
    );

  const portal = (token: string) => ({
    get: (url: string) =>
      f.http().get(`/v1${url}`).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: unknown) =>
      f
        .http()
        .post(`/v1${url}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body as object),
  });

  const upload = (
    user: string,
    borrowerId: string,
    over: Record<string, unknown> = {},
  ) =>
    f.as(user).post(`/lending/customers/${borrowerId}/documents`, {
      category: 'KYC',
      typeCode: 'NATIONAL_ID',
      title: 'National ID card',
      fileName: '../../etc/passwd Sok Dara ID.pdf',
      mimeType: 'application/pdf',
      contentBase64: pdf('national id'),
      ...over,
    });

  const version = (id: string) =>
    f.system(() =>
      f.prisma.customerDocumentVersion.findMany({
        where: { documentId: id },
        orderBy: { version: 'asc' },
      }),
    );

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    // Compliance holds document.manage (legal hold, retention, deletion).
    await grant(f, f.t1, 'nobody', 'RISK_COMPLIANCE');
    ({ productId } = await activeProduct(f, 'PERSONAL_INSTALMENT', 'DOC-PL'));
  }, 120_000);
  afterAll(async () => f?.app.close());

  it('DOC-1/DOC-2: an upload is stored outside the database under a tenant-prefixed key, with checksum, size and type checks', async () => {
    const b = await borrower(f, f.t1, f.b1);
    const doc = expectOk(await upload('ro', b.id, { expiresOn: '2030-01-01' }));
    expect(doc.reviewStatus).toBe('PENDING_REVIEW');
    const [v] = await version(doc.id);
    const bytes = Buffer.from(pdf('national id'), 'base64');
    expect(
      v.storageKey.startsWith(
        `tenants/${f.t1}/customers/${b.id}/documents/${doc.id}/v1-`,
      ),
    ).toBe(true);
    expect(v.storageKey).not.toMatch(/passwd|Sok|Dara|\.pdf/);
    expect(v.fileName).not.toContain('/');
    expect(v.sizeBytes).toBe(bytes.length);
    expect(v.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(['LOCAL_DISK', 'S3']).toContain(v.storageProvider);

    // Unsupported types and content that does not match its declared type.
    const exe = await upload('ro', b.id, {
      mimeType: 'application/x-msdownload',
    });
    expect(exe.status).toBe(400);
    const fake = await upload('ro', b.id, {
      mimeType: 'image/png',
      contentBase64: pdf('not a png'),
    });
    expect(fake.status).toBe(400);
    expectOk(
      await upload('ro', b.id, {
        typeCode: 'SELFIE',
        mimeType: 'image/png',
        contentBase64: PNG.toString('base64'),
      }),
    );

    const lib = expectOk(
      await f.as('ro').get(`/lending/customers/${b.id}/documents`),
    );
    expect(lib.documents.map((x: any) => x.typeCode).sort()).toEqual([
      'NATIONAL_ID',
      'SELFIE',
    ]);
  });

  it('DOC-1: application documents, the key facts statement (DOC-9) and older stores land in one customer library', async () => {
    const { borrowerId, applicationId, loanId } = await originateAndDisburse(
      f,
      productId,
      {
        principal: '3000',
        numberOfInstalments: 6,
        disbursementDate: '2026-01-05',
      },
    );
    // Older stores: an e-KYC image held inline and a legacy loan-vault file.
    const legacy = await f.system(async () => {
      const kyc = await f.prisma.kycDocument.create({
        data: {
          tenantId: f.t1,
          borrowerId,
          type: 'NATIONAL_ID_FRONT',
          content: `data:image/png;base64,${PNG.toString('base64')}`,
          mimeType: 'image/png',
        },
      });
      const product = await f.prisma.loanProduct.create({
        data: { tenantId: f.t1, name: 'Old daily', interestMethod: 'FLAT' },
      });
      const loan = await f.prisma.loan.create({
        data: {
          tenantId: f.t1,
          borrowerId,
          productId: product.id,
          branchId: f.b1,
          principal: '100',
          annualInterestRate: '12',
          termMonths: 3,
          interestMethod: 'FLAT',
          startDate: new Date(Date.UTC(2025, 5, 1)),
        },
      });
      const vault = await f.prisma.document.create({
        data: {
          tenantId: f.t1,
          loanId: loan.id,
          name: 'old-contract.pdf',
          content: `data:application/pdf;base64,${pdf('old contract')}`,
          type: 'application/pdf',
        },
      });
      return { kyc, vault };
    });

    const lib = expectOk(
      await f.as('ro').get(`/lending/customers/${borrowerId}/documents`),
    );
    const by = (t: string) => lib.documents.find((x: any) => x.typeCode === t);
    const idDoc = by('ID_DOCUMENT');
    expect(idDoc).toMatchObject({
      category: 'APPLICATION',
      applicationId,
      origin: 'STAFF',
    });
    // D-123: the pre-contract statement, in English and Khmer, accepted
    // before booking and linked to the loan it was booked on.
    const statements = lib.documents.filter(
      (x: any) => x.typeCode === 'KEY_FACTS',
    );
    expect(statements).toHaveLength(2);
    const keyFacts = statements.find((x: any) => x.title.endsWith('(EN)'));
    const keyFactsKm = statements.find((x: any) => x.title.endsWith('(KM)'));
    expect(keyFactsKm).toMatchObject({ loanAccountId: loanId });
    expect(keyFacts).toMatchObject({
      category: 'GENERATED',
      origin: 'GENERATED',
      reviewStatus: 'NOT_REQUIRED',
      loanAccountId: loanId,
      customerVisible: true,
    });
    expect(by('NATIONAL_ID_FRONT')).toMatchObject({
      origin: 'LEGACY',
      legacySource: 'KYC_DOCUMENT',
    });
    expect(by('LOAN_DOCUMENT')).toMatchObject({
      origin: 'LEGACY',
      legacySource: 'LOAN_DOCUMENT',
    });
    // Linked once: opening the library again creates nothing new.
    const again = expectOk(
      await f.as('ro').get(`/lending/customers/${borrowerId}/documents`),
    );
    expect(again.documents).toHaveLength(lib.documents.length);
    // The application document is the same stored object as its ApplicationDocument row.
    const appDoc = await f.system(() =>
      f.prisma.applicationDocument.findFirst({ where: { applicationId } }),
    );
    const [idV] = await version(idDoc.id);
    expect(appDoc.storageKey).toBe(idV.storageKey);

    // Older content is still readable through the library, and untouched.
    const link = expectOk(
      await f
        .as('ro')
        .post(`/lending/documents/${by('NATIONAL_ID_FRONT').id}/link`, {}),
    );
    const got = await f.http().get(`/v1${link.url}`).buffer(true);
    expect(got.status).toBe(200);
    expect(Buffer.compare(got.body, PNG)).toBe(0);
    const kyc = await f.system(() =>
      f.prisma.kycDocument.findFirst({ where: { id: legacy.kyc.id } }),
    );
    expect(kyc.content).toContain('base64');

    // The key facts statement is a real document.
    const kf = expectOk(
      await f.as('ro').post(`/lending/documents/${keyFacts.id}/link`, {}),
    );
    const html = await f.http().get(`/v1${kf.url}`);
    expect(html.status).toBe(200);
    expect(html.headers['content-type']).toContain('text/html');
    expect(html.text).toContain('Key facts statement');
    const km = expectOk(
      await f.as('ro').post(`/lending/documents/${keyFactsKm.id}/link`, {}),
    );
    const kmHtml = await f.http().get(`/v1${km.url}`);
    expect(kmHtml.text).toContain('lang="km"');
    expect(kmHtml.text).toContain('សេចក្តីថ្លែងការណ៍ព័ត៌មានសំខាន់ៗ');
  });

  it('DOC-5: replacing a document creates a new version and keeps the history; stored versions are immutable', async () => {
    const b = await borrower(f, f.t1, f.b1);
    const doc = expectOk(await upload('ro', b.id));
    const v2 = expectOk(
      await f.as('ro').post(`/lending/documents/${doc.id}/versions`, {
        fileName: 'id-renewed.pdf',
        mimeType: 'application/pdf',
        contentBase64: pdf('renewed id'),
        expiresOn: '2031-06-30',
        note: 'Renewed card',
      }),
    );
    expect(v2.currentVersion).toBe(2);
    const view = expectOk(await f.as('ro').get(`/lending/documents/${doc.id}`));
    expect(view.versions.map((v: any) => v.version)).toEqual([2, 1]);
    expect(view.expiresOn).toBe('2031-06-30');
    const [first, second] = await version(doc.id);
    expect(first.sha256).not.toBe(second.sha256);
    expect(first.storageKey).not.toBe(second.storageKey);
    // Both versions remain downloadable.
    const old = expectOk(
      await f
        .as('ro')
        .post(`/lending/documents/${doc.id}/link`, { version: 1 }),
    );
    const res = await f.http().get(`/v1${old.url}`).buffer(true);
    expect(res.body.toString()).toContain('national id');
    // The database refuses to rewrite a stored version.
    await expect(
      f.system(() =>
        f.prisma.customerDocumentVersion.update({
          where: { id: first.id },
          data: { sha256: '0'.repeat(64) },
        }),
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      f.system(() =>
        f.prisma.customerDocument.delete({ where: { id: doc.id } }),
      ),
    ).rejects.toThrow(/never deleted/);
  });

  it('DOC-4: review by another user — the uploader cannot review, a rejection needs a reason, and a decided version is final', async () => {
    const b = await borrower(f, f.t1, f.b1);
    const doc = expectOk(await upload('opsMaker', b.id));
    const own = await f
      .as('opsMaker')
      .post(`/lending/documents/${doc.id}/review`, { decision: 'ACCEPT' });
    expect(own.status).toBe(403);
    expect(JSON.stringify(own.body)).toContain('You cannot approve');
    const noReason = await f
      .as('analyst')
      .post(`/lending/documents/${doc.id}/review`, { decision: 'REJECT' });
    expect(noReason.status).toBe(400);
    const rejected = expectOk(
      await f.as('analyst').post(`/lending/documents/${doc.id}/review`, {
        decision: 'REJECT',
        reason: 'Photo is blurred',
      }),
    );
    expect(rejected.reviewStatus).toBe('REJECTED');
    const twice = await f
      .as('opsChecker')
      .post(`/lending/documents/${doc.id}/review`, { decision: 'ACCEPT' });
    expect(twice.status).toBe(409);
    // A new version goes back to review; this time another reviewer accepts.
    expectOk(
      await f.as('opsMaker').post(`/lending/documents/${doc.id}/versions`, {
        fileName: 'clear.pdf',
        mimeType: 'application/pdf',
        contentBase64: pdf('clear photo'),
      }),
    );
    const queue = expectOk(
      await f.as('opsChecker').get('/lending/document-review-queue'),
    );
    expect(queue.documents.find((x: any) => x.id === doc.id)).toMatchObject({
      version: 2,
      ownUpload: false,
    });
    const mine = expectOk(
      await f.as('opsMaker').get('/lending/document-review-queue'),
    );
    expect(mine.documents.find((x: any) => x.id === doc.id)).toMatchObject({
      ownUpload: true,
    });
    expectOk(
      await f
        .as('opsChecker')
        .post(`/lending/documents/${doc.id}/review`, { decision: 'ACCEPT' }),
    );
    const view = expectOk(await f.as('ro').get(`/lending/documents/${doc.id}`));
    expect(view.reviewStatus).toBe('ACCEPTED');
    expect(
      view.versions.map((v: any) => [v.version, v.reviewStatus, v.reviewedBy]),
    ).toEqual([
      [2, 'ACCEPTED', f.users.opsChecker.id],
      [1, 'REJECTED', f.users.analyst.id],
    ]);
    expect(view.versions[1].rejectionReason).toBe('Photo is blurred');
  });

  it('DOC-3: the application checklist reads the library, and a rejected required document blocks submission', async () => {
    const b = await borrower(f, f.t1, f.b1);
    const app = expectOk(
      await f.as('ro').post('/lending/applications', {
        borrowerId: b.id,
        productId,
        terms: {
          principal: '2000',
          numberOfInstalments: 6,
          disbursementDate: '2026-01-05',
        },
      }),
    );
    let list = expectOk(
      await f
        .as('ro')
        .get(`/lending/applications/${app.id}/document-checklist`),
    );
    expect(list.items).toEqual([
      expect.objectContaining({
        code: 'ID_DOCUMENT',
        status: 'MISSING',
        present: false,
        mandatory: true,
      }),
    ]);
    const missing = await f
      .as('ro')
      .post(`/lending/applications/${app.id}/submit`);
    expect(missing.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(missing.body)).toContain(
      'Missing document: Identity document',
    );

    expectOk(
      await f.as('ro').post(`/lending/applications/${app.id}/documents`, {
        code: 'ID_DOCUMENT',
        fileName: 'id.pdf',
        mimeType: 'application/pdf',
        contentBase64: PDF,
      }),
    );
    list = expectOk(
      await f
        .as('ro')
        .get(`/lending/applications/${app.id}/document-checklist`),
    );
    expect(list.items[0]).toMatchObject({
      status: 'PENDING_REVIEW',
      present: true,
    });
    const docId = list.items[0].documentIds[0];
    expectOk(
      await f.as('analyst').post(`/lending/documents/${docId}/review`, {
        decision: 'REJECT',
        reason: 'Document belongs to someone else',
      }),
    );
    list = expectOk(
      await f.as('ro').get(`/lending/customers/${b.id}/document-checklist`),
    );
    expect(list.applications[0].items[0]).toMatchObject({
      status: 'REJECTED',
      present: false,
    });
    const blocked = await f
      .as('ro')
      .post(`/lending/applications/${app.id}/submit`);
    expect(blocked.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(blocked.body)).toContain(
      'Identity document is rejected',
    );

    // A replacement that another user accepts clears the item.
    expectOk(
      await f.as('ro').post(`/lending/documents/${docId}/versions`, {
        fileName: 'id2.pdf',
        mimeType: 'application/pdf',
        contentBase64: pdf('right person'),
      }),
    );
    expectOk(
      await f
        .as('analyst')
        .post(`/lending/documents/${docId}/review`, { decision: 'ACCEPT' }),
    );
    list = expectOk(
      await f
        .as('ro')
        .get(`/lending/applications/${app.id}/document-checklist`),
    );
    expect(list.items[0]).toMatchObject({ status: 'ACCEPTED', present: true });
    expectOk(await f.as('ro').post(`/lending/applications/${app.id}/submit`));
  });

  it('DOC-6: expiry flags expired documents and raises one reminder before expiry (end-of-day job, idempotent)', async () => {
    // Business date of the fixture is 2026-01-05.
    const b = await borrower(f, f.t1, f.b1);
    const soon = expectOk(
      await upload('ro', b.id, {
        typeCode: 'PASSPORT',
        expiresOn: '2026-01-20',
      }),
    );
    const gone = expectOk(
      await upload('ro', b.id, {
        typeCode: 'DRIVING_LICENCE',
        expiresOn: '2026-01-01',
      }),
    );
    const later = expectOk(
      await upload('ro', b.id, {
        typeCode: 'WORK_PERMIT',
        expiresOn: '2027-06-01',
      }),
    );
    const notAllowed = await f.as('ro').post('/lending/document-expiries/run');
    expect(notAllowed.status).toBe(403);
    const run = expectOk(
      await f.as('nobody').post('/lending/document-expiries/run'),
    );
    expect(run.expired).toBeGreaterThanOrEqual(1);
    expect(run.reminded).toBeGreaterThanOrEqual(1);

    const state = async (id: string) =>
      expectOk(await f.as('ro').get(`/lending/documents/${id}`));
    expect(await state(gone.id)).toMatchObject({
      expiryState: 'EXPIRED',
      expired: true,
    });
    expect(await state(soon.id)).toMatchObject({
      expiryState: 'REMINDED',
      daysToExpiry: 15,
      expired: false,
    });
    expect(await state(later.id)).toMatchObject({ expiryState: 'NONE' });

    const notices = async () =>
      f.system(() =>
        f.prisma.outboxMessage.findMany({
          where: {
            tenantId: f.t1,
            topic: { in: ['document.expired', 'document.expiry_reminder'] },
          },
        }),
      );
    const mine = (rows: any[]) =>
      rows.filter((r) =>
        [soon.id, gone.id, later.id].includes(r.payload.documentId),
      );
    const first = mine(await notices());
    expect(
      first.map((r: any) => [r.topic, r.payload.documentId]).sort(),
    ).toEqual(
      [
        ['document.expired', gone.id],
        ['document.expiry_reminder', soon.id],
      ].sort(),
    );
    // Running again raises nothing new.
    expectOk(await f.as('nobody').post('/lending/document-expiries/run'));
    expect(mine(await notices())).toHaveLength(2);

    const list = expectOk(
      await f.as('ro').get('/lending/document-expiries?withinDays=30'),
    );
    const ids = list.documents.map((x: any) => x.id);
    expect(ids).toEqual(expect.arrayContaining([soon.id, gone.id]));
    expect(ids).not.toContain(later.id);

    // A renewed card (new version with a new expiry) clears the flag.
    expectOk(
      await f.as('ro').post(`/lending/documents/${gone.id}/versions`, {
        fileName: 'licence.pdf',
        mimeType: 'application/pdf',
        contentBase64: pdf('renewed licence'),
        expiresOn: '2031-01-01',
      }),
    );
    expect(await state(gone.id)).toMatchObject({
      expiryState: 'NONE',
      expired: false,
    });
  });

  it('DOC-7: legal hold blocks deletion; deletion only after retention, soft-deleted, files removed and audited', async () => {
    const b = await borrower(f, f.t1, f.b1);
    const held = expectOk(
      await upload('ro', b.id, {
        typeCode: 'BANK_STATEMENT',
        category: 'OTHER',
      }),
    );
    const free = expectOk(
      await upload('ro', b.id, { typeCode: 'PAYSLIP', category: 'OTHER' }),
    );
    // Retention: OTHER documents kept 2 years in this tenant.
    expect(
      (
        await f.as('ro').put('/lending/document-retention', {
          rules: [{ scope: 'CATEGORY', code: 'OTHER', retentionYears: 2 }],
        })
      ).status,
    ).toBe(403);
    expectOk(
      await f.as('nobody').put('/lending/document-retention', {
        rules: [{ scope: 'CATEGORY', code: 'OTHER', retentionYears: 2 }],
      }),
    );
    const early = await f
      .as('nobody')
      .post(`/lending/documents/${free.id}/delete`, {
        reason: 'Customer asked',
      });
    expect(early.status).toBe(409);
    expect(early.body.code ?? early.body.message?.code).toBeDefined();

    expectOk(
      await f.as('nobody').post(`/lending/documents/${held.id}/legal-hold`, {
        hold: true,
        reason: 'Court order 2026/17',
      }),
    );
    // Move this tenant's business date past the retention period.
    await f.system(() =>
      f.prisma.tenantBusinessDate.update({
        where: { tenantId: f.t1 },
        data: { businessDate: new Date(Date.UTC(2031, 0, 5)) },
      }),
    );
    try {
      const onHold = await f
        .as('nobody')
        .post(`/lending/documents/${held.id}/delete`, {
          reason: 'Retention passed',
        });
      expect(onHold.status).toBe(409);
      expect(JSON.stringify(onHold.body)).toContain('legal hold');
      const noRole = await f
        .as('ro')
        .post(`/lending/documents/${free.id}/delete`, {
          reason: 'Retention passed',
        });
      expect(noRole.status).toBe(403);

      const [v] = await version(free.id);
      const link = expectOk(
        await f.as('ro').post(`/lending/documents/${free.id}/link`, {}),
      );
      const del = expectOk(
        await f.as('nobody').post(`/lending/documents/${free.id}/delete`, {
          reason: 'Retention passed',
        }),
      );
      expect(del).toMatchObject({
        status: 'DELETED',
        storageDeleted: 1,
        storageFailed: 0,
      });
      const row = await f.system(() =>
        f.prisma.customerDocument.findFirst({ where: { id: free.id } }),
      );
      expect(row).toMatchObject({
        status: 'DELETED',
        deletedBy: f.users.nobody.id,
        deletionReason: 'Retention passed',
      });
      const [after] = await version(free.id);
      expect(after.purgedAt).not.toBeNull();
      expect(after.storageKey).toBe(v.storageKey);
      // An earlier link no longer serves the file; a new link is refused.
      expect((await f.http().get(`/v1${link.url}`)).status).toBe(404);
      expect(
        (await f.as('ro').post(`/lending/documents/${free.id}/link`, {}))
          .status,
      ).toBe(410);
      const audit = await f.system(() =>
        f.prisma.auditEvent.findMany({
          where: {
            tenantId: f.t1,
            resourceId: { in: [free.id, held.id] },
            action: 'document.delete',
          },
        }),
      );
      expect(audit.map((a: any) => [a.resourceId, a.outcome]).sort()).toEqual(
        expect.arrayContaining([
          [free.id, 'SUCCESS'],
          [held.id, 'DENY'],
        ]),
      );
      // Released from hold, it can go too.
      expectOk(
        await f.as('nobody').post(`/lending/documents/${held.id}/legal-hold`, {
          hold: false,
          reason: 'Order lifted',
        }),
      );
      expectOk(
        await f.as('nobody').post(`/lending/documents/${held.id}/delete`, {
          reason: 'Retention passed',
        }),
      );
    } finally {
      await f.system(() =>
        f.prisma.tenantBusinessDate.update({
          where: { tenantId: f.t1 },
          data: { businessDate: new Date(Date.UTC(2026, 0, 5)) },
        }),
      );
    }
  });

  it('DOC-8: access is branch-scoped and audited; links are short-lived and bound to one tenant and version', async () => {
    const b = await borrower(f, f.t1, f.b1);
    const doc = expectOk(await upload('ro', b.id));
    // Another branch's officer cannot see this customer's library or document.
    expect(
      (await f.as('ro2').get(`/lending/customers/${b.id}/documents`)).status,
    ).toBe(403);
    expect((await f.as('ro2').get(`/lending/documents/${doc.id}`)).status).toBe(
      403,
    );
    expect(
      (await f.as('ro2').post(`/lending/documents/${doc.id}/link`, {})).status,
    ).toBe(403);
    expect(
      (await f.as('admin1').get(`/lending/documents/${doc.id}`)).status,
    ).toBe(403);

    const link = expectOk(
      await f.as('ro').post(`/lending/documents/${doc.id}/link`, {}),
    );
    expect(link.external).toBe(false);
    const ttl = (Date.parse(link.expiresAt) - Date.now()) / 1000;
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(900);
    const ok = await f.http().get(`/v1${link.url}`).buffer(true);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-disposition']).toContain('attachment');
    expect(ok.headers['x-content-type-options']).toBe('nosniff');
    // A tampered token is refused.
    const token = link.url.split('/').pop() as string;
    const [body, mac] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body, 'base64url').toString()),
        e: Date.now() + 86_400_000,
      }),
    ).toString('base64url');
    expect(
      (await f.http().get(`/v1/lending/document-links/${forged}.${mac}`))
        .status,
    ).toBe(404);

    expectOk(await f.as('ro').get(`/lending/documents/${doc.id}`));
    const trail = await f.system(() =>
      f.prisma.auditEvent.findMany({
        where: {
          tenantId: f.t1,
          resourceType: 'CustomerDocument',
          resourceId: doc.id,
        },
      }),
    );
    const actions = trail.map((a: any) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'document.upload',
        'document.download_link',
        'document.download',
        'document.view',
      ]),
    );
    const denied = await f.system(() =>
      f.prisma.auditEvent.findMany({
        where: {
          tenantId: f.t1,
          actorId: f.users.ro2.id,
          action: 'document.read',
          outcome: 'DENY',
        },
      }),
    );
    expect(denied.length).toBeGreaterThan(0);
  });

  it('DOC-8: another tenant cannot read, review, link or upload against this tenant’s documents', async () => {
    const b = await borrower(f, f.t1, f.b1);
    const doc = expectOk(await upload('ro', b.id));
    await grant(f, f.t2, 't2admin', 'RISK_COMPLIANCE');
    await grant(f, f.t2, 't2admin', 'CREDIT_ANALYST');
    for (const res of [
      await f.as('t2admin').get(`/lending/customers/${b.id}/documents`),
      await f.as('t2admin').get(`/lending/documents/${doc.id}`),
      await f.as('t2admin').post(`/lending/documents/${doc.id}/link`, {}),
      await f
        .as('t2admin')
        .post(`/lending/documents/${doc.id}/review`, { decision: 'ACCEPT' }),
      await f.as('t2admin').post(`/lending/documents/${doc.id}/legal-hold`, {
        hold: true,
        reason: 'cross tenant',
      }),
      await upload('t2admin', b.id),
    ]) {
      expect([403, 404]).toContain(res.status);
      expect(res.text).not.toContain(doc.id);
    }
    const t2Borrower = await borrower(f, f.t2, f.b3);
    const t2Portal = portal(borrowerToken(t2Borrower.id, f.t2));
    expect(
      (await t2Portal.get(`/borrower/my-documents/${doc.id}/download`)).status,
    ).toBe(404);
    const unchanged = await f.system(() =>
      f.prisma.customerDocument.findFirst({ where: { id: doc.id } }),
    );
    expect(unchanged).toMatchObject({
      reviewStatus: 'PENDING_REVIEW',
      legalHold: false,
    });
  });

  it('DOC-9: a settlement quote letter and the closure letter are filed in the library', async () => {
    const { borrowerId, loanId } = await originateAndDisburse(f, productId, {
      principal: '1200',
      numberOfInstalments: 6,
      disbursementDate: '2026-01-05',
    });
    const issued = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/loans/${loanId}/settlement-quote-letter`, {}),
    );
    expect(issued.documentId).toBeDefined();
    const payable = issued.quote.payable as string;
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${loanId}/settlement`,
          { amount: payable },
          key('settle'),
        ),
    );
    const lib = expectOk(
      await f.as('ro').get(`/lending/customers/${borrowerId}/documents`),
    );
    const types = lib.documents.map((x: any) => x.typeCode);
    expect(types).toEqual(
      expect.arrayContaining([
        'KEY_FACTS',
        'SETTLEMENT_QUOTE',
        'CLOSURE_LETTER',
      ]),
    );
    const quote = lib.documents.find(
      (x: any) => x.typeCode === 'SETTLEMENT_QUOTE',
    );
    const link = expectOk(
      await f.as('ro').post(`/lending/documents/${quote.id}/link`, {}),
    );
    const html = await f.http().get(`/v1${link.url}`);
    expect(html.text).toContain(payable);
  });

  it('DOC-10: the borrower sees documents requested from them, uploads against a request, and re-uploads after a rejection', async () => {
    const b = await borrower(f, f.t1, f.b1);
    const me = portal(borrowerToken(b.id, f.t1));
    const req = expectOk(
      await f.as('ro').post(`/lending/customers/${b.id}/document-requests`, {
        category: 'KYC',
        typeCode: 'PROOF_OF_ADDRESS',
        label: 'Proof of address',
        message: 'A utility bill from the last 3 months',
        dueOn: '2026-02-01',
      }),
    );
    const dup = await f
      .as('ro')
      .post(`/lending/customers/${b.id}/document-requests`, {
        category: 'KYC',
        typeCode: 'PROOF_OF_ADDRESS',
        label: 'Proof of address',
      });
    expect(dup.status).toBe(409);
    const notice = await f.system(() =>
      f.prisma.outboxMessage.findFirst({
        where: { tenantId: f.t1, topic: 'document.requested' },
      }),
    );
    expect(notice).toBeTruthy();

    let open = expectOk(await me.get('/borrower/document-requests'));
    expect(open.requests).toEqual([
      expect.objectContaining({
        id: req.id,
        status: 'OPEN',
        label: 'Proof of address',
        dueOn: '2026-02-01',
      }),
    ]);
    // Another borrower cannot upload against it.
    const other = await borrower(f, f.t1, f.b1);
    const stranger = await portal(borrowerToken(other.id, f.t1)).post(
      `/borrower/document-requests/${req.id}/upload`,
      {
        fileName: 'bill.pdf',
        mimeType: 'application/pdf',
        contentBase64: pdf('bill'),
      },
    );
    expect(stranger.status).toBe(404);

    const up = expectOk(
      await me.post(`/borrower/document-requests/${req.id}/upload`, {
        fileName: 'bill.pdf',
        mimeType: 'application/pdf',
        contentBase64: pdf('electricity bill'),
      }),
    );
    expect(up).toMatchObject({ status: 'SUBMITTED', version: 1 });
    expectOk(
      await f.as('analyst').post(`/lending/documents/${up.documentId}/review`, {
        decision: 'REJECT',
        reason: 'Bill is older than 3 months',
      }),
    );
    open = expectOk(await me.get('/borrower/document-requests'));
    expect(open.requests[0]).toMatchObject({
      status: 'OPEN',
      lastRejection: 'Bill is older than 3 months',
    });

    const again = expectOk(
      await me.post(`/borrower/document-requests/${req.id}/upload`, {
        fileName: 'bill-new.pdf',
        mimeType: 'application/pdf',
        contentBase64: pdf('recent bill'),
      }),
    );
    expect(again).toMatchObject({ documentId: up.documentId, version: 2 });
    expectOk(
      await f.as('analyst').post(`/lending/documents/${up.documentId}/review`, {
        decision: 'ACCEPT',
      }),
    );
    open = expectOk(await me.get('/borrower/document-requests'));
    expect(open.requests[0]).toMatchObject({ status: 'ACCEPTED' });
    const closed = await me.post(
      `/borrower/document-requests/${req.id}/upload`,
      {
        fileName: 'x.pdf',
        mimeType: 'application/pdf',
        contentBase64: pdf('x'),
      },
    );
    expect(closed.status).toBe(409);

    const mine = expectOk(await me.get('/borrower/my-documents'));
    expect(mine.documents).toEqual([
      expect.objectContaining({ id: up.documentId, reviewStatus: 'ACCEPTED' }),
    ]);
    const file = await me
      .get(`/borrower/my-documents/${up.documentId}/download`)
      .buffer(true);
    expect(file.status).toBe(200);
    expect(file.body.toString()).toContain('recent bill');

    // The portal e-KYC upload writes through to the library.
    const kyc = expectOk(
      await me.post('/borrower/kyc/documents', {
        type: 'SELFIE',
        content: `data:image/png;base64,${PNG.toString('base64')}`,
        mimeType: 'image/png',
      }),
    );
    expect(kyc.documentId).toBeDefined();
    const row = await f.system(() =>
      f.prisma.kycDocument.findFirst({ where: { id: kyc.id } }),
    );
    expect(row.content).toBe(`library:${kyc.documentId}`);
    const lib = expectOk(
      await f.as('ro').get(`/lending/customers/${b.id}/documents`),
    );
    expect(lib.documents.filter((x: any) => x.typeCode === 'SELFIE')).toEqual([
      expect.objectContaining({
        id: kyc.documentId,
        category: 'KYC',
        origin: 'PORTAL',
      }),
    ]);
  });
});
