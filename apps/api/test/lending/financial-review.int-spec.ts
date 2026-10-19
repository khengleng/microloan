/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped API responses and Prisma client. */
/**
 * Financial-review fixes in servicing (DECISIONS D-133…D-137):
 *
 * - late penalties on a non-accrual loan are held in penalty suspense and
 *   released to income when collected (D-134);
 * - a backdated repayment undoes the penalty for the days it would have
 *   prevented, and reversing it puts the penalty back (D-135);
 * - a held down payment is refunded before disbursement only, maker-checker
 *   (D-137);
 * - a repayment cannot be reversed once the agreement changed after it
 *   (a payment holiday here), and allocations name the line paid (D-137).
 */
import { lending } from '@microloan/shared';
import { Fixture, TEST_DB, bootstrap, expectOk, grant, key } from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

const PENALTY_18 = {
  type: 'RATE_ON_OVERDUE',
  flatAmount: null,
  percentOfOverdue: null,
  annualRate: '0.18',
  graceDays: 0,
  capPerInstalment: null,
  capPerLoan: null,
};
const terms = {
  principal: '6000',
  numberOfInstalments: 12,
  disbursementDate: '2026-01-05',
};

d('Financial review: penalties, refunds and reversals (integration)', () => {
  let f: Fixture;
  let suspended: string;
  let backdated: string;
  let holiday: string;
  let downPaid: string;
  let refundTask: string;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    await grant(f, f.t1, 'approver2', 'RESTRUCTURE_COMMITTEE');
    await grant(f, f.t1, 'approver', 'RESTRUCTURE_COMMITTEE');
    await grant(f, f.t1, 'opsMaker', 'COLLECTIONS_OFFICER');
    const { productId: susp } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-PSUSP',
      (c) => {
        c.pricing.fees = [];
        c.pricing.penalty = PENALTY_18;
        c.operations.nonAccrual = { enabled: true, fromDpd: 30, cureAtDpd: 0 };
      },
    );
    const { productId: back } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-BACKD',
      (c) => {
        c.pricing.fees = [];
        c.pricing.penalty = PENALTY_18;
        c.repayment.maxBackdateDays = 10;
      },
    );
    const { productId: plain } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-REVH',
      (c) => {
        c.pricing.fees = [];
      },
    );
    suspended = (await originateAndDisburse(f, susp, terms)).loanId;
    backdated = (await originateAndDisburse(f, back, terms)).loanId;
    holiday = (await originateAndDisburse(f, plain, terms)).loanId;
    downPaid = (
      await originateAndDisburse(f, plain, terms, {
        // The 60 still held after the refund is paid to the seller with the loan.
        payees: [
          {
            type: 'DEALER',
            name: 'Phnom Penh Motors',
            account: 'ABA-0012',
            amount: '6060.00',
          },
        ],
        beforeDisbursement: async (loanId) => {
          expectOk(
            await f.as('opsMaker').post(
              `/lending/loans/${loanId}/down-payments`,
              {
                amount: '100',
                collectedBy: 'LENDER',
                externalReference: 'RCPT-DP-1',
              },
              key('dp'),
            ),
          );
          const task = expectOk(
            await f
              .as('opsMaker')
              .post(`/lending/loans/${loanId}/down-payment-refunds`, {
                amount: '40',
                reason: 'Customer reduced the deposit',
              }),
          );
          refundTask = task.id;
          // The proposer cannot approve their own refund.
          const own = await f
            .as('opsMaker')
            .post(
              `/lending/loans/${loanId}/down-payment-refunds/${task.id}/decision`,
              { approve: true },
              key('dp-own'),
            );
          expect(own.status).toBe(403);
          const ev = expectOk(
            await f
              .as('opsChecker')
              .post(
                `/lending/loans/${loanId}/down-payment-refunds/${task.id}/decision`,
                { approve: true },
                key('dp-ok'),
              ),
          );
          expect(ev.type).toBe('DOWN_PAYMENT_REFUND');
          const l = await loan(loanId);
          expect(Number(l.account.downPaymentHeld)).toBe(60);
          expect(Number(l.account.downPaymentReceived)).toBe(60);
        },
      })
    ).loanId;
  }, 180_000);
  afterAll(async () => f?.app.close());

  const loan = async (id: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${id}`));
  const line = (l: any, n: number) =>
    l.schedule.find((x: any) => x.number === n && x.status !== 'SUPERSEDED');
  const moveTo = async (target: string) => {
    let current = expectOk(
      await f.as('finance').get('/lending/ops/business-date'),
    ).businessDate as string;
    while (lending.compareDates(current, target) < 0) {
      const step = lending.addDays(current, 31);
      current = lending.compareDates(step, target) > 0 ? target : step;
      expectOk(
        await f
          .as('finance')
          .post('/lending/ops/business-date', { businessDate: current }),
      );
      const run = expectOk(
        await f.as('finance').post('/lending/loans/batch/run'),
      );
      expect(run.failed).toEqual([]);
    }
  };
  const reconcile = async () => {
    const rec = expectOk(
      await f.as('finance').get('/lending/ops/reconciliation'),
    );
    expect(rec.breaks).toEqual([]);
  };
  const penaltyFor = (overdue: string, days: number) =>
    lending.roundMoney(
      new lending.D(overdue).times('0.18').times(days).div(365),
      { increment: '0.01', mode: 'HALF_UP' },
    );

  describe('down payments (D-137)', () => {
    it('the approved refund paid the borrower back from the money held', async () => {
      const l = await loan(downPaid);
      const refund = l.events.find(
        (e: any) => e.type === 'DOWN_PAYMENT_REFUND',
      );
      expect(Number(refund.amount)).toBe(40);
      expect(refund.components.task).toBe(refundTask);
      await reconcile();
    });

    it('is not refundable once the loan is disbursed', async () => {
      const r = await f
        .as('opsMaker')
        .post(`/lending/loans/${downPaid}/down-payment-refunds`, {
          amount: '10',
          reason: 'Too late',
        });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('DOWN_PAYMENT_NOT_REFUNDABLE');
    });
  });

  describe('reversal after the agreement changed (D-137)', () => {
    let paymentId: string;

    it('allocations name the schedule line they paid', async () => {
      await moveTo('2026-02-05');
      const l = await loan(holiday);
      const first = line(l, 1);
      const ev = expectOk(
        await f.as('opsMaker').post(
          `/lending/loans/${holiday}/repayments`,
          {
            amount: (
              Number(first.principalDue) + Number(first.interestDue)
            ).toFixed(2),
          },
          key('pay-h'),
        ),
      );
      paymentId = ev.id;
      const allocations = await f.system(() =>
        f.prisma.paymentAllocation.findMany({
          where: { financialEventId: ev.id },
        }),
      );
      expect(allocations.length).toBeGreaterThan(0);
      expect(allocations.every((a: any) => a.instalmentId === first.id)).toBe(
        true,
      );
    });

    it('is refused once a payment holiday replaced the schedule', async () => {
      const programme = expectOk(
        await f
          .as('approver2')
          .post('/lending/ops/payment-holiday-programmes', {
            code: 'FR_HOLIDAY',
            name: 'Financial review holiday',
            maxInstalments: 2,
            interestTreatment: 'DEFER_NO_CAPITALIZATION',
            termTreatment: 'EXTEND_TERM',
            opensOn: '2026-01-01',
            closesOn: '2026-12-31',
            minInstalmentsPaid: 0,
            maxDaysPastDue: 30,
            minInstalmentsRemaining: 2,
            maxHolidaysPerLoan: 1,
          }),
      );
      expectOk(
        await f
          .as('approver')
          .post(
            `/lending/ops/payment-holiday-programmes/${programme.id}/status`,
            { status: 'OPEN' },
          ),
      );
      expectOk(
        await f
          .as('opsMaker')
          .post(`/lending/loans/${holiday}/payment-holidays/${programme.id}`, {
            instalments: 2,
          }),
      );
      const r = await f
        .as('opsChecker')
        .post(
          `/lending/loans/${holiday}/events/${paymentId}/reverse`,
          { reason: 'Keyed against the wrong loan' },
          key('rev-h'),
        );
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('AGREEMENT_CHANGED_SINCE_PAYMENT');
      await reconcile();
    });
  });

  describe('backdated repayment and late penalties (D-133, D-135)', () => {
    let overdue: string;
    let paymentId: string;

    it('charges daily penalty on the cumulative accrual', async () => {
      await moveTo('2026-02-15');
      const first = line(await loan(backdated), 1);
      overdue = new lending.D(first.principalDue)
        .plus(first.interestDue)
        .toString();
      expect(first.penaltyDue).toBe(penaltyFor(overdue, 10).toString());
      expect(first.penaltyAssessedThrough).toBe('2026-02-15');
    });

    it('a payment valued 8 February undoes the penalty from that day on', async () => {
      const pen3 = penaltyFor(overdue, 3);
      const ev = expectOk(
        await f.as('opsMaker').post(
          `/lending/loans/${backdated}/repayments`,
          {
            amount: new lending.D(overdue).plus(pen3).toFixed(2),
            valueDate: '2026-02-08',
          },
          key('pay-b'),
        ),
      );
      paymentId = ev.id;
      expect(ev.components.penalty).toBe(pen3.toString());
      expect(ev.components.penaltyRewind.reversed).toBe(
        penaltyFor(overdue, 10).minus(pen3).toString(),
      );
      const l = await loan(backdated);
      const first = line(l, 1);
      expect(first.status).toBe('PAID');
      expect(first.penaltyDue).toBe(pen3.toString());
      expect(Number(l.account.penaltyReceivable)).toBe(0);
      const undo = l.events.find((e: any) => e.type === 'PENALTY_REVERSAL');
      expect(undo.valueDate).toMatch(/^2026-02-08/);
      await reconcile();
    });

    it('reversing the payment puts the penalty back, and accrual carries on from it', async () => {
      expectOk(
        await f
          .as('opsChecker')
          .post(
            `/lending/loans/${backdated}/events/${paymentId}/reverse`,
            { reason: 'Payment returned by the bank' },
            key('rev-b'),
          ),
      );
      let l = await loan(backdated);
      expect(line(l, 1).penaltyDue).toBe(penaltyFor(overdue, 10).toString());
      expect(l.account.penaltyReceivable).toBe(
        penaltyFor(overdue, 10).toString(),
      );
      expect(
        l.events.find((e: any) => e.type === 'PENALTY_REVERSAL').status,
      ).toBe('REVERSED');
      await reconcile();
      await moveTo('2026-02-16');
      l = await loan(backdated);
      expect(line(l, 1).penaltyDue).toBe(penaltyFor(overdue, 11).toString());
      await reconcile();
    });

    it('a partial backdated payment keeps the penalty on what it left overdue', async () => {
      const rate = (amount: lending.Dec, days: number) =>
        amount.times('0.18').times(days).div(365);
      const full = new lending.D(overdue);
      const round = (x: lending.Dec) =>
        lending.roundMoney(x, { increment: '0.01', mode: 'HALF_UP' });
      const before7 = rate(full, 7);
      const ev = expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/loans/${backdated}/repayments`,
            { amount: '500.00', valueDate: '2026-02-12' },
            key('pay-b2'),
          ),
      );
      // Penalty to 12 February is paid first; the rest reduces the overdue.
      expect(ev.components.penalty).toBe(round(before7).toString());
      const left = full.minus(new lending.D(500).minus(round(before7)));
      const expected = round(before7.plus(rate(left, 4)));
      expect(ev.components.penaltyRewind.recharged).toBe(
        expected.minus(round(before7)).toString(),
      );
      const l = await loan(backdated);
      expect(line(l, 1).penaltyDue).toBe(expected.toString());
      expect(line(l, 1).penaltyAssessedThrough).toBe('2026-02-16');
      await reconcile();
    });
  });

  describe('penalties on a non-accrual loan (D-134)', () => {
    it('unpaid penalty moves to suspense when the loan stops accruing', async () => {
      await moveTo('2026-03-08');
      const l = await loan(suspended);
      expect(l.account.nonAccrual).toBe(true);
      expect(Number(l.account.penaltyReceivable)).toBeGreaterThan(0);
      expect(l.account.penaltyInSuspense).toBe(l.account.penaltyReceivable);
      await reconcile();
    });

    it('new penalty is credited to suspense, not income', async () => {
      await moveTo('2026-03-12');
      const l = await loan(suspended);
      const latest = l.events
        .filter((e: any) => e.type === 'PENALTY')
        .sort((a: any, b: any) => a.createdAt.localeCompare(b.createdAt))
        .pop();
      expect(latest.components.suspended).toBe(true);
      expect(l.account.penaltyInSuspense).toBe(l.account.penaltyReceivable);
      await reconcile();
    });

    it('collected penalty is released from suspense to income', async () => {
      const before = await loan(suspended);
      const pen1 = line(before, 1).penaltyDue;
      const ev = expectOk(
        await f
          .as('opsMaker')
          .post(
            `/lending/loans/${suspended}/repayments`,
            { amount: pen1 },
            key('pay-s'),
          ),
      );
      expect(ev.components.penalty).toBe(pen1);
      expect(ev.components.penaltySuspenseReleased).toBe(pen1);
      const after = await loan(suspended);
      expect(after.account.penaltyInSuspense).toBe(
        new lending.D(before.account.penaltyInSuspense).minus(pen1).toString(),
      );
      await reconcile();
    });
  });
});
