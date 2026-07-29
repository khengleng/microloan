import { ForbiddenException } from '@nestjs/common';
import { createTenantGuardMiddleware } from './tenant-guard';
import {
  getTenantContext,
  runAsSystem,
  runAsTenant,
  runWithRequestContext,
  setRequestContext,
  SystemContext,
  TenantScopedByArg,
} from './tenant-context';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

/**
 * Minimal Prisma stand-in. Only the delegates the guard reaches for its
 * ownership pre-flights need to exist; `rows` is the fake table content.
 */
type FakeRow = { id: string; tenantId?: string; [key: string]: unknown };

function fakePrisma(rows: Record<string, FakeRow[]> = {}) {
  const delegate = (model: string) => ({
    findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
      const table: FakeRow[] = rows[model] ?? [];
      return table.find((r) => r.id === where.id) ?? null;
    }),
  });
  return {
    loan: delegate('loan'),
    borrower: delegate('borrower'),
    loanProduct: delegate('loanProduct'),
    journalEntry: delegate('journalEntry'),
    provisionRun: delegate('provisionRun'),
    user: delegate('user'),
  } as any;
}

function guard(prisma = fakePrisma(), mode: 'enforce' | 'warn' = 'enforce') {
  return createTenantGuardMiddleware(prisma, {
    mode,
    logger: { warn: jest.fn(), log: jest.fn(), error: jest.fn() } as any,
  });
}

/** Run inside a request whose principal is a tenant user. */
const asTenant = <T>(tenantId: string, fn: () => T): T =>
  runWithRequestContext(() => {
    setRequestContext({ mode: 'tenant', tenantId });
    return fn();
  });

const asPlatform = <T>(fn: () => T): T =>
  runWithRequestContext(() => {
    setRequestContext({ mode: 'platform' });
    return fn();
  });

describe('Prisma tenant guard — the database-level Chinese wall', () => {
  describe('tenant principals', () => {
    it('scopes an unscoped findMany to the caller tenant', async () => {
      const next = jest.fn(async (p: any) => p);
      const params: any = { model: 'Loan', action: 'findMany', args: {} };

      await asTenant(TENANT_A, () => guard()(params, next));

      expect(next.mock.calls[0][0].args.where).toEqual({ tenantId: TENANT_A });
    });

    it('preserves an existing where and ANDs the tenant scope onto it', async () => {
      const next = jest.fn(async (p: any) => p);
      const params: any = {
        model: 'Loan',
        action: 'findMany',
        args: { where: { status: 'DISBURSED' } },
      };

      await asTenant(TENANT_A, () => guard()(params, next));

      expect(next.mock.calls[0][0].args.where).toEqual({
        AND: [{ status: 'DISBURSED' }, { tenantId: TENANT_A }],
      });
    });

    it('scopes deleteMany, so a bulk delete cannot reach another tenant', async () => {
      const next = jest.fn(async (p: any) => p);
      const params: any = {
        model: 'Borrower',
        action: 'deleteMany',
        args: { where: {} },
      };

      await asTenant(TENANT_A, () => guard()(params, next));

      expect(next.mock.calls[0][0].args.where).toEqual({ tenantId: TENANT_A });
    });

    it('returns null rather than another tenant row on findUnique by id', async () => {
      const next = jest.fn(async () => ({ id: 'loan-1', tenantId: TENANT_B }));
      const params: any = {
        model: 'Loan',
        action: 'findUnique',
        args: { where: { id: 'loan-1' } },
      };

      const result = await asTenant(TENANT_A, () => guard()(params, next));

      expect(result).toBeNull();
    });

    it('returns the row on findUnique when it does belong to the caller', async () => {
      const row = { id: 'loan-1', tenantId: TENANT_A };
      const next = jest.fn(async () => row);
      const params: any = {
        model: 'Loan',
        action: 'findUnique',
        args: { where: { id: 'loan-1' } },
      };

      await expect(
        asTenant(TENANT_A, () => guard()(params, next)),
      ).resolves.toBe(row);
    });

    it('throws on findUniqueOrThrow for a foreign row instead of returning null', async () => {
      const next = jest.fn(async () => ({ id: 'loan-1', tenantId: TENANT_B }));
      const params: any = {
        model: 'Loan',
        action: 'findUniqueOrThrow',
        args: { where: { id: 'loan-1' } },
      };

      await expect(
        asTenant(TENANT_A, () => guard()(params, next)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('blocks an update targeting another tenant row, before it mutates', async () => {
      const prisma = fakePrisma({
        loan: [{ id: 'loan-1', tenantId: TENANT_B }],
      });
      const next = jest.fn(async (p: any) => p);
      const params: any = {
        model: 'Loan',
        action: 'update',
        args: { where: { id: 'loan-1' }, data: { status: 'WRITTEN_OFF' } },
      };

      await expect(
        asTenant(TENANT_A, () => guard(prisma)(params, next)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(next).not.toHaveBeenCalled();
    });

    it('allows an update on the caller own row', async () => {
      const prisma = fakePrisma({
        loan: [{ id: 'loan-1', tenantId: TENANT_A }],
      });
      const next = jest.fn(async (p: any) => p);
      const params: any = {
        model: 'Loan',
        action: 'update',
        args: { where: { id: 'loan-1' }, data: { status: 'CLOSED' } },
      };

      await asTenant(TENANT_A, () => guard(prisma)(params, next));

      expect(next).toHaveBeenCalled();
    });

    it('blocks a delete targeting another tenant row', async () => {
      const prisma = fakePrisma({
        borrower: [{ id: 'b-1', tenantId: TENANT_B }],
      });
      const next = jest.fn(async (p: any) => p);
      const params: any = {
        model: 'Borrower',
        action: 'delete',
        args: { where: { id: 'b-1' } },
      };

      await expect(
        asTenant(TENANT_A, () => guard(prisma)(params, next)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(next).not.toHaveBeenCalled();
    });

    it('stamps the caller tenantId onto a create that omits it', async () => {
      const next = jest.fn(async (p: any) => p);
      const params: any = {
        model: 'Borrower',
        action: 'create',
        args: { data: { firstName: 'Sok' } },
      };

      await asTenant(TENANT_A, () => guard()(params, next));

      expect(next.mock.calls[0][0].args.data.tenantId).toBe(TENANT_A);
    });

    it('rejects a create that names another tenant', async () => {
      const next = jest.fn(async (p: any) => p);
      const params: any = {
        model: 'Borrower',
        action: 'create',
        args: { data: { firstName: 'Sok', tenantId: TENANT_B } },
      };

      await expect(
        asTenant(TENANT_A, () => guard()(params, next)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(next).not.toHaveBeenCalled();
    });

    it('rejects a createMany where any single row names another tenant', async () => {
      const next = jest.fn(async (p: any) => p);
      const params: any = {
        model: 'Repayment',
        action: 'createMany',
        args: {
          data: [
            { amount: 1, tenantId: TENANT_A },
            { amount: 2, tenantId: TENANT_B },
          ],
        },
      };

      await expect(
        asTenant(TENANT_A, () => guard()(params, next)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('forbids a tenant principal from creating an organization', async () => {
      const next = jest.fn(async (p: any) => p);
      const params: any = {
        model: 'Tenant',
        action: 'create',
        args: { data: { name: 'x' } },
      };

      await expect(
        asTenant(TENANT_A, () => guard()(params, next)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('scopes reads of the Tenant table to the caller own organization', async () => {
      const next = jest.fn(async (p: any) => p);
      const params: any = { model: 'Tenant', action: 'findMany', args: {} };

      await asTenant(TENANT_A, () => guard()(params, next));

      expect(next.mock.calls[0][0].args.where).toEqual({ id: TENANT_A });
    });
  });

  describe('models with no tenantId column', () => {
    // These are reachable directly through Prisma even though the app only
    // means to reach them via their parent — the wall has to cover them too.
    it('scopes RepaymentSchedule through its loan relation', async () => {
      const next = jest.fn(async (p: any) => p);
      const params: any = {
        model: 'RepaymentSchedule',
        action: 'findMany',
        args: {},
      };

      await asTenant(TENANT_A, () => guard()(params, next));

      expect(next.mock.calls[0][0].args.where).toEqual({
        loan: { tenantId: TENANT_A },
      });
    });

    it('scopes JournalLine through its journal entry', async () => {
      const next = jest.fn(async (p: any) => p);
      const params: any = {
        model: 'JournalLine',
        action: 'findMany',
        args: {},
      };

      await asTenant(TENANT_A, () => guard()(params, next));

      expect(next.mock.calls[0][0].args.where).toEqual({
        entry: { tenantId: TENANT_A },
      });
    });

    it('scopes RefreshToken through its owning user', async () => {
      const next = jest.fn(async (p: any) => p);
      const params: any = {
        model: 'RefreshToken',
        action: 'findMany',
        args: {},
      };

      await asTenant(TENANT_A, () => guard()(params, next));

      expect(next.mock.calls[0][0].args.where).toEqual({
        user: { tenantId: TENANT_A },
      });
    });

    it('rejects creating a child row under another tenant parent', async () => {
      const prisma = fakePrisma({
        loan: [{ id: 'loan-b', tenantId: TENANT_B }],
      });
      const next = jest.fn(async (p: any) => p);
      const params: any = {
        model: 'RepaymentSchedule',
        action: 'create',
        args: { data: { loanId: 'loan-b', dueDate: new Date(0) } },
      };

      await expect(
        asTenant(TENANT_A, () => guard(prisma)(params, next)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(next).not.toHaveBeenCalled();
    });

    it('allows creating a child row under the caller own parent', async () => {
      const prisma = fakePrisma({
        loan: [{ id: 'loan-a', tenantId: TENANT_A }],
      });
      const next = jest.fn(async (p: any) => p);
      const params: any = {
        model: 'RepaymentSchedule',
        action: 'create',
        args: { data: { loanId: 'loan-a', dueDate: new Date(0) } },
      };

      await asTenant(TENANT_A, () => guard(prisma)(params, next));

      expect(next).toHaveBeenCalled();
    });
  });

  describe('platform and system principals', () => {
    it('lets SUPERADMIN through unscoped — the one deliberate hole', async () => {
      const next = jest.fn(async (p: any) => p);
      const params: any = { model: 'Loan', action: 'findMany', args: {} };

      await asPlatform(() => guard()(params, next));

      expect(next.mock.calls[0][0].args.where).toBeUndefined();
    });

    it('lets an explicitly declared system path through unscoped', async () => {
      const next = jest.fn(async (p: any) => p);
      const params: any = {
        model: 'User',
        action: 'findUnique',
        args: { where: { email: 'a@b.c' } },
      };

      await runAsSystem('test: login lookup', () => guard()(params, next));

      expect(next).toHaveBeenCalled();
    });

    it('re-applies the wall inside runAsTenant, for per-tenant cron work', async () => {
      const next = jest.fn(async (p: any) => p);
      const params: any = { model: 'Loan', action: 'findMany', args: {} };

      await runAsSystem('test: cron', () =>
        runAsTenant(TENANT_B, () => guard()(params, next)),
      );

      expect(next.mock.calls[0][0].args.where).toEqual({ tenantId: TENANT_B });
    });
  });

  describe('platform-owned configuration', () => {
    // PlatformPaymentQr holds the operator's own Bakong merchant details. It
    // has no tenantId, so without an explicit entry it would fall through
    // `isGuarded` and be readable by every tenant.
    it('denies a tenant principal any access to PlatformPaymentQr', async () => {
      const next = jest.fn(async (p: any) => p);
      const params: any = {
        model: 'PlatformPaymentQr',
        action: 'findMany',
        args: {},
      };

      await expect(
        asTenant(TENANT_A, () => guard()(params, next)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(next).not.toHaveBeenCalled();
    });

    it('denies writes as well as reads', async () => {
      const next = jest.fn(async (p: any) => p);
      const params: any = {
        model: 'PlatformPaymentQr',
        action: 'create',
        args: { data: { bakongAccountId: 'evil@devb' } },
      };

      await expect(
        asTenant(TENANT_A, () => guard()(params, next)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows the platform owner', async () => {
      const next = jest.fn(async (p: any) => p);
      const params: any = {
        model: 'PlatformPaymentQr',
        action: 'findFirst',
        args: {},
      };

      await asPlatform(() => guard()(params, next));

      expect(next).toHaveBeenCalled();
    });

    /**
     * PlanTier is the third category: platform-owned but not secret. The quota
     * guard reads the caller's own ceilings mid-request and the signup page
     * reads prices with no principal at all, so the read must be open — while
     * the write stays the platform owner's alone.
     */
    it('lets a tenant principal read the plan catalogue', async () => {
      const next = jest.fn(async (p: any) => p);
      const params: any = { model: 'PlanTier', action: 'findMany', args: {} };

      await asTenant(TENANT_A, () => guard()(params, next));

      expect(next).toHaveBeenCalled();
      // Read openly, but NOT rewritten to look tenant-owned: a `tenantId`
      // filter here would match nothing and the quota guard would see no tiers.
      expect(params.args.where).toBeUndefined();
    });

    it('lets an unauthenticated caller read the plan catalogue', async () => {
      // The signup price list is fetched before anyone has an account. With no
      // context at all this must still succeed — everything else fails closed.
      const next = jest.fn(async (p: any) => p);
      const params: any = { model: 'PlanTier', action: 'findMany', args: {} };

      await guard()(params, next);

      expect(next).toHaveBeenCalled();
    });

    it('refuses a tenant principal writing to the plan catalogue', async () => {
      // Otherwise a tenant could mint itself an unlimited tier.
      const next = jest.fn(async (p: any) => p);
      const params: any = {
        model: 'PlanTier',
        action: 'update',
        args: { where: { id: 'tier-free' }, data: { maxLoans: null } },
      };

      await expect(
        asTenant(TENANT_A, () => guard()(params, next)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(next).not.toHaveBeenCalled();
    });

    it('refuses a tenant principal creating or deleting a tier', async () => {
      for (const action of ['create', 'delete', 'deleteMany', 'upsert']) {
        const next = jest.fn(async (p: any) => p);
        const params: any = { model: 'PlanTier', action, args: { data: {} } };
        await expect(
          asTenant(TENANT_A, () => guard()(params, next)),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(next).not.toHaveBeenCalled();
      }
    });

    it('allows the platform owner to write the plan catalogue', async () => {
      const next = jest.fn(async (p: any) => p);
      const params: any = {
        model: 'PlanTier',
        action: 'create',
        args: { data: { name: 'STARTER' } },
      };

      await asPlatform(() => guard()(params, next));

      expect(next).toHaveBeenCalled();
    });

    it('scopes the new PlanPayment table to the caller tenant', async () => {
      const next = jest.fn(async (p: any) => p);
      const params: any = {
        model: 'PlanPayment',
        action: 'findMany',
        args: {},
      };

      await asTenant(TENANT_A, () => guard()(params, next));

      expect(next.mock.calls[0][0].args.where).toEqual({ tenantId: TENANT_A });
    });

    it('scopes FederatedIdentity through its owning user', async () => {
      const next = jest.fn(async (p: any) => p);
      const params: any = {
        model: 'FederatedIdentity',
        action: 'findMany',
        args: {},
      };

      await asTenant(TENANT_A, () => guard()(params, next));

      expect(next.mock.calls[0][0].args.where).toEqual({
        user: { tenantId: TENANT_A },
      });
    });
  });

  describe('fail-closed defaults', () => {
    it('denies a tenant-owned query made with no context at all', async () => {
      const next = jest.fn(async (p: any) => p);
      const params: any = { model: 'Loan', action: 'findMany', args: {} };

      await expect(guard()(params, next)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('allows and logs the same query under TENANT_GUARD_MODE=warn', async () => {
      const next = jest.fn(async (p: any) => p);
      const params: any = { model: 'Loan', action: 'findMany', args: {} };

      await guard(fakePrisma(), 'warn')(params, next);

      expect(next).toHaveBeenCalled();
    });

    it('ignores models that hold no tenant data', async () => {
      const next = jest.fn(async (p: any) => p);
      const params: any = {
        model: 'SomeUnguardedModel',
        action: 'findMany',
        args: {},
      };

      await expect(guard()(params, next)).resolves.toBeDefined();
    });

    it('denies an unclassified action against a tenant-owned model', async () => {
      const next = jest.fn(async (p: any) => p);
      const params: any = {
        model: 'Loan',
        action: 'someFutureAction',
        args: {},
      };

      await expect(
        asTenant(TENANT_A, () => guard()(params, next)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});

/**
 * The decorators are the only thing standing between a cron job and a 403 at
 * 00:00, and the existing cron specs only assert the service is defined — so
 * the wrapping is verified directly here.
 */
describe('context decorators', () => {
  class Worker {
    calls: string[] = [];

    @SystemContext('cron: nightly sweep')
    async nightlySweep() {
      this.calls.push('nightlySweep');
      return getTenantContext();
    }

    @TenantScopedByArg(0)
    async perTenant(tenantId: string, note: string) {
      this.calls.push(`perTenant:${tenantId}:${note}`);
      return getTenantContext();
    }
  }

  it('@SystemContext establishes system mode for the whole call', async () => {
    await expect(new Worker().nightlySweep()).resolves.toEqual({
      mode: 'system',
      reason: 'nightlySweep: cron: nightly sweep',
    });
  });

  it('@SystemContext preserves `this` and the return value', async () => {
    const worker = new Worker();
    await worker.nightlySweep();
    expect(worker.calls).toEqual(['nightlySweep']);
  });

  it('@TenantScopedByArg pins the context to the named tenant', async () => {
    await expect(new Worker().perTenant(TENANT_B, 'x')).resolves.toEqual({
      mode: 'tenant',
      tenantId: TENANT_B,
    });
  });

  it('@TenantScopedByArg forwards all arguments unchanged', async () => {
    const worker = new Worker();
    await worker.perTenant(TENANT_A, 'reminder');
    expect(worker.calls).toEqual([`perTenant:${TENANT_A}:reminder`]);
  });

  it('leaves no context behind once the call unwinds', async () => {
    await new Worker().nightlySweep();
    expect(getTenantContext()).toBeNull();
  });

  it('re-scopes a per-tenant call made from inside a system sweep', async () => {
    const worker = new Worker();
    const inner = await runAsSystem('cron', () =>
      worker.perTenant(TENANT_A, 'nested'),
    );
    expect(inner).toEqual({ mode: 'tenant', tenantId: TENANT_A });
  });
});
