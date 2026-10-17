/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: modules are required after the test environment is configured, and fixture rows come from the untyped Prisma client. */
/**
 * LT-24 syndicated loans over the real HTTP API, guards and database: a
 * floating-rate (benchmark + margin) loan with the tenant as agent, two
 * participants, funding by participant before disbursement, every
 * repayment (and its reversal) split by share into the participant
 * sub-ledger, and maker-checker payouts — with the books reconciling.
 *
 * Evidence for: syndication.participations
 */
import { Fixture, TEST_DB, borrower, bootstrap, expectOk, key } from './harness';
import { activeProduct, docs, standardRoles } from './setup';
import { lending } from '@microloan/shared';

const d = TEST_DB ? describe : describe.skip;

d('Syndicated loans (integration)', () => {
  let f: Fixture;
  let productId: string;
  let loanId: string;
  let appId: string;
  let participants: { id: string; lenderName: string; isAgent: boolean }[];
  const byName = (n: string) => participants.find((p) => p.lenderName === n)!;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    await setBusinessDate('2026-01-05');
    expectOk(
      await f.as('finance').post('/lending/ops/rates', {
        benchmarkCode: 'SOFR_3M',
        observationDate: '2026-01-01',
        rate: '0.05',
        source: 'Published benchmark',
      }),
    );
    for (const flagKey of ['lending.syndication', 'lending.pricing.floating_rate']) await enableFlag(flagKey);
    ({ productId } = await activeProduct(f, 'SYNDICATED', 'SYND-CORP', (c: any) => {
      // Benchmark + margin, the usual syndicated pricing (reuses floating-rate resets).
      c.attributes.rateType = 'FLOATING';
      c.pricing.fixed = null;
      c.pricing.floating = { benchmarkCode: 'SOFR_3M', margin: '0.03', resetFrequency: 'QUARTERLY', floor: null, cap: null };
      c.pricing.regulatoryCapAnnualRate = null;
      c.limits.minAmount = '100000';
    }));
  }, 60_000);
  afterAll(async () => f?.app.close());

  async function setBusinessDate(target: string) {
    let current = expectOk(await f.as('finance').get('/lending/ops/business-date')).businessDate as string;
    while (lending.compareDates(current, target) < 0) {
      const step = lending.addDays(current, 31);
      const next = lending.compareDates(step, target) > 0 ? target : step;
      expectOk(await f.as('finance').post('/lending/ops/business-date', { businessDate: next }));
      current = next;
    }
  }

  async function enableFlag(flagKey: string) {
    const r = expectOk(
      await f.as('admin1').post('/lending/access/flags/rules', { flagKey, scopeType: 'TENANT', enabled: true, reason: 'syndication integration tests' }),
    );
    expectOk(await f.as('admin2').post(`/lending/access/flags/changes/${r.approval.id}/decision`, { approve: true }));
  }

  const syndicate = async () => expectOk(await f.as('opsMaker').get(`/lending/loans/${loanId}/syndicate`));
  const participant = async (name: string) =>
    (await syndicate()).syndicate.participants.find((p: { lenderName: string }) => p.lenderName === name);

  async function glNet(accountCode: string) {
    const rows = await f.system(() => f.prisma.lendingJournalLine.findMany({ where: { tenantId: f.t1, accountCode, loanAccountId: loanId } }));
    return rows.reduce((t: any, l: any) => t.plus(l.debit.toString()).minus(l.credit.toString()), new lending.D(0)).toFixed(2);
  }

  it('LT-24: a syndicated loan is booked like any term loan, at benchmark + margin', async () => {
    const b = await borrower(f, f.t1, f.b1, { firstName: 'Mekong', lastName: 'Holdings' });
    const app = expectOk(
      await f.as('ro').post('/lending/applications', {
        borrowerId: b.id,
        productId,
        terms: { principal: '1000000', numberOfInstalments: 4, disbursementDate: '2026-01-05' },
      }),
    );
    await docs(f, app.id, ['ID_DOCUMENT']);
    expectOk(await f.as('ro').post(`/lending/applications/${app.id}/submit`));
    expectOk(await f.as('analyst').post(`/lending/applications/${app.id}/recommend`, { recommendation: 'APPROVE', rationale: 'Club deal' }));
    expectOk(await f.as('approver2').post(`/lending/applications/${app.id}/approve`, { rationale: 'Within authority' }));
    const booked = expectOk(await f.as('opsMaker').post(`/lending/applications/${app.id}/book`, {}));
    loanId = booked.account.id;
    appId = app.id;
    // 5% benchmark + 3% margin.
    expect(booked.preview.schedule.lines[0].annualRate).toBe('0.08');
  });

  it('LT-24: not disbursed before the participants have funded it', async () => {
    const r = await f.as('opsMaker').post(`/lending/loans/${loanId}/disbursements`, {});
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('SYNDICATE_NOT_FUNDED');
  });

  it('LT-24: participants must sum to 100%, with this lender as the one agent', async () => {
    const bad = await f.as('opsMaker').put(`/lending/loans/${loanId}/syndicate`, {
      participants: [
        { lenderName: 'Our Bank (agent)', isAgent: true, share: '0.4' },
        { lenderName: 'Bank B', isAgent: false, share: '0.35' },
        { lenderName: 'Bank C', isAgent: false, share: '0.15' },
      ],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/sum to 100%; they sum to 90%/);
    const noAgent = await f.as('opsMaker').put(`/lending/loans/${loanId}/syndicate`, {
      participants: [
        { lenderName: 'Bank B', isAgent: false, share: '0.5' },
        { lenderName: 'Bank C', isAgent: false, share: '0.5' },
      ],
    });
    expect(noAgent.status).toBe(400);

    const ok = expectOk(
      await f.as('opsMaker').put(`/lending/loans/${loanId}/syndicate`, {
        participants: [
          // The agent keeps the fees (an agency fee); interest and principal follow shares.
          { lenderName: 'Our Bank (agent)', isAgent: true, share: '0.4', feeShare: '1' },
          { lenderName: 'Bank B', isAgent: false, share: '0.35', feeShare: '0' },
          { lenderName: 'Bank C', isAgent: false, share: '0.25', feeShare: '0' },
        ],
      }),
    );
    expect(ok.status).toBe('DRAFT');
    expect(ok.participants.map((p: { commitment: string }) => p.commitment)).toEqual(['400000', '350000', '250000']);
  });

  it('LT-24: approved by a checker, then funded by the participants (each share recorded)', async () => {
    // The maker cannot approve their own syndicate.
    expect((await f.as('opsMaker').post(`/lending/loans/${loanId}/syndicate/approve`)).status).toBe(403);
    expectOk(await f.as('approver').post(`/lending/loans/${loanId}/syndicate/approve`));
    const funded = expectOk(
      await f.as('opsMaker').post(`/lending/loans/${loanId}/syndicate/funding`, { externalReference: 'PARTICIPANT-WIRES-0105' }, key('fund')),
    );
    expect(funded.status).toBe('FUNDED');
    expect(funded.participantFunding).toBe('600000');
    const s = await syndicate();
    participants = s.syndicate.participants;
    expect(s.syndicate.participants.map((p: any) => [p.lenderName, p.funded])).toEqual([
      ['Our Bank (agent)', '400000'],
      ['Bank B', '350000'],
      ['Bank C', '250000'],
    ]);
    expect(await glNet('2330')).toBe('-600000.00');
    // Changing the syndicate after approval is refused.
    const late = await f.as('opsMaker').put(`/lending/loans/${loanId}/syndicate`, {
      participants: [
        { lenderName: 'Our Bank (agent)', isAgent: true, share: '0.5' },
        { lenderName: 'Bank B', isAgent: false, share: '0.5' },
      ],
    });
    expect(late.status).toBe(409);

    // Now the ordinary disbursement path runs.
    for (const cp of expectOk(await f.as('opsMaker').get(`/lending/applications/${appId}`)).conditions)
      expectOk(
        await f.as('opsMaker').post(`/lending/applications/${appId}/conditions/${cp.code}`, { resolution: 'SATISFIED', evidence: `Evidence for ${cp.code}` }),
      );
    const task = expectOk(await f.as('opsMaker').post(`/lending/loans/${loanId}/disbursements`, {}));
    expectOk(await f.as('opsChecker').post(`/lending/loans/${loanId}/disbursements/${task.id}/decision`, { approve: true }));
    expectOk(await f.as('opsChecker').post(`/lending/loans/${loanId}/disbursements/execute`, { externalReference: 'SYND-DISB-1' }, key('synd-disb')));
  });

  let firstRepayment: string;
  let instalment: { principal: string; interest: string };

  it('LT-24: a repayment is split across participants by share (principal / interest)', async () => {
    await setBusinessDate('2026-04-05');
    const l = expectOk(await f.as('opsMaker').get(`/lending/loans/${loanId}`));
    const line = l.schedule.find((x: { number: number }) => x.number === 1);
    instalment = { principal: line.principalDue, interest: line.interestDue };
    const total = new lending.D(line.principalDue).plus(line.interestDue).toString();
    firstRepayment = expectOk(
      await f.as('opsMaker').post(`/lending/loans/${loanId}/repayments`, { amount: total, externalReference: 'BORROWER-Q1' }, key('q1')),
    ).id;
    const shared = expectOk(await f.as('opsMaker').post(`/lending/loans/${loanId}/syndicate/distribute`));
    expect(shared.distributed).toBe(1);
    // Sharing again does nothing: each collection is shared once.
    expect(expectOk(await f.as('opsMaker').post(`/lending/loans/${loanId}/syndicate/distribute`)).distributed).toBe(0);

    const b = await participant('Bank B');
    const c = await participant('Bank C');
    const agent = await participant('Our Bank (agent)');
    const R = { increment: '0.01', mode: 'DOWN' } as const;
    const down = (v: string, s: string) => lending.roundMoney(new lending.D(v).times(s), R).toString();
    expect(b.principalReturned).toBe(down(instalment.principal, '0.35'));
    expect(b.interestEarned).toBe(down(instalment.interest, '0.35'));
    expect(c.interestEarned).toBe(down(instalment.interest, '0.25'));
    // The agent takes the remainder, so the shares add up to what was paid.
    const sum = (k: string) => [agent, b, c].reduce((t, p) => t.plus(p[k]), new lending.D(0)).toString();
    expect(sum('principalReturned')).toBe(new lending.D(instalment.principal).toString());
    expect(sum('interestEarned')).toBe(new lending.D(instalment.interest).toString());
    expect(b.payable).toBe(new lending.D(b.principalReturned).plus(b.interestEarned).toString());
    expect(b.outstanding).toBe(new lending.D('350000').minus(b.principalReturned).toString());
  });

  it('LT-24: reversing a shared repayment takes the shares back', async () => {
    expectOk(
      await f.as('opsChecker').post(`/lending/loans/${loanId}/events/${firstRepayment}/reverse`, { reason: 'Cheque bounced' }, key('rev')),
    );
    expectOk(await f.as('opsMaker').post(`/lending/loans/${loanId}/syndicate/distribute`));
    const b = await participant('Bank B');
    expect(b.principalReturned).toBe('0');
    expect(b.interestEarned).toBe('0');
    expect(b.payable).toBe('0');
    expect(await glNet('2320')).toBe('0.00');
  });

  it('LT-24: the end-of-day batch shares the next repayment; payouts are maker-checker', async () => {
    const total = new lending.D(instalment.principal).plus(instalment.interest).toString();
    expectOk(await f.as('opsMaker').post(`/lending/loans/${loanId}/repayments`, { amount: total, externalReference: 'BORROWER-Q1-RETRY' }, key('q1b')));
    expectOk(await f.as('opsMaker').post('/lending/loans/batch/run'));
    const b = await participant('Bank B');
    expect(b.principalReturned).toBe(lending.roundMoney(new lending.D(instalment.principal).times('0.35'), { increment: '0.01', mode: 'DOWN' }).toString());

    const task = expectOk(
      await f.as('opsMaker').post(`/lending/loans/${loanId}/syndicate/participants/${byName('Bank B').id}/payouts`, { externalReference: 'MT103-BANK-B' }),
    );
    expect(task.amount).toBe(b.payable);
    expect(
      (await f.as('opsMaker').post(`/lending/loans/${loanId}/syndicate/payouts/${task.id}/decision`, { approve: true }, key('self-pay'))).status,
    ).toBe(403);
    // The agent is never paid out to itself.
    expect((await f.as('opsMaker').post(`/lending/loans/${loanId}/syndicate/participants/${byName('Our Bank (agent)').id}/payouts`, {})).status).toBe(400);
    expectOk(await f.as('opsChecker').post(`/lending/loans/${loanId}/syndicate/payouts/${task.id}/decision`, { approve: true }, key('pay-b')));
    const after = await participant('Bank B');
    expect(after.payable).toBe('0');
    expect(after.paidOut).toBe(b.payable);
    const c = await participant('Bank C');
    // Still due to Bank C, held as a liability.
    expect(await glNet('2320')).toBe(new lending.D(c.payable).negated().toFixed(2));

    const r = expectOk(await f.as('finance').get('/lending/ops/reconciliation'));
    expect(r.trialBalanceBalanced).toBe(true);
    expect(r.breaks.filter((x: { loanAccountId: string }) => x.loanAccountId === loanId)).toEqual([]);
  });
});
