/**
 * Shared settings for the lending load-test harness (docs/lending/PERFORMANCE.md).
 *
 * The harness works on its own database, never on a test or production one:
 * LENDING_LOAD_DATABASE_URL must name a database whose name contains both
 * "load" and "test" (the second because the database is prepared with
 * scripts/lending-test-db.mjs, which resets only throwaway databases).
 */
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';

export const REPO_ROOT = path.resolve(__dirname, '../../../..');

export const DEFAULT_LOAD_URL =
  'postgresql://postgres@localhost:5432/microloan_loadtest?schema=public';

/** Owner connection (runs the cloning and the checks, bypassing nothing the app relies on). */
export function loadDatabaseUrl(): string {
  const url = process.env.LENDING_LOAD_DATABASE_URL || DEFAULT_LOAD_URL;
  const name = databaseName(url);
  if (!/load/i.test(name) || !/test/i.test(name)) {
    throw new Error(
      `Refusing to use database "${name}" for load testing: its name must contain "load" and "test".`,
    );
  }
  return url;
}

export function databaseName(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}

/** The same URL pointed at another database on the same server. */
export function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

/** psql does not accept Prisma's query parameters (schema, connection_limit). */
export function psqlUrl(url: string): string {
  const u = new URL(url);
  u.search = '';
  return u.toString();
}

/** Run one SQL statement with psql as the database owner; returns stdout. */
export function psql(url: string, sql: string): string {
  return execFileSync(
    'psql',
    [psqlUrl(url), '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql],
    { encoding: 'utf8', maxBuffer: 1 << 28 },
  );
}

/** A psql process reading COPY data on stdin. */
export function copyIn(url: string, table: string, columns: string[]) {
  const cols = columns.map((c) => `"${c}"`).join(', ');
  const child = spawn(
    'psql',
    [
      psqlUrl(url),
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
      // Rows are copies of rows that already passed every trigger and foreign
      // key; replica mode skips re-running them per row (seconds instead of
      // hours). The seed verifies the books afterwards.
      '-c',
      'SET session_replication_role = replica',
      '-c',
      `\\copy "${table}" (${cols}) FROM STDIN`,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`COPY into ${table} failed (psql exit ${code})`)),
    );
  });
  return {
    async write(chunk: string) {
      if (!child.stdin.write(chunk))
        await new Promise<void>((r) => child.stdin.once('drain', () => r()));
    },
    async end() {
      child.stdin.end();
      await done;
    },
  };
}

/** Configure the API's environment for the load database (before requiring the app). */
export function configureLoadEnv(connectionLimit: number) {
  const owner = new URL(loadDatabaseUrl());
  owner.searchParams.set('connection_limit', String(connectionLimit));
  process.env.LENDING_TEST_DATABASE_URL = owner.toString();
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[i];
}

export function arg(name: string, fallback?: string): string | undefined {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  return fallback;
}
