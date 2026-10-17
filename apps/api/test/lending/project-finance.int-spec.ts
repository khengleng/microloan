/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: responses and rows are untyped by nature here. */
/**
 * Project and infrastructure finance (PROJECT_FINANCE, INFRASTRUCTURE,
 * LT-17), end to end over the real API and database:
 *
 *  • construction: tranches drawn against conditions (maker-checker), the
 *    interest of each statement capitalized into principal;
 *  • term-out on a repayment profile sculpted to projected CFADS at the
 *    target DSCR — refused when the projection cannot carry the debt;
 *  • operation: project receipts applied through the cash waterfall — debt
 *    service, reserve top-up, cash sweep, lock-up below the DSCR threshold
 *    and release, distributions — to closure, with the reserve released;
 *  • every posting balanced, the receipts clearing account empty after each
 *    run and reconciliation free of breaks.
 */
import {
  Fixture,
  TEST_DB,
  authority,
  bootstrap,
  borrower,
  expectOk,
  key,
} from './harness';
import { activeProduct, docs, standardRoles } from './setup';
import { lending } from '@microloan/shared';

const d = TEST_DB ? describe : describe.skip;
const D = (v: string | number) => new lending.D(v);

d('Project and infrastructure finance (integration)', () => {
  let f: Fixture;

  async function setBusinessDate(target: string) {
    let current = expectOk(
      await f.as('finance').get('/lending/ops/business-date'),
    ).businessDate as string;
    while (lending.compareDates(current, target) < 0) {
      const step = lending.addDays(current, 31);
      const next = lending.compareDates(step, target) > 0 ? target : step;
      expectOk(
        await f
          .as('finance')
          .post('/lending/ops/business-date', { businessDate: next }),
      );
      current = next;
    }
  }

  async function enableFlag(flagKey: string) {
    const r = expectOk(
      await f.as('admin1').post('/lending/access/flags/rules', {
        flagKey,
        scopeType: 'TENANT',
        enabled: true,
        reason: 'project finance integration tests',
      }),
    );
    expectOk(
      await f
        .as('admin2')
        .post(`/lending/access/flags/changes/${r.approval.id}/decision`, {
          approve: true,
        }),
    );
  }

  async function bookProject(
    productId: string,
    terms: Record<string, unknown>,
    name: string,
  ) {
    const b = await borrower(f, f.t1, f.b1, {
      firstName: name,
      lastName: 'SPV Co',
      monthlyIncome: '900000',
    });
    const app = expectOk(
      await f
        .as('ro')
        .post('/lending/applications', { borrowerId: b.id, productId, terms }),
    );
    await docs(f, app.id, ['ID_DOCUMENT']);
    expectOk(await f.as('ro').post(`/lending/applications/${app.id}/submit`));
    expectOk(
      await f.as('analyst').post(`/lending/applications/${app.id}/recommend`, {
        recommendation: 'APPROVE',
        rationale: 'Bankable base case',
      }),
    );
    expectOk(
      await f.as('approver2').post(`/lending/applications/${app.id}/approve`, {
        rationale: 'Credit committee approval',
      }),
    );
    const booked = expectOk(
      await f.as('opsMaker').post(`/lending/applications/${app.id}/book`, {}),
    );
    return {
      facilityId: booked.facility.id as string,
      loanId: booked.account.id as string,
    };
  }

  async function satisfy(facilityId: string, trancheCode: string) {
    const v = expectOk(
      await f.as('opsMaker').get(`/lending/facilities/${facilityId}`),
    );
    for (const c of v.conditions.filter(
      (x: any) => x.trancheCode === trancheCode && x.status === 'PENDING',
    ))
      expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/facilities/${facilityId}/conditions/${c.id}/satisfy`,
            { evidence: `${c.code} evidence on file` },
          ),
      );
  }

  async function draw(
    facilityId: string,
    trancheCode: string,
    amount: string,
    tag: string,
  ) {
    await satisfy(facilityId, trancheCode);
    const dd = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/drawdowns`, {
          amount,
          trancheCode,
        }),
    );
    // Maker-checker: the requester cannot approve their own drawdown.
    if (tag.endsWith('1')) {
      const own = await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/drawdowns/${dd.id}/approve`);
      expect(own.status).toBe(403);
    }
    expectOk(
      await f
        .as('opsChecker')
        .post(`/lending/facilities/${facilityId}/drawdowns/${dd.id}/approve`),
    );
    return expectOk(
      await f
        .as('opsChecker')
        .post(
          `/lending/facilities/${facilityId}/drawdowns/${dd.id}/release`,
          { externalReference: `EPC-${tag}` },
          key(`pf-${tag}`),
        ),
    );
  }

  async function statement(facilityId: string, periodEnd: string, tag: string) {
    return expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/facilities/${facilityId}/statements`,
          { periodEnd },
          key(`pf-st-${tag}`),
        ),
    );
  }

  async function glNet(loanId: string, accountCode: string) {
    const rows = await f.system(() =>
      f.prisma.lendingJournalLine.findMany({
        where: { tenantId: f.t1, accountCode, loanAccountId: loanId },
      }),
    );
    return rows.reduce(
      (t: any, l: any) => t.plus(l.debit.toString()).minus(l.credit.toString()),
      D(0),
    );
  }

  async function reconcile(loanId: string) {
    const r = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(r.trialBalanceBalanced).toBe(true);
    expect(
      r.breaks.filter(
        (x: { loanAccountId: string }) => x.loanAccountId === loanId,
      ),
    ).toEqual([]);
  }

  const project = async (loanId: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${loanId}/project`));
  const waterfall = (
    loanId: string,
    body: Record<string, string>,
    tag: string,
    who = 'opsMaker',
  ) =>
    f
      .as(who)
      .post(
        `/lending/loans/${loanId}/project/waterfall`,
        body,
        key(`wf-${tag}`),
      );

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    await authority(
      f,
      f.t1,
      'approver2',
      'credit_decision.approve',
      'USD',
      '50000000',
    );
    await authority(
      f,
      f.t1,
      'opsChecker',
      'facility.drawdown.approve',
      'USD',
      '50000000',
    );
    for (const flagKey of [
      'lending.facility.staged_drawdown',
      'lending.project_finance',
    ])
      await enableFlag(flagKey);
    await setBusinessDate('2026-01-05');
  }, 90_000);
  afterAll(async () => f?.app.close());

  describe('project finance: construction, sculpted term-out and the cash waterfall', () => {
    let facilityId: string;
    let loanId: string;
    const cfads = [
      { dueDate: '2027-01-05', cfads: '700000' },
      { dueDate: '2027-07-05', cfads: '900000' },
      { dueDate: '2028-01-05', cfads: '900000' },
      { dueDate: '2028-07-05', cfads: '900000' },
    ];

    beforeAll(async () => {
      const { productId } = await activeProduct(
        f,
        'PROJECT_FINANCE',
        'PF-SOLAR',
        (c) => {
          // A short build keeps the timeline walkable: availability 6 months,
          // tranches at 0, 2 and 4 months.
          c.facility.availabilityMonths = 6;
          c.facility.tranches[1].availableAfterMonths = 2;
          c.facility.tranches[2].availableAfterMonths = 4;
        },
      );
      ({ facilityId, loanId } = await bookProject(
        productId,
        {
          principal: '2000000',
          numberOfInstalments: 24,
          disbursementDate: '2026-01-05',
          annualRate: '0.10',
        },
        'Solar',
      ));
    }, 90_000);

    it('LT-17: booking creates the project in construction and sets up its covenants', async () => {
      const p = await project(loanId);
      expect(p.project.status).toBe('CONSTRUCTION');
      expect(p.project.targetDscr).toBe('1.3');
      expect(p.project.lockUpDscr).toBe('1.1');
      expect(p.facilityId).toBe(facilityId);
      const covs = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}/covenants`),
      );
      expect(covs.map((c: { type: string }) => c.type).sort()).toEqual([
        'FINANCIAL_STATEMENTS',
        'MIN_DSCR',
      ]);
      const v = expectOk(
        await f.as('opsMaker').get(`/lending/facilities/${facilityId}`),
      );
      expect(v.project.capitalizeConstructionInterest).toBe(true);
    });

    it('LT-17: receipts cannot be applied while the project is being built', async () => {
      const r = await waterfall(
        loanId,
        { revenue: '1', operatingCosts: '0', taxes: '0' },
        'early',
      );
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('PROJECT_IN_CONSTRUCTION');
    });

    it('LT-17: tranches are drawn against their conditions and construction interest is capitalized', async () => {
      await draw(facilityId, 'FINANCIAL_CLOSE', '600000', 'pf1');
      await setBusinessDate('2026-03-05');
      const st1 = await statement(facilityId, '2026-03-05', '1');
      expect(D(st1.detail.capitalizedInterest).gt(0)).toBe(true);
      expect(st1.detail.capitalizedInterest).toBe(st1.detail.interest);
      await draw(facilityId, 'CONSTRUCTION', '800000', 'pf2');
      await setBusinessDate('2026-05-05');
      await statement(facilityId, '2026-05-05', '2');
      await draw(facilityId, 'COMPLETION', '600000', 'pf3');
      await setBusinessDate('2026-07-05');
      await statement(facilityId, '2026-07-05', '3');
      const loan = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}`),
      );
      // Nothing is billed during construction: interest became principal.
      expect(D(loan.account.interestReceivable).isZero()).toBe(true);
      expect(D(loan.account.principalOutstanding).gt(D('2000000'))).toBe(true);
      const capitalized = D(loan.account.principalOutstanding).minus('2000000');
      expect(
        capitalized.eq((await glNet(loanId, '1200')).minus('2000000')),
      ).toBe(true);
      await reconcile(loanId);
    });

    it('LT-17: the term-out needs a CFADS projection, and one that cannot carry the debt is refused with the maximum', async () => {
      const bare = await f
        .as('opsChecker')
        .post(`/lending/facilities/${facilityId}/term-out`, {});
      expect(bare.status).toBe(400);
      expect(bare.body.code).toBe('SCULPTING_REQUIRED');
      const thin = await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/sculpting-preview`, {
          cfads: cfads.map((c) => ({ ...c, cfads: '300000' })),
        });
      expect(thin.status).toBe(400);
      expect(thin.body.message).toMatch(/supports at most/);
      const beyond = await f
        .as('opsMaker')
        .post(`/lending/facilities/${facilityId}/sculpting-preview`, {
          cfads: [...cfads, { dueDate: '2029-01-05', cfads: '900000' }],
        });
      expect(beyond.status).toBe(400);
      expect(beyond.body.code).toBe('SCULPT_BEYOND_MATURITY');
    });

    it('LT-17: the preview and the term-out sculpt principal to CFADS at one cover ratio, closing to zero', async () => {
      const preview = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/facilities/${facilityId}/sculpting-preview`, {
            cfads,
          }),
      );
      expect(D(preview.sculptedDscr).gte('1.3')).toBe(true);
      const plan = expectOk(
        await f
          .as('opsChecker')
          .post(`/lending/facilities/${facilityId}/term-out`, { cfads }),
      );
      expect(plan.sculpting.sculptedDscr).toBe(preview.sculptedDscr);
      expect(plan.months).toBe(4);
      const loan = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}`),
      );
      const lines = loan.schedule.filter(
        (l: any) => l.number > 0 && l.status === 'DUE',
      );
      expect(lines.map((l: any) => l.dueDate)).toEqual(
        cfads.map((c) => c.dueDate),
      );
      const principal = lines.reduce(
        (t: any, l: any) => t.plus(l.principalDue),
        D(0),
      );
      expect(principal.eq(loan.account.principalOutstanding)).toBe(true);
      // Lower CFADS in the first period → lower debt service.
      const ds = lines.map((l: any) => D(l.principalDue).plus(l.interestDue));
      expect(ds[0].lt(ds[1])).toBe(true);
      for (let i = 0; i < 3; i++)
        expect(
          D(cfads[i].cfads)
            .div(ds[i])
            .minus(plan.sculpting.sculptedDscr)
            .abs()
            .lt('0.001'),
        ).toBe(true);
      const p = await project(loanId);
      expect(p.project.status).toBe('OPERATIONS');
      expect(p.project.sculpting.lines).toHaveLength(4);
      await reconcile(loanId);
    });

    let firstRun: any;
    const firstRunBody = {
      revenue: '1500000',
      operatingCosts: '300000',
      taxes: '50000',
      externalReference: 'PROCEEDS-2027H1',
    };
    const firstRunKey = key('wf-first');
    it('LT-17: a healthy period pays debt service, fills the reserve, sweeps and distributes', async () => {
      await setBusinessDate('2027-01-05');
      const body = firstRunBody;
      const preview = expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/loans/${loanId}/project/waterfall-preview`, body),
      );
      const res = expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/loans/${loanId}/project/waterfall`,
            body,
            firstRunKey,
          ),
      );
      firstRun = res.run;
      expect(firstRun.cfads).toBe('1150000');
      expect(firstRun.lockedUp).toBe(false);
      expect(firstRun.dsraTopUp).toBe(preview.dsraTopUp);
      expect(D(firstRun.dsraTopUp).eq(firstRun.dsraTarget)).toBe(true);
      expect(D(firstRun.cashSweep).gt(0)).toBe(true);
      expect(D(firstRun.distribution).gt(0)).toBe(true);
      // Every unit of CFADS is accounted for.
      const out = [
        'seniorDebtService',
        'dsraTopUp',
        'cashSweep',
        'lockUpRetained',
        'distribution',
      ].reduce((t, k) => t.plus(firstRun[k]), D(0));
      expect(out.toString()).toBe(firstRun.cfads);
      const loan = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}`),
      );
      expect(loan.schedule.find((l: any) => l.number === 1).status).toBe(
        'PAID',
      );
      const p = await project(loanId);
      expect(p.project.dsraBalance).toBe(firstRun.dsraBalanceAfter);
      expect((await glNet(loanId, '2410')).negated().toString()).toBe(
        p.project.dsraBalance,
      );
      expect((await glNet(loanId, '2430')).isZero()).toBe(true);
      await reconcile(loanId);
    });

    it('LT-17: a waterfall run replays on its key, and its repayments cannot be reversed alone', async () => {
      const replay = expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/loans/${loanId}/project/waterfall`,
            firstRunBody,
            firstRunKey,
          ),
      );
      expect(replay.replayed).toBe(true);
      expect((await project(loanId)).runs).toHaveLength(1);
      const repayment = await f.system(() =>
        f.prisma.financialEvent.findFirst({
          where: {
            tenantId: f.t1,
            loanAccountId: loanId,
            type: 'REPAYMENT',
            idempotencyKey: { endsWith: ':debt-service' },
          },
        }),
      );
      expect(repayment).toBeTruthy();
      const rev = await f
        .as('opsChecker')
        .post(
          `/lending/loans/${loanId}/events/${repayment.id}/reverse`,
          { reason: 'Test' },
          key('pf-rev'),
        );
      expect(rev.status).toBe(409);
      expect(rev.body.code).toBe('PROJECT_WATERFALL_REPAYMENT');
    });

    let lockedRun: any;
    it('LT-17: below the lock-up DSCR the cash that would be distributed is held back', async () => {
      await setBusinessDate('2027-07-05');
      const loan = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}`),
      );
      const line = loan.schedule.find((l: any) => l.number === 2);
      const ds = D(line.principalDue).plus(line.interestDue);
      // CFADS 1.05× debt service: covered, but below the 1.10 lock-up ratio.
      const revenue = lending
        .roundMoney(ds.times('1.05'), { increment: '0.01', mode: 'UP' })
        .plus('200000');
      lockedRun = expectOk(
        await waterfall(
          loanId,
          { revenue: revenue.toString(), operatingCosts: '200000', taxes: '0' },
          '2',
        ),
      ).run;
      expect(lockedRun.lockedUp).toBe(true);
      expect(D(lockedRun.dscr).lt('1.1')).toBe(true);
      expect(lockedRun.distribution).toBe('0');
      expect(D(lockedRun.lockUpRetained).gt(0)).toBe(true);
      const p = await project(loanId);
      expect(p.project.lockedUp).toBe(true);
      expect(p.project.lockUpBalance).toBe(lockedRun.lockUpBalanceAfter);
      expect((await glNet(loanId, '2420')).negated().toString()).toBe(
        p.project.lockUpBalance,
      );
      const outbox = await f.system(() =>
        f.prisma.outboxMessage.findFirst({
          where: { tenantId: f.t1, topic: 'lending.project.lock_up' },
        }),
      );
      expect(outbox).toBeTruthy();
      await reconcile(loanId);
    });

    it('LT-17: once cover recovers the locked-up cash is released with the distribution', async () => {
      await setBusinessDate('2028-01-05');
      const run = expectOk(
        await waterfall(
          loanId,
          { revenue: '1400000', operatingCosts: '300000', taxes: '50000' },
          '3',
        ),
      ).run;
      expect(run.lockedUp).toBe(false);
      expect(run.lockUpReleased).toBe(lockedRun.lockUpBalanceAfter);
      expect(run.lockUpBalanceAfter).toBe('0');
      expect(D(run.distribution).gte(run.lockUpReleased)).toBe(true);
      expect((await glNet(loanId, '2420')).isZero()).toBe(true);
      await reconcile(loanId);
    });

    it('LT-17: the last period repays the loan; the reserve is released and the project closes', async () => {
      await setBusinessDate('2028-07-05');
      const res = expectOk(
        await waterfall(
          loanId,
          { revenue: '1200000', operatingCosts: '250000', taxes: '50000' },
          '4',
        ),
      );
      expect(res.loanClosed).toBe(true);
      const loan = expectOk(
        await f.as('opsMaker').get(`/lending/loans/${loanId}`),
      );
      expect(loan.account.status).toBe('CLOSED');
      const p = await project(loanId);
      expect(p.project.status).toBe('CLOSED');
      expect(p.project.dsraBalance).toBe('0');
      expect(p.project.lockUpBalance).toBe('0');
      expect(p.runs).toHaveLength(4);
      for (const code of ['2410', '2420', '2430', '1200', '1210'])
        expect((await glNet(loanId, code)).isZero()).toBe(true);
      const after = await waterfall(
        loanId,
        { revenue: '1', operatingCosts: '0', taxes: '0' },
        '5',
      );
      expect(after.status).toBe(409);
      await reconcile(loanId);
    });
  });

  describe('infrastructure finance: one tranche, sculpted, serviced to closure', () => {
    let facilityId: string;
    let loanId: string;

    beforeAll(async () => {
      await setBusinessDate('2028-07-05');
      const { productId } = await activeProduct(
        f,
        'INFRASTRUCTURE',
        'INFRA-TOLL',
        (c) => {
          c.facility.availabilityMonths = 3;
          c.facility.tranches[1].availableAfterMonths = 1;
          c.facility.tranches[2].availableAfterMonths = 2;
        },
      );
      ({ facilityId, loanId } = await bookProject(
        productId,
        {
          principal: '5000000',
          numberOfInstalments: 24,
          disbursementDate: '2028-07-05',
          annualRate: '0.10',
        },
        'Toll',
      ));
    }, 90_000);

    it('LT-17: draws the financial-close tranche, capitalizes interest and terms out on the sculpted profile', async () => {
      await draw(facilityId, 'FINANCIAL_CLOSE', '1250000', 'inf1');
      await setBusinessDate('2028-10-05');
      const st = await statement(facilityId, '2028-10-05', 'inf');
      expect(D(st.detail.capitalizedInterest).gt(0)).toBe(true);
      const plan = expectOk(
        await f
          .as('opsChecker')
          .post(`/lending/facilities/${facilityId}/term-out`, {
            cfads: [
              { dueDate: '2029-04-05', cfads: '900000' },
              { dueDate: '2029-10-05', cfads: '950000' },
            ],
          }),
      );
      expect(D(plan.sculpting.sculptedDscr).gte('1.25')).toBe(true);
      await reconcile(loanId);
    });

    it('LT-17: two waterfall runs repay it; with no sweep configured all surplus is distributed', async () => {
      await setBusinessDate('2029-04-05');
      const r1 = expectOk(
        await waterfall(
          loanId,
          { revenue: '1800000', operatingCosts: '150000', taxes: '20000' },
          'inf1',
        ),
      ).run;
      expect(r1.cashSweep).toBe('0');
      expect(r1.lockedUp).toBe(false);
      await setBusinessDate('2029-10-05');
      const r2 = expectOk(
        await waterfall(
          loanId,
          { revenue: '1000000', operatingCosts: '100000', taxes: '20000' },
          'inf2',
        ),
      );
      expect(r2.loanClosed).toBe(true);
      // The reserve built in the first period flows back out once nothing is left to serve.
      expect(
        D(r2.run.distribution).gt(
          D(r2.run.cfads).minus(r2.run.seniorDebtService),
        ),
      ).toBe(true);
      const p = await project(loanId);
      expect(p.project.status).toBe('CLOSED');
      for (const code of ['2410', '2420', '2430', '1200'])
        expect((await glNet(loanId, code)).isZero()).toBe(true);
      await reconcile(loanId);
    });
  });
});
