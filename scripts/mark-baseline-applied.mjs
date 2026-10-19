#!/usr/bin/env node
/**
 * Mark the fresh-build migrations as applied on a database that already has
 * its schema (local dev, Railway production, a restore of either).
 *
 *   DATABASE_URL=<owner connection string> node scripts/mark-baseline-applied.mjs [--dry-run]
 *
 * Why: until 2026-10 the migration history could not build a database from
 * empty. 00000000000000_baseline (the schema that predates the first
 * migration) and the three 20260702_*_fresh_build_currency_* migrations fix
 * that. Databases built before them already contain everything those files
 * create, so they are recorded as applied (`prisma migrate resolve
 * --applied`) instead of being run. Each of them is also written to be a
 * no-op on such a database, so forgetting this step is not dangerous — but
 * recording them keeps `prisma migrate status` honest.
 *
 * Guards (it refuses rather than guess):
 *   - the database must already have the "User" table and a
 *     `_prisma_migrations` table that records 20260302_add_penalty_last_applied_at;
 *     an empty database must run `prisma migrate deploy` instead;
 *   - the currency migrations are only marked when
 *     20260702_multicurrency_gl_provisioning_cbc is recorded as applied;
 *   - migrations already recorded are left alone, so it is safe to re-run.
 *
 * Needs the generated Prisma client (`pnpm --filter @microloan/db build`).
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPackage = path.join(root, 'packages/db');
const dryRun = process.argv.includes('--dry-run');

const BASELINE = '00000000000000_baseline';
const CURRENCY_COMPAT = [
  '20260702_a_fresh_build_currency_type',
  '20260702_m_fresh_build_currency_detach',
  '20260702_n_fresh_build_currency_reattach',
];
const FIRST_HISTORICAL = '20260302_add_penalty_last_applied_at';
const MULTICURRENCY = '20260702_multicurrency_gl_provisioning_cbc';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL to the database to mark (the migration owner, e.g. MIGRATION_DATABASE_URL).');
  process.exit(1);
}

const require = createRequire(path.join(dbPackage, 'package.json'));
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url } } });

const fail = async (message) => {
  console.error(message);
  await prisma.$disconnect();
  process.exit(1);
};

try {
  const [{ user, history }] = await prisma.$queryRawUnsafe(
    `SELECT to_regclass('public."User"')::text AS "user", to_regclass('public."_prisma_migrations"')::text AS history`,
  );
  if (!user) {
    await fail('No "User" table: this database has no schema yet. Run `prisma migrate deploy` instead; it builds everything from the baseline.');
  }
  if (!history) {
    await fail('No _prisma_migrations table: this database was not built from migrations. Resolve it by hand (see DEPLOYMENT.md).');
  }
  const rows = await prisma.$queryRawUnsafe(
    `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
  );
  const applied = new Set(rows.map((r) => r.migration_name));
  if (!applied.has(FIRST_HISTORICAL)) {
    await fail(`${FIRST_HISTORICAL} is not recorded as applied; this does not look like a database built from the existing history. Refusing.`);
  }

  const toMark = [];
  if (!applied.has(BASELINE)) toMark.push(BASELINE);
  if (applied.has(MULTICURRENCY)) {
    for (const name of CURRENCY_COMPAT) if (!applied.has(name)) toMark.push(name);
  } else {
    console.log(`${MULTICURRENCY} is not applied yet: leaving the currency compatibility migrations to run with it.`);
  }
  await prisma.$disconnect();

  if (!toMark.length) {
    console.log('Nothing to mark: the baseline migrations are already recorded.');
    process.exit(0);
  }
  for (const name of toMark) {
    if (dryRun) {
      console.log(`[dry run] would mark ${name} as applied`);
      continue;
    }
    console.log(`Marking ${name} as applied`);
    execFileSync('npx', ['prisma', 'migrate', 'resolve', '--applied', name], {
      cwd: dbPackage,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'inherit',
    });
  }
  console.log(dryRun ? 'Dry run: nothing changed.' : 'Done. `prisma migrate status` should now report the database up to date.');
} catch (error) {
  await fail(`mark-baseline-applied failed: ${error?.message ?? error}`);
}
