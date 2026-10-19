/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: modules are required after the test environment is configured, and fixture rows come from the untyped Prisma client. */
/**
 * Automatic end-of-day: the scheduler rolls the business date forward a day
 * at a time and runs the batch after each step, once across instances.
 */
import { Fixture, TEST_DB, bootstrap, expectOk } from './harness';
import { activeProduct, originateAndDisburse, standardRoles } from './setup';
import { lending } from '@microloan/shared';

const d = TEST_DB ? describe : describe.skip;

d('End-of-day scheduler (integration)', () => {
  let f: Fixture;
  let scheduler: any;
  let loanId: string;

  beforeAll(async () => {
    f = await bootstrap();
    await standardRoles(f);
    const {
      EodSchedulerService,
    } = require('../../src/lending/servicing/eod-scheduler.service');
    scheduler = f.app.get(EodSchedulerService);
    const { productId } = await activeProduct(
      f,
      'PERSONAL_INSTALMENT',
      'EOD-STD',
    );
    const start = businessDate();
    loanId = (
      await originateAndDisburse(f, productId, {
        principal: '6000',
        numberOfInstalments: 12,
        disbursementDate: await start,
      })
    ).loanId;
  }, 60_000);
  afterAll(async () => f?.app.close());

  async function businessDate(): Promise<string> {
    return expectOk(await f.as('finance').get('/lending/ops/business-date'))
      .businessDate as string;
  }
  const account = async () =>
    expectOk(await f.as('opsMaker').get(`/lending/loans/${loanId}`)).account;

  it('rolls the business date one day at a time and runs the batch each day', async () => {
    const from = await businessDate();
    const before = await account();
    const today = lending.addDays(from, 3);

    const r = await scheduler.runTenant(f.t1, today);

    expect(r.runs.map((x: any) => x.businessDate)).toEqual([
      lending.addDays(from, 1),
      lending.addDays(from, 2),
      today,
    ]);
    expect(r.runs.every((x: any) => x.failed === 0 && x.processed >= 1)).toBe(
      true,
    );
    expect(await businessDate()).toBe(today);
    expect(Number((await account()).interestReceivable)).toBeGreaterThan(
      Number(before.interestReceivable),
    );
  });

  it('does nothing when the business date is already today', async () => {
    const today = await businessDate();
    const r = await scheduler.runTenant(f.t1, today);
    expect(r.runs).toEqual([]);
  });

  it('caps a catch-up run so a long outage cannot start an unbounded run', async () => {
    const from = await businessDate();
    const r = await scheduler.runTenant(f.t1, lending.addDays(from, 10), 2);
    expect(r.runs).toHaveLength(2);
    expect(await businessDate()).toBe(lending.addDays(from, 2));
  });

  it('runs on one instance at a time', async () => {
    const today = await businessDate();
    const [a, b] = await Promise.all([
      scheduler.runAll(today),
      scheduler.runAll(today),
    ]);
    expect([a, b].filter((x) => x === null)).toHaveLength(1);
  });
});
