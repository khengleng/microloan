/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-require-imports -- integration fixtures: rows come from the untyped Prisma client. */
/**
 * The strict database tenant wall (D-141…D-143, docs/security/RLS.md).
 *
 * Row-level security on every tenant-owned table admits a row only when the
 * transaction declares its tenant (`app.tenant_id`) or a system path
 * (`app.system = on`). These tests use raw SQL — which the Prisma tenant
 * guard never sees — so what they prove is the database's own wall:
 *
 *  - nothing declared → no tenant-owned row at all, not every row;
 *  - tenant A's context → none of tenant B's rows, on the core tables too,
 *    and no write into tenant B;
 *  - NULL-tenant rows (platform users) → system context only;
 *  - system context (cron paths) → every tenant's rows;
 *  - the settings are transaction-local: nothing survives on a pooled
 *    connection.
 */
import { randomUUID } from 'node:crypto';
import { Fixture, TEST_DB, bootstrap } from './harness';

const d = TEST_DB ? describe : describe.skip;

/** Core (legacy app) tables, each with a row of tenant 1 made below. */
const CORE_TABLES = [
  'Tenant',
  'Branch',
  'User',
  'Borrower',
  'KycDocument',
  'LoanProduct',
  'LoanPolicy',
  'Loan',
  'RepaymentSchedule',
  'Repayment',
  'Document',
  'AuditLog',
  'RefreshToken',
];

d('Database tenant wall — strict row-level security (integration)', () => {
  let f: Fixture;
  let runAsTenant: <T>(t: string, fn: () => Promise<T>) => Promise<T>;
  let runAsSystem: <T>(r: string, fn: () => Promise<T>) => Promise<T>;
  /** Table → the id of tenant 1's row in it. */
  const victim: Record<string, string> = {};

  /** How many rows of `table` with `id` the current context can see (raw SQL). */
  const visible = async (table: string, id: string): Promise<number> => {
    const [row]: { n: bigint }[] = await f.prisma.$queryRawUnsafe(
      `SELECT count(*) AS n FROM "${table}" WHERE id = $1`,
      id,
    );
    return Number(row.n);
  };

  beforeAll(async () => {
    f = await bootstrap();
    ({ runAsTenant, runAsSystem } = require('../../src/prisma/tenant-context'));
    await f.system(async () => {
      const borrower = await f.prisma.borrower.create({
        data: { tenantId: f.t1, firstName: 'Wall', lastName: 'Victim' },
      });
      const product = await f.prisma.loanProduct.create({
        data: { tenantId: f.t1, name: 'Wall product', interestMethod: 'FLAT' },
      });
      const policy = await f.prisma.loanPolicy.create({
        data: { productId: product.id, creditRating: 'A', interestRate: 12 },
      });
      const loan = await f.prisma.loan.create({
        data: {
          tenantId: f.t1,
          borrowerId: borrower.id,
          principal: 1000,
          annualInterestRate: 12,
          termMonths: 6,
          interestMethod: 'FLAT',
          startDate: new Date(Date.UTC(2026, 0, 5)),
        },
      });
      const schedule = await f.prisma.repaymentSchedule.create({
        data: {
          loanId: loan.id,
          installmentNumber: 1,
          dueDate: new Date(Date.UTC(2026, 1, 5)),
          principalAmount: 1000,
          interestAmount: 10,
          totalAmount: 1010,
          outstandingPrincipal: 0,
        },
      });
      const repayment = await f.prisma.repayment.create({
        data: { tenantId: f.t1, loanId: loan.id, amount: 5 },
      });
      const kyc = await f.prisma.kycDocument.create({
        data: {
          tenantId: f.t1,
          borrowerId: borrower.id,
          type: 'NATIONAL_ID',
          content: 'x',
        },
      });
      const doc = await f.prisma.document.create({
        data: {
          tenantId: f.t1,
          loanId: loan.id,
          name: 'contract.pdf',
          content: 'x',
          type: 'CONTRACT',
        },
      });
      const audit = await f.prisma.auditLog.create({
        data: {
          tenantId: f.t1,
          action: 'WALL_TEST',
          entity: 'Loan',
          entityId: loan.id,
        },
      });
      const token = await f.prisma.refreshToken.create({
        data: {
          id: randomUUID(),
          userId: f.users.admin1.id,
          hashedToken: `wall-${randomUUID()}`,
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });
      Object.assign(victim, {
        Tenant: f.t1,
        Branch: f.b1,
        User: f.users.admin1.id,
        Borrower: borrower.id,
        KycDocument: kyc.id,
        LoanProduct: product.id,
        LoanPolicy: policy.id,
        Loan: loan.id,
        RepaymentSchedule: schedule.id,
        Repayment: repayment.id,
        Document: doc.id,
        AuditLog: audit.id,
        RefreshToken: token.id,
      });
    });
  }, 120_000);
  afterAll(async () => f?.app.close());

  it('runs as a role that row-level security applies to', async () => {
    const [role]: { rolsuper: boolean; rolbypassrls: boolean }[] =
      await f.prisma.$queryRawUnsafe(
        'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
      );
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it('a query that declares no context sees no tenant-owned row — not every row', async () => {
    for (const t of CORE_TABLES)
      expect([t, await visible(t, victim[t])]).toEqual([t, 0]);
    // Whole tables, not just the fixture rows.
    const [all]: { n: bigint }[] = await f.prisma.$queryRawUnsafe(
      'SELECT (SELECT count(*) FROM "Loan") + (SELECT count(*) FROM "User") + (SELECT count(*) FROM "LoanAccount") + (SELECT count(*) FROM "Tenant") AS n',
    );
    expect(Number(all.n)).toBe(0);
    // An interactive transaction without context is no different.
    const inTx = await f.prisma.$transaction((tx: any) =>
      tx.$queryRawUnsafe(
        'SELECT id FROM "Borrower" WHERE id = $1',
        victim.Borrower,
      ),
    );
    expect(inTx).toEqual([]);
    // Nor can it write.
    await expect(
      f.prisma.$executeRawUnsafe(
        `INSERT INTO "Branch" (id, "tenantId", name, code, "updatedAt") VALUES ($1, $2, 'Wall', 'WAL', now())`,
        randomUUID(),
        f.t1,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('raw SQL in tenant A cannot see, change or add tenant B rows on the core tables', async () => {
    // The owner sees its own rows through the same raw SQL…
    await runAsTenant(f.t1, async () => {
      for (const t of CORE_TABLES)
        expect([t, await visible(t, victim[t])]).toEqual([t, 1]);
    });
    // …and the other organisation sees none of them.
    await runAsTenant(f.t2, async () => {
      for (const t of CORE_TABLES)
        expect([t, await visible(t, victim[t])]).toEqual([t, 0]);
      const changed = await f.prisma.$executeRawUnsafe(
        'UPDATE "Borrower" SET "firstName" = \'Owned\' WHERE id = $1',
        victim.Borrower,
      );
      expect(changed).toBe(0);
      const deleted = await f.prisma.$executeRawUnsafe(
        'DELETE FROM "RepaymentSchedule" WHERE id = $1',
        victim.RepaymentSchedule,
      );
      expect(deleted).toBe(0);
      await expect(
        f.prisma.$executeRawUnsafe(
          `INSERT INTO "Borrower" (id, "tenantId", "firstName", "lastName", "updatedAt") VALUES ($1, $2, 'Planted', 'Row', now())`,
          randomUUID(),
          f.t1,
        ),
      ).rejects.toThrow(/row-level security/);
      // A child row cannot be hung under another tenant's parent either.
      await expect(
        f.prisma.$executeRawUnsafe(
          `INSERT INTO "RepaymentSchedule" (id, "loanId", "installmentNumber", "dueDate", "principalAmount", "interestAmount", "totalAmount", "outstandingPrincipal", "updatedAt")
           VALUES ($1, $2, 9, now(), 1, 1, 2, 0, now())`,
          randomUUID(),
          victim.Loan,
        ),
      ).rejects.toThrow(/row-level security/);
    });
    // Inside a tenant's interactive and batch transactions, the same.
    const inTx = await runAsTenant(f.t2, () =>
      f.prisma.$transaction((tx: any) =>
        tx.$queryRawUnsafe('SELECT id FROM "Loan" WHERE id = $1', victim.Loan),
      ),
    );
    expect(inTx).toEqual([]);
    const [batch]: any[] = await runAsTenant(f.t2, () =>
      f.prisma.$transaction([
        f.prisma.$queryRawUnsafe(
          'SELECT id FROM "User" WHERE id = $1',
          victim.User,
        ),
      ]),
    );
    expect(batch).toEqual([]);
    const settled = await f.system(() =>
      f.prisma.borrower.findUnique({ where: { id: victim.Borrower } }),
    );
    expect(settled.firstName).toBe('Wall');
  });

  it('rows with no tenant (platform users) are visible in system context only', async () => {
    const platformUser = f.users.platform.id;
    await runAsTenant(f.t1, async () =>
      expect(await visible('User', platformUser)).toBe(0),
    );
    expect(await visible('User', platformUser)).toBe(0);
    await runAsSystem('database wall test: platform rows', async () =>
      expect(await visible('User', platformUser)).toBe(1),
    );
  });

  it('system context — the cron paths — sees every tenant', async () => {
    const tenantsSeen = async () => {
      const rows: { tenantId: string }[] = await f.prisma.$queryRawUnsafe(
        'SELECT DISTINCT "tenantId" FROM "Branch" WHERE "tenantId" = ANY($1::text[])',
        [f.t1, f.t2],
      );
      return rows.map((r) => r.tenantId).sort();
    };
    const both = [f.t1, f.t2].sort();
    expect(await runAsSystem('database wall test', tenantsSeen)).toEqual(both);
    // As end of day does: an outer system transaction holding a lock, the
    // tenant loop reading through it.
    expect(
      await runAsSystem('database wall test', () =>
        f.prisma.$transaction(() => tenantsSeen()),
      ),
    ).toEqual(both);
    // The real end-of-day entry point runs (nothing to catch up for a date
    // in the past) instead of finding no tenants or failing on the wall.
    const {
      EodSchedulerService,
    } = require('../../src/lending/servicing/eod-scheduler.service');
    const results = await f.app.get(EodSchedulerService).runAll('2000-01-01');
    expect(Array.isArray(results)).toBe(true);
    expect(results.filter((r: any) => r.error)).toEqual([]);
    // Durable job claims, called the way a cron loop or a shutdown hook
    // calls them (no ambient context): they declare their tenant.
    const { JobClaimService } = require('../../src/prisma/job-claim.service');
    const claims = f.app.get(JobClaimService);
    const runKey = randomUUID();
    expect(await claims.once(f.t1, 'database-wall-test', runKey)).toBe(true);
    expect(await claims.once(f.t1, 'database-wall-test', runKey)).toBe(false);
  });

  it('the settings never outlive their transaction on a pooled connection', async () => {
    // Fill every pooled connection with tenant and system work, then ask each
    // what it still carries.
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        i % 2
          ? runAsTenant(f.t1, () => visible('Loan', victim.Loan))
          : runAsSystem('database wall test', () =>
              visible('Loan', victim.Loan),
            ),
      ),
    );
    const left: { t: string | null; s: string | null }[][] = await Promise.all(
      Array.from({ length: 8 }, () =>
        f.prisma.$queryRawUnsafe(
          `SELECT current_setting('app.tenant_id', true) AS t, current_setting('app.system', true) AS s`,
        ),
      ),
    );
    for (const [row] of left) {
      expect(row.t ?? '').toBe('');
      expect(row.s ?? '').toBe('');
    }
  });

  it('every tenant-owned table, and every table reached through one, is under forced row-level security', async () => {
    const open: { relname: string }[] = await f.prisma.$queryRawUnsafe(`
      SELECT c.relname FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
       WHERE c.relkind = 'r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
       ORDER BY 1`);
    // Only the platform catalogue (read by everyone, no tenant data) and
    // Prisma's bookkeeping stay open.
    expect(open.map((r) => r.relname)).toEqual([
      'AccessPermission',
      'FeatureFlag',
      'LoanFamily',
      'PlanTier',
      'PlatformFlagRule',
      'ProductTemplate',
      '_prisma_migrations',
    ]);
    // And no policy admits rows when nothing is declared.
    const permissive: { polname: string }[] = await f.prisma.$queryRawUnsafe(`
      SELECT polname FROM pg_policy
       WHERE pg_get_expr(polqual, polrelid) NOT LIKE '%current_setting(''app.system''%'`);
    expect(permissive).toEqual([]);
  });
});
