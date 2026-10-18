/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: rows come from the untyped API responses. */
/**
 * Access governance maker-checker: issuing a service-account credential and
 * changing cohort membership both need a second person.
 *
 *  - a service account is requested by one administrator, approved by
 *    another, and its key is collected once by the requester only — nothing
 *    secret exists before then and only the hash is stored;
 *  - a cohort change is proposed by one person and applied only when a second
 *    person (never the proposer, nor a user being placed in the cohort)
 *    approves it;
 *  - pending items appear in the approvers' work queues, never the maker's.
 */
import { randomUUID } from 'node:crypto';
import { Fixture, TEST_DB, bootstrap, expectOk, grant } from './harness';

const d = TEST_DB ? describe : describe.skip;

d('Access governance maker-checker (integration)', () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await bootstrap();
    await grant(f, f.t1, 'nobody', 'AUDITOR');
  }, 60_000);
  afterAll(async () => f?.app.close());

  const work = async (who: string) =>
    expectOk(await f.as(who).get('/me/work')) as {
      queues: { code: string; count: number; items: { id: string }[] }[];
    };
  const queue = async (who: string, code: string) =>
    (await work(who)).queues.find((q) => q.code === code);
  const denial = (res: { body: any }) =>
    (res.body.blockedBy ?? []).map((b: any) => b.message).join(' ');

  describe('service accounts', () => {
    it('one person requests, another approves, and the requester collects the key once', async () => {
      const req = expectOk(
        await f.as('admin1').post('/lending/access/service-accounts', {
          name: 'Bank feed',
          scopes: ['loan.repayment.post'],
          expiresInDays: 30,
        }),
      );
      expect(req.status).toBe('PENDING');
      expect(req.key).toBeUndefined();
      // Nothing is issued while the request waits.
      const before = expectOk(
        await f.as('admin1').get('/lending/access/service-accounts'),
      );
      expect(before.find((s: any) => s.id === req.serviceAccountId)).toBe(
        undefined,
      );

      // The requester cannot approve their own request.
      const own = await f
        .as('admin1')
        .post(`/lending/access/service-account-requests/${req.id}/decision`, {
          approve: true,
        });
      expect(own.status).toBe(403);
      expect(denial(own)).toMatch(/created or proposed/);

      // The approver's queue shows it; the maker's does not.
      expect(
        (await queue('admin2', 'ACCESS_TO_APPROVE'))?.items.map((i) => i.id),
      ).toContain(req.id);
      expect(
        (await queue('admin1', 'ACCESS_TO_APPROVE'))?.items.map((i) => i.id) ??
          [],
      ).not.toContain(req.id);

      expectOk(
        await f
          .as('admin2')
          .post(`/lending/access/service-account-requests/${req.id}/decision`, {
            approve: true,
          }),
      );
      // Approved but not collected: still no credential, and the requester is told to collect it.
      expect(
        (await queue('admin1', 'SERVICE_KEYS_TO_COLLECT'))?.items.map(
          (i) => i.id,
        ),
      ).toContain(req.id);

      // Only the requester collects the key.
      const approverTry = await f
        .as('admin2')
        .post(`/lending/access/service-account-requests/${req.id}/issue`);
      expect(approverTry.status).toBe(403);

      const issued = expectOk(
        await f
          .as('admin1')
          .post(`/lending/access/service-account-requests/${req.id}/issue`),
      );
      expect(issued.id).toBe(req.serviceAccountId);
      expect(issued.key).toMatch(/^[0-9a-f]{16}\./);
      expect(issued.scopes).toEqual(['loan.repayment.post']);

      // Shown once.
      const again = await f
        .as('admin1')
        .post(`/lending/access/service-account-requests/${req.id}/issue`);
      expect(again.status).toBe(409);

      // Only the hash is stored.
      const row = await f.system(() =>
        f.prisma.serviceAccount.findFirst({ where: { id: issued.id } }),
      );
      expect(row.keyHash).not.toContain(issued.key.split('.')[1]);
      expect(row.createdBy).toBe(f.users.admin1.id);

      // The key authenticates (a garbage key does not).
      const call = (k: string) =>
        f
          .http()
          .post(`/v1/lending/integrations/loans/${randomUUID()}/repayments`)
          .set('X-Service-Key', k)
          .set('Idempotency-Key', randomUUID())
          .send({ amount: '1.00' });
      expect((await call(issued.key)).status).not.toBe(401);
      expect(
        (await call('deadbeefdeadbeef.notarealsecretnotarealsecret00')).status,
      ).toBe(401);

      const requests = expectOk(
        await f.as('admin2').get('/lending/access/service-account-requests'),
      );
      const listed = requests.find((r: any) => r.id === req.id);
      expect(listed.status).toBe('EXECUTED');
      expect(listed.makerEmail).toContain('admin1');
      expect(JSON.stringify(requests)).not.toContain(issued.key);
    });

    it('a rejected request never issues a key', async () => {
      const req = expectOk(
        await f.as('admin2').post('/lending/access/service-accounts', {
          name: 'Reporting',
          scopes: ['loan.read'],
        }),
      );
      expectOk(
        await f
          .as('admin1')
          .post(`/lending/access/service-account-requests/${req.id}/decision`, {
            approve: false,
            comment: 'Not needed',
          }),
      );
      const res = await f
        .as('admin2')
        .post(`/lending/access/service-account-requests/${req.id}/issue`);
      expect(res.status).toBe(409);
      // A decided request cannot be decided again.
      const twice = await f
        .as('admin1')
        .post(`/lending/access/service-account-requests/${req.id}/decision`, {
          approve: true,
        });
      expect(twice.status).toBe(409);
    });

    it('reading access is not enough to request a service account', async () => {
      const res = await f
        .as('nobody')
        .post('/lending/access/service-accounts', {
          name: 'Sneaky',
          scopes: ['loan.read'],
        });
      expect(res.status).toBe(403);
    });
  });

  describe('cohorts', () => {
    const members = async () =>
      expectOk(await f.as('admin1').get('/lending/access/cohorts')).members;

    it('a proposed membership is applied only after a second person approves it', async () => {
      const change = expectOk(
        await f.as('admin1').post('/lending/access/cohorts', {
          cohortCode: 'PILOT_A',
          subjectType: 'BRANCH',
          subjectId: f.b1,
          member: true,
          reason: 'Pilot branch',
        }),
      );
      expect(change.status).toBe('PENDING');
      expect(
        (await members()).filter((m: any) => m.cohortCode === 'PILOT_A'),
      ).toHaveLength(0);

      // One pending change per member at a time.
      const dup = await f.as('admin1').post('/lending/access/cohorts', {
        cohortCode: 'PILOT_A',
        subjectType: 'BRANCH',
        subjectId: f.b1,
        member: true,
      });
      expect(dup.status).toBe(409);

      const own = await f
        .as('admin1')
        .post(`/lending/access/cohort-changes/${change.id}/decision`, {
          approve: true,
        });
      expect(own.status).toBe(403);
      expect(denial(own)).toMatch(/created or proposed/);

      expect(
        (await queue('admin2', 'FLAGS_TO_APPROVE'))?.items.map((i) => i.id),
      ).toContain(change.id);

      const applied = expectOk(
        await f
          .as('admin2')
          .post(`/lending/access/cohort-changes/${change.id}/decision`, {
            approve: true,
          }),
      );
      expect(applied.map((m: any) => m.subjectId)).toEqual([f.b1]);
      expect(applied[0].addedBy).toBe(f.users.admin1.id);

      // Removal goes through the same two steps.
      const removal = expectOk(
        await f.as('admin2').post('/lending/access/cohorts', {
          cohortCode: 'PILOT_A',
          subjectType: 'BRANCH',
          subjectId: f.b1,
          member: false,
        }),
      );
      expect(
        (await members()).filter((m: any) => m.cohortCode === 'PILOT_A'),
      ).toHaveLength(1);
      expectOk(
        await f
          .as('admin1')
          .post(`/lending/access/cohort-changes/${removal.id}/decision`, {
            approve: true,
          }),
      );
      expect(
        (await members()).filter((m: any) => m.cohortCode === 'PILOT_A'),
      ).toHaveLength(0);
    });

    it('a person being placed in a cohort cannot approve it', async () => {
      const change = expectOk(
        await f.as('admin1').post('/lending/access/cohorts', {
          cohortCode: 'PILOT_B',
          subjectType: 'USER',
          subjectId: f.users.admin2.id,
          member: true,
        }),
      );
      const self = await f
        .as('admin2')
        .post(`/lending/access/cohort-changes/${change.id}/decision`, {
          approve: true,
        });
      expect(self.status).toBe(403);
      expect(
        (await queue('admin2', 'FLAGS_TO_APPROVE'))?.items.map((i) => i.id) ??
          [],
      ).not.toContain(change.id);
    });

    it('another tenant cannot be named as a member', async () => {
      const res = await f.as('admin1').post('/lending/access/cohorts', {
        cohortCode: 'PILOT_C',
        subjectType: 'BRANCH',
        subjectId: f.b3,
        member: true,
      });
      expect(res.status).toBe(404);
    });
  });
});
