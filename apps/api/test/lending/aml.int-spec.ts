/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * AML/CFT controls (DECISIONS D-118…D-122), end to end:
 *
 * - the gate: submit, approve, book and disburse are refused until every
 *   party is KYC-verified and AML-cleared (whatever the workflow), with the
 *   reason in the capability map's "Blocked by";
 * - clearing a customer takes two people; flagging takes one;
 * - watch lists: maker-checker activation, a background re-screen that
 *   opens cases, screening at customer creation;
 * - dispositions by two people: a false positive is not raised again; a PEP
 *   match flags the customer and requires approved EDD; a sanctions match
 *   raises a suspicious transaction referral and cannot be cleared;
 * - the risk rating from tenant-configured factors;
 * - the cash transaction report, single and same-day aggregated;
 * - suspicious transaction referrals are seen only by compliance;
 * - nothing of one tenant's AML data reaches another.
 */
import {
  Fixture,
  TEST_DB,
  acceptKeyFacts,
  bootstrap,
  borrower,
  expectOk,
  grant,
  key,
} from './harness';
import {
  activeProduct,
  docs,
  originateAndDisburse,
  standardRoles,
} from './setup';

const d = TEST_DB ? describe : describe.skip;

const LIST = [
  'name,type,source,list_date,aliases,country,date_of_birth',
  '# Fictional names for tests only',
  'Fictional Sanctioned Person,SANCTION,Test sanctions list (fictional),2026-01-02,Phantom Testname,KP,1970-05-01',
  'Example Minister Pich,PEP,Test PEP register (fictional),2026-01-02,,KH,',
].join('\n');

d('AML/CFT controls (integration)', () => {
  let f: Fixture;
  let productId: string;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    // Two compliance reviewers (maker and checker) in each tenant.
    await grant(f, f.t1, 'admin1', 'RISK_COMPLIANCE');
    await grant(f, f.t1, 'admin2', 'RISK_COMPLIANCE');
    await grant(f, f.t2, 't2admin', 'RISK_COMPLIANCE');
    await grant(f, f.t1, 'nobody', 'AUDITOR');
    productId = (await activeProduct(f, 'PERSONAL_INSTALMENT', 'AML-PL'))
      .productId;
  }, 120_000);
  afterAll(async () => f?.app.close());

  const terms = {
    principal: '5000',
    numberOfInstalments: 12,
    disbursementDate: '2026-01-05',
  };
  const newApplication = async (borrowerId: string) => {
    const app = expectOk(
      await f
        .as('ro')
        .post('/lending/applications', { borrowerId, productId, terms }),
    );
    await docs(f, app.id, ['ID_DOCUMENT']);
    return app.id as string;
  };
  const clear = async (borrowerId: string) => {
    expectOk(
      await f.as('admin1').post(`/lending/aml/customers/${borrowerId}/status`, {
        status: 'CLEAR',
        reason: 'Screened: no match on the lists in force',
      }),
    );
    return expectOk(
      await f
        .as('admin2')
        .post(`/lending/aml/customers/${borrowerId}/clearance/decision`, {
          approve: true,
        }),
    );
  };
  const flag = (borrowerId: string) =>
    f.as('admin1').post(`/lending/aml/customers/${borrowerId}/status`, {
      status: 'FLAGGED',
      reason: 'Unusual cash deposits reported by the branch',
    });
  const summary = async (borrowerId: string, user = 'admin1') =>
    expectOk(await f.as(user).get(`/lending/aml/customers/${borrowerId}`));
  const casesOf = async (borrowerId: string) =>
    expectOk(
      await f.as('admin1').get(`/lending/aml/cases?borrowerId=${borrowerId}`),
    ).data;

  describe('the lending gate', () => {
    it('refuses submission until the borrower is KYC-verified and AML-cleared, whatever the workflow', async () => {
      const b = await borrower(f, f.t1, f.b1, {
        kycStatus: 'PENDING',
        amlStatus: 'NOT_SCREENED',
      });
      const appId = await newApplication(b.id);

      const caps = expectOk(
        await f
          .as('ro')
          .get(`/lending/access/capabilities/APPLICATION/${appId}`),
      );
      expect(caps['loan_application.submit'].allowed).toBe(false);
      expect(caps['loan_application.submit'].blockedBy).toEqual(
        expect.arrayContaining([expect.objectContaining({ layer: 'AML' })]),
      );

      const blocked = await f
        .as('ro')
        .post(`/lending/applications/${appId}/submit`);
      expect(blocked.status).toBe(400);
      expect(blocked.body.code).toBe('AML_CDD_INCOMPLETE');
      expect(blocked.body.blockedBy[0].message).toMatch(
        /identity \(KYC\) is not verified/,
      );
      expect(blocked.body.blockedBy[0].message).toMatch(/not been AML-cleared/);

      await f.system(() =>
        f.prisma.borrower.update({
          where: { id: b.id },
          data: { kycStatus: 'VERIFIED' },
        }),
      );
      const stillBlocked = await f
        .as('ro')
        .post(`/lending/applications/${appId}/submit`);
      expect(stillBlocked.status).toBe(400);
      expect(stillBlocked.body.message).not.toMatch(/KYC/);

      await clear(b.id);
      expectOk(await f.as('ro').post(`/lending/applications/${appId}/submit`));
    });

    it('checks a guarantor on file as a customer too', async () => {
      const b = await borrower(f, f.t1, f.b1);
      const g = await borrower(f, f.t1, f.b1, {
        firstName: 'Chan',
        lastName: 'Sopheap',
        amlStatus: 'NOT_SCREENED',
      });
      const appId = await newApplication(b.id);
      expectOk(
        await f.as('ro').post(`/lending/applications/${appId}/guarantees`, {
          guarantorName: 'Chan Sopheap',
          guarantorBorrowerId: g.id,
          type: 'PERSONAL',
          amount: '1000',
        }),
      );
      const blocked = await f
        .as('ro')
        .post(`/lending/applications/${appId}/submit`);
      expect(blocked.status).toBe(400);
      expect(blocked.body.message).toMatch(/Guarantor Chan Sopheap/);
      await clear(g.id);
      expectOk(await f.as('ro').post(`/lending/applications/${appId}/submit`));
    });

    it('refuses booking and disbursement once a customer is flagged, until cleared again', async () => {
      const b = await borrower(f, f.t1, f.b1);
      const appId = await newApplication(b.id);
      expectOk(await f.as('ro').post(`/lending/applications/${appId}/submit`));
      expectOk(
        await f.as('analyst').post(`/lending/applications/${appId}/recommend`, {
          recommendation: 'APPROVE',
          rationale: 'Affordable',
        }),
      );
      expectOk(
        await f.as('approver').post(`/lending/applications/${appId}/approve`, {
          rationale: 'Within authority',
        }),
      );

      // One person flags; it takes effect at once.
      expect(expectOk(await flag(b.id)).amlStatus).toBe('FLAGGED');
      const caps = expectOk(
        await f
          .as('opsMaker')
          .get(`/lending/access/capabilities/APPLICATION/${appId}`),
      );
      expect(caps['loan.agreement.book'].allowed).toBe(false);
      expect(
        caps['loan.agreement.book'].blockedBy.map((x: any) => x.message).join(),
      ).toMatch(/flagged by AML\/CFT review/);
      const book = await f
        .as('opsMaker')
        .post(`/lending/applications/${appId}/book`, {});
      expect(book.status).toBe(400);
      expect(book.body.code).toBe('AML_CDD_INCOMPLETE');

      await clear(b.id);
      await acceptKeyFacts(f, appId);
      const booked = expectOk(
        await f.as('opsMaker').post(`/lending/applications/${appId}/book`, {}),
      );
      const loanId = booked.account.id as string;
      const view = expectOk(
        await f.as('opsMaker').get(`/lending/applications/${appId}`),
      );
      for (const cp of view.conditions)
        expectOk(
          await f
            .as('opsMaker')
            .post(`/lending/applications/${appId}/conditions/${cp.code}`, {
              resolution: 'SATISFIED',
              evidence: 'Seen',
            }),
        );

      expectOk(await flag(b.id));
      const loanCaps = expectOk(
        await f
          .as('opsMaker')
          .get(`/lending/access/capabilities/LOAN_ACCOUNT/${loanId}`),
      );
      expect(loanCaps['loan.disbursement.prepare'].allowed).toBe(false);
      const prepare = await f
        .as('opsMaker')
        .post(`/lending/loans/${loanId}/disbursements`, {});
      expect(prepare.status).toBe(400);
      expect(prepare.body.code).toBe('AML_CDD_INCOMPLETE');

      await clear(b.id);
      const task = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/loans/${loanId}/disbursements`, {}),
      );
      expectOk(
        await f
          .as('opsChecker')
          .post(`/lending/loans/${loanId}/disbursements/${task.id}/decision`, {
            approve: true,
          }),
      );
      // Flagged between approval and payout: execution is refused too.
      expectOk(await flag(b.id));
      const exec = await f
        .as('opsChecker')
        .post(
          `/lending/loans/${loanId}/disbursements/execute`,
          { externalReference: 'CASH-1' },
          key('aml'),
        );
      expect(exec.status).toBe(400);
      expect(exec.body.code).toBe('AML_CDD_INCOMPLETE');
    });
  });

  describe('AML clearance takes two people', () => {
    it('is recorded by one compliance user, approved by another; officers cannot clear', async () => {
      const b = await borrower(f, f.t1, f.b1, { amlStatus: 'NOT_SCREENED' });
      const ro = await f
        .as('ro')
        .post(`/lending/aml/customers/${b.id}/status`, {
          status: 'CLEAR',
          reason: 'I know this customer well',
        });
      expect(ro.status).toBe(403);

      const proposed = expectOk(
        await f.as('admin1').post(`/lending/aml/customers/${b.id}/status`, {
          status: 'CLEAR',
          reason: 'Screened: no match',
        }),
      );
      expect(proposed.amlStatus).toBe('NOT_SCREENED');
      expect(proposed.pendingClearance.taskId).toEqual(expect.any(String));

      const self = await f
        .as('admin1')
        .post(`/lending/aml/customers/${b.id}/clearance/decision`, {
          approve: true,
        });
      expect(self.status).toBe(403);
      expect(self.body.code).toBe('ACCESS_DENIED');
      expect((await summary(b.id)).amlStatus).toBe('NOT_SCREENED');

      const again = await f
        .as('admin1')
        .post(`/lending/aml/customers/${b.id}/status`, {
          status: 'CLEAR',
          reason: 'Screened again',
        });
      expect(again.status).toBe(409);

      const refused = await f
        .as('admin2')
        .post(`/lending/aml/customers/${b.id}/clearance/decision`, {
          approve: false,
        });
      expect(refused.status).toBe(400);

      const done = expectOk(
        await f
          .as('admin2')
          .post(`/lending/aml/customers/${b.id}/clearance/decision`, {
            approve: true,
          }),
      );
      expect(done.amlStatus).toBe('CLEAR');
      const s = await summary(b.id);
      expect(s.amlStatus).toBe('CLEAR');
      expect(s.amlStatusChangedBy).toBe(f.users.admin2.id);
      expect(s.amlRiskRating).toBe('LOW');
      expect(s.gate.clear).toBe(true);

      // Every change is in the audit trail.
      const trail = await f.system(() =>
        f.prisma.auditEvent.findMany({
          where: {
            tenantId: f.t1,
            resourceId: b.id,
            action: { startsWith: 'aml.status' },
            outcome: 'SUCCESS',
          },
          select: { action: true, actorId: true },
        }),
      );
      expect(trail.map((t: any) => t.action).sort()).toEqual([
        'aml.status.approve',
        'aml.status.propose',
      ]);
    });

    it('relationship officers see the screening status of their own branch’s customers only', async () => {
      const own = await borrower(f, f.t1, f.b1);
      const other = await borrower(f, f.t1, f.b2);
      expect((await summary(own.id, 'ro')).amlStatus).toBe('CLEAR');
      expect(
        (await f.as('ro').get(`/lending/aml/customers/${other.id}`)).status,
      ).toBe(403);
    });
  });

  describe('watch lists, screening and dispositions', () => {
    let sanctioned: string;
    let falsePositive: string;

    it('rejects a malformed list line by line', async () => {
      const r = await f.as('admin1').post('/lending/aml/watch-lists', {
        listCode: 'TEST_LIST',
        name: 'Test list',
        fileName: 'bad.csv',
        content: 'name,type,source,list_date\nX,NOPE,,2026-02-30',
      });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('WATCH_LIST_INVALID');
      expect(r.body.issues.length).toBeGreaterThanOrEqual(3);
    });

    it('activates a list version by a second person and re-screens every customer in the background', async () => {
      // Customers on file before the list arrives.
      sanctioned = (
        await borrower(f, f.t1, f.b1, {
          firstName: 'Phantom',
          lastName: 'Testname',
        })
      ).id;
      falsePositive = (
        await borrower(f, f.t1, f.b1, {
          firstName: 'Fictional',
          lastName: 'Person',
        })
      ).id;

      const ro = await f.as('ro').post('/lending/aml/watch-lists', {
        listCode: 'TEST_LIST',
        name: 'Test list',
        fileName: 'list.csv',
        content: LIST,
      });
      expect(ro.status).toBe(403);
      const v = expectOk(
        await f.as('admin1').post('/lending/aml/watch-lists', {
          listCode: 'TEST_LIST',
          name: 'Test list',
          fileName: 'list.csv',
          content: LIST,
        }),
      );
      expect(v.status).toBe('PENDING');
      expect(v.entryCount).toBe(2);
      const dup = await f.as('admin1').post('/lending/aml/watch-lists', {
        listCode: 'TEST_LIST',
        name: 'Test list',
        fileName: 'list-again.csv',
        content: LIST,
      });
      expect(dup.status).toBe(409);

      const self = await f
        .as('admin1')
        .post(`/lending/aml/watch-lists/${v.id}/decision`, { approve: true });
      expect(self.status).toBe(403);

      // A pending list is not screened against.
      const before = expectOk(
        await f
          .as('admin1')
          .post(`/lending/aml/customers/${sanctioned}/screen`),
      );
      expect(before.hits).toBe(0);

      const activated = expectOk(
        await f
          .as('admin2')
          .post(`/lending/aml/watch-lists/${v.id}/decision`, { approve: true }),
      );
      expect(activated.version.status).toBe('ACTIVE');
      expect(activated.rescreenJobId).toEqual(expect.any(String));
      const queued = await f.system(() =>
        f.prisma.amlRescreenJob.findFirst({
          where: { id: activated.rescreenJobId },
        }),
      );
      expect(queued.status).toBe('PENDING');

      const run = expectOk(
        await f.as('admin2').post('/lending/aml/rescreen-jobs/run'),
      );
      const job = run.jobs.find((j: any) => j.id === activated.rescreenJobId);
      expect(job.status).toBe('COMPLETED');
      expect(job.casesOpened).toBeGreaterThanOrEqual(2);
      const lists = expectOk(
        await f.as('admin1').get('/lending/aml/watch-lists'),
      );
      expect(
        lists.jobs.find((j: any) => j.id === activated.rescreenJobId).status,
      ).toBe('COMPLETED');

      const cases = await casesOf(sanctioned);
      expect(cases).toHaveLength(1);
      expect(cases[0]).toMatchObject({
        status: 'OPEN',
        trigger: 'LIST_ACTIVATION',
        topType: 'SANCTION',
      });
      expect(cases[0].hits[0].matchedName).toBe('Phantom Testname');

      // The open case blocks lending even though the customer was CLEAR.
      const appId = await newApplication(sanctioned);
      const blocked = await f
        .as('ro')
        .post(`/lending/applications/${appId}/submit`);
      expect(blocked.status).toBe(400);
      expect(blocked.body.message).toMatch(
        /watch-list match awaiting compliance review/,
      );
      // …and clearing is refused while it is open.
      const clearing = await f
        .as('admin1')
        .post(`/lending/aml/customers/${sanctioned}/status`, {
          status: 'CLEAR',
          reason: 'Trying to clear',
        });
      expect(clearing.status).toBe(409);
    });

    it('a false positive is disposed by two people and not raised again', async () => {
      const [c] = await casesOf(falsePositive);
      const proposed = expectOk(
        await f.as('admin1').post(`/lending/aml/cases/${c.id}/disposition`, {
          outcome: 'FALSE_POSITIVE',
          reason: 'Different date of birth and nationality',
        }),
      );
      expect(proposed.status).toBe('PENDING_APPROVAL');
      const self = await f
        .as('admin1')
        .post(`/lending/aml/cases/${c.id}/disposition/decision`, {
          approve: true,
        });
      expect(self.status).toBe(403);
      const decided = expectOk(
        await f
          .as('admin2')
          .post(`/lending/aml/cases/${c.id}/disposition/decision`, {
            approve: true,
          }),
      );
      expect(decided.status).toBe('FALSE_POSITIVE');
      expect(decided.proposedBy).toBe(f.users.admin1.id);
      expect(decided.decidedBy).toBe(f.users.admin2.id);

      const again = expectOk(
        await f
          .as('admin1')
          .post(`/lending/aml/customers/${falsePositive}/screen`),
      );
      expect(again.hits).toBe(0);
      expect((await summary(falsePositive)).gate.clear).toBe(true);
    });

    it('a confirmed sanctions match flags the customer, raises a referral and cannot be cleared', async () => {
      const [c] = await casesOf(sanctioned);
      expectOk(
        await f.as('admin1').post(`/lending/aml/cases/${c.id}/disposition`, {
          outcome: 'TRUE_MATCH',
          reason: 'Alias and date of birth match the list entry',
        }),
      );
      const decided = expectOk(
        await f
          .as('admin2')
          .post(`/lending/aml/cases/${c.id}/disposition/decision`, {
            approve: true,
          }),
      );
      expect(decided.status).toBe('TRUE_MATCH');
      expect(decided.strReference).toMatch(/^STR-/);
      expect((await summary(sanctioned)).amlStatus).toBe('FLAGGED');

      const clearing = await f
        .as('admin1')
        .post(`/lending/aml/customers/${sanctioned}/status`, {
          status: 'CLEAR',
          reason: 'Trying to clear',
        });
      expect(clearing.status).toBe(409);
      expect(clearing.body.code).toBe('AML_SANCTIONED');

      const strs = expectOk(await f.as('admin2').get('/lending/aml/str')).data;
      const str = strs.find((s: any) => s.reference === decided.strReference);
      expect(str).toMatchObject({
        borrowerId: sanctioned,
        screeningCaseId: c.id,
        status: 'OPEN',
      });
    });

    it('screens a new customer at creation; a PEP match requires approved EDD before lending', async () => {
      const created = expectOk(
        await f.as('ro').post('/borrowers', {
          firstName: 'Example',
          lastName: 'Minister Pich',
          dateOfBirth: '1972-03-04',
          occupation: 'Civil servant',
          monthlyIncome: 3000,
        }),
      );
      const pep = created.id as string;
      const [c] = await casesOf(pep);
      expect(c).toMatchObject({
        status: 'OPEN',
        trigger: 'CUSTOMER_CREATE',
        topType: 'PEP',
      });
      await f.system(() =>
        f.prisma.borrower.update({
          where: { id: pep },
          data: { kycStatus: 'VERIFIED' },
        }),
      );

      expectOk(
        await f.as('admin1').post(`/lending/aml/cases/${c.id}/disposition`, {
          outcome: 'TRUE_MATCH',
          reason: 'Confirmed: serving official on the PEP register',
        }),
      );
      const decided = expectOk(
        await f
          .as('admin2')
          .post(`/lending/aml/cases/${c.id}/disposition/decision`, {
            approve: true,
          }),
      );
      expect(decided.strReference).toBeNull();
      let s = await summary(pep);
      expect(s).toMatchObject({
        amlStatus: 'FLAGGED',
        pep: true,
        amlRiskRating: 'HIGH',
        eddRequired: true,
      });

      // A PEP may be cleared (two people), but cannot borrow without EDD.
      await clear(pep);
      s = await summary(pep);
      expect(s.amlStatus).toBe('CLEAR');
      expect(s.gate.clear).toBe(false);
      expect(s.gate.reasons.join()).toMatch(
        /politically exposed person and needs approved enhanced due diligence/,
      );
      const appId = await newApplication(pep);
      expect(
        (await f.as('ro').post(`/lending/applications/${appId}/submit`)).status,
      ).toBe(400);

      const edd = expectOk(
        await f.as('admin1').post(`/lending/aml/customers/${pep}/edd`, {
          sourceOfFunds: 'Government salary, paid monthly into a bank account',
          sourceOfWealth: 'Inherited family land, title deed sighted',
          documentReference: 'Title deed no. FICT-001 and salary slips',
        }),
      );
      expect(edd).toMatchObject({ status: 'PENDING', reason: 'PEP' });
      const self = await f
        .as('admin1')
        .post(`/lending/aml/edd/${edd.id}/decision`, { approve: true });
      expect(self.status).toBe(403);
      const ro = await f
        .as('ro')
        .post(`/lending/aml/edd/${edd.id}/decision`, { approve: true });
      expect(ro.status).toBe(403);
      expect(
        expectOk(
          await f
            .as('admin2')
            .post(`/lending/aml/edd/${edd.id}/decision`, { approve: true }),
        ).status,
      ).toBe('APPROVED');
      expect((await summary(pep)).gate.clear).toBe(true);
      expectOk(await f.as('ro').post(`/lending/applications/${appId}/submit`));
    });
  });

  describe('customer risk rating', () => {
    it('rates from the tenant’s factors; HIGH needs approved EDD before the gate passes', async () => {
      const b = await borrower(f, f.t1, f.b1, { occupation: 'Market vendor' });
      const rated = expectOk(
        await f.as('admin1').post(`/lending/aml/customers/${b.id}/risk-rating`),
      );
      expect(rated.rating).toBe('MEDIUM');
      expect(
        rated.factors.find((x: any) => x.code === 'CASH_INTENSITY').present,
      ).toBe(true);

      // A higher-risk nationality, through the customer API, re-rates them.
      expectOk(
        await f.as('admin1').put(`/borrowers/${b.id}`, { nationality: 'KP' }),
      );
      const s = await summary(b.id);
      expect(s.amlRiskRating).toBe('HIGH');
      expect(s.amlNextReviewOn).toBe('2027-01-05');
      expect(s.gate.reasons.join()).toMatch(/rated HIGH risk/);
      const list = expectOk(
        await f.as('admin1').get('/lending/aml/risk-ratings?rating=HIGH'),
      ).data;
      expect(list.find((r: any) => r.id === b.id)).toMatchObject({
        eddRequired: true,
        eddStatus: 'NONE',
      });

      const edd = expectOk(
        await f.as('admin1').post(`/lending/aml/customers/${b.id}/edd`, {
          sourceOfFunds: 'Market stall takings, daily',
          sourceOfWealth: 'Savings and a family house',
          documentReference: 'Market licence and bank statements',
        }),
      );
      expect(edd.reason).toBe('HIGH_RISK');
      expectOk(
        await f
          .as('admin2')
          .post(`/lending/aml/edd/${edd.id}/decision`, { approve: true }),
      );
      expect((await summary(b.id)).gate.clear).toBe(true);
    });
  });

  describe('cash transaction report', () => {
    let borrowerId: string;

    beforeAll(async () => {
      // A low threshold for the test, as the lender's approved settings.
      await f.system(() =>
        f.prisma.tenantLendingSettings.create({
          data: {
            tenantId: f.t1,
            version: 1,
            settings: { aml: { ctr: { thresholds: { USD: '100' } } } },
            status: 'ACTIVE',
            makerId: f.users.finance.id,
            checkerId: f.users.admin1.id,
          },
        }),
      );
      const r = await originateAndDisburse(f, productId, terms);
      borrowerId = r.borrowerId;
      const repay = (amount: string, channel: string) =>
        f
          .as('opsMaker')
          .post(
            `/lending/loans/${r.loanId}/repayments`,
            { amount, channel },
            key('ctr'),
          );
      expectOk(await repay('60.00', 'BRANCH_CASH'));
      expectOk(await repay('45.00', 'BRANCH_CASH'));
      expectOk(await repay('500.00', 'BANK_TRANSFER'));
    });

    it('reports same-day cash of one customer at or above the threshold, aggregated', async () => {
      const report = expectOk(
        await f
          .as('admin2')
          .get('/lending/aml/ctr?from=2026-01-05&to=2026-01-05'),
      );
      expect(report.thresholds.USD).toBe('100');
      const mine = report.groups.filter(
        (g: any) => g.borrowerId === borrowerId,
      );
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({
        basis: 'AGGREGATED',
        total: '105',
        currency: 'USD',
      });
      expect(mine[0].transactions.map((t: any) => t.amount).sort()).toEqual([
        '45',
        '60',
      ]);
      expect(mine[0].customer.name).toBe('Sok Dara');
      // The disbursement recorded no channel: counted, not guessed.
      expect(report.withoutChannel).toBeGreaterThanOrEqual(1);

      const csv = await f
        .as('admin2')
        .get('/lending/aml/ctr.csv?from=2026-01-05&to=2026-01-05');
      expect(csv.status).toBe(200);
      expect(csv.headers['content-type']).toMatch(/text\/csv/);
      expect(csv.text).toMatch(/AGGREGATED/);
      expect(csv.text.split('\n')[0]).toMatch(/^business_date,customer_id/);
    });

    it('is confined to the reader’s branches', async () => {
      const own = expectOk(
        await f.as('ro').get('/lending/aml/ctr?from=2026-01-05&to=2026-01-05'),
      );
      expect(own.groups.some((g: any) => g.borrowerId === borrowerId)).toBe(
        true,
      );
      const other = expectOk(
        await f.as('ro2').get('/lending/aml/ctr?from=2026-01-05&to=2026-01-05'),
      );
      expect(other.groups.some((g: any) => g.borrowerId === borrowerId)).toBe(
        false,
      );
      expect(
        (
          await f
            .as('opsMaker')
            .get('/lending/aml/ctr?from=2026-02-01&to=2026-01-01')
        ).status,
      ).toBe(400);
    });
  });

  describe('suspicious transaction referrals', () => {
    it('any officer raises one; only compliance sees and works it', async () => {
      const b = await borrower(f, f.t1, f.b1);
      const raised = expectOk(
        await f.as('ro').post('/lending/aml/str', {
          borrowerId: b.id,
          grounds:
            'Customer repaid a large amount in cash days after disbursement and would not explain the source.',
          indicators: ['UNUSUAL_CASH', 'UNEXPLAINED_EARLY_REPAYMENT'],
        }),
      );
      expect(Object.keys(raised).sort()).toEqual(['id', 'reference', 'status']);
      expect(raised.status).toBe('SUBMITTED');

      // Tipping-off: officers, auditors and administrators see nothing.
      for (const user of ['ro', 'nobody', 'opsMaker'])
        expect((await f.as(user).get('/lending/aml/str')).status).toBe(403);
      expect(
        (await f.as('ro').get(`/lending/aml/str/${raised.id}`)).status,
      ).toBe(403);
      expect(JSON.stringify(await summary(b.id))).not.toContain(
        raised.reference,
      );

      // An officer cannot raise one on a customer outside their branch.
      const elsewhere = await borrower(f, f.t1, f.b2);
      expect(
        (
          await f.as('ro').post('/lending/aml/str', {
            borrowerId: elsewhere.id,
            grounds: 'Outside my branch, testing scope',
          })
        ).status,
      ).toBe(403);

      const got = expectOk(
        await f.as('admin1').get(`/lending/aml/str/${raised.id}`),
      );
      expect(got.raisedBy).toBe(f.users.ro.id);
      const early = await f
        .as('admin1')
        .post(`/lending/aml/str/${raised.id}/reported`, {
          cafiuReference: 'CAFIU-TEST-1',
          reportedOn: '2026-01-05',
        });
      expect(early.status).toBe(409);
      expect(
        expectOk(
          await f.as('admin1').post(`/lending/aml/str/${raised.id}/review`, {
            decision: 'TO_REPORT',
            notes: 'Cash structuring pattern; report to CAFIU',
          }),
        ).status,
      ).toBe('TO_REPORT');
      const reported = expectOk(
        await f.as('admin1').post(`/lending/aml/str/${raised.id}/reported`, {
          cafiuReference: 'CAFIU-TEST-1',
          reportedOn: '2026-01-05',
        }),
      );
      expect(reported).toMatchObject({
        status: 'REPORTED',
        cafiuReference: 'CAFIU-TEST-1',
        cafiuReportedOn: '2026-01-05',
      });
      // The trail records that a referral exists, not on whom.
      const trail = await f.system(() =>
        f.prisma.auditEvent.findFirst({
          where: {
            tenantId: f.t1,
            action: 'aml.str.raise',
            resourceId: raised.id,
          },
        }),
      );
      expect(JSON.stringify(trail.details)).not.toContain(b.id);
    });
  });

  describe('tenant isolation', () => {
    it('no AML record of one tenant is visible to or changeable by another', async () => {
      const [aCase] = expectOk(
        await f.as('admin1').get('/lending/aml/cases'),
      ).data;
      const versions = expectOk(
        await f.as('admin1').get('/lending/aml/watch-lists'),
      ).versions;
      const str = expectOk(await f.as('admin1').get('/lending/aml/str'))
        .data[0];
      const edd = await f.system(() =>
        f.prisma.amlEddRecord.findFirst({ where: { tenantId: f.t1 } }),
      );
      const job = await f.system(() =>
        f.prisma.amlRescreenJob.findFirst({ where: { tenantId: f.t1 } }),
      );
      expect(aCase && versions.length && str && edd && job).toBeTruthy();

      const t2 = f.as('t2admin');
      expect(expectOk(await t2.get('/lending/aml/cases')).data).toEqual([]);
      expect(expectOk(await t2.get('/lending/aml/watch-lists'))).toEqual({
        versions: [],
        jobs: [],
      });
      expect(expectOk(await t2.get('/lending/aml/str')).data).toEqual([]);
      expect(expectOk(await t2.get('/lending/aml/risk-ratings')).data).toEqual(
        [],
      );
      expect((await t2.get(`/lending/aml/cases/${aCase.id}`)).status).toBe(404);
      expect(
        (await t2.get(`/lending/aml/watch-lists/${versions[0].id}`)).status,
      ).toBe(404);
      expect((await t2.get(`/lending/aml/str/${str.id}`)).status).toBe(404);
      expect(
        (await t2.get(`/lending/aml/customers/${aCase.borrowerId}`)).status,
      ).toBe(404);
      expect(
        (
          await t2.post(`/lending/aml/edd/${edd.id}/decision`, {
            approve: true,
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await t2.post(`/lending/aml/str/${str.id}/review`, {
            decision: 'NO_FURTHER_ACTION',
            notes: 'cross-tenant',
          })
        ).status,
      ).toBe(404);
      const run = expectOk(await t2.post('/lending/aml/rescreen-jobs/run'));
      expect(run.jobs).toEqual([]);

      // Row-level security: tenant 2's database session sees none of the rows.
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the harness configured the environment
      const { runAsTenant } = require('../../src/prisma/tenant-context');
      const counts = await runAsTenant(f.t2, () =>
        f.prisma.$transaction(async (tx: any) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${f.t2}, true)`;
          const out: Record<string, number> = {};
          for (const t of [
            'AmlWatchListVersion',
            'AmlWatchListEntry',
            'AmlScreeningCase',
            'AmlRescreenJob',
            'AmlEddRecord',
            'AmlStrCase',
          ]) {
            const [r] = await tx.$queryRawUnsafe(
              `SELECT count(*)::int AS n FROM "${t}" WHERE "tenantId" = $1`,
              f.t1,
            );
            out[t] = r.n;
          }
          return out;
        }),
      );
      expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    });
  });
});
