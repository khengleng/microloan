/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * Institutional lending end to end (D-065, D-068): counterparties with
 * ratings, counterparty and country limits approved under maker-checker and
 * approval authority, utilisation checked at submission, approval and
 * disbursement — and refused with the figures — and interbank (ACT/360
 * bullet), municipal, sovereign and concessional development loans
 * originated and serviced to closure with no reconciliation breaks.
 */
import { lending } from '@microloan/shared';
import {
  Fixture,
  TEST_DB,
  authority,
  borrower,
  bootstrap,
  expectOk,
  grant,
  key,
} from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Institutional lending (integration)', () => {
  let f: Fixture;
  const products: Record<string, string> = {};
  const cp: Record<string, { id: string; borrowerId: string }> = {};
  let ib1: string;
  let ib2: string;
  let sovereign: string;
  let municipal: string;
  let development: string;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    // Institutional amounts need institutional authority.
    await authority(
      f,
      f.t1,
      'approver2',
      'credit_decision.approve',
      'USD',
      '1000000000',
    );
    await authority(
      f,
      f.t1,
      'opsChecker',
      'loan.disbursement.approve',
      'USD',
      '1000000000',
    );
    // The analyst may also approve (to show they still cannot approve their own proposal).
    await grant(f, f.t1, 'analyst', 'CREDIT_APPROVER');
    await authority(
      f,
      f.t1,
      'analyst',
      'credit_decision.approve',
      'USD',
      '1000000000',
    );
    await enableFlag('lending.institutional');
    products.IB = (
      await activeProduct(f, 'INTERBANK', 'IB-MM', (c: any) => {
        c.institutional.minRating = 'BBB-';
      })
    ).productId;
    products.MUNI = (await activeProduct(f, 'MUNICIPAL', 'MUNI-LG')).productId;
    products.SOV = (
      await activeProduct(f, 'SOVEREIGN', 'SOV-GOV', (c: any) => {
        c.limits.minInstalments = 2;
      })
    ).productId;
    products.DEV = (
      await activeProduct(f, 'DEVELOPMENT_CONCESSIONAL', 'DEV-IDA')
    ).productId;
  }, 120_000);
  afterAll(async () => f?.app.close());

  async function enableFlag(flagKey: string) {
    const r = expectOk(
      await f.as('admin1').post('/lending/access/flags/rules', {
        flagKey,
        scopeType: 'TENANT',
        enabled: true,
        reason: 'institutional integration tests',
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
      const run = expectOk(
        await f.as('finance').post('/lending/loans/batch/run'),
      );
      expect(run.failed).toEqual([]);
      current = next;
    }
  }

  const reconcile = async () => {
    const rec = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(rec.breaks).toEqual([]);
    expect(rec.trialBalanceBalanced).toBe(true);
  };
  const loan = async (id: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${id}`));
  const open = (l: any) =>
    ['principal', 'interest', 'fee', 'penalty', 'tax'].reduce(
      (t, c) => t.plus(l[`${c}Due`] ?? '0').minus(l[`${c}Paid`] ?? '0'),
      new lending.D(0),
    );
  const payDue = async (id: string, dueDate: string) => {
    const l = await loan(id);
    const owed = l.schedule
      .filter((x: any) => x.status === 'DUE' && x.dueDate === dueDate)
      .reduce((s: any, x: any) => s.plus(open(x)), new lending.D(0));
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${id}/repayments`,
          { amount: owed.toString() },
          key('inst'),
        ),
    );
  };
  const counterparty = async (
    name: string,
    type: string,
    countryCode: string,
    rating?: string,
  ) => {
    const b = await borrower(f, f.t1, f.b1, {
      firstName: name,
      lastName: 'Institution',
    });
    const c = expectOk(
      await f.as('analyst').post('/lending/counterparties', {
        name,
        type,
        countryCode,
        borrowerId: b.id,
        legalIdentifier: `LEI-${name.replace(/\W/g, '').toUpperCase()}`,
        ...(rating
          ? { rating, ratingAgency: 'S&P', ratedOn: '2025-12-01' }
          : {}),
      }),
    );
    return { id: c.id as string, borrowerId: b.id as string };
  };
  const proposeLimit = async (id: string, amount: string) =>
    expectOk(
      await f.as('analyst').post(`/lending/counterparties/${id}/limits`, {
        amount,
        currency: 'USD',
        reviewOn: '2027-12-31',
        note: 'Annual credit review',
      }),
    );
  const proposeCountry = async (countryCode: string, amount: string) =>
    expectOk(
      await f.as('analyst').post('/lending/exposure-limits/country', {
        countryCode,
        amount,
        currency: 'USD',
        reviewOn: '2027-12-31',
      }),
    );
  const approveLimit = async (limitId: string) =>
    expectOk(
      await f
        .as('approver2')
        .post(`/lending/exposure-limits/${limitId}/decision`, {
          approve: true,
        }),
    );
  const position = async (id: string) =>
    expectOk(await f.as('analyst').get(`/lending/counterparties/${id}`))
      .position.limits[0];

  it('an institution must be a registered counterparty before it can borrow', async () => {
    const b = await borrower(f, f.t1, f.b1, {
      firstName: 'Unregistered',
      lastName: 'Bank',
    });
    await expect(
      originateAndDisburse(
        f,
        products.IB,
        {
          principal: '500000',
          numberOfInstalments: 1,
          disbursementDate: '2026-01-05',
          firstDueDate: '2026-02-04',
        },
        {
          borrowerId: b.id,
          docs: ['INSTITUTION_LICENCE'],
          approvers: ['approver2'],
        },
      ),
    ).rejects.toThrow(/COUNTERPARTY_NOT_REGISTERED/);
  });

  it('counterparties are registered with ratings; limits are proposed and approved by someone else within authority', async () => {
    const ro = await f.as('ro').post('/lending/counterparties', {
      name: 'Not allowed',
      type: 'BANK',
      countryCode: 'KH',
      borrowerId: '00000000-0000-4000-8000-000000000001',
    });
    expect(ro.status).toBe(403);
    cp.bankA = await counterparty('Bank of Angkor', 'BANK', 'KH', 'A-');
    cp.bankB = await counterparty(
      'Mekong Commercial Bank',
      'BANK',
      'KH',
      'BB+',
    );
    const dup = await f.as('analyst').post('/lending/counterparties', {
      name: 'Duplicate',
      type: 'BANK',
      countryCode: 'KH',
      borrowerId: cp.bankA.borrowerId,
    });
    expect(dup.status).toBe(409);

    const limA = await proposeLimit(cp.bankA.id, '2000000');
    expect(limA.status).toBe('PENDING');
    const again = await f
      .as('analyst')
      .post(`/lending/counterparties/${cp.bankA.id}/limits`, {
        amount: '2500000',
        currency: 'USD',
        reviewOn: '2027-12-31',
      });
    expect(again.status).toBe(409);
    // The proposer cannot approve their own limit, even holding the authority.
    const own = await f
      .as('analyst')
      .post(`/lending/exposure-limits/${limA.id}/decision`, { approve: true });
    expect(own.status).toBe(403);
    // A checker without enough authority cannot approve it either.
    const small = await f
      .as('approver')
      .post(`/lending/exposure-limits/${limA.id}/decision`, { approve: true });
    expect(small.status).toBe(403);
    expect(JSON.stringify(small.body)).toMatch(/authority/i);
    expect((await approveLimit(limA.id)).limit.status).toBe('ACTIVE');
    await approveLimit((await proposeLimit(cp.bankB.id, '5000000')).id);
    await approveLimit((await proposeCountry('KH', '3000000')).id);

    const exp = expectOk(
      await f.as('analyst').get('/lending/counterparties/exposure'),
    );
    const a = exp.byCounterparty.find((x: any) => x.id === cp.bankA.id);
    expect(a.limits[0]).toMatchObject({
      limit: '2000000',
      utilised: '0',
      status: 'WITHIN_LIMIT',
    });
    expect(
      exp.byCountry.find((x: any) => x.countryCode === 'KH').limits[0].limit,
    ).toBe('3000000');
    expect(exp.pendingLimits).toEqual([]);
  });

  it('an interbank placement is a single ACT/360 bullet, counted against the limit', async () => {
    ({ loanId: ib1 } = await originateAndDisburse(
      f,
      products.IB,
      {
        principal: '1000000',
        numberOfInstalments: 1,
        disbursementDate: '2026-01-05',
        firstDueDate: '2026-04-06',
        annualRate: '0.05',
      },
      {
        borrowerId: cp.bankA.borrowerId,
        docs: ['INSTITUTION_LICENCE'],
        approvers: ['approver2'],
      },
    ));
    const l = await loan(ib1);
    expect(l.specialised).toEqual({ kind: 'INSTITUTIONAL' });
    const lines = l.schedule.filter((x: any) => x.number > 0);
    expect(lines).toHaveLength(1);
    // 1,000,000 × 5% × 91 / 360.
    expect(lines[0]).toMatchObject({
      dueDate: '2026-04-06',
      principalDue: '1000000',
      interestDue: '12638.89',
    });
    expect(await position(cp.bankA.id)).toMatchObject({
      utilised: '1000000',
      headroom: '1000000',
    });
    await reconcile();
  });

  it('lending beyond the counterparty limit is refused with the figures', async () => {
    await expect(
      originateAndDisburse(
        f,
        products.IB,
        {
          principal: '1500000',
          numberOfInstalments: 1,
          disbursementDate: '2026-01-05',
          firstDueDate: '2026-03-06',
        },
        {
          borrowerId: cp.bankA.borrowerId,
          docs: ['INSTITUTION_LICENCE'],
          approvers: ['approver2'],
        },
      ),
    ).rejects.toThrow(
      /1500000 USD would take exposure to 2500000 against a limit of 2000000 \(1000000 available\)/,
    );
  });

  it('a limit cut after approval stops the payout; once restored the loan pays out', async () => {
    await expect(
      originateAndDisburse(
        f,
        products.IB,
        {
          principal: '900000',
          numberOfInstalments: 1,
          disbursementDate: '2026-01-05',
          firstDueDate: '2026-02-04',
        },
        {
          borrowerId: cp.bankA.borrowerId,
          docs: ['INSTITUTION_LICENCE'],
          approvers: ['approver2'],
          beforeDisbursement: async (id) => {
            ib2 = id;
            // Booked but not paid out: it already counts.
            expect(await position(cp.bankA.id)).toMatchObject({
              utilised: '1900000',
            });
            await approveLimit((await proposeLimit(cp.bankA.id, '1500000')).id);
            expect((await position(cp.bankA.id)).status).toBe('BREACHED');
          },
        },
      ),
    ).rejects.toThrow(/COUNTERPARTY_LIMIT_EXCEEDED/);
    await approveLimit((await proposeLimit(cp.bankA.id, '2500000')).id);
    const task = expectOk(
      await f.as('opsMaker').post(`/lending/loans/${ib2}/disbursements`, {}),
    );
    expectOk(
      await f
        .as('opsChecker')
        .post(`/lending/loans/${ib2}/disbursements/${task.id}/decision`, {
          approve: true,
        }),
    );
    expectOk(
      await f
        .as('opsChecker')
        .post(
          `/lending/loans/${ib2}/disbursements/execute`,
          { externalReference: 'RTGS-IB2' },
          key('disb'),
        ),
    );
    expect((await loan(ib2)).account.status).toBe('ACTIVE');
    await reconcile();
  });

  it('a rating below the product minimum, then the country limit, refuse the second bank', async () => {
    const terms = {
      principal: '1200000',
      numberOfInstalments: 1,
      disbursementDate: '2026-01-05',
      firstDueDate: '2026-02-04',
    };
    const opts = {
      borrowerId: cp.bankB.borrowerId,
      docs: ['INSTITUTION_LICENCE'],
      approvers: ['approver2'],
    };
    await expect(
      originateAndDisburse(f, products.IB, terms, opts),
    ).rejects.toThrow(/COUNTERPARTY_RATING.*BB\+/);
    expectOk(
      await f
        .as('analyst')
        .post(`/lending/counterparties/${cp.bankB.id}/rating`, {
          rating: 'BBB',
          ratingAgency: 'Fitch',
          ratedOn: '2026-01-02',
          reason: 'Upgrade after recapitalisation',
        }),
    );
    // KH: 1,900,000 already lent to Bank of Angkor against a 3,000,000 country limit.
    await expect(
      originateAndDisburse(f, products.IB, terms, opts),
    ).rejects.toThrow(
      /COUNTRY_LIMIT_EXCEEDED.*Country KH: 1200000 USD would take exposure to 3100000/,
    );
  });

  it('a suspended counterparty gets no new lending', async () => {
    expectOk(
      await f
        .as('analyst')
        .post(`/lending/counterparties/${cp.bankA.id}/status`, {
          status: 'SUSPENDED',
          reason: 'Regulatory intervention',
        }),
    );
    await expect(
      originateAndDisburse(
        f,
        products.IB,
        {
          principal: '100000',
          numberOfInstalments: 1,
          disbursementDate: '2026-01-05',
          firstDueDate: '2026-02-04',
        },
        {
          borrowerId: cp.bankA.borrowerId,
          docs: ['INSTITUTION_LICENCE'],
          approvers: ['approver2'],
        },
      ),
    ).rejects.toThrow(/COUNTERPARTY_SUSPENDED/);
    expectOk(
      await f
        .as('analyst')
        .post(`/lending/counterparties/${cp.bankA.id}/status`, {
          status: 'ACTIVE',
          reason: 'Intervention lifted',
        }),
    );
  });

  it('sovereign and municipal loans are lent within their own limits', async () => {
    cp.mof = await counterparty(
      'Ministry of Economy and Finance',
      'SOVEREIGN',
      'LA',
      'BB-',
    );
    cp.city = await counterparty('Vientiane Capital', 'MUNICIPALITY', 'LA');
    await approveLimit((await proposeLimit(cp.mof.id, '10000000')).id);
    await approveLimit((await proposeLimit(cp.city.id, '1000000')).id);
    // No LA country limit yet.
    await expect(
      originateAndDisburse(
        f,
        products.SOV,
        {
          principal: '2000000',
          numberOfInstalments: 2,
          disbursementDate: '2026-01-05',
        },
        {
          borrowerId: cp.mof.borrowerId,
          docs: ['BORROWING_AUTHORISATION'],
          approvers: ['approver2'],
        },
      ),
    ).rejects.toThrow(/COUNTRY_NO_LIMIT/);
    await approveLimit((await proposeCountry('LA', '20000000')).id);
    ({ loanId: sovereign } = await originateAndDisburse(
      f,
      products.SOV,
      {
        principal: '2000000',
        numberOfInstalments: 2,
        disbursementDate: '2026-01-05',
        annualRate: '0.045',
      },
      {
        borrowerId: cp.mof.borrowerId,
        docs: ['BORROWING_AUTHORISATION'],
        approvers: ['approver2'],
      },
    ));
    ({ loanId: municipal } = await originateAndDisburse(
      f,
      products.MUNI,
      {
        principal: '400000',
        numberOfInstalments: 2,
        disbursementDate: '2026-01-05',
        annualRate: '0.06',
      },
      {
        borrowerId: cp.city.borrowerId,
        docs: ['BORROWING_AUTHORISATION'],
        approvers: ['approver2'],
      },
    ));
    const sov = (await loan(sovereign)).schedule.filter(
      (x: any) => x.number > 0,
    );
    // Semi-annual equal principal: 1,000,000 + 45,000 interest, then 1,000,000 + 22,500.
    expect(
      sov.map((x: any) => [x.dueDate, x.principalDue, x.interestDue]),
    ).toEqual([
      ['2026-07-05', '1000000', '45000'],
      ['2027-01-05', '1000000', '22500'],
    ]);
    await reconcile();
  });

  it('concessional lending must reach its grant element', async () => {
    cp.dev = await counterparty(
      'Lao Development Bank',
      'DEVELOPMENT_INSTITUTION',
      'LA',
    );
    await approveLimit((await proposeLimit(cp.dev.id, '5000000')).id);
    await expect(
      originateAndDisburse(
        f,
        products.DEV,
        {
          principal: '1000000',
          numberOfInstalments: 10,
          disbursementDate: '2026-01-05',
          annualRate: '0.03',
        },
        {
          borrowerId: cp.dev.borrowerId,
          docs: ['BORROWING_AUTHORISATION'],
          approvers: ['approver2'],
        },
      ),
    ).rejects.toThrow(/CONCESSIONALITY/);
    ({ loanId: development } = await originateAndDisburse(
      f,
      products.DEV,
      {
        principal: '1000000',
        numberOfInstalments: 60,
        principalGraceInstalments: 20,
        disbursementDate: '2026-01-05',
        annualRate: '0.0075',
      },
      {
        borrowerId: cp.dev.borrowerId,
        docs: ['BORROWING_AUTHORISATION'],
        approvers: ['approver2'],
      },
    ));
    const app = expectOk(
      await f
        .as('analyst')
        .get(
          `/lending/applications/${(await loan(development)).account.applicationId}`,
        ),
    );
    const approval = app.decisions.find((x: any) => x.type === 'APPROVE');
    expect(Number(approval.assessment.metrics.grantElement)).toBeGreaterThan(
      0.35,
    );
    const first = (await loan(development)).schedule.find(
      (x: any) => x.number === 1,
    );
    // Grace: interest only, at the concessional rate.
    expect(first).toMatchObject({ principalDue: '0', interestDue: '3750' });
  });

  it('everything is serviced to closure and the exposure runs off to nothing', async () => {
    await setBusinessDate('2026-02-04');
    await payDue(ib2, '2026-02-04');
    await setBusinessDate('2026-04-06');
    await payDue(ib1, '2026-04-06');
    for (const id of [ib1, ib2])
      expect((await loan(id)).account.status).toBe('CLOSED');
    await setBusinessDate('2026-07-05');
    for (const id of [sovereign, municipal, development])
      await payDue(id, '2026-07-05');
    // The development loan is prepaid in full by its borrower.
    const q = expectOk(
      await f
        .as('opsMaker')
        .get(`/lending/loans/${development}/settlement-quote`),
    );
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${development}/settlement`,
          { amount: q.payable, externalReference: 'SETTLE-DEV' },
          key('settle'),
        ),
    );
    await setBusinessDate('2027-01-05');
    for (const id of [sovereign, municipal]) await payDue(id, '2027-01-05');
    for (const id of [ib1, ib2, sovereign, municipal, development])
      expect((await loan(id)).account.status).toBe('CLOSED');
    const exp = expectOk(
      await f.as('analyst').get('/lending/counterparties/exposure'),
    );
    for (const c of exp.byCounterparty)
      for (const l of c.limits) expect(l.utilised).toBe('0');
    const detail = expectOk(
      await f.as('analyst').get(`/lending/counterparties/${cp.bankA.id}`),
    );
    expect(detail.loans.map((x: any) => x.status).sort()).toEqual([
      'CLOSED',
      'CLOSED',
    ]);
    await reconcile();
  });
});
