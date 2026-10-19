/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-call -- the app is required after the environment is configured, and its services are untyped here. */
/**
 * Run end of day over the seeded book and measure it.
 *
 *   pnpm load:lending:run -- --days 4 --label after --concurrency 8
 *
 * Works on a fresh copy of the seeded database (<db>_run), so every run
 * starts from the same book. Runs the real scheduler (EodSchedulerService.
 * runTenant: advance the business date, auto-debit, the per-loan batch and
 * its hooks, month-end preparation) one day at a time and reports:
 * throughput, per-loan p50/p95/max, total and per-day time, database
 * connections in use, Prisma operations per loan, failures, and the
 * reconciliation breaks afterwards. With --compare <file>, the outcome is
 * checked against an earlier run's fingerprint (balances, events, journal).
 */
import { PrismaClient } from '@microloan/db';
import { lending } from '@microloan/shared';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  REPO_ROOT,
  arg,
  configureLoadEnv,
  databaseName,
  loadDatabaseUrl,
  percentile,
  psql,
  withDatabase,
} from './common';
import { compare, fingerprint, Fingerprint } from './fingerprint';

const log = (m: string) =>
  console.log(`[run ${new Date().toISOString().slice(11, 19)}] ${m}`);

async function main() {
  const days = Number(arg('days', '3'));
  const pool = Number(arg('pool', '10'));
  const label = arg('label', 'run')!;
  const concurrency = arg('concurrency');
  if (concurrency) process.env.LENDING_EOD_CONCURRENCY = concurrency;
  const seeded = loadDatabaseUrl();
  const runName = `${databaseName(seeded)}_run`;
  const admin = withDatabase(seeded, 'postgres');
  const runUrl = withDatabase(seeded, runName);
  const outDir = path.join(REPO_ROOT, '.lending-load');
  fs.mkdirSync(outDir, { recursive: true });

  if (!process.argv.includes('--no-fresh')) {
    log(`copying ${databaseName(seeded)} to ${runName}`);
    psql(admin, `DROP DATABASE IF EXISTS "${runName}" WITH (FORCE)`);
    psql(
      admin,
      `CREATE DATABASE "${runName}" TEMPLATE "${databaseName(seeded)}"`,
    );
  }
  process.env.LENDING_LOAD_DATABASE_URL = runUrl;
  configureLoadEnv(pool);
  const { configureEnv } = require('../lending/harness');
  configureEnv();
  process.env.LENDING_EOD_DISABLED = 'true';

  const owner = new PrismaClient({ datasources: { db: { url: runUrl } } });
  const [{ tenantId }] = await owner.$queryRawUnsafe<{ tenantId: string }[]>(
    `SELECT "tenantId" FROM "LoanAccount" WHERE status = 'ACTIVE'
     GROUP BY "tenantId" ORDER BY count(*) DESC LIMIT 1`,
  );
  const [bd] = await owner.$queryRawUnsafe<{ d: string }[]>(
    `SELECT "businessDate"::text AS d FROM "TenantBusinessDate" WHERE "tenantId" = $1`,
    tenantId,
  );
  const startDate = bd.d;

  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../../src/app.module');
  const {
    EodSchedulerService,
  } = require('../../src/lending/servicing/eod-scheduler.service');
  const {
    ServicingService,
  } = require('../../src/lending/servicing/servicing.service');
  const {
    LendingOperationsService,
  } = require('../../src/lending/accounting/operations.service');
  const {
    periodCloseActor,
  } = require('../../src/lending/accounting/period-close.service');
  const { runAsTenant } = require('../../src/prisma/tenant-context');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  // The client the lending services run their transactions on.
  const { LendingPrisma } = require('../../src/lending/common/lending-prisma');
  const prisma = app.get(LendingPrisma).prisma;
  const scheduler = app.get(EodSchedulerService);
  const servicing = app.get(ServicingService);
  const ops = app.get(LendingOperationsService);

  // ── Instruments ───────────────────────────────────────────────────────────
  const loanMs: number[] = [];
  let failedLoans = 0;
  const batchMs: number[] = [];
  servicing.registerBatchObserver({
    loanProcessed: (_t: string, ms: number, ok: boolean) => {
      loanMs.push(ms);
      if (!ok) failedLoans++;
    },
    batchFinished: (_t: string, _d: string, r: { ms: number }) =>
      batchMs.push(r.ms),
  });
  let operations = 0;
  prisma.$use(async (params: unknown, next: (p: unknown) => unknown) => {
    operations++;
    return next(params);
  });
  const connections: number[] = [];
  const inUse: number[] = [];
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const [c] = await owner.$queryRawUnsafe<{ open: bigint; busy: bigint }[]>(
        `SELECT count(*) AS open, count(*) FILTER (WHERE state <> 'idle') AS busy
         FROM pg_stat_activity
         WHERE datname = current_database() AND usename = 'lending_app_test'`,
      );
      connections.push(Number(c.open));
      inUse.push(Number(c.busy));
      await new Promise((r) => setTimeout(r, 250));
    }
  })();

  const [{ active }] = await owner.$queryRawUnsafe<{ active: bigint }[]>(
    `SELECT count(*) AS active FROM "LoanAccount" WHERE "tenantId" = $1 AND status = 'ACTIVE'`,
    tenantId,
  );
  log(
    `${active} active loans; end of day for ${days} day(s) from ${startDate}; concurrency ${process.env.LENDING_EOD_CONCURRENCY ?? 'default'}; pool ${pool}`,
  );

  // ── End of day, one day at a time ─────────────────────────────────────────
  const perDay: {
    businessDate: string;
    processed: number;
    failed: number;
    seconds: number;
    batchSeconds: number;
  }[] = [];
  const t0 = performance.now();
  let day = startDate;
  for (let i = 0; i < days; i++) {
    day = lending.addDays(day, 1);
    const d0 = performance.now();
    const before = batchMs.length;
    const r = await scheduler.runTenant(tenantId, day, 1);
    const run = r.runs[0];
    perDay.push({
      businessDate: day,
      processed: run?.processed ?? 0,
      failed: run?.failed ?? 0,
      seconds: (performance.now() - d0) / 1000,
      batchSeconds: (batchMs[before] ?? 0) / 1000,
    });
    log(
      `  ${day}: ${run?.processed} processed, ${run?.failed} failed, ${perDay[i].seconds.toFixed(1)}s (batch ${perDay[i].batchSeconds.toFixed(1)}s)`,
    );
  }
  const totalSeconds = (performance.now() - t0) / 1000;
  sampling = false;
  await sampler;

  // ── Afterwards: reconciliation and the outcome fingerprint ───────────────
  const r0 = performance.now();
  let rec: {
    accountsChecked: number;
    breaks: unknown[];
    trialBalanceBalanced: boolean;
  } | null = null;
  let reconciliationError: string | null = null;
  try {
    rec = await runAsTenant(tenantId, () =>
      ops.reconciliation(periodCloseActor(tenantId)),
    );
  } catch (e) {
    reconciliationError = (e as Error).message.split('\n').slice(-1)[0];
  }
  const reconciliationSeconds = (performance.now() - r0) / 1000;
  const [closes] = await owner.$queryRawUnsafe<{ s: string }[]>(
    `SELECT coalesce(string_agg(concat(year, '-', month, ' ', status), ', '), 'none') AS s
     FROM "AccountingPeriod" WHERE "tenantId" = $1`,
    tenantId,
  );
  const fp = await fingerprint(owner, tenantId, startDate);
  await app.close();
  await owner.$disconnect();

  const sorted = [...loanMs].sort((a, b) => a - b);
  const loanDays = perDay.reduce((s, d) => s + d.processed + d.failed, 0);
  const batchSeconds = perDay.reduce((s, d) => s + d.batchSeconds, 0);
  const result = {
    label,
    at: new Date().toISOString(),
    machine: `${os.cpus()[0]?.model} x${os.cpus().length}, ${Math.round(os.totalmem() / 2 ** 30)} GB`,
    activeLoans: Number(active),
    days,
    concurrency: process.env.LENDING_EOD_CONCURRENCY ?? 'default',
    pool,
    totalSeconds: round(totalSeconds),
    batchSeconds: round(batchSeconds),
    loansPerSecond: round(loanDays / batchSeconds),
    perLoanMs: {
      p50: round(percentile(sorted, 50)),
      p95: round(percentile(sorted, 95)),
      p99: round(percentile(sorted, 99)),
      max: round(sorted[sorted.length - 1] ?? 0),
    },
    prismaOperations: operations,
    prismaOperationsPerLoan: round(operations / Math.max(1, loanDays)),
    dbConnections: {
      openMax: Math.max(0, ...connections),
      busyMax: Math.max(0, ...inUse),
      busyAvg: round(
        inUse.reduce((s, c) => s + c, 0) / Math.max(1, inUse.length),
      ),
    },
    failedLoans,
    perDay: perDay.map((d) => ({
      ...d,
      seconds: round(d.seconds),
      batchSeconds: round(d.batchSeconds),
    })),
    reconciliation: rec
      ? {
          accountsChecked: rec.accountsChecked,
          breaks: rec.breaks.length,
          trialBalanceBalanced: rec.trialBalanceBalanced,
          seconds: round(reconciliationSeconds),
        }
      : { error: reconciliationError, seconds: round(reconciliationSeconds) },
    periods: closes.s,
    fingerprint: {
      digest: fp.digest,
      loans: fp.loans,
      events: fp.events,
    },
  };
  const base = path.join(outDir, `${label}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(result, null, 2));
  fs.writeFileSync(`${base}.fingerprint.json`, JSON.stringify(fp));
  console.log(JSON.stringify(result, null, 2));
  const against = arg('compare');
  if (against) {
    const other = JSON.parse(
      fs.readFileSync(
        against.endsWith('.json')
          ? against
          : path.join(outDir, `${against}.fingerprint.json`),
        'utf8',
      ),
    ) as Fingerprint;
    const c = compare(other, fp);
    console.log(`comparison with ${against}: ${JSON.stringify(c)}`);
    if (!c.identical) process.exitCode = 2;
  }
  if (!process.argv.includes('--keep'))
    psql(admin, `DROP DATABASE IF EXISTS "${runName}" WITH (FORCE)`);
}

const round = (n: number) => Math.round(n * 100) / 100;

main().then(
  () => process.exit(process.exitCode ?? 0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
