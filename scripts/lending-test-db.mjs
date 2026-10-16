#!/usr/bin/env node
/**
 * Prepare a throwaway database for the lending integration tests (CI and local).
 *
 *   LENDING_TEST_DATABASE_URL=<connection string> node scripts/lending-test-db.mjs
 *
 * The migration history cannot build a database from scratch (see
 * DEPLOYMENT.md), so this pushes the current Prisma schema and then applies
 * the database-level invariants — immutability triggers, the balanced-journal
 * constraint trigger, CHECK constraints and row-level security — taken
 * verbatim from the lending migration, so tests run against the same rules
 * production enforces.
 *
 * Destructive: it resets the target database. It refuses to run unless the
 * database name contains "test" or "ci".
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const url = process.env.LENDING_TEST_DATABASE_URL;
if (!url) {
  console.error('Set LENDING_TEST_DATABASE_URL to a throwaway PostgreSQL database.');
  process.exit(1);
}
const dbName = new URL(url).pathname.replace(/^\//, '');
if (!/(test|ci)/i.test(dbName)) {
  console.error(`Refusing to reset database "${dbName}": its name must contain "test" or "ci".`);
  process.exit(1);
}

const env = { ...process.env, DATABASE_URL: url };
const run = (cmd) => execSync(cmd, { env, stdio: 'inherit' });

run('pnpm --filter @microloan/db exec prisma db push --skip-generate --force-reset --accept-data-loss');

/**
 * Each lending migration ends with an invariant section introduced by a
 * banner. `db push` builds the tables but applies none of it, so the sections
 * are re-applied here in migration order.
 */
const INVARIANT_SECTIONS = [
  ['20261016_lending_platform_phase1', '-- Database-level invariants for the lending platform.'],
  ['20261017_lending_facilities_phase2', '-- Database-level invariants for lending facilities.'],
  ['20261017_lending_rate_resets', '-- Database-level invariants for rate resets.'],
  ['20261017_lending_group_liability', '-- Database-level invariants for group lending.'],
];

for (const [dir, marker] of INVARIANT_SECTIONS) {
  const migration = fs.readFileSync(`packages/db/prisma/migrations/${dir}/migration.sql`, 'utf8');
  const at = migration.indexOf(marker);
  if (at < 0) throw new Error(`Invariant section not found in ${dir}.`);
  const start = migration.lastIndexOf('-- ═', at);
  const file = path.join(os.tmpdir(), `lending-invariants-${process.pid}-${dir}.sql`);
  fs.writeFileSync(file, migration.slice(start));
  run(`pnpm --filter @microloan/db exec prisma db execute --file ${file}`);
  fs.unlinkSync(file);
}
console.log(`Lending test database "${dbName}" is ready.`);
