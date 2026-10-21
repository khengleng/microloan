/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-require-imports -- integration fixtures: fixture rows come from the untyped API responses; services are required after the environment is configured. */
/**
 * Promises to pay on lending loans and their daily review (UC-59; D-168):
 * recorded with a work-queue outcome or on their own, reviewed after end of
 * day — kept when the money received from the day of the promise to the
 * promised date plus the grace days covers it, broken otherwise, raising a
 * task in the next stage's work queue.
 */
import {
  Fixture,
  TEST_DB,
  bootstrap,
  expectOk,
  key,
  lendingSettings,
} from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';

const d = TEST_DB ? describe : describe.skip;

d('Promises to pay (integration)', () => {
  let f: Fixture;
  let kept: string;
  let broken: string;
  let withdrawn: string;
  let promises: any;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    await lendingSettings(f, f.t1, {
      collections: { promiseToPay: { graceDays: 2, maxDaysAhead: 10 } },
    });
    const { productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'PL-PROMISE',
      (c) => {
        c.pricing.fees = [];
        c.pricing.penalty = {
          type: 'NONE',
          flatAmount: null,
          percentOfOverdue: null,
          annualRate: null,
          graceDays: 0,
          capPerInstalment: null,
          capPerLoan: null,
        };
        c.operations.collectionStages = [
          {
            code: 'REMIND',
            label: 'Reminder',
            fromDpd: 1,
            action: 'SMS',
            queue: '',
          },
          {
            code: 'PHONE',
            label: 'Phone follow-up',
            fromDpd: 5,
            action: 'CALL',
            queue: 'PHONE',
          },
          {
            code: 'FIELD',
            label: 'Field visit',
            fromDpd: 30,
            action: 'VISIT',
            queue: 'FIELD',
          },
        ];
      },
    );
    const terms = {
      principal: '3000',
      numberOfInstalments: 6,
      disbursementDate: '2026-01-05',
    };
    kept = (await originateAndDisburse(f, productId, terms)).loanId;
    broken = (await originateAndDisburse(f, productId, terms)).loanId;
    withdrawn = (await originateAndDisburse(f, productId, terms)).loanId;
    const {
      PromisesService,
    } = require('../../src/lending/collections/promises.service');
    promises = f.app.get(PromisesService);
  }, 120_000);
  afterAll(async () => f?.app.close());

  const moveTo = async (businessDate: string) => {
    expectOk(
      await f
        .as('finance')
        .post('/lending/ops/business-date', { businessDate }),
    );
    expect(
      expectOk(await f.as('finance').post('/lending/loans/batch/run')).failed,
    ).toEqual([]);
  };
  const forLoan = async (id: string) =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${id}/promises`));
  const firstInstalment = async (id: string) => {
    const loan = expectOk(await f.as('opsMaker').get(`/lending/loans/${id}`));
    const l = loan.schedule.find(
      (x: any) => x.number === 1 && x.status !== 'SUPERSEDED',
    );
    return (Number(l.principalDue) + Number(l.interestDue)).toFixed(2);
  };

  it('records a promise with the call outcome, within the settings’ horizon', async () => {
    await moveTo('2026-02-05');
    await moveTo('2026-02-10');
    const queue = expectOk(
      await f
        .as('opsMaker')
        .get('/lending/collections/tasks?queue=PHONE&status=OPEN'),
    );
    const call = queue.find((t: any) => t.loanAccountId === kept);
    expect(call).toBeDefined();
    const amount = await firstInstalment(kept);

    // Beyond maxDaysAhead (10): refused.
    const far = await f
      .as('opsMaker')
      .post(`/lending/collections/tasks/${call.id}/complete`, {
        outcome: 'PROMISE_TO_PAY',
        promise: { amount, payBy: '2026-02-25' },
      });
    expect(far.status).toBe(400);
    expect(far.body.code).toBe('PROMISE_DATE_OUT_OF_RANGE');

    const done = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/collections/tasks/${call.id}/complete`, {
          outcome: 'PROMISE_TO_PAY',
          note: 'Pays after harvest sale',
          promise: { amount, payBy: '2026-02-13' },
        }),
    );
    expect(done.promise).toMatchObject({
      status: 'PENDING',
      promisedOn: '2026-02-10',
      payBy: '2026-02-13',
      graceDays: 2,
      countsUntil: '2026-02-15',
      taskId: call.id,
    });

    // On its own (the customer called in), for a smaller amount.
    const p = expectOk(
      await f.as('opsMaker').post(`/lending/loans/${broken}/promises`, {
        amount: '400',
        payBy: '2026-02-12',
      }),
    );
    expect(p).toMatchObject({ status: 'PENDING', countsUntil: '2026-02-14' });
    // Someone without collections work cannot record one.
    expect(
      (
        await f.as('nobody').post(`/lending/loans/${broken}/promises`, {
          amount: '400',
          payBy: '2026-02-12',
        })
      ).status,
    ).toBe(403);
  });

  it('a newer promise replaces the pending one; a pending promise can be withdrawn', async () => {
    const first = expectOk(
      await f.as('opsMaker').post(`/lending/loans/${withdrawn}/promises`, {
        amount: '200',
        payBy: '2026-02-11',
      }),
    );
    const second = expectOk(
      await f.as('opsMaker').post(`/lending/loans/${withdrawn}/promises`, {
        amount: '300',
        payBy: '2026-02-14',
      }),
    );
    const rows = await forLoan(withdrawn);
    expect(rows.find((r: any) => r.id === first.id)).toMatchObject({
      status: 'CANCELLED',
      note: 'Replaced by a newer promise.',
    });
    const gone = expectOk(
      await f
        .as('opsMaker')
        .post(`/lending/collections/promises/${second.id}/cancel`, {
          reason: 'Customer disputes the arrears',
        }),
    );
    expect(gone).toMatchObject({
      status: 'CANCELLED',
      reviewedOn: '2026-02-10',
    });
    expect(
      (
        await f
          .as('opsMaker')
          .post(`/lending/collections/promises/${second.id}/cancel`, {
            reason: 'again',
          })
      ).status,
    ).toBe(409);
  });

  it('KEPT once the money received covers it; reviewed once per tenant and day', async () => {
    await moveTo('2026-02-12');
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${kept}/repayments`,
          { amount: await firstInstalment(kept) },
          key('ptp-kept'),
        ),
    );
    expectOk(
      await f
        .as('opsMaker')
        .post(
          `/lending/loans/${broken}/repayments`,
          { amount: '50' },
          key('ptp-part'),
        ),
    );
    const r = await promises.afterEndOfDay(f.t1, '2026-02-12');
    expect(r).toMatchObject({ kept: 1, broken: 0 });
    // The day is claimed: a second run (another instance) does nothing.
    expect(await promises.afterEndOfDay(f.t1, '2026-02-12')).toBeNull();
    const [k] = await forLoan(kept);
    expect(k).toMatchObject({ status: 'KEPT', reviewedOn: '2026-02-12' });
    expect(Number(k.received)).toBeCloseTo(Number(k.amount), 2);
    // Still inside its window (to 2026-02-14): pending.
    expect((await forLoan(broken))[0].status).toBe('PENDING');
  });

  it('BROKEN after the promised date plus grace: a task in the next stage’s queue', async () => {
    await moveTo('2026-02-14');
    expect(await promises.review(f.t1, '2026-02-14')).toMatchObject({
      broken: 0,
    });
    await moveTo('2026-02-15');
    const run = expectOk(
      await f.as('finance').post('/lending/collections/promises/review'),
    );
    expect(run).toMatchObject({
      businessDate: '2026-02-15',
      broken: 1,
      tasksRaised: 1,
    });
    const [b] = await forLoan(broken);
    expect(b).toMatchObject({ status: 'BROKEN', reviewedOn: '2026-02-15' });
    expect(Number(b.received)).toBe(50);
    expect(b.followUpTaskId).toBeTruthy();

    // PHONE is the loan's stage (10 days past due): the task goes to FIELD.
    const field = expectOk(
      await f
        .as('opsMaker')
        .get('/lending/collections/tasks?queue=FIELD&status=OPEN'),
    );
    const task = field.find((t: any) => t.id === b.followUpTaskId);
    expect(task).toMatchObject({
      loanAccountId: broken,
      stage: 'PROMISE_BROKEN',
      action: 'VISIT',
      status: 'OPEN',
    });
    expect(task.note).toContain('Promise to pay broken');
    expect(Number(task.amountOverdue)).toBeGreaterThan(0);

    // Reviewing again changes nothing.
    expect(
      expectOk(
        await f.as('finance').post('/lending/collections/promises/review'),
      ),
    ).toMatchObject({ reviewed: 0 });
    // Staff without the batch permission cannot run the review.
    expect(
      (await f.as('nobody').post('/lending/collections/promises/review'))
        .status,
    ).toBe(403);

    const list = expectOk(
      await f.as('opsMaker').get('/lending/collections/promises?status=BROKEN'),
    );
    expect(list.map((p: any) => p.loanAccountId)).toEqual([broken]);
    // The review is audited.
    const audits = await f.system(() =>
      f.prisma.auditEvent.findMany({
        where: {
          tenantId: f.t1,
          action: 'collection.promise.review',
          resourceId: broken,
        },
      }),
    );
    expect(audits).toHaveLength(1);
  });

  it('another tenant sees none of it', async () => {
    expect([403, 404]).toContain(
      (await f.as('t2admin').get(`/lending/loans/${broken}/promises`)).status,
    );
    const list = await f.as('t2admin').get('/lending/collections/promises');
    expect([200, 403]).toContain(list.status);
    expect(list.text).not.toContain(broken);
  });
});
