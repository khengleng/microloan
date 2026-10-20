import { PrismaClient } from '@microloan/db';
import {
  dbSettingsFor,
  queryNeedsContext,
  withDatabaseTenantContext,
} from './db-tenant-context';
import { runAsSystem, runAsTenant } from './tenant-context';

/**
 * The database tenant context (D-141, D-142). The integration suite
 * (test/lending/database-wall.int-spec.ts) proves the policies against
 * PostgreSQL; this proves, without a database, that every query is sent with
 * the right declaration and that nothing is declared without a context.
 */
describe('database tenant context', () => {
  it('maps each ambient context to its transaction-local settings', () => {
    expect(dbSettingsFor(null)).toBeNull();
    expect(dbSettingsFor({ mode: 'tenant', tenantId: 't1' })).toEqual({
      tenantId: 't1',
      system: 'off',
    });
    expect(dbSettingsFor({ mode: 'platform' })).toEqual({
      tenantId: '',
      system: 'on',
    });
    expect(dbSettingsFor({ mode: 'system', reason: 'cron' })).toEqual({
      tenantId: '',
      system: 'on',
    });
  });

  it('declares the context for raw SQL and tenant-owned models, not for a plain catalogue read', () => {
    expect(queryNeedsContext(undefined, '$queryRaw', {})).toBe(true);
    expect(queryNeedsContext('Loan', 'findMany', {})).toBe(true);
    expect(queryNeedsContext('User', 'findUnique', {})).toBe(true);
    expect(queryNeedsContext('Tenant', 'findUnique', {})).toBe(true);
    expect(queryNeedsContext('RepaymentSchedule', 'findMany', {})).toBe(true);
    expect(queryNeedsContext('PlatformPaymentQr', 'findFirst', {})).toBe(true);
    expect(queryNeedsContext('PlanTier', 'findMany', {})).toBe(false);
    expect(
      queryNeedsContext('PlanTier', 'findMany', { select: { code: true } }),
    ).toBe(false);
    // A catalogue read that reaches a relation, or a catalogue write, is
    // declared like any other query.
    expect(
      queryNeedsContext('PlanTier', 'findMany', { include: { tenants: true } }),
    ).toBe(true);
    expect(queryNeedsContext('PlanTier', 'update', {})).toBe(true);
  });

  describe('the extended client', () => {
    const base = new PrismaClient({
      datasources: { db: { url: 'postgresql://nobody@127.0.0.1:1/none' } },
    });
    const client = withDatabaseTenantContext(base);
    let spy: jest.SpyInstance;
    /** What each batch transaction was sent: SQL of its first statement. */
    let batches: unknown[][];

    beforeEach(() => {
      batches = [];
      spy = jest
        .spyOn(base, '$transaction')
        .mockImplementation((arg: unknown) => {
          if (typeof arg === 'function')
            return Promise.resolve(
              (arg as (tx: unknown) => unknown)({
                $executeRaw: (
                  strings: TemplateStringsArray,
                  ...v: unknown[]
                ) => {
                  batches.push([strings.join('?'), ...v]);
                  return Promise.resolve(1);
                },
              }),
            ) as never;
          const items = arg as unknown[];
          batches.push(items);
          return Promise.resolve(items.map((_, i) => `r${i}`)) as never;
        });
    });
    afterEach(() => spy.mockRestore());

    it('sends a tenant query as [set_config, query] in one transaction', async () => {
      const r = await runAsTenant('t1', () => client.loan.findMany());
      expect(r).toBe('r1');
      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(2);
    });

    it('sends system work the same way, and raw SQL too', async () => {
      await runAsSystem('test', () => client.user.count());
      // (The fake result is not a raw result set, so only the batch counts.)
      await runAsSystem('test', () => client.$queryRaw`SELECT 1`).catch(
        () => undefined,
      );
      expect(batches).toHaveLength(2);
      expect(batches.every((b) => b.length === 2)).toBe(true);
    });

    it('declares nothing without a context — the policies then show no row', async () => {
      spy.mockRestore();
      const sent = jest.spyOn(base, '$transaction');
      // No context: the query is not wrapped (it would fail to connect here,
      // which is beside the point — only whether a transaction was opened).
      await client.loan.findMany().catch(() => undefined);
      expect(sent).not.toHaveBeenCalled();
      sent.mockRestore();
    });

    it('opens an interactive transaction with the declaration as its first statement', async () => {
      const out = await runAsTenant('t9', () =>
        client.$transaction(() => Promise.resolve('done')),
      );
      expect(out).toBe('done');
      expect(batches).toEqual([
        [
          "SELECT set_config('app.tenant_id', ?, true), set_config('app.system', ?, true)",
          't9',
          'off',
        ],
      ]);
    });

    it('prepends the declaration to a batch transaction and hides its result', async () => {
      const out = await runAsSystem('test', () =>
        client.$transaction([
          client.$queryRaw`SELECT 1`,
          client.$queryRaw`SELECT 2`,
        ]),
      );
      expect(out).toEqual(['r1', 'r2']);
      expect(batches[0]).toHaveLength(3);
    });
  });
});
