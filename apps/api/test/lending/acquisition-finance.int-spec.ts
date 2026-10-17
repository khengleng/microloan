/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: responses are untyped by nature here. */
/**
 * Acquisition finance (ACQUISITION_FINANCE, LT-16): a leveraged term loan
 * whose maintenance covenants — net leverage, interest cover, DSCR and
 * financial statements — are set up from the product at booking, tested,
 * breached, cured and waived (maker-checker), and the loan repaid to closure
 * with the books reconciling.
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
import { activeProduct, originateAndDisburse, standardRoles } from './setup';
import { lending } from '@microloan/shared';

const d = TEST_DB ? describe : describe.skip;

d('Acquisition finance with maintenance covenants (integration)', () => {
  let f: Fixture;
  let productId: string;
  let loanId: string;

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

  const covenants = async () =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${loanId}/covenants`));
  const byType = async (type: string) =>
    (await covenants()).find((c: { type: string }) => c.type === type);
  const test = (
    covenantId: string,
    body: Record<string, unknown>,
    who = 'opsMaker',
  ) =>
    f.as(who).post(`/lending/loans/${loanId}/covenants/${covenantId}/tests`, {
      periodEnd: '2026-01-05',
      ...body,
    });

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    await authority(
      f,
      f.t1,
      'approver2',
      'credit_decision.approve',
      'USD',
      '10000000',
    );
    await setBusinessDate('2026-01-05');
    ({ productId } = await activeProduct(f, 'ACQUISITION_FINANCE', 'ACQ-LBO'));
  }, 90_000);
  afterAll(async () => f?.app.close());

  it('LT-16: the product carries four maintenance covenants and requires covenant monitoring', async () => {
    const tpl = expectOk(
      await f.as('maker').get('/lending/templates/ACQUISITION_FINANCE'),
    );
    expect(
      tpl.defaultConfig.covenants.map((c: { type: string }) => c.type),
    ).toEqual([
      'MAX_LEVERAGE',
      'MIN_INTEREST_COVER',
      'MIN_DSCR',
      'FINANCIAL_STATEMENTS',
    ]);
    expect(
      lending.templateAvailability(lending.TEMPLATE_BY_CODE.ACQUISITION_FINANCE)
        .available,
    ).toBe(true);
  });

  it('LT-16: booking sets up the configured covenants on the loan, first tested one period on', async () => {
    const b = await borrower(f, f.t1, f.b1, {
      firstName: 'Angkor',
      lastName: 'Holdco',
      monthlyIncome: '400000',
    });
    loanId = (
      await originateAndDisburse(
        f,
        productId,
        {
          principal: '600000',
          numberOfInstalments: 4,
          disbursementDate: '2026-01-05',
        },
        { borrowerId: b.id, approvers: ['approver2'] },
      )
    ).loanId;
    const list = await covenants();
    expect(list.map((c: { type: string }) => c.type).sort()).toEqual([
      'FINANCIAL_STATEMENTS',
      'MAX_LEVERAGE',
      'MIN_DSCR',
      'MIN_INTEREST_COVER',
    ]);
    for (const c of list) {
      expect(c.status).toBe('ACTIVE');
      expect(c.nextTestOn).toBe('2026-04-05');
    }
    expect((await byType('MAX_LEVERAGE')).threshold).toBe('3.5');
  });

  it('LT-16: net leverage defaults debt to the loan outstanding, breaches above the maximum and is cured by a later test', async () => {
    const cov = await byType('MAX_LEVERAGE');
    expect((await test(cov.id, {})).status).toBe(400);
    const breach = expectOk(
      await test(cov.id, {
        ebitda: '100000',
        evidence: 'FY2025 management accounts',
      }),
    );
    expect(breach.status).toBe('BREACHED');
    expect(breach.tests[0].value).toBe('6');
    expect(breach.tests[0].inputs.totalDebt).toBe('600000');
    const cured = expectOk(
      await test(cov.id, { ebitda: '200000', cash: '100000' }),
    );
    expect(cured.status).toBe('ACTIVE');
    expect(cured.tests[0].value).toBe('2.5');
  });

  it('LT-16: interest cover takes the scheduled interest by default; a breach is waived only by a second person', async () => {
    const cov = await byType('MIN_INTEREST_COVER');
    const loan = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loanId}`),
    );
    const interest = loan.schedule
      .filter((l: { number: number }) => l.number > 0)
      .reduce(
        (t: InstanceType<typeof lending.D>, l: { interestDue: string }) =>
          t.plus(l.interestDue),
        new lending.D(0),
      );
    const pass = expectOk(await test(cov.id, { ebitda: '200000' }));
    expect(pass.status).toBe('ACTIVE');
    expect(
      new lending.D(pass.tests[0].inputs.interestExpense).eq(interest),
    ).toBe(true);
    const breach = expectOk(
      await test(cov.id, { ebitda: interest.times(2).toFixed(2) }),
    );
    expect(breach.status).toBe('BREACHED');
    // The person who recorded the failing test cannot waive it.
    expect(
      (
        await f
          .as('opsMaker')
          .post(`/lending/loans/${loanId}/covenants/${cov.id}/waive`, {
            reason: 'One-off integration costs',
          })
      ).status,
    ).toBe(403);
    expectOk(
      await f
        .as('opsChecker')
        .post(`/lending/loans/${loanId}/covenants/${cov.id}/waive`, {
          reason:
            'One-off integration costs of the acquisition, agreed by credit committee',
        }),
    );
    expect((await byType('MIN_INTEREST_COVER')).status).toBe('WAIVED');
  });

  it('LT-16: a leverage covenant without a threshold, or a statements covenant with one, is refused', async () => {
    expect(
      (
        await f.as('opsMaker').post(`/lending/loans/${loanId}/covenants`, {
          type: 'MAX_LEVERAGE',
          frequencyMonths: 3,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await f.as('opsMaker').post(`/lending/loans/${loanId}/covenants`, {
          type: 'FINANCIAL_STATEMENTS',
          threshold: '1',
          frequencyMonths: 3,
        })
      ).status,
    ).toBe(400);
    const extra = expectOk(
      await f.as('opsMaker').post(`/lending/loans/${loanId}/covenants`, {
        type: 'MIN_INTEREST_COVER',
        threshold: '2.5',
        frequencyMonths: 6,
      }),
    );
    expect(extra.type).toBe('MIN_INTEREST_COVER');
    const fs = await byType('FINANCIAL_STATEMENTS');
    expect(
      expectOk(await test(fs.id, { statementsReceived: true })).status,
    ).toBe('ACTIVE');
  });

  it('services the loan to closure, quarter by quarter, and the books reconcile', async () => {
    const loan = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loanId}`),
    );
    const lines = loan.schedule.filter((l: { number: number }) => l.number > 0);
    expect(lines).toHaveLength(4);
    for (const l of lines) {
      await setBusinessDate(l.dueDate);
      const amount = new lending.D(l.principalDue)
        .plus(l.interestDue)
        .toString();
      expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/loans/${loanId}/repayments`,
            { amount, externalReference: `Q${l.number}` },
            key(`acq-${l.number}`),
          ),
      );
    }
    const closed = expectOk(
      await f.as('opsMaker').get(`/lending/loans/${loanId}`),
    );
    expect(closed.account.status).toBe('CLOSED');
    const r = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(r.trialBalanceBalanced).toBe(true);
    expect(r.breaks).toEqual([]);
  });
});
