/**
 * Close the original loan module's open applications: every legacy loan
 * still PENDING, or APPROVED and never paid out, becomes REJECTED with the
 * reason "Original loan module retired" (docs/lending/LEGACY_RETIREMENT.md,
 * DECISIONS D-169). Idempotent and audited; nothing runs it automatically.
 *
 *   pnpm legacy:close-applications --dry-run --operator=ops@example.com
 *   pnpm legacy:close-applications --operator=ops@example.com [--tenant=<id>]
 *
 * Run with the API's DATABASE_URL (the runtime role is enough: it runs as a
 * declared system path, so row-level security admits every tenant).
 */
import { PrismaClient } from '@microloan/db';
import { withDatabaseTenantContext } from '../prisma/db-tenant-context';
import { runAsSystem } from '../prisma/tenant-context';
import { closeLegacyApplications } from '../lending/migration/close-legacy-applications';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf('=');
  return eq === -1 ? 'true' : hit.slice(eq + 1);
}

async function main() {
  const dryRun = arg('dry-run') === 'true';
  const operator = arg('operator');
  const tenantId = arg('tenant');
  if (!operator || operator === 'true') {
    // eslint-disable-next-line no-console
    console.error('Pass --operator=<your e-mail or name>: it is recorded on every audit row.');
    process.exit(2);
  }
  const prisma = withDatabaseTenantContext(new PrismaClient());
  try {
    const r = await closeLegacyApplications(prisma as unknown as PrismaClient, {
      dryRun,
      operator,
      tenantId,
    });
    // eslint-disable-next-line no-console
    console.log(
      `[close-legacy-applications] ${dryRun ? 'DRY RUN — nothing changed. ' : ''}run ${r.runId}: ` +
        `${r.totalFound} open legacy application(s) found, ${r.totalClosed} closed.`,
    );
    for (const t of r.tenants)
      // eslint-disable-next-line no-console
      console.log(
        `  tenant ${t.tenantId}: ${t.found} found (${Object.entries(t.byStatus)
          .map(([s, n]) => `${s} ${n}`)
          .join(', ')}), ${t.closed} closed`,
      );
  } finally {
    await prisma.$disconnect();
  }
}

runAsSystem('close legacy applications (operator script)', main).catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
