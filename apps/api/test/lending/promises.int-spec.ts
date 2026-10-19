/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped Prisma client. */
/**
 * Promises to pay are followed up automatically (UC-59): kept when the money
 * arrived by the promised date, broken (and flagged to the collector) when not.
 */
import { CollectionsService } from '../../src/collections/collections.service';
import { Fixture, TEST_DB, bootstrap, borrower } from './harness';

const d = TEST_DB ? describe : describe.skip;

d('Promise-to-pay follow-up (integration)', () => {
  let f: Fixture;

  beforeAll(async () => {
    f = await bootstrap();
  }, 60_000);
  afterAll(async () => f?.app.close());

  it('marks a promise kept or broken once its date has passed, and flags the broken one', async () => {
    const day = 86_400_000;
    const now = Date.now();
    const { kept, broken, other } = await f.system(async () => {
      const b = await borrower(f, f.t1, f.b1);
      const product = await f.prisma.loanProduct.create({
        data: { tenantId: f.t1, name: 'PTP test', interestMethod: 'FLAT' },
      });
      const loan = await f.prisma.loan.create({
        data: {
          tenantId: f.t1,
          borrowerId: b.id,
          productId: product.id,
          branchId: f.b1,
          principal: '1000',
          annualInterestRate: '12',
          termMonths: 6,
          interestMethod: 'FLAT',
          startDate: new Date(now - 60 * day),
          status: 'DISBURSED',
        },
      });
      const promise = (amount: string, daysAgo: number) =>
        f.prisma.promiseToPay.create({
          data: {
            tenantId: f.t1,
            loanId: loan.id,
            amount,
            promisedDate: new Date(now - daysAgo * day),
            createdAt: new Date(now - 10 * day),
          },
        });
      const kept = await promise('100', 2);
      const broken = await promise('500', 2);
      const other = await promise('100', -5); // not yet due
      await f.prisma.repayment.create({
        data: {
          tenantId: f.t1,
          loanId: loan.id,
          amount: '150',
          date: new Date(now - 3 * day),
        },
      });
      return { kept, broken, other, loanId: loan.id };
    });
    const svc = f.app.get(CollectionsService);
    const r = await f.system(() => svc.reviewPromises(new Date()));
    expect(r.kept).toBeGreaterThanOrEqual(1);
    expect(r.broken).toBeGreaterThanOrEqual(1);
    const status = async (id: string) =>
      (
        await f.system(() =>
          f.prisma.promiseToPay.findUnique({ where: { id } }),
        )
      ).status;
    expect(await status(kept.id)).toBe('KEPT');
    expect(await status(broken.id)).toBe('BROKEN');
    expect(await status(other.id)).toBe('PENDING');
    const flags = await f.system(() =>
      f.prisma.loanInteraction.findMany({
        where: { loanId: broken.loanId, type: 'SYSTEM' },
      }),
    );
    expect(flags.some((x: any) => x.title === 'Promise to pay broken')).toBe(
      true,
    );
  });
});
