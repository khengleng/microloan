#!/usr/bin/env node
/**
 * Prepare a throwaway database for the lending integration tests (CI and local).
 *
 *   LENDING_TEST_DATABASE_URL=<connection string> node scripts/lending-test-db.mjs
 *
 * It builds the database the way production is built, in production's order:
 *
 *   1. empty schema "public";
 *   2. the runtime role and its default privileges — ops/db/app-role.sql, the
 *      same runbook production uses, with the connecting user as the owner;
 *   3. `prisma migrate deploy` from empty (the baseline plus every migration,
 *      with their triggers, CHECK constraints and row-level security).
 *
 * Nothing is granted after the schema exists: the tests connect as the
 * NOSUPERUSER NOBYPASSRLS role `lending_app_test` and only see the tables the
 * default privileges gave it, so a migration whose tables the runtime role
 * cannot reach fails here rather than in production.
 *
 * Destructive: it drops and recreates schema "public" of the target database.
 * It refuses to run unless the database name contains "test" or "ci".
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
const execute = (label, sql) => {
  const file = path.join(os.tmpdir(), `lending-test-db-${process.pid}-${label}.sql`);
  fs.writeFileSync(file, sql);
  try {
    run(`pnpm --filter @microloan/db exec prisma db execute --file ${file}`);
  } finally {
    fs.unlinkSync(file);
  }
};

/** The suites connect as this role (apps/api/test/lending/harness.ts). */
const appRole = 'lending_app_test';

// 1. Empty schema. Default privileges are recorded per schema, so they are
//    set after this, never before.
execute('reset', 'DROP SCHEMA IF EXISTS public CASCADE;\nCREATE SCHEMA public;\n');

// The role that runs the migrations owns the tables; the runtime role's
// default privileges are granted on its behalf.
const owner = decodeURIComponent(new URL(url).username);
if (!owner) throw new Error('LENDING_TEST_DATABASE_URL must name its user (the migration owner).');

// 2. The production runbook, with its psql variables filled in. psql
//    meta-commands (`\set`) are dropped: `prisma db execute` is not psql.
const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;
const runbook = fs
  .readFileSync('ops/db/app-role.sql', 'utf8')
  .split('\n')
  .filter((line) => !line.startsWith('\\'))
  .join('\n')
  .replaceAll(":'app_role'", quote(appRole))
  .replaceAll(":'app_password'", quote(appRole))
  .replaceAll(":'owner_role'", quote(owner));
if (/:'[a-z_]+'/.test(runbook)) throw new Error('ops/db/app-role.sql uses a psql variable this script does not fill in.');
execute('app-role', runbook);

// 3. The real migration chain, from empty, as the owner.
run('pnpm --filter @microloan/db exec prisma migrate deploy');

console.log(`Lending test database "${dbName}" is ready (app role: ${appRole}).`);
