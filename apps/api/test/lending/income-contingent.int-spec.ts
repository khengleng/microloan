/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses. */
/**
 * Income-contingent education loan end to end (D-066): nothing due while
 * the income is below the threshold (interest capitalised, no arrears), a
 * change of circumstances reassessed with evidence under maker-checker that
 * rebuilds the rest of the schedule, a return below the threshold, and the
 * balance forgiven at the end of the term — reconciled throughout.
 */
import { lending } from '@microloan/shared';
import { Fixture, TEST_DB, bootstrap, expectOk, key } from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Income-contingent education loans (integration)', () => {
  let f: Fixture;
  let productId: string;
  let loanId: string;
  let projectedForgiveness: string;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    await enableFlag('lending.education.income_contingent');
    // A one-year term so the test reaches forgiveness.
    ({ productId } = await activeProduct(
      f,
      'INCOME_CONTINGENT_EDUCATION',
      'ICL-EDU',
      (c: any) => {
        c.limits.minInstalments = 12;
      },
    ));
  }, 90_000);
  afterAll(async () => f?.app.close());

  async function enableFlag(flagKey: string) {
    const r = expectOk(
      await f.as('admin1').post('/lending/access/flags/rules', {
        flagKey,
        scopeType: 'TENANT',
        enabled: true,
        reason: 'income-contingent integration tests',
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
      const step = lending.addDays(current, 10);
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

  const loan = async () =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${loanId}`));
  const plan = async () =>
    expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loanId}/income-contingent`),
    );
  const reconcile = async () => {
    const rec = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(rec.breaks).toEqual([]);
    expect(rec.trialBalanceBalanced).toBe(true);
  };
  const open = (l: any) =>
    ['principal', 'interest', 'fee', 'penalty', 'tax'].reduce(
      (t, c) => t.plus(l[`${c}Due`] ?? '0').minus(l[`${c}Paid`] ?? '0'),
      new lending.D(0),
    );
  const live = (l: any) =>
    l.schedule.filter(
      (x: any) => ['DUE', 'PAID'].includes(x.status) && x.number > 0,
    );
  /** The instalment the borrower owes on a due date (not a capitalisation line). */
  const owedOn = (l: any, dueDate: string) =>
    live(l).find(
      (x: any) =>
        x.dueDate === dueDate &&
        Number(x.capitalizedInterest) === 0 &&
        (Number(x.principalDue) > 0 || Number(x.interestDue) > 0),
    );
  const assess = (body: Record<string, unknown>) =>
    f.as('opsMaker').post(`/lending/loans/${loanId}/income-assessments`, body);
  const decide = (who: string, id: string, approve = true) =>
    f
      .as(who)
      .post(`/lending/loans/${loanId}/income-assessments/${id}/decision`, {
        approve,
        comment: 'Evidence checked',
      });

  it('a student declares no income: nothing is due, interest is capitalised and the rest would be forgiven', async () => {
    ({ loanId } = await originateAndDisburse(f, productId, {
      principal: '10000',
      numberOfInstalments: 12,
      disbursementDate: '2026-01-05',
      declaredAnnualIncome: '0',
    }));
    const l = await loan();
    expect(l.specialised).toEqual({ kind: 'INCOME_CONTINGENT' });
    expect(l.account.instalmentAmount).toBe('0');
    const lines = live(l);
    expect(
      lines.filter((x: any) => open(x).gt(0)).map((x: any) => x.dueDate),
    ).toEqual(['2027-01-05']);
    const p = await plan();
    expect(p.currentPayment).toBe('0');
    expect(p.termEnd).toBe('2027-01-05');
    expect(p.current).toMatchObject({
      reason: 'ORIGINATION',
      status: 'APPROVED',
      periodicPayment: '0',
      nextReviewDate: '2027-01-05',
    });
    expect(Number(p.projectedForgiveness)).toBeGreaterThan(10000);
    await setBusinessDate('2026-03-10');
    const after = await loan();
    expect(after.account.daysPastDue).toBe(0);
    expect(after.account.delinquencyBucket).toBe('CURRENT');
    expect(after.events.filter((e: any) => e.type === 'PENALTY')).toEqual([]);
    expect(
      after.events.filter((e: any) => e.type === 'CAPITALIZATION').length,
    ).toBe(2);
    expect(after.account.principalOutstanding).toBe('10050.06');
    await reconcile();
  });

  it('a change of circumstances is previewed, proposed with evidence and approved by someone else', async () => {
    const preview = expectOk(
      await f
        .as('opsMaker')
        .get(`/lending/loans/${loanId}/income-contingent/preview?income=20000`),
    );
    expect(preview.payment.periodicPayment).toBe('127.5');
    expect(preview.effectiveDate).toBe('2026-04-05');
    // Evidence is required on this product.
    const noEvidence = await assess({
      declaredAnnualIncome: '20000',
      reason: 'CHANGE_OF_CIRCUMSTANCES',
      evidenceType: 'OTHER',
      evidenceReference: 'Told us by phone',
    });
    expect(noEvidence.status).toBe(400);
    const proposed = expectOk(
      await assess({
        declaredAnnualIncome: '20000',
        reason: 'CHANGE_OF_CIRCUMSTANCES',
        incomePeriod: '2026',
        evidenceType: 'PAYSLIP',
        evidenceReference: 'Payslip March 2026, employer ACME Co',
      }),
    );
    expect(proposed.assessment).toMatchObject({
      status: 'PENDING',
      periodicPayment: '127.5',
    });
    // One at a time.
    const again = await assess({
      declaredAnnualIncome: '21000',
      reason: 'CHANGE_OF_CIRCUMSTANCES',
      evidenceType: 'PAYSLIP',
      evidenceReference: 'Payslip again',
    });
    expect(again.status).toBe(409);
    const queue = expectOk(
      await f.as('opsChecker').get('/lending/income-contingent/reviews'),
    );
    expect(queue.pending.map((x: any) => x.loanId)).toContain(loanId);
    // Maker-checker: the proposer cannot approve their own assessment.
    const self = await decide('opsMaker', proposed.assessment.id);
    expect(self.status).toBe(403);
    const approved = expectOk(
      await decide('opsChecker', proposed.assessment.id),
    );
    expect(approved.effectiveDate).toBe('2026-04-05');
    expect(approved.assessment).toMatchObject({
      status: 'APPROVED',
      nextReviewDate: '2027-04-05',
    });
    const l = await loan();
    expect(l.account.instalmentAmount).toBe('127.5');
    // The period already running keeps the old (nil) payment; the first new instalment is on 2026-05-05.
    expect(owedOn(l, '2026-04-05')).toBeUndefined();
    const first = owedOn(l, '2026-05-05');
    expect(first).toMatchObject({
      interestDue: '25.19',
      principalDue: '102.31',
    });
    expect(
      l.events.find((e: any) => e.type === 'INCOME_ASSESSMENT'),
    ).toBeDefined();
    await reconcile();
  });

  it('the assessed instalments are paid', async () => {
    for (const due of ['2026-05-05', '2026-06-05', '2026-07-05']) {
      await setBusinessDate(due);
      const line = owedOn(await loan(), due);
      expect(open(line).toString()).toBe('127.5');
      expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/loans/${loanId}/repayments`,
            { amount: '127.5' },
            key('icl'),
          ),
      );
    }
    await reconcile();
  });

  it('back below the threshold: nothing more is due and nothing falls into arrears', async () => {
    await setBusinessDate('2026-07-10');
    const proposed = expectOk(
      await assess({
        declaredAnnualIncome: '2500',
        reason: 'CHANGE_OF_CIRCUMSTANCES',
        evidenceType: 'NO_INCOME_DECLARATION',
        evidenceReference: 'Signed declaration: unemployed since July 2026',
      }),
    );
    expect(proposed.payment.periodicPayment).toBe('0');
    const rejected = expectOk(
      await decide('opsChecker', proposed.assessment.id, false),
    );
    expect(rejected.assessment.status).toBe('REJECTED');
    const again = expectOk(
      await assess({
        declaredAnnualIncome: '2500',
        reason: 'CHANGE_OF_CIRCUMSTANCES',
        evidenceType: 'BENEFITS_STATEMENT',
        evidenceReference: 'Jobseeker benefit statement July 2026',
      }),
    );
    const ok = expectOk(await decide('opsChecker', again.assessment.id));
    expect(ok.effectiveDate).toBe('2026-08-05');
    // The period already running still carries its assessed instalment.
    await setBusinessDate('2026-08-05');
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${loanId}/repayments`,
          { amount: open(owedOn(await loan(), '2026-08-05')).toString() },
          key('icl'),
        ),
    );
    await setBusinessDate('2026-12-20');
    const l = await loan();
    expect(l.account.instalmentAmount).toBe('0');
    expect(l.account.daysPastDue).toBe(0);
    expect(l.events.filter((e: any) => e.type === 'PENALTY')).toEqual([]);
    projectedForgiveness = (await plan()).projectedForgiveness;
    expect(Number(projectedForgiveness)).toBeGreaterThan(9000);
    await reconcile();
  });

  it('at the end of the term what is left is forgiven and the loan closes', async () => {
    await setBusinessDate('2027-01-05');
    const l = await loan();
    expect(l.account.status).toBe('CLOSED');
    const ev = l.events.find((e: any) => e.type === 'ICL_FORGIVENESS');
    expect(ev.amount).toBe(projectedForgiveness);
    expect(
      ev.journal.lines
        .map(
          (x: any) => `${x.accountCode}:${Number(x.debit)}:${Number(x.credit)}`,
        )
        .sort(),
    ).toEqual([
      `1200:0:${Number(projectedForgiveness)}`,
      `5700:${Number(projectedForgiveness)}:0`,
    ]);
    const p = await plan();
    expect(p.forgiven).toMatchObject({
      amount: projectedForgiveness,
      on: '2027-01-05',
    });
    await reconcile();
  });

  it('only an income-contingent loan takes an income assessment', async () => {
    const { productId: pl } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-NOT-ICL',
    );
    const { loanId: other } = await originateAndDisburse(f, pl, {
      principal: '1000',
      numberOfInstalments: 6,
      disbursementDate: '2027-01-05',
    });
    const r = await f
      .as('opsMaker')
      .post(`/lending/loans/${other}/income-assessments`, {
        declaredAnnualIncome: '5000',
        reason: 'ANNUAL',
        evidenceType: 'PAYSLIP',
        evidenceReference: 'Payslip',
      });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('NOT_INCOME_CONTINGENT');
  });
});
