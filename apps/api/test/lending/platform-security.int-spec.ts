/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-require-imports -- integration fixtures: modules are required after the test environment is configured, and fixture rows come from the untyped Prisma client. */
/**
 * Platform super-administrator, MFA and tenant deletion controls
 * (DECISIONS D-128…D-132), over the real HTTP API and database:
 *  - SUPERADMIN without an authenticator reaches only the enrolment routes,
 *    and can enrol with tenantId null;
 *  - an MFA-gated action with a stale authenticator code answers
 *    MFA_STEP_UP_REQUIRED, and goes through after a step-up;
 *  - a TOTP code is accepted once; the login mfaToken is single-use;
 *  - a platform password reset shows in the tenant's audit log;
 *  - promotion to SUPERADMIN needs a second super-administrator;
 *  - a purge is refused inside the grace period, under legal hold and
 *    without an archive, and deletes the tenant's stored files.
 */
import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Fixture, TEST_DB, borrower, bootstrap, expectOk } from './harness';
import { activeProduct, docs, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

d(
  'Platform security: MFA, step-up, replay, platform audit, purge (integration)',
  () => {
    let f: Fixture;
    let jwt: JwtService;
    let encrypt: (v: string) => string;
    let personal: { productId: string; versionId: string };
    const suffix = randomUUID().slice(0, 8);

    /** A user row of our own, with an authenticator unless `mfa: false`. */
    const makeUser = async (
      role: string,
      tenantId: string | null,
      opts: { mfa?: boolean; password?: string; branchId?: string | null } = {},
    ) => {
      const email = `ps-${role.toLowerCase()}-${randomUUID().slice(0, 6)}-${suffix}@test.local`;
      const user = await f.system(() =>
        f.prisma.user.create({
          data: {
            email,
            tenantId,
            branchId: opts.branchId ?? null,
            role,
            passwordHash: opts.password
              ? bcrypt.hashSync(opts.password, 4)
              : 'x',
            twoFactorEnabled: opts.mfa !== false,
            twoFactorSecret: opts.mfa !== false ? encrypt('TESTSECRET') : null,
          },
        }),
      );
      return { id: user.id as string, email, role, tenantId };
    };

    const tokenFor = (
      u: {
        id: string;
        email: string;
        role: string;
        tenantId: string | null;
        branchId?: string | null;
      },
      claims: Record<string, unknown>,
    ) =>
      jwt.sign(
        {
          sub: u.id,
          email: u.email,
          role: u.role,
          tenantId: u.tenantId,
          branchId: u.branchId ?? null,
          ...claims,
        },
        { expiresIn: '1h' },
      );
    const fresh = () => ({ amr: 'mfa', mfaAt: Math.floor(Date.now() / 1000) });
    const stale = () => ({
      amr: 'mfa',
      mfaAt: Math.floor(Date.now() / 1000) - 3 * 3600,
    });
    const call = (
      method: 'get' | 'post' | 'put' | 'patch' | 'delete',
      url: string,
      token: string,
      body?: unknown,
    ) => {
      const r = f
        .http()
        [method](`/v1${url}`)
        .set('Authorization', `Bearer ${token}`);
      return body === undefined ? r : r.send(body as object);
    };

    beforeAll(async () => {
      f = await bootstrap();
      jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
      encrypt = (v: string) =>
        require('../../src/common/field-crypto').encryptField(v);
      await standardRoles(f);
      personal = await activeProduct(f, 'PERSONAL_INSTALMENT', 'PL-PSEC');
    }, 120_000);
    afterAll(async () => f?.app.close());

    describe('authenticator requirement for platform and tenant administrators (D-128)', () => {
      it('a SUPERADMIN without an authenticator reaches only the enrolment routes, then enrols (tenantId null)', async () => {
        const su = await makeUser('SUPERADMIN', null, { mfa: false });
        const token = tokenFor(su, { amr: 'pwd' });

        const blocked = await call('get', '/tenants', token);
        expect(blocked.status).toBe(403);
        expect(blocked.body.code).toBe('MFA_ENROLMENT_REQUIRED');
        expect((await call('get', '/audit-logs', token)).body.code).toBe(
          'MFA_ENROLMENT_REQUIRED',
        );

        const me = expectOk(await call('get', '/auth/me', token));
        expect(me).toMatchObject({
          mfaRequired: true,
          mfaEnrolled: false,
          mfaEnrolmentRequired: true,
          tenantId: null,
        });
        expect(expectOk(await call('get', '/auth/mfa/status', token))).toEqual({
          enabled: false,
        });

        const gen = expectOk(
          await call('post', '/auth/mfa/generate', token, {}),
        );
        expect(gen.qrCodeDataUrl).toMatch(/^data:image\/png/);
        const enabled = expectOk(
          await call('post', '/auth/mfa/enable', token, { code: '100000' }),
        );
        expect(enabled.access_token).toBeDefined();
        const claims: any = jwt.decode(enabled.access_token);
        expect(claims).toMatchObject({ amr: 'mfa', tenantId: null });

        // The re-issued session is an MFA session: platform routes answer.
        expectOk(await call('get', '/tenants', enabled.access_token));
        const after = expectOk(
          await call('get', '/auth/me', enabled.access_token),
        );
        expect(after.mfaEnrolmentRequired).toBe(false);
      });

      it('a tenant administrator without an authenticator is held at enrolment too', async () => {
        const admin = await makeUser('TENANT_ADMIN', f.t1, { mfa: false });
        const res = await call(
          'get',
          '/users',
          tokenFor(admin, { amr: 'pwd' }),
        );
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('MFA_ENROLMENT_REQUIRED');
      });
    });

    describe('step-up freshness for MFA-gated actions (D-129)', () => {
      it('a stale MFA session is refused with the step-up code, then accepted after a step-up', async () => {
        await f.system(() =>
          f.prisma.user.update({
            where: { id: f.users.approver.id },
            data: {
              twoFactorSecret: encrypt('TESTSECRET'),
              totpLastStep: null,
            },
          }),
        );
        const b = await borrower(f, f.t1, f.b1);
        const app = expectOk(
          await f.as('ro').post('/lending/applications', {
            borrowerId: b.id,
            productId: personal.productId,
            terms: {
              principal: '1000',
              numberOfInstalments: 6,
              disbursementDate: '2026-01-05',
            },
          }),
        );
        await docs(f, app.id, ['ID_DOCUMENT']);
        expectOk(
          await f.as('ro').post(`/lending/applications/${app.id}/submit`),
        );
        expectOk(
          await f
            .as('analyst')
            .post(`/lending/applications/${app.id}/recommend`, {
              recommendation: 'APPROVE',
              rationale: 'Fine',
            }),
        );

        const approver = {
          id: f.users.approver.id,
          email: 'approver@test.local',
          role: 'LOAN_OFFICER',
          tenantId: f.t1,
          branchId: f.b1,
        };
        const staleToken = tokenFor(approver, stale());
        const refused = await call(
          'post',
          `/lending/applications/${app.id}/approve`,
          staleToken,
          { rationale: 'stale' },
        );
        expect(refused.status).toBe(403);
        expect(refused.body.code).toBe('MFA_STEP_UP_REQUIRED');

        const stepped = expectOk(
          await call('post', '/auth/mfa/step-up', staleToken, {
            code: '100000',
          }),
        );
        const claims: any = jwt.decode(stepped.access_token);
        expect(claims.amr).toBe('mfa');
        expect(Math.abs(claims.mfaAt - Date.now() / 1000)).toBeLessThan(30);
        expectOk(
          await call(
            'post',
            `/lending/applications/${app.id}/approve`,
            stepped.access_token,
            { rationale: 'fresh code' },
          ),
        );
      });

      it('a TOTP code is accepted once: the same code again is a replay', async () => {
        const u = await makeUser('LOAN_OFFICER', f.t1, { branchId: f.b1 });
        const token = tokenFor({ ...u, branchId: f.b1 }, { amr: 'pwd' });
        expectOk(
          await call('post', '/auth/mfa/step-up', token, { code: '100003' }),
        );
        const replay = await call('post', '/auth/mfa/step-up', token, {
          code: '100003',
        });
        expect(replay.status).toBe(400);
        expect(replay.body.message).toMatch(/already used/);
        // An older step than the one used is refused as well.
        expect(
          (await call('post', '/auth/mfa/step-up', token, { code: '100002' }))
            .status,
        ).toBe(400);
        expectOk(
          await call('post', '/auth/mfa/step-up', token, { code: '100004' }),
        );
      });

      it('the login mfaToken is single-use', async () => {
        const u = await makeUser('LOAN_OFFICER', f.t1, {
          password: 'correct horse battery',
          branchId: f.b1,
        });
        const login = expectOk(
          await f
            .http()
            .post('/v1/auth/login')
            .send({ email: u.email, password: 'correct horse battery' }),
        );
        expect(login.mfaRequired).toBe(true);
        expectOk(
          await f
            .http()
            .post('/v1/auth/mfa/authenticate')
            .send({ mfaToken: login.mfaToken, code: '100000' }),
        );
        const again = await f
          .http()
          .post('/v1/auth/mfa/authenticate')
          .send({ mfaToken: login.mfaToken, code: '100001' });
        expect(again.status).toBe(401);
        const row = await f.system(() =>
          f.prisma.mfaChallenge.findFirst({ where: { userId: u.id } }),
        );
        expect(row.consumedAt).not.toBeNull();
      });
    });

    describe('platform actions in the tenant audit log (D-130)', () => {
      it('a platform password reset is visible to the tenant, flagged as a platform operator', async () => {
        expectOk(
          await call(
            'patch',
            `/users/${f.users.nobody.id}/password`,
            f.tokens.platform,
            { password: 'Platform-Reset-Password-1!' },
          ),
        );
        const logs = expectOk(
          await f.as('admin1').get('/audit-logs?action=USER_PASSWORD_RESET'),
        );
        const entry = logs.data.find(
          (l: any) => l.entityId === f.users.nobody.id,
        );
        expect(entry).toBeDefined();
        expect(entry.userId).toBe(f.users.platform.id);
        expect(entry.metadata).toMatchObject({
          actorRole: 'SUPERADMIN',
          platformOperator: true,
        });
        // The other tenant does not see it.
        const other = expectOk(
          await f.as('t2admin').get('/audit-logs?action=USER_PASSWORD_RESET'),
        );
        expect(
          other.data.find((l: any) => l.entityId === f.users.nobody.id),
        ).toBeUndefined();
      });

      it('promotion to SUPERADMIN needs a second super-administrator', async () => {
        const second = await makeUser('SUPERADMIN', null);
        const target = await makeUser('LOAN_OFFICER', f.t1, { branchId: f.b1 });
        const platform = {
          id: f.users.platform.id,
          email: 'platform@test.local',
          role: 'SUPERADMIN',
          tenantId: null,
        };

        const req = expectOk(
          await call(
            'post',
            '/auth/promote-superadmin',
            tokenFor(platform, fresh()),
            { email: target.email },
          ),
        );
        expect(req.status).toBe('PENDING_APPROVAL');
        const before = await f.system(() =>
          f.prisma.user.findUnique({ where: { id: target.id } }),
        );
        expect(before.role).toBe('LOAN_OFFICER');

        const own = await call(
          'post',
          `/auth/superadmin-grants/${req.approvalId}/approve`,
          tokenFor(platform, fresh()),
          {},
        );
        expect(own.status).toBe(403);

        const pending = expectOk(
          await call(
            'get',
            '/auth/superadmin-grants?status=PENDING',
            tokenFor(second, fresh()),
          ),
        );
        expect(pending.map((r: any) => r.id)).toContain(req.approvalId);

        expectOk(
          await call(
            'post',
            `/auth/superadmin-grants/${req.approvalId}/approve`,
            tokenFor(second, fresh()),
            {},
          ),
        );
        const after = await f.system(() =>
          f.prisma.user.findUnique({ where: { id: target.id } }),
        );
        expect(after).toMatchObject({ role: 'SUPERADMIN', tenantId: null });

        const audit = await f.system(() =>
          f.prisma.auditLog.findFirst({
            where: { action: 'PROMOTED_TO_SUPERADMIN', entityId: target.id },
          }),
        );
        expect(audit.userId).toBe(second.id);
        expect(audit.userId).not.toBe(target.id);
        expect(audit.tenantId).toBe(f.t1);
      });
    });

    describe('tenant purge (D-131)', () => {
      let tenantId: string;
      let fileKey: string;
      let second: {
        id: string;
        email: string;
        role: string;
        tenantId: string | null;
      };
      const platform = () => ({
        id: f.users.platform.id,
        email: 'platform@test.local',
        role: 'SUPERADMIN',
        tenantId: null,
      });

      beforeAll(async () => {
        second = await makeUser('SUPERADMIN', null);
        const {
          DocumentStorageService,
        } = require('../../src/lending/documents/document-storage');
        const storage = f.app.get(DocumentStorageService);
        const longAgo = new Date(Date.UTC(2010, 0, 4));
        const ids = await f.system(async () => {
          const t = await f.prisma.tenant.create({
            data: { name: `Purge Me ${suffix}`, status: 'ACTIVE' },
          });
          const br = await f.prisma.branch.create({
            data: { tenantId: t.id, name: 'Kampot', code: 'KPT' },
          });
          return { t: t.id as string, br: br.id as string };
        });
        tenantId = ids.t;
        const b = await borrower(f, tenantId, ids.br);
        await f.system(async () => {
          await f.prisma.borrower.update({
            where: { id: b.id },
            data: { createdAt: longAgo },
          });
          const doc = await f.prisma.customerDocument.create({
            data: {
              tenantId,
              borrowerId: b.id,
              category: 'KYC',
              typeCode: 'NATIONAL_ID',
              title: 'National ID',
              origin: 'STAFF',
              createdBy: 'fixture',
              createdAt: longAgo,
              legalHold: true,
              legalHoldReason: 'Court order',
              legalHoldBy: 'fixture',
              legalHoldAt: longAgo,
            },
          });
          fileKey = `tenants/${tenantId}/customers/${b.id}/documents/${doc.id}/v1-${randomUUID()}`;
          await storage
            .storage()
            .put(fileKey, Buffer.from('%PDF-1.4 test'), 'application/pdf');
          await f.prisma.customerDocumentVersion.create({
            data: {
              tenantId,
              documentId: doc.id,
              version: 1,
              fileName: 'id.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 13,
              sha256: 'b'.repeat(64),
              storageProvider: storage.storage().provider,
              storageKey: fileKey,
              uploadedBy: 'fixture',
              uploaderType: 'USER',
              reviewStatus: 'ACCEPTED',
              createdAt: longAgo,
            },
          });
        });
      }, 60_000);

      it('is refused inside the grace period', async () => {
        expectOk(
          await call(
            'delete',
            `/tenants/${tenantId}`,
            tokenFor(platform(), fresh()),
          ),
        );
        const req = await call(
          'post',
          `/tenants/${tenantId}/purge-requests`,
          tokenFor(platform(), fresh()),
          {},
        );
        expect(req.status).toBe(409);
        expect(req.body.code).toBe('TENANT_PURGE_GRACE');
        const purge = await call(
          'delete',
          `/tenants/${tenantId}/hard`,
          tokenFor(platform(), fresh()),
        );
        expect(purge.status).toBe(409);
        expect(purge.body.code).toBe('TENANT_PURGE_GRACE');
      });

      it('is refused without an archive, and while a document is under legal hold', async () => {
        await f.system(() =>
          f.prisma.tenant.update({
            where: { id: tenantId },
            data: { deletedAt: new Date(Date.now() - 40 * 86_400_000) },
          }),
        );
        const noArchive = await call(
          'post',
          `/tenants/${tenantId}/purge-requests`,
          tokenFor(platform(), fresh()),
          {},
        );
        expect(noArchive.status).toBe(409);
        expect(noArchive.body.code).toBe('TENANT_PURGE_NO_ARCHIVE');

        const archive = expectOk(
          await call(
            'post',
            `/tenants/${tenantId}/archive`,
            tokenFor(platform(), fresh()),
            {},
          ),
        );
        expect(archive.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(archive.recordCounts).toMatchObject({
          Borrower: 1,
          CustomerDocument: 1,
        });

        const held = await call(
          'post',
          `/tenants/${tenantId}/purge-requests`,
          tokenFor(platform(), fresh()),
          {},
        );
        expect(held.status).toBe(409);
        expect(held.body.code).toBe('TENANT_PURGE_BLOCKED');
        expect(held.body.blockers.legalHolds).toBe(1);
      });

      it('with the hold released, a second super-administrator approves and the purge deletes the stored files', async () => {
        await f.system(() =>
          f.prisma.customerDocument.updateMany({
            where: { tenantId },
            data: { legalHold: false },
          }),
        );
        const status = expectOk(
          await call(
            'get',
            `/tenants/${tenantId}/purge`,
            tokenFor(platform(), fresh()),
          ),
        );
        expect(status).toMatchObject({
          graceElapsed: true,
          archiveReady: true,
        });
        expect(status.blockers).toMatchObject({
          legalHolds: 0,
          openRelationships: 0,
          withinRetention: 0,
        });

        const req = expectOk(
          await call(
            'post',
            `/tenants/${tenantId}/purge-requests`,
            tokenFor(platform(), fresh()),
            { reason: 'Contract ended' },
          ),
        );
        expect(req.status).toBe('PENDING');
        // Not yet approved: the purge is refused.
        expect(
          (
            await call(
              'delete',
              `/tenants/${tenantId}/hard`,
              tokenFor(platform(), fresh()),
            )
          ).body.code,
        ).toBe('TENANT_PURGE_NOT_APPROVED');
        // The requester cannot approve it.
        expect(
          (
            await call(
              'post',
              `/tenants/purge-requests/${req.id}/approve`,
              tokenFor(platform(), fresh()),
              {},
            )
          ).status,
        ).toBe(403);
        expectOk(
          await call(
            'post',
            `/tenants/purge-requests/${req.id}/approve`,
            tokenFor(second, fresh()),
            {},
          ),
        );

        const {
          DocumentStorageService,
        } = require('../../src/lending/documents/document-storage');
        const storage = f.app.get(DocumentStorageService);
        await expect(storage.storage().get(fileKey)).resolves.toBeDefined();

        const done = expectOk(
          await call(
            'delete',
            `/tenants/${tenantId}/hard`,
            tokenFor(platform(), fresh()),
          ),
        );
        expect(done.filesDeleted).toBeGreaterThanOrEqual(1);
        await expect(storage.storage().get(fileKey)).rejects.toBeDefined();
        expect(
          await f.system(() =>
            f.prisma.tenant.findUnique({ where: { id: tenantId } }),
          ),
        ).toBeNull();

        // The archive outlives the purge it allowed, file and record.
        const archive = await f.system(() =>
          f.prisma.tenantArchive.findFirst({ where: { tenantId } }),
        );
        expect(archive).not.toBeNull();
        const bytes: Buffer = await storage.storage().get(archive.storageKey);
        expect(
          require('node:crypto')
            .createHash('sha256')
            .update(bytes)
            .digest('hex'),
        ).toBe(archive.sha256);
        const approval = await f.system(() =>
          f.prisma.platformApproval.findUnique({ where: { id: req.id } }),
        );
        expect(approval).toMatchObject({
          status: 'EXECUTED',
          makerId: platform().id,
          checkerId: second.id,
        });
      });
    });
  },
);
