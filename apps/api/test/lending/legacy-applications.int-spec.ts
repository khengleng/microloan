/* eslint-disable @typescript-eslint/no-unsafe-call -- integration fixtures: fixture rows come from the untyped Prisma client. */
/**
 * Closing the original module's open applications (D-169): the operator's
 * script marks PENDING and APPROVED-but-not-disbursed legacy loans REJECTED
 * with the retirement reason — dry run first, idempotent, audited, one
 * organisation at a time when asked.
 */
import { Fixture, TEST_DB, bootstrap, borrower } from './harness';
import {
  LEGACY_CLOSE_REASON,
  closeLegacyApplications,
} from '../../src/lending/migration/close-legacy-applications';

const d = TEST_DB ? describe : describe.skip;

d('Closing legacy applications (integration)', () => {
  let f: Fixture;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    f = await bootstrap();
    const b1 = await borrower(f, f.t1, f.b1);
    const b2 = await borrower(f, f.t2, f.b3);
    await f.system(async () => {
      const mk = async (tenantId: string, borrowerId: string, status: string) =>
        (
          await f.prisma.loan.create({
            data: {
              tenantId,
              borrowerId,
              status,
              principal: 500,
              annualInterestRate: 18,
              termMonths: 6,
              interestMethod: 'FLAT',
              startDate: new Date(Date.UTC(2025, 5, 1)),
            },
          })
        ).id;
      ids.pending = await mk(f.t1, b1.id, 'PENDING');
      ids.approved = await mk(f.t1, b1.id, 'APPROVED');
      ids.disbursed = await mk(f.t1, b1.id, 'DISBURSED');
      ids.rejected = await mk(f.t1, b1.id, 'REJECTED');
      ids.other = await mk(f.t2, b2.id, 'PENDING');
    });
  }, 60_000);
  afterAll(async () => f?.app.close());

  const run = (dryRun: boolean, tenantId: string) =>
    f.system(() =>
      closeLegacyApplications(f.prisma, {
        dryRun,
        tenantId,
        operator: 'ops@test.local',
      }),
    );
  const loan = (id: string) =>
    f.system(() => f.prisma.loan.findUnique({ where: { id } }));

  it('a dry run lists what would close and changes nothing', async () => {
    const r = await run(true, f.t1);
    expect(r).toMatchObject({ dryRun: true, totalFound: 2, totalClosed: 0 });
    expect(r.tenants[0].byStatus).toEqual({ PENDING: 1, APPROVED: 1 });
    expect(r.tenants[0].loanIds.sort()).toEqual(
      [ids.pending, ids.approved].sort(),
    );
    expect((await loan(ids.pending))!.status).toBe('PENDING');
  });

  it('closes PENDING and APPROVED with the reason, audits each, and leaves the rest', async () => {
    const r = await run(false, f.t1);
    expect(r).toMatchObject({ dryRun: false, totalFound: 2, totalClosed: 2 });
    for (const id of [ids.pending, ids.approved])
      expect(await loan(id)).toMatchObject({
        status: 'REJECTED',
        rejectionReason: LEGACY_CLOSE_REASON,
        rejectedBy: 'system:legacy-retirement',
      });
    expect((await loan(ids.disbursed))!.status).toBe('DISBURSED');
    expect((await loan(ids.rejected))!.rejectionReason).toBeNull();
    expect((await loan(ids.other))!.status).toBe('PENDING');

    const audit = await f.system(() =>
      f.prisma.auditLog.findMany({
        where: {
          tenantId: f.t1,
          entity: 'Loan',
          entityId: { in: [ids.pending, ids.approved] },
        },
      }),
    );
    expect(audit).toHaveLength(2);
    expect(audit.map((a: any) => a.metadata.from).sort()).toEqual([
      'APPROVED',
      'PENDING',
    ]);
    expect(audit[0].metadata).toMatchObject({
      event: 'LEGACY_APPLICATION_CLOSED',
      operator: 'ops@test.local',
      runId: r.runId,
    });
  });

  it('is idempotent: a second run finds nothing', async () => {
    expect(await run(false, f.t1)).toMatchObject({
      totalFound: 0,
      totalClosed: 0,
      tenants: [],
    });
    const audit = await f.system(() =>
      f.prisma.auditLog.count({
        where: { tenantId: f.t1, entity: 'Loan', entityId: ids.pending },
      }),
    );
    expect(audit).toBe(1);
  });
});
