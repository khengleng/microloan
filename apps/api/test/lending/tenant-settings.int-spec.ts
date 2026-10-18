/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-require-imports -- integration fixtures: rows come from the untyped API and Prisma client; services are required after the harness has set the environment. */
/**
 * The lender's own operating parameters (TenantLendingSettings, DECISIONS
 * D-071) and the durable job claims that replaced in-process guards (D-072).
 */
import {
  Fixture,
  TEST_DB,
  bootstrap,
  borrower,
  expectOk,
  grant,
} from './harness';
import { standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Tenant lending settings and job claims (integration)', () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    await grant(f, f.t1, 'nobody', 'RISK_COMPLIANCE');
  }, 90_000);
  afterAll(async () => f?.app.close());

  const delegate = (days: number) => {
    const from = new Date(Date.now() + 60_000);
    const to = new Date(from.getTime() + days * 86_400_000);
    return f.as('opsMaker').post('/lending/access/delegations', {
      toUserId: f.users.ro.id,
      permissions: ['loan.read'],
      validFrom: from.toISOString(),
      validTo: to.toISOString(),
      reason: 'Holiday cover',
    });
  };

  it('with nothing approved, every value is the documented default', async () => {
    const s = expectOk(await f.as('finance').get('/lending/ops/settings'));
    expect(s.active).toBeNull();
    expect(s.effective).toEqual(s.defaults);
    expect(s.effective.accounting.retainedEarnings).toBe('3100');
    expect(s.effective.accounting.migrationClearing).toBe('3900');
    expect(s.effective.regulatory.sizeBandKhrPerUsd).toBe('4000');
    expect(s.effective.payments).toEqual({
      maxFileLines: 5000,
      maxBackdateDays: 30,
    });
    expect(s.effective.access.maxDelegationDays).toBe(30);
    expect(
      s.effective.regulatory.classes.map((c: { minDpd: number }) => c.minDpd),
    ).toEqual([0, 15, 31, 61, 91]);
    // The default limit applies: a 20-day delegation is accepted.
    expectOk(await delegate(20));
  });

  it('refuses a version that names an account outside the chart, or breaks the class order', async () => {
    const bad = await f.as('finance').post('/lending/ops/settings', {
      settings: { accounting: { retainedEarnings: '3999' } },
    });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain('3999');
    const disorder = await f.as('finance').post('/lending/ops/settings', {
      settings: {
        regulatory: {
          classes: [
            { code: 'STANDARD', label: 'Standard', minDpd: 0, rate: '0.01' },
            {
              code: 'SPECIAL_MENTION',
              label: 'Special mention',
              minDpd: 40,
              rate: '0.03',
            },
            {
              code: 'SUBSTANDARD',
              label: 'Substandard',
              minDpd: 31,
              rate: '0.25',
            },
            { code: 'DOUBTFUL', label: 'Doubtful', minDpd: 61, rate: '0.5' },
            { code: 'LOSS', label: 'Loss', minDpd: 91, rate: '1' },
          ],
        },
      },
    });
    expect(disorder.status).toBe(400);
    const unknown = await f.as('finance').post('/lending/ops/settings', {
      settings: { formula: 'x' },
    });
    expect(unknown.status).toBe(400);
  });

  it('only a permitted maker proposes, and the maker cannot approve their own version', async () => {
    expect(
      (await f.as('ro').post('/lending/ops/settings', { settings: {} })).status,
    ).toBe(403);
    const v = expectOk(
      await f.as('finance').post('/lending/ops/settings', {
        settings: { access: { maxDelegationDays: 10 } },
        reason: 'Shorter delegations',
      }),
    );
    expect(v.status).toBe('PENDING');
    expect(
      (
        await f
          .as('finance')
          .post(`/lending/ops/settings/${v.id}/decision`, { approve: true })
      ).status,
    ).toBe(403);
    // Nothing applies until approved.
    expectOk(await delegate(20));
    const ok = expectOk(
      await f
        .as('nobody')
        .post(`/lending/ops/settings/${v.id}/decision`, { approve: true }),
    );
    expect(ok.status).toBe('ACTIVE');
    expect(ok.checkerId).not.toBe(ok.makerId);
  });

  it('the approved version applies at once, and only to what it changes', async () => {
    const res = await delegate(20);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('at most 10 days');
    expectOk(await delegate(9));
    const s = expectOk(await f.as('finance').get('/lending/ops/settings'));
    expect(s.active.version).toBe(1);
    expect(s.effective.access.maxDelegationDays).toBe(10);
    // Everything not set stays at its default.
    expect(s.effective.accounting).toEqual(s.defaults.accounting);
    // The access overview gives the forms the same limit.
    const overview = expectOk(await f.as('admin1').get('/lending/access'));
    expect(overview.limits).toEqual({ maxDelegationDays: 10 });
  });

  it('a second approved version retires the first; another tenant is untouched', async () => {
    const v2 = expectOk(
      await f.as('finance').post('/lending/ops/settings', {
        settings: {
          access: { maxDelegationDays: 30 },
          payments: { maxBackdateDays: 15 },
        },
      }),
    );
    expectOk(
      await f
        .as('nobody')
        .post(`/lending/ops/settings/${v2.id}/decision`, { approve: true }),
    );
    const rows = await f.system(() =>
      f.prisma.tenantLendingSettings.findMany({
        where: { tenantId: f.t1 },
        orderBy: { version: 'asc' },
      }),
    );
    expect(rows.map((r: { status: string }) => r.status)).toEqual([
      'RETIRED',
      'ACTIVE',
    ]);
    expect(
      await f.system(() =>
        f.prisma.tenantLendingSettings.count({ where: { tenantId: f.t2 } }),
      ),
    ).toBe(0);
  });

  it('the database refuses a version approved by its own maker', async () => {
    await expect(
      f.system(() =>
        f.prisma.tenantLendingSettings.create({
          data: {
            tenantId: f.t2,
            version: 1,
            settings: {},
            status: 'ACTIVE',
            makerId: f.users.admin2.id,
            checkerId: f.users.admin2.id,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  /** A disbursed legacy loan whose first instalment is `overdueDays` past due. */
  async function overdueLegacyLoan(overdueDays: number) {
    return f.system(async () => {
      const b = await borrower(f, f.t1, f.b1);
      const product = await f.prisma.loanProduct.create({
        data: {
          tenantId: f.t1,
          name: `Penalty test ${overdueDays}`,
          interestMethod: 'FLAT',
        },
      });
      const day = 86_400_000;
      const loan = await f.prisma.loan.create({
        data: {
          tenantId: f.t1,
          borrowerId: b.id,
          productId: product.id,
          branchId: f.b1,
          principal: '1000',
          annualInterestRate: '12',
          termMonths: 1,
          interestMethod: 'FLAT',
          startDate: new Date(Date.now() - (overdueDays + 30) * day),
          status: 'DISBURSED',
        },
      });
      const schedule = await f.prisma.repaymentSchedule.create({
        data: {
          loanId: loan.id,
          installmentNumber: 1,
          dueDate: new Date(Date.now() - overdueDays * day),
          principalAmount: '1000',
          interestAmount: '10',
          totalAmount: '1010',
          outstandingPrincipal: '0',
        },
      });
      return { loanId: loan.id as string, scheduleId: schedule.id as string };
    });
  }

  it("two instances running the legacy penalty job charge a penalty once; the DEFAULTED threshold is the lender's", async () => {
    const {
      PenaltyCronService,
    } = require('../../src/penalty-cron/penalty-cron.service');
    const job = f.app.get(PenaltyCronService);
    const first = await overdueLegacyLoan(40);
    await Promise.all([job.applyLatePenalties(), job.applyLatePenalties()]);
    const after = await f.system(() =>
      f.prisma.repaymentSchedule.findUnique({
        where: { id: first.scheduleId },
      }),
    );
    const rate = await f.system(() =>
      f.prisma.tenant.findUnique({
        where: { id: f.t1 },
        select: { penaltyRatePerDay: true },
      }),
    );
    expect(Number(after.penaltyAmount)).toBe(Number(rate.penaltyRatePerDay));
    expect(Number(after.totalAmount)).toBe(
      1010 + Number(rate.penaltyRatePerDay),
    );
    // 40 days overdue > the default 30: DEFAULTED.
    const loan = await f.system(() =>
      f.prisma.loan.findUnique({ where: { id: first.loanId } }),
    );
    expect(loan.status).toBe('DEFAULTED');

    // With the lender's threshold at 60 days, a 40-day arrear is not a default.
    const v = expectOk(
      await f.as('finance').post('/lending/ops/settings', {
        settings: { legacyServicing: { defaultAfterDaysOverdue: 60 } },
      }),
    );
    expectOk(
      await f
        .as('nobody')
        .post(`/lending/ops/settings/${v.id}/decision`, { approve: true }),
    );
    const second = await overdueLegacyLoan(40);
    await job.applyLatePenalties();
    const loan2 = await f.system(() =>
      f.prisma.loan.findUnique({ where: { id: second.loanId } }),
    );
    expect(loan2.status).toBe('DISBURSED');
  });

  it('a job run is claimed by exactly one caller, even concurrently and across instances', async () => {
    const { JobClaimService } = require('../../src/prisma/job-claim.service');
    const a = f.app.get(JobClaimService);
    const b = new JobClaimService(f.prisma); // a second instance: another holder
    expect(a.holder).not.toBe(b.holder);
    const results = await Promise.all([
      a.once(f.t1, 'test.reminders', '2026-10-18'),
      b.once(f.t1, 'test.reminders', '2026-10-18'),
      a.once(f.t1, 'test.reminders', '2026-10-18'),
      b.once(f.t1, 'test.reminders', '2026-10-18'),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    // Another day, another tenant: free again.
    expect(await b.once(f.t1, 'test.reminders', '2026-10-19')).toBe(true);
    expect(await a.once(f.t2, 'test.reminders', '2026-10-18')).toBe(true);
  });

  it('a lease is held by one instance, renewed by it, and taken over once released or lapsed', async () => {
    const { JobClaimService } = require('../../src/prisma/job-claim.service');
    const a = new JobClaimService(f.prisma);
    const b = new JobClaimService(f.prisma);
    expect(await a.lease(f.t1, 'test.polling', 'leader', 60_000)).toBe(true);
    expect(await b.lease(f.t1, 'test.polling', 'leader', 60_000)).toBe(false);
    expect(await a.lease(f.t1, 'test.polling', 'leader', 60_000)).toBe(true);
    await a.release(f.t1, 'test.polling', 'leader');
    expect(await b.lease(f.t1, 'test.polling', 'leader', 1)).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(await a.lease(f.t1, 'test.polling', 'leader', 60_000)).toBe(true);
    // A run claimed for good is never taken over as a lease.
    expect(await a.once(f.t1, 'test.once', 'x')).toBe(true);
    expect(await b.lease(f.t1, 'test.once', 'x', 60_000)).toBe(false);
  });
});
