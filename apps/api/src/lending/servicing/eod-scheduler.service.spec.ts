import { EodSchedulerService } from './eod-scheduler.service';

/**
 * End of day loops over tenants inside one advisory-locked transaction. A
 * failure in one tenant used to abort the loop, so every later tenant
 * silently missed its end of day.
 */
describe('EodSchedulerService.runAll', () => {
  const tenants = ['t-a', 't-b', 't-c'];

  const build = () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([{ locked: true }]) };
    const prisma = {
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
      loanAccount: {
        findMany: jest
          .fn()
          .mockResolvedValue(tenants.map((tenantId) => ({ tenantId }))),
      },
    };
    const audit = { write: jest.fn().mockResolvedValue(undefined) };
    const scheduler = new EodSchedulerService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      audit as any,
    );
    jest.spyOn((scheduler as any).logger, 'error').mockImplementation(() => {});
    return { scheduler, audit };
  };

  it('carries on with the next tenant when one fails, and audits the failure', async () => {
    const { scheduler, audit } = build();
    const runTenant = jest
      .spyOn(scheduler, 'runTenant')
      .mockImplementation(async (tenantId: string) => {
        if (tenantId === 't-b') throw new Error('deadlock detected');
        return { tenantId, from: '2026-10-18', runs: [] };
      });

    const results = await scheduler.runAll('2026-10-19');

    expect(runTenant.mock.calls.map((c) => c[0])).toEqual(tenants);
    expect(results).toEqual([
      { tenantId: 't-a', from: '2026-10-18', runs: [] },
      { tenantId: 't-b', error: 'deadlock detected' },
      { tenantId: 't-c', from: '2026-10-18', runs: [] },
    ]);
    expect(audit.write).toHaveBeenCalledTimes(1);
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'servicing.eod.run',
        resourceType: 'Tenant',
        resourceId: 't-b',
        outcome: 'FAILURE',
        actor: expect.objectContaining({ tenantId: 't-b' }),
        details: { error: 'deadlock detected' },
      }),
    );
  });

  it('still finishes the run when the failure cannot be audited either', async () => {
    const { scheduler, audit } = build();
    audit.write.mockRejectedValue(new Error('database gone'));
    jest
      .spyOn(scheduler, 'runTenant')
      .mockImplementation(async (tenantId: string) => {
        if (tenantId === 't-a') throw new Error('boom');
        return { tenantId, from: '2026-10-18', runs: [] };
      });

    const results = await scheduler.runAll('2026-10-19');

    expect(results?.map((r) => r.tenantId)).toEqual(tenants);
    expect(results?.[0]).toEqual({ tenantId: 't-a', error: 'boom' });
  });
});
