/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * What the servicing screens read: the checker's list of pending fee
 * waivers, advance refunds and set-offs; the collections list paged on the
 * server; who made each open task; and a facility's loan account, which is
 * never disbursed directly.
 */
import { Fixture, TEST_DB, bootstrap, expectOk } from './harness';
import { activeProduct, docs, originateAndDisburse, standardRoles } from './setup';
import { borrower } from './harness';

const d = TEST_DB ? describe : describe.skip;

d('Servicing screens (integration)', () => {
  let f: Fixture;
  let productId: string;
  let loanId: string;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    ({ productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-SCREENS',
      (c) => {
        c.pricing.fees = [];
        c.repayment.earlySettlement.feeRate = '0.02';
      },
    ));
    loanId = (
      await originateAndDisburse(f, productId, {
        principal: '3000',
        numberOfInstalments: 6,
        disbursementDate: '2026-01-05',
      })
    ).loanId;
  }, 90_000);
  afterAll(async () => f?.app.close());

  it('lists pending fee waivers for checkers, with loan, borrower and maker', async () => {
    const task = expectOk(
      await f.as('opsMaker').post(`/lending/loans/${loanId}/fee-waivers`, {
        kind: 'EARLY_SETTLEMENT',
        reason: 'Hardship agreed with the branch',
      }),
    );
    const list = expectOk(
      await f
        .as('opsChecker')
        .get('/lending/loans/pending-approvals?action=FEE_WAIVER'),
    );
    const row = list.data.find((r: any) => r.id === task.id);
    expect(row).toBeDefined();
    expect(row.action).toBe('FEE_WAIVER');
    expect(row.loan.id).toBe(loanId);
    expect(row.loan.reference).toMatch(/^LN/);
    expect(row.loan.borrowerName).toBeTruthy();
    expect(row.makerEmail).toMatch(/^opsMaker-/);
    expect(row.mine).toBe(false);
    expect(row.detail.kind).toBe('EARLY_SETTLEMENT');
    // The maker sees their own task marked as theirs.
    const own = expectOk(
      await f
        .as('opsMaker')
        .get('/lending/loans/pending-approvals?action=FEE_WAIVER'),
    );
    expect(own.data.find((r: any) => r.id === task.id).mine).toBe(true);
    // Another kind of task is not mixed in.
    const setOffs = expectOk(
      await f
        .as('opsChecker')
        .get('/lending/loans/pending-approvals?action=SET_OFF'),
    );
    expect(setOffs.data.some((r: any) => r.id === task.id)).toBe(false);
    // A loan outside the caller's branch scope is not listed.
    const other = await f
      .as('ro2')
      .get('/lending/loans/pending-approvals?action=FEE_WAIVER');
    if (other.status === 200)
      expect(other.body.data.some((r: any) => r.id === task.id)).toBe(false);
    else expect(other.status).toBe(403);
    // Unknown task kinds are refused rather than ignored.
    const bad = await f
      .as('opsChecker')
      .get('/lending/loans/pending-approvals?action=DISBURSEMENT');
    expect(bad.status).toBe(400);
    // Once decided, it leaves the list.
    expectOk(
      await f
        .as('opsChecker')
        .post(`/lending/loans/${loanId}/fee-waivers/${task.id}/decision`, {
          approve: false,
        }),
    );
    const after = expectOk(
      await f
        .as('opsChecker')
        .get('/lending/loans/pending-approvals?action=FEE_WAIVER'),
    );
    expect(after.data.some((r: any) => r.id === task.id)).toBe(false);
  });

  it('names the maker of each task on the loan, and says the loan has no facility', async () => {
    const loan = expectOk(await f.as('opsMaker').get(`/lending/loans/${loanId}`));
    expect(loan.facility).toBeNull();
    expect(loan.tasks.length).toBeGreaterThan(0);
    for (const t of loan.tasks) expect(t.makerEmail).toMatch(/@test\.local$/);
  });

  it('pages the past-due list on the server, worst first', async () => {
    const second = (
      await originateAndDisburse(f, productId, {
        principal: '2000',
        numberOfInstalments: 6,
        disbursementDate: '2026-01-05',
      })
    ).loanId;
    await f.system(async () => {
      await f.prisma.loanAccount.update({
        where: { id: loanId },
        data: { daysPastDue: 12 },
      });
      await f.prisma.loanAccount.update({
        where: { id: second },
        data: { daysPastDue: 40 },
      });
    });
    const page = expectOk(
      await f.as('opsMaker').get('/lending/loans?pastDue=1&page=1'),
    );
    expect(page.total).toBe(2);
    expect(page.data.map((l: any) => l.id)).toEqual([second, loanId]);
    expect(page.data.every((l: any) => l.daysPastDue > 0)).toBe(true);
    const all = expectOk(await f.as('opsMaker').get('/lending/loans'));
    expect(all.total).toBeGreaterThanOrEqual(2);
    const beyond = expectOk(
      await f.as('opsMaker').get('/lending/loans?pastDue=1&page=2'),
    );
    expect(beyond.data).toEqual([]);
    await f.system(async () => {
      await f.prisma.loanAccount.updateMany({
        where: { id: { in: [loanId, second] } },
        data: { daysPastDue: 0 },
      });
    });
  });

  it("refuses to disburse a facility's loan account, and says which facility it carries", async () => {
    const { productId: rc } = await activeProduct(
      f,
      'REVOLVING_CREDIT',
      'RC-SCREENS',
    );
    const b = await borrower(f, f.t1, f.b1, { monthlyIncome: '40000' });
    const app = expectOk(
      await f.as('ro').post('/lending/applications', {
        borrowerId: b.id,
        productId: rc,
        terms: {
          principal: '50000',
          numberOfInstalments: 60,
          disbursementDate: '2026-01-05',
          annualRate: '0.12',
        },
      }),
    );
    await docs(f, app.id, ['ID_DOCUMENT']);
    expectOk(await f.as('ro').post(`/lending/applications/${app.id}/submit`));
    expectOk(
      await f.as('analyst').post(`/lending/applications/${app.id}/recommend`, {
        recommendation: 'APPROVE',
        rationale: 'Within policy',
      }),
    );
    expectOk(
      await f.as('approver').post(`/lending/applications/${app.id}/approve`, {
        rationale: 'Approved within authority',
      }),
    );
    const booked = expectOk(
      await f.as('opsMaker').post(`/lending/applications/${app.id}/book`, {}),
    );
    const facilityId = booked.facility.id as string;
    const account = booked.account.id as string;

    const loan = expectOk(await f.as('opsMaker').get(`/lending/loans/${account}`));
    expect(loan.facility.id).toBe(facilityId);
    expect(loan.facility.facilityType).toBe('REVOLVING');
    const fac = expectOk(
      await f.as('opsMaker').get(`/lending/facilities/${facilityId}`),
    );
    expect(fac.receivablesKind).toBeNull();

    const res = await f
      .as('opsMaker')
      .post(`/lending/loans/${account}/disbursements`, {});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('FACILITY_ACCOUNT');
  }, 60_000);
});
