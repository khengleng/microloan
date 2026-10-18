/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * Customers: identity verification by two people, and placing a customer in
 * a branch.
 *
 * - Verifying a customer's identity is recorded by one person and confirmed by
 *   another; whoever filed one of the customer's identity documents can do
 *   neither. The legacy PATCH /borrowers/:id/kyc cannot shortcut it.
 * - A customer's branch is chosen from the branches the user may assign: a
 *   branch-confined officer only their own, an administrator any active one.
 */
import { Fixture, TEST_DB, bootstrap, borrower, expectOk, grant } from './harness';
import { standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

const pdf = (text: string) =>
  Buffer.from(`%PDF-1.4 ${text}`).toString('base64');

d('Customers: KYC verification and branch (integration)', () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    // admin1 also files customer documents (a lending permission).
    await grant(f, f.t1, 'admin1', 'RELATIONSHIP_OFFICER', {
      branchIds: [f.b1],
    });
  }, 60_000);
  afterAll(async () => f?.app.close());

  const verify = (user: string, borrowerId: string, body: object) =>
    f.as(user).post(`/kyc/${borrowerId}/verify`, body);
  const review = (user: string, borrowerId: string) =>
    f.as(user).get(`/kyc/${borrowerId}/documents`);
  const patch = (user: string, url: string, body: object) =>
    f
      .http()
      .patch(`/v1${url}`)
      .set('Authorization', `Bearer ${f.tokens[user]}`)
      .send(body);

  describe('identity verification', () => {
    it('is recorded by one person and confirmed by a second', async () => {
      const b = await borrower(f, f.t1, f.b1, { kycStatus: 'PENDING' });
      const recorded = expectOk(
        await verify('admin1', b.id, {
          status: 'VERIFIED',
          reason: 'ID card checked against the original',
        }),
      );
      expect(recorded.kycStatus).toBe('PENDING');
      expect(recorded.pendingVerification.id).toEqual(expect.any(String));

      // The same person cannot confirm their own verification.
      const self = await verify('admin1', b.id, { status: 'VERIFIED' });
      expect(self.status).toBe(409);
      expect(self.body.message).toMatch(/second person must confirm/);

      const seen = expectOk(await review('admin2', b.id));
      expect(seen.kycStatus).toBe('PENDING');
      expect(seen.pendingVerification.recordedBy.id).toBe(f.users.admin1.id);
      expect(seen.you).toMatchObject({ mayConfirm: true, mayRecord: false });

      const confirmed = expectOk(
        await verify('admin2', b.id, { status: 'VERIFIED' }),
      );
      expect(confirmed.kycStatus).toBe('VERIFIED');
      const after = expectOk(await review('admin1', b.id));
      expect(after.verifiedBy.id).toBe(f.users.admin2.id);
      expect(after.pendingVerification).toBeNull();
    });

    it('lists identity documents staff filed, and keeps their uploader out of the verification', async () => {
      const b = await borrower(f, f.t1, f.b1, { kycStatus: 'PENDING' });
      expectOk(
        await f.as('admin1').post(`/lending/customers/${b.id}/documents`, {
          category: 'KYC',
          typeCode: 'NATIONAL_ID',
          title: 'National ID card',
          fileName: 'id.pdf',
          mimeType: 'application/pdf',
          contentBase64: pdf('national id'),
        }),
      );
      const seen = expectOk(await review('admin1', b.id));
      expect(seen.documents).toHaveLength(1);
      expect(seen.documents[0]).toMatchObject({
        origin: 'STAFF',
        type: 'NATIONAL_ID',
      });
      expect(seen.you).toMatchObject({
        uploadedDocuments: true,
        mayRecord: false,
      });

      const own = await verify('admin1', b.id, { status: 'VERIFIED' });
      expect(own.status).toBe(409);
      expect(own.body.message).toMatch(/filed one of this customer/);

      // Someone else records it; the uploader still cannot confirm.
      expectOk(await verify('admin2', b.id, { status: 'VERIFIED' }));
      const confirm = await verify('admin1', b.id, { status: 'VERIFIED' });
      expect(confirm.status).toBe(409);

      // Rejection is one step, needs a reason, and withdraws the pending one.
      const bare = await verify('admin1', b.id, { status: 'REJECTED' });
      expect(bare.status).toBe(400);
      const rejected = expectOk(
        await verify('admin1', b.id, {
          status: 'REJECTED',
          reason: 'Photo does not match the customer',
        }),
      );
      expect(rejected.kycStatus).toBe('REJECTED');
      expect(expectOk(await review('admin2', b.id)).pendingVerification).toBeNull();
    });

    it('cannot be set directly through the customer KYC/AML update', async () => {
      const b = await borrower(f, f.t1, f.b1, { kycStatus: 'PENDING' });
      const r = await patch('admin1', `/borrowers/${b.id}/kyc`, {
        kycStatus: 'VERIFIED',
      });
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/second person confirms/);
      // AML screening status is still recorded there.
      const aml = await patch('admin1', `/borrowers/${b.id}/kyc`, {
        amlStatus: 'CLEAR',
      });
      expect([200, 201]).toContain(aml.status);
      expect(aml.body.amlStatus).toBe('CLEAR');
    });
  });

  describe('branch', () => {
    const person = {
      firstName: 'Srey',
      lastName: 'Leak',
      dateOfBirth: '1990-02-01',
      idType: 'NATIONAL_ID',
      occupation: 'Tailor',
    };

    it('offers an administrator every active branch and an officer only their own', async () => {
      const all = expectOk(await f.as('admin1').get('/borrowers/branches'));
      expect(all.map((b: any) => b.id)).toEqual(
        expect.arrayContaining([f.b1, f.b2]),
      );
      const own = expectOk(await f.as('ro').get('/borrowers/branches'));
      expect(own.map((b: any) => b.id)).toEqual([f.b1]);
      expect(own[0].name).toEqual(expect.any(String));
    });

    it('places a new customer in the chosen branch', async () => {
      const b = expectOk(
        await f
          .as('admin1')
          .post('/borrowers', { ...person, lastName: 'Leak1', branchId: f.b2 }),
      );
      expect(b.branchId).toBe(f.b2);
      const got = expectOk(await f.as('admin1').get(`/borrowers/${b.id}`));
      expect(got.branch.id).toBe(f.b2);
      expect(got.dateOfBirth).toMatch(/^1990-02-01/);
      expect(got.loans).toEqual([]);
    });

    it('refuses a branch-confined officer another branch', async () => {
      const r = await f
        .as('ro')
        .post('/borrowers', { ...person, lastName: 'Leak2', branchId: f.b2 });
      expect(r.status).toBe(403);
      expect(r.body.message).toMatch(/own branch|Cross-branch/);
    });

    it('gives a customer without a branch one, so an application can follow', async () => {
      const b = expectOk(
        await f.as('admin1').post('/borrowers', { ...person, lastName: 'Leak3' }),
      );
      expect(b.branchId).toBeNull();
      const moved = expectOk(
        await f.as('admin1').put(`/borrowers/${b.id}`, { branchId: f.b1 }),
      );
      expect(moved.branchId).toBe(f.b1);
      const unknown = await f.as('admin1').put(`/borrowers/${b.id}`, {
        branchId: '00000000-0000-4000-8000-000000000000',
      });
      expect(unknown.status).toBe(400);
      expect(unknown.body.message).toMatch(/active branches/);
    });
  });
});
