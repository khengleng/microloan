/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-require-imports -- integration fixtures: modules are required after the test environment is configured, and fixture rows come from the untyped Prisma client and API responses. */
/**
 * The workspace endpoints: what the signed-in person may do (/me/access),
 * what waits for them (/me/work) and global search (/search).
 *
 *  - every access role's /me/access is exactly its catalogue grants and scope;
 *  - queues honour scope and never count work the user made where a second
 *    person must act;
 *  - search finds borrowers by name, phone (blind index) and ID, and records
 *    by reference, within the caller's branches and tenant only.
 */
import { JwtService } from '@nestjs/jwt';
import {
  Fixture,
  TEST_DB,
  authority,
  bootstrap,
  borrower,
  expectOk,
  grant,
} from './harness';
import { activeProduct, standardRoles, PDF } from './setup';

const d = TEST_DB ? describe : describe.skip;

const STAFF_ROLES = [
  'TENANT_ADMIN',
  'PRODUCT_MAKER',
  'PRODUCT_CHECKER',
  'RELATIONSHIP_OFFICER',
  'CREDIT_ANALYST',
  'CREDIT_APPROVER',
  'LOAN_OPS_MAKER',
  'LOAN_OPS_CHECKER',
  'COLLECTIONS_OFFICER',
  'RESTRUCTURE_COMMITTEE',
  'FINANCE_OFFICER',
  'RISK_COMPLIANCE',
  'AUDITOR',
];
/** Roles assigned to one branch in the field; the rest are head-office roles. */
const BRANCH_ROLES = new Set(['RELATIONSHIP_OFFICER', 'COLLECTIONS_OFFICER']);

d('Workspace: access, work queues and search (integration)', () => {
  let f: Fixture;
  let productId: string;
  let catalogue: typeof import('../../src/lending/policy/catalogue');
  let mfaGated: Set<string>;

  /** A staff user of tenant 1 with a signed token, usable with f.as(key). */
  async function staff(
    keyName: string,
    branchId: string | null = null,
    tenantId = f.t1,
    legacyRole = 'LOAN_OFFICER',
  ) {
    const u = await f.system(() =>
      f.prisma.user.create({
        data: {
          email: `${keyName}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`,
          tenantId,
          branchId,
          role: legacyRole,
          passwordHash: 'x',
          twoFactorEnabled: true,
        },
      }),
    );
    f.users[keyName] = { id: u.id, tenantId, role: legacyRole, branchId };
    f.tokens[keyName] = new JwtService({
      secret: process.env.JWT_ACCESS_SECRET,
    }).sign(
      {
        sub: u.id,
        email: u.email,
        role: legacyRole,
        tenantId,
        branchId,
        amr: 'mfa',
      },
      { expiresIn: '1h' },
    );
    return u.id as string;
  }

  const app = async (who: string, borrowerId: string, principal = '1000') =>
    expectOk(
      await f.as(who).post('/lending/applications', {
        borrowerId,
        productId,
        terms: {
          principal,
          numberOfInstalments: 6,
          disbursementDate: '2026-01-05',
        },
      }),
    );
  const upload = async (who: string, appId: string) =>
    expectOk(
      await f.as(who).post(`/lending/applications/${appId}/documents`, {
        code: 'ID_DOCUMENT',
        fileName: 'id.pdf',
        mimeType: 'application/pdf',
        contentBase64: PDF,
      }),
    );
  const submit = async (who: string, appId: string) =>
    expectOk(await f.as(who).post(`/lending/applications/${appId}/submit`));
  const work = async (who: string) => expectOk(await f.as(who).get('/me/work'));
  const queue = (w: any, code: string) =>
    (w.queues as any[]).find((q) => q.code === code);

  beforeAll(async () => {
    f = await bootstrap();
    catalogue = require('../../src/lending/policy/catalogue');
    const {
      MFA_GATED_PERMISSIONS,
    } = require('../../src/lending/workspace/workspace-access.service');
    mfaGated = MFA_GATED_PERMISSIONS;
    await standardRoles(f);
    productId = (
      await activeProduct(f, 'PERSONAL_INSTALMENT', 'WS-PL', (c) => {
        c.pricing.fees = [];
      })
    ).productId;
  }, 120_000);
  afterAll(async () => f?.app.close());

  // ── /me/access ──────────────────────────────────────────────────────────

  it('each access role sees exactly its catalogue grants and scope', async () => {
    for (const role of STAFF_ROLES) {
      const k = `role_${role}`;
      await staff(k, f.b1);
      await grant(
        f,
        f.t1,
        k,
        role,
        BRANCH_ROLES.has(role) ? { branchIds: [f.b1] } : { allBranches: true },
      );
      const a = expectOk(await f.as(k).get('/me/access'));
      const def = catalogue.ROLE_DEFINITIONS.find((r) => r.code === role)!;
      const expected = [...new Set(def.permissions)].sort();
      expect({ role, permissions: a.permissions }).toEqual({
        role,
        permissions: expected,
      });
      expect(a.hasLending).toBe(true);
      expect(a.principal).toMatchObject({ type: 'USER', branchId: f.b1 });
      expect(a.tenant.id).toBe(f.t1);
      expect(a.roles.map((r: any) => r.code)).toEqual([role]);
      expect(a.assignments).toHaveLength(1);
      expect(a.assurance.mfaGatedPermissions).toEqual(
        expected.filter((p) => mfaGated.has(p)),
      );
      expect(a.assurance.stepUpNeeded).toBe(false);
      if (BRANCH_ROLES.has(role)) {
        expect(a.scope.all).toBe(false);
        expect(a.scope.branches.map((b: any) => b.id)).toEqual([f.b1]);
      } else {
        expect(a.scope.all).toBe(true);
        expect(a.scope.branches).toEqual([]);
      }
      // The flag catalogue is evaluated for this person.
      expect(
        a.flags.find((x: any) => x.key === 'lending.origination'),
      ).toMatchObject({ enabled: true });
      expect(a.legacy.role).toBe('LOAN_OFFICER');
      expect(a.legacy.permissions).toContain('CUSTOMER_VIEW');
    }
  }, 120_000);

  it('a user without lending roles has no lending section; a legacy admin holds the tenant-administrator role', async () => {
    await staff('plain', f.b1);
    const none = expectOk(await f.as('plain').get('/me/access'));
    expect(none.hasLending).toBe(false);
    expect(none.permissions).toEqual([]);
    expect(expectOk(await f.as('plain').get('/me/work'))).toMatchObject({
      total: 0,
      queues: [],
    });
    const admin = expectOk(await f.as('admin1').get('/me/access'));
    expect(admin.roles).toEqual([
      expect.objectContaining({
        code: 'TENANT_ADMIN',
        sources: ['LEGACY_ADMIN'],
      }),
    ]);
    const def = catalogue.ROLE_DEFINITIONS.find(
      (r) => r.code === 'TENANT_ADMIN',
    )!;
    expect(admin.permissions).toEqual([...def.permissions].sort());
  });

  it('shows approval authorities, delegations and the MFA step-up', async () => {
    const a = expectOk(await f.as('approver').get('/me/access'));
    expect(a.authorities).toEqual([
      expect.objectContaining({
        permission: 'credit_decision.approve',
        currency: 'USD',
        maxAmount: '200000',
      }),
    ]);
    const noMfa = expectOk(await f.as('approverNoMfa').get('/me/access'));
    expect(noMfa.assurance).toMatchObject({
      current: 'SINGLE_FACTOR',
      stepUpNeeded: true,
    });
    expect(noMfa.assurance.mfaGatedPermissions).toContain(
      'credit_decision.approve',
    );
    // A delegation from one approver to the analyst.
    await f.system(async () => {
      await f.prisma.delegation.create({
        data: {
          tenantId: f.t1,
          fromUserId: f.users.approver2.id,
          toUserId: f.users.analyst.id,
          permissions: ['credit_decision.approve'],
          maxAmount: '5000',
          currency: 'USD',
          validFrom: new Date(Date.now() - 60_000),
          validTo: new Date(Date.now() + 7 * 86_400_000),
          status: 'ACTIVE',
          reason: 'Leave cover',
          createdBy: f.users.admin1.id,
          approvedBy: f.users.admin2.id,
        },
      });
      await f.prisma.tenant.update({
        where: { id: f.t1 },
        data: { authzVersion: { increment: 1 } },
      });
    });
    const analyst = expectOk(await f.as('analyst').get('/me/access'));
    expect(analyst.delegations.received).toEqual([
      expect.objectContaining({
        fromUserId: f.users.approver2.id,
        permissions: ['credit_decision.approve'],
        maxAmount: '5000',
        currency: 'USD',
      }),
    ]);
    expect(analyst.permissions).toContain('credit_decision.approve');
    expect(analyst.authorities).toEqual([
      expect.objectContaining({
        permission: 'credit_decision.approve',
        maxAmount: '5000',
        source: 'delegated authority',
      }),
    ]);
    const giver = expectOk(await f.as('approver2').get('/me/access'));
    expect(giver.delegations.given).toHaveLength(1);
    // Withdraw it so the queues below see the analyst's own role only.
    await f.system(async () => {
      await f.prisma.delegation.updateMany({
        where: { tenantId: f.t1, toUserId: f.users.analyst.id },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      await f.prisma.tenant.update({
        where: { id: f.t1 },
        data: { authzVersion: { increment: 1 } },
      });
    });
  });

  it('the platform operator gets the platform variant, never tenant lending access', async () => {
    const a = expectOk(await f.as('platform').get('/me/access'));
    expect(a.principal.type).toBe('PLATFORM');
    expect(a.hasLending).toBe(false);
    expect(a.tenant).toBeNull();
    const w = expectOk(await f.as('platform').get('/me/work'));
    expect(w.queues.map((q: any) => q.code)).toEqual([
      'PLAN_PAYMENTS_TO_CONFIRM',
      'ORGANISATIONS_PENDING',
      'ORGANISATIONS_SUSPENDED',
    ]);
  });

  // ── /me/work ────────────────────────────────────────────────────────────

  it('origination queues honour scope and maker-checker', async () => {
    // Analysts: one for every branch, one for Siem Reap only, and one who is
    // also a relationship officer in Phnom Penh (so makes applications).
    await staff('analystB2', f.b2);
    await grant(f, f.t1, 'analystB2', 'CREDIT_ANALYST', { branchIds: [f.b2] });
    await staff('roAnalyst', f.b1);
    await grant(f, f.t1, 'roAnalyst', 'RELATIONSHIP_OFFICER', {
      branchIds: [f.b1],
    });
    await grant(f, f.t1, 'roAnalyst', 'CREDIT_ANALYST', {
      branchIds: [f.b1],
    });
    await staff('analystApprover', f.b1);
    await grant(f, f.t1, 'analystApprover', 'CREDIT_ANALYST');
    await grant(f, f.t1, 'analystApprover', 'CREDIT_APPROVER');
    await authority(
      f,
      f.t1,
      'analystApprover',
      'credit_decision.approve',
      'USD',
      '1000000',
    );

    const b1 = await borrower(f, f.t1, f.b1);
    const b2 = await borrower(f, f.t1, f.b2);
    const a1 = await app('ro', b1.id);
    await upload('ro', a1.id);
    await submit('ro', a1.id);
    const a2 = await app('ro2', b2.id);
    await upload('ro2', a2.id);
    await submit('ro2', a2.id);
    const a3 = await app('roAnalyst', b1.id);
    await upload('roAnalyst', a3.id);
    await submit('roAnalyst', a3.id);
    // A draft stays in its maker's queue only.
    const draft = await app('ro', b1.id, '500');

    const roQ = queue(await work('ro'), 'APPLICATIONS_DRAFT');
    expect(roQ).toMatchObject({ kind: 'MAKER', count: 1 });
    expect(roQ.items[0]).toMatchObject({
      id: draft.id,
      href: `/lending/applications/${draft.id}`,
    });
    expect(queue(await work('ro2'), 'APPLICATIONS_DRAFT').count).toBe(0);

    const ids = (q: any) => q.items.map((i: any) => i.id).sort();
    const all = queue(await work('analyst'), 'APPLICATIONS_TO_RECOMMEND');
    expect(all).toMatchObject({ kind: 'CHECKER', count: 3 });
    expect(ids(all)).toEqual([a1.id, a2.id, a3.id].sort());
    const onlyB2 = queue(await work('analystB2'), 'APPLICATIONS_TO_RECOMMEND');
    expect(onlyB2.count).toBe(1);
    expect(ids(onlyB2)).toEqual([a2.id]);
    // roAnalyst made a3: only a1 (same branch, someone else's) waits for them.
    const own = queue(await work('roAnalyst'), 'APPLICATIONS_TO_RECOMMEND');
    expect(own.count).toBe(1);
    expect(ids(own)).toEqual([a1.id]);
    // A relationship officer has no credit queue at all.
    expect(
      queue(await work('ro'), 'APPLICATIONS_TO_RECOMMEND'),
    ).toBeUndefined();

    // Documents: everyone's uploads but your own wait for your review.
    const docsAnalyst = queue(await work('analyst'), 'DOCUMENTS_TO_REVIEW');
    const docsRoAnalyst = queue(await work('roAnalyst'), 'DOCUMENTS_TO_REVIEW');
    const docsB2 = queue(await work('analystB2'), 'DOCUMENTS_TO_REVIEW');
    expect(docsAnalyst.count).toBe(3);
    expect(docsRoAnalyst.count).toBe(1); // ro's upload in Phnom Penh, not its own
    expect(docsB2.count).toBe(1); // Siem Reap only

    // The analyst-approver recommends a1: it may not approve it afterwards.
    expectOk(
      await f
        .as('analystApprover')
        .post(`/lending/applications/${a1.id}/recommend`, {
          recommendation: 'APPROVE',
          rationale: 'Within policy',
        }),
    );
    const self = queue(
      await work('analystApprover'),
      'APPLICATIONS_TO_APPROVE',
    );
    expect(self.count).toBe(0);
    expect(self.needsMfa).toBe(false);
    const approverQ = queue(await work('approver'), 'APPLICATIONS_TO_APPROVE');
    expect(approverQ.count).toBe(1);
    expect(approverQ.items[0]).toMatchObject({ id: a1.id, aboveLimit: false });
    // The same queue for a session without MFA is flagged, not hidden.
    const noMfa = queue(await work('approverNoMfa'), 'APPLICATIONS_TO_APPROVE');
    expect(noMfa).toMatchObject({ count: 1, needsMfa: true });
    // The analyst-approver's recommend queue no longer holds a1.
    expect(
      ids(queue(await work('analystApprover'), 'APPLICATIONS_TO_RECOMMEND')),
    ).toEqual([a2.id, a3.id].sort());
  }, 120_000);

  it('disbursement queues exclude the preparer and respect the loan’s branch', async () => {
    // opsMaker also holds the checker role here: it must not approve its own.
    await grant(f, f.t1, 'opsMaker', 'LOAN_OPS_CHECKER');
    await authority(
      f,
      f.t1,
      'opsMaker',
      'loan.disbursement.approve',
      'USD',
      '1000000',
    );
    await staff('checkerB2', f.b2);
    await grant(f, f.t1, 'checkerB2', 'LOAN_OPS_CHECKER', {
      branchIds: [f.b2],
    });

    const b = await borrower(f, f.t1, f.b1);
    const a = await app('ro', b.id, '2000');
    await upload('ro', a.id);
    await submit('ro', a.id);
    expectOk(
      await f.as('analyst').post(`/lending/applications/${a.id}/recommend`, {
        recommendation: 'APPROVE',
        rationale: 'Fine',
      }),
    );
    expectOk(
      await f.as('approver').post(`/lending/applications/${a.id}/approve`, {
        rationale: 'Approved',
      }),
    );
    expect(
      queue(await work('opsMaker'), 'APPLICATIONS_TO_BOOK').items.map(
        (i: any) => i.id,
      ),
    ).toContain(a.id);
    const booked = expectOk(
      await f.as('opsMaker').post(`/lending/applications/${a.id}/book`, {}),
    );
    const loanId = booked.account.id as string;
    const view = expectOk(
      await f.as('opsMaker').get(`/lending/applications/${a.id}`),
    );
    for (const cp of view.conditions)
      expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/applications/${a.id}/conditions/${cp.code}`, {
            resolution: 'SATISFIED',
            evidence: 'ok',
          }),
      );
    const prep = queue(await work('opsMaker'), 'DISBURSEMENTS_TO_PREPARE');
    expect(prep.items.map((i: any) => i.id)).toContain(loanId);
    const task = expectOk(
      await f.as('opsMaker').post(`/lending/loans/${loanId}/disbursements`, {}),
    );
    expect(
      queue(await work('opsMaker'), 'DISBURSEMENTS_TO_PREPARE').items.map(
        (i: any) => i.id,
      ),
    ).not.toContain(loanId);

    const mine = queue(await work('opsMaker'), 'DISBURSEMENTS_TO_APPROVE');
    expect(mine.items.map((i: any) => i.id)).not.toContain(task.id);
    expect(mine.count).toBe(0);
    const theirs = queue(await work('opsChecker'), 'DISBURSEMENTS_TO_APPROVE');
    expect(theirs).toMatchObject({ kind: 'CHECKER', count: 1, money: true });
    expect(theirs.items[0]).toMatchObject({
      id: task.id,
      href: `/lending/loans/${loanId}`,
      amount: '2000',
      currency: 'USD',
    });
    // A checker in another branch does not see it.
    expect(
      queue(await work('checkerB2'), 'DISBURSEMENTS_TO_APPROVE').count,
    ).toBe(0);

    // Approved: waits to be paid out by someone other than the preparer.
    expectOk(
      await f
        .as('opsChecker')
        .post(`/lending/loans/${loanId}/disbursements/${task.id}/decision`, {
          approve: true,
        }),
    );
    expect(
      queue(await work('opsChecker'), 'DISBURSEMENTS_TO_APPROVE').count,
    ).toBe(0);
    expect(
      queue(await work('opsChecker'), 'DISBURSEMENTS_TO_EXECUTE').count,
    ).toBe(1);
    expect(
      queue(await work('opsMaker'), 'DISBURSEMENTS_TO_EXECUTE').count,
    ).toBe(0);
    expect(
      queue(await work('checkerB2'), 'DISBURSEMENTS_TO_EXECUTE').count,
    ).toBe(0);
  }, 120_000);

  it('period closes and reopenings wait for someone other than who prepared them', async () => {
    await staff('risk1', null);
    await grant(f, f.t1, 'risk1', 'RISK_COMPLIANCE');
    await staff('risk2', null);
    await grant(f, f.t1, 'risk2', 'RISK_COMPLIANCE');
    await f.system(async () => {
      await f.prisma.accountingPeriod.create({
        data: {
          tenantId: f.t1,
          year: 2025,
          month: 12,
          startDate: new Date(Date.UTC(2025, 11, 1)),
          endDate: new Date(Date.UTC(2025, 11, 31)),
          status: 'PENDING',
          preparedBy: f.users.risk1.id,
          preparedAt: new Date(),
        },
      });
      await f.prisma.accountingPeriod.create({
        data: {
          tenantId: f.t1,
          year: 2025,
          month: 11,
          startDate: new Date(Date.UTC(2025, 10, 1)),
          endDate: new Date(Date.UTC(2025, 10, 30)),
          status: 'REOPEN_PENDING',
          preparedBy: f.users.finance.id,
          approvedBy: f.users.risk1.id,
          closedAt: new Date(),
          reopenRequestedBy: f.users.risk2.id,
          reopenReason: 'Late invoice',
        },
      });
    });
    const q1 = queue(await work('risk1'), 'PERIODS_TO_APPROVE');
    expect(q1.count).toBe(1);
    expect(q1.items[0]).toMatchObject({
      reference: '2025-11',
      label: 'Reopening requested',
    });
    const q2 = queue(await work('risk2'), 'PERIODS_TO_APPROVE');
    expect(q2.count).toBe(1);
    expect(q2.items[0]).toMatchObject({ reference: '2025-12' });
    // Finance prepares closes but holds no approve permission: no such queue.
    expect(queue(await work('finance'), 'PERIODS_TO_APPROVE')).toBeUndefined();
  });

  it('badge total counts maker and checker queues, not information', async () => {
    const w = await work('opsChecker');
    expect(w.total).toBe(
      w.queues
        .filter((q: any) => q.kind !== 'INFO')
        .reduce((a: number, q: any) => a + q.count, 0),
    );
    expect(w.businessDate).toBe('2026-01-05');
  });

  // ── /me/people ──────────────────────────────────────────────────────────

  it('people resolves ids and email fragments to colleagues of the same organisation only', async () => {
    const ro = f.users['ro'].id;
    const foreign = f.users['t2admin'].id;
    const byId = expectOk(
      await f.as('analyst').get(`/me/people?ids=${ro},${foreign}`),
    ) as any[];
    expect(byId.map((p) => p.id)).toEqual([ro]);
    expect(byId[0].email).toMatch(/^ro-/);
    const found = expectOk(await f.as('analyst').get('/me/people?q=ro-')) as any[];
    expect(found.map((p) => p.id)).toContain(ro);
    expect(found.every((p) => p.id !== foreign)).toBe(true);
    // Too short a fragment, and platform operators, get nothing.
    expect(expectOk(await f.as('analyst').get('/me/people?q=r'))).toEqual([]);
    expect(
      expectOk(await f.as('platform').get(`/me/people?ids=${ro}`)),
    ).toEqual([]);
  });

  // ── /search ─────────────────────────────────────────────────────────────

  it('search finds by name, phone and reference within scope, and never across branches or tenants', async () => {
    const pp = await borrower(f, f.t1, f.b1, {
      firstName: 'Chanthavy',
      lastName: 'Sokunthea',
      phone: '+85512345678',
      idNumber: 'N0123456',
    });
    const sr = await borrower(f, f.t1, f.b2, {
      firstName: 'Chanthavy',
      lastName: 'Rotha',
      phone: '+85598765432',
    });
    const other = await borrower(f, f.t2, f.b3, {
      firstName: 'Chanthavy',
      lastName: 'Other',
      phone: '+85512345678',
    });
    const a = await app('ro', pp.id, '750');
    const search = async (who: string, q: string) =>
      expectOk(await f.as(who).get(`/search?q=${encodeURIComponent(q)}`))
        .results as any[];
    const of = (rs: any[], type: string) =>
      rs.filter((r) => r.type === type).map((r) => r.id);

    // Branch scope: each officer finds only their branch's customer.
    expect(of(await search('ro', 'chanthavy'), 'BORROWER')).toEqual([pp.id]);
    expect(of(await search('ro2', 'Chanthavy'), 'BORROWER')).toEqual([sr.id]);
    expect(of(await search('analyst', 'chanthavy'), 'BORROWER').sort()).toEqual(
      [pp.id, sr.id].sort(),
    );
    // Full name, phone in either spelling, and national ID — by blind index.
    expect(of(await search('ro', 'Chanthavy Sokunthea'), 'BORROWER')).toEqual([
      pp.id,
    ]);
    expect(of(await search('ro', '012 345 678'), 'BORROWER')).toEqual([pp.id]);
    expect(of(await search('ro', '+85512345678'), 'BORROWER')).toEqual([pp.id]);
    expect(of(await search('ro', 'N0123456'), 'BORROWER')).toEqual([pp.id]);
    expect(of(await search('ro2', '+85512345678'), 'BORROWER')).toEqual([]);
    // Records by reference and by their borrower's name.
    const byRef = await search('ro', a.reference);
    expect(of(byRef, 'APPLICATION')).toEqual([a.id]);
    expect(byRef.find((r) => r.id === a.id)).toMatchObject({
      href: `/lending/applications/${a.id}`,
      status: 'DRAFT',
    });
    expect(of(await search('ro', 'Sokunthea'), 'APPLICATION')).toEqual([a.id]);
    expect(of(await search('ro2', a.reference), 'APPLICATION')).toEqual([]);
    // Loan accounts by reference.
    const loan = await f.system(() =>
      f.prisma.loanAccount.findFirst({
        where: { tenantId: f.t1, branchId: f.b1 },
        select: { id: true, reference: true },
      }),
    );
    expect(of(await search('opsChecker', loan.reference), 'LOAN')).toEqual([
      loan.id,
    ]);
    expect(of(await search('checkerB2', loan.reference), 'LOAN')).toEqual([]);

    // The other organisation: same name and phone, its own customer only.
    const t2 = expectOk(await f.as('t2admin').get('/search?q=Chanthavy'));
    expect(of(t2.results, 'BORROWER')).toEqual([other.id]);
    const text = JSON.stringify(t2);
    for (const id of [pp.id, sr.id, a.id]) expect(text).not.toContain(id);
    const t2Phone = expectOk(
      await f.as('t2admin').get('/search?q=%2B85512345678'),
    );
    expect(of(t2Phone.results, 'BORROWER')).toEqual([other.id]);
    expect(
      of(
        expectOk(await f.as('t2admin').get(`/search?q=${a.reference}`)).results,
        'APPLICATION',
      ),
    ).toEqual([]);

    // A user with neither lending nor legacy customer access finds nothing.
    await staff('noCustomers', f.b1, f.t1, 'BORROWER');
    expect(await search('noCustomers', 'Chanthavy')).toEqual([]);
    // The platform searches organisations, never borrowers.
    const tenantName = await f.system(() =>
      f.prisma.tenant.findUnique({
        where: { id: f.t1 },
        select: { name: true },
      }),
    );
    const plat = await search('platform', tenantName.name);
    expect(plat.map((r) => r.type)).toEqual(['ORGANISATION']);
    expect(await search('platform', 'Chanthavy')).toEqual([]);
    // Too short is empty; too long is refused.
    expect(await search('ro', 'C')).toEqual([]);
    expect((await f.as('ro').get(`/search?q=${'x'.repeat(101)}`)).status).toBe(
      400,
    );
  }, 120_000);
});
