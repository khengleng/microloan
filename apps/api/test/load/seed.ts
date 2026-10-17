/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-call -- the app is required after the environment is configured, and its services are untyped here. */
/**
 * Seed a realistic lending book for load testing.
 *
 *   pnpm load:lending:seed -- --loans 50000
 *
 * 1. Resets LENDING_LOAD_DATABASE_URL (default microloan_loadtest) with the
 *    same schema and database invariants as the integration tests.
 * 2. Builds ~70 template loans through the HTTP API across five families
 *    (instalment, flat, microfinance, group, revolving facility), four
 *    disbursement cohorts and five behaviours (on time, late, partial, never
 *    pays, restructured), running end of day every day from January to the
 *    clone date. Saved as <db>_tpl so later seeds can skip this step
 *    (--reuse-templates).
 * 3. Copies the templates to --loans loans (clone.ts) and checks the books:
 *    every journal entry balances and the ledger totals equal the copies'.
 */
import { PrismaClient } from '@microloan/db';
import {
  REPO_ROOT,
  arg,
  configureLoadEnv,
  databaseName,
  loadDatabaseUrl,
  psql,
  psqlUrl,
  withDatabase,
} from './common';
import { cloneBook } from './clone';
import type { TemplateUnit } from './templates';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const log = (m: string) =>
  console.log(`[seed ${new Date().toISOString().slice(11, 19)}] ${m}`);

async function main() {
  const target = Number(arg('loans', process.env.LOAD_LOANS || '50000'));
  const reuse = process.argv.includes('--reuse-templates');
  const url = loadDatabaseUrl();
  const name = databaseName(url);
  const tplName = `${name}_tpl`;
  const admin = withDatabase(url, 'postgres');
  const unitsFile = path.join(REPO_ROOT, '.lending-load', `${tplName}.json`);
  const started = Date.now();

  const exists = (db: string) =>
    psql(admin, `SELECT 1 FROM pg_database WHERE datname = '${db}'`).trim() ===
    '1';

  let units: TemplateUnit[];
  let tenantId: string;
  if (reuse && exists(tplName) && fs.existsSync(unitsFile)) {
    ({ units, tenantId } = JSON.parse(fs.readFileSync(unitsFile, 'utf8')));
    log(`reusing templates from ${tplName}`);
  } else {
    if (!exists(name)) psql(admin, `CREATE DATABASE "${name}"`);
    log(`preparing ${name}`);
    execFileSync('node', ['scripts/lending-test-db.mjs'], {
      cwd: REPO_ROOT,
      env: { ...process.env, LENDING_TEST_DATABASE_URL: url },
      stdio: 'inherit',
    });
    configureLoadEnv(8);
    const { bootstrap } = require('../lending/harness');
    const { buildTemplates } = require('./templates');
    const f = await bootstrap();
    log('building templates through the API');
    ({ units, tenantId } = await buildTemplates(f, log));
    await f.app.close();
    log(`${units.length} template loans built`);
    psql(admin, `DROP DATABASE IF EXISTS "${tplName}"`);
    psql(admin, `CREATE DATABASE "${tplName}" TEMPLATE "${name}"`);
    fs.mkdirSync(path.dirname(unitsFile), { recursive: true });
    fs.writeFileSync(unitsFile, JSON.stringify({ units, tenantId }, null, 2));
  }

  // Start the clone from the saved templates.
  psql(admin, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  psql(admin, `CREATE DATABASE "${name}" TEMPLATE "${tplName}"`);

  const db = new PrismaClient({ datasources: { db: { url } } });
  log(`cloning to ${target} loans`);
  const cloneStart = Date.now();
  const r = await cloneBook(db, url, tenantId, units, target, log);
  log(
    `${r.rowsWritten} rows written in ${((Date.now() - cloneStart) / 1000).toFixed(0)}s`,
  );
  psql(url, 'VACUUM ANALYZE');

  // ── Checks ────────────────────────────────────────────────────────────────
  const [counts] = await db.$queryRawUnsafe<
    { loans: bigint; active: bigint; events: bigint; lines: bigint }[]
  >(
    `SELECT (SELECT count(*) FROM "LoanAccount" WHERE "tenantId" = $1) AS loans,
            (SELECT count(*) FROM "LoanAccount" WHERE "tenantId" = $1 AND status = 'ACTIVE') AS active,
            (SELECT count(*) FROM "FinancialEvent" WHERE "tenantId" = $1) AS events,
            (SELECT count(*) FROM "LendingJournalLine" WHERE "tenantId" = $1) AS lines`,
    tenantId,
  );
  const [unbalanced] = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM (
       SELECT "entryId" FROM "LendingJournalLine" WHERE "tenantId" = $1
       GROUP BY "entryId" HAVING sum(debit) <> sum(credit)) x`,
    tenantId,
  );
  const [orphans] = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*) AS n FROM "ScheduleInstalment" s
     WHERE NOT EXISTS (SELECT 1 FROM "LoanAccount" a WHERE a.id = s."loanAccountId")`,
  );
  await db.$disconnect();
  if (Number(unbalanced.n) || Number(orphans.n))
    throw new Error(
      `Seed check failed: ${unbalanced.n} unbalanced entries, ${orphans.n} orphan instalments`,
    );
  const size = psql(
    admin,
    `SELECT pg_size_pretty(pg_database_size('${name}'))`,
  ).trim();
  log(
    `done in ${((Date.now() - started) / 1000).toFixed(0)}s: ${counts.loans} loans (${counts.active} active), ${counts.events} events, ${counts.lines} journal lines, ${size}; all entries balance`,
  );
  log(`run: pnpm load:lending:run  (database ${psqlUrl(url)})`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
