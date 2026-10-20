#!/usr/bin/env node
/**
 * A full local stack for the browser tests (apps/e2e), locally and in CI.
 *
 *   node scripts/e2e-stack.mjs up      build and start everything (default)
 *   node scripts/e2e-stack.mjs down    stop what `up` started
 *   node scripts/e2e-stack.mjs restart api|web|all
 *                                      rebuild and restart a service on the
 *                                      same database (after fixing a bug)
 *   node scripts/e2e-stack.mjs reset-qa-mfa
 *                                      turn the qa.* authenticators off again
 *                                      and clear their learning progress
 *   node scripts/e2e-stack.mjs status  print the stack's URLs and process ids
 *
 * `up`, in order:
 *   1. rebuilds the database from empty, the way production is built: schema
 *      "public" dropped, the runtime role and its default privileges
 *      (ops/db/app-role.sql, role lending_app_e2e), then `prisma migrate
 *      deploy`. The API connects as that NOSUPERUSER NOBYPASSRLS role, so the
 *      tests run behind the tenant wall exactly as production does;
 *   2. builds the shared packages and the API (`nest build`) and starts
 *      `node dist/main.js` on E2E_API_PORT (3031) with test settings
 *      (NODE_ENV=test: no schedulers; throwaway JWT secrets and encryption
 *      keys; documents in a temporary directory; no Redis);
 *   3. waits for the lending catalogue sync, then runs the demo seed
 *      (`pnpm --filter @microloan/db demo:lending`) with DEMO_PASSWORD;
 *   4. turns the four qa.* accounts' authenticator off, as the hosted demo
 *      does — the browser tests enrol it again through the UI (apps/e2e);
 *   5. builds the web app and starts `next start` on E2E_WEB_PORT (3030).
 *
 * Environment (all optional):
 *   E2E_DATABASE_URL   owner connection, default
 *                      postgresql://postgres@localhost:5432/microloan_e2e_browser?schema=public
 *                      The database name must contain "e2e", "test" or "ci"
 *                      (it is wiped), and is never the app database "microloan".
 *   E2E_API_PORT       default 3031     E2E_WEB_PORT   default 3030
 *   DEMO_PASSWORD      the demo users' password (default: generated once per
 *                      stack directory; the tests read it from state.json)
 *   E2E_SKIP_BUILD=1   reuse the existing builds (API dist, web .next)
 *   E2E_STACK_DIR      logs and process ids, default apps/e2e/.stack
 *
 * The secrets below are test-only throwaway values for a local database; they
 * never reach a deployed environment.
 */
import { execSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stackDir = path.resolve(root, process.env.E2E_STACK_DIR || 'apps/e2e/.stack');
const stateFile = path.join(stackDir, 'state.json');

const ownerUrl =
  process.env.E2E_DATABASE_URL ||
  ['postgresql:', '', 'postgres@localhost:5432', 'microloan_e2e_browser?schema=public'].join('/');
const apiPort = Number(process.env.E2E_API_PORT || 3031);
const webPort = Number(process.env.E2E_WEB_PORT || 3030);
const appRole = 'lending_app_e2e';

function fail(message) {
  console.error(`e2e-stack: ${message}`);
  process.exit(1);
}

for (const port of [apiPort, webPort])
  if (port === 3000 || port === 3001) fail(`port ${port} belongs to the local app; choose another.`);
const dbName = new URL(ownerUrl).pathname.replace(/^\//, '');
if (dbName === 'microloan' || !/(e2e|test|ci)/i.test(dbName))
  fail(`refusing to wipe database "${dbName}": its name must contain "e2e", "test" or "ci".`);

/** The runtime role's connection: the owner URL with the app role's credentials. */
function appUrl() {
  const u = new URL(ownerUrl);
  u.username = appRole;
  u.password = appRole;
  const params = u.searchParams;
  if (!params.has('connection_limit')) params.set('connection_limit', '10');
  return u.toString();
}

/** Test-only secrets: generated once per stack directory, so a restart keeps sessions valid. */
function testSecrets() {
  const file = path.join(stackDir, 'secrets.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const hex = (n) => randomBytes(n).toString('hex');
  const secrets = {
    JWT_ACCESS_SECRET: hex(32),
    JWT_REFRESH_SECRET: hex(32),
    JWT_REFRESH_TOKEN_PEPPER: hex(16),
    FIELD_ENCRYPTION_KEY: hex(32),
    DOCUMENT_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    DOCUMENT_LINK_SECRET: hex(24),
    SERVICE_KEY_PEPPER: hex(24),
    WEB_PROXY_SECRET: hex(24),
    // Letters, digits and symbols, so it passes the password policy.
    DEMO_PASSWORD: `E2e#${randomBytes(12).toString('base64url')}9a`,
  };
  fs.writeFileSync(file, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  return secrets;
}

function sh(cmd, env = {}, opts = {}) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env }, ...opts });
}

function sql(label, text, url = ownerUrl) {
  const file = path.join(stackDir, `${label}.sql`);
  fs.writeFileSync(file, text);
  try {
    execSync(`pnpm --filter @microloan/db exec prisma db execute --file ${JSON.stringify(file)}`, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: url },
    });
  } finally {
    fs.unlinkSync(file);
  }
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return { pids: {} };
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function down() {
  const state = readState();
  for (const [name, pid] of Object.entries(state.pids || {})) {
    if (!pid || !alive(pid)) continue;
    try {
      // Detached children lead their own process group: stop the whole group.
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
    console.log(`stopped ${name} (pid ${pid})`);
  }
  if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
}

async function portFree(port) {
  try {
    await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1000) });
    return false;
  } catch {
    return true;
  }
}

function start(name, cmd, args, cwd, env) {
  const log = fs.openSync(path.join(stackDir, `${name}.log`), 'w');
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', log, log],
    detached: true,
  });
  child.unref();
  return child.pid;
}

async function waitFor(what, check, timeoutMs, logName) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (logName) {
    const log = path.join(stackDir, `${logName}.log`);
    if (fs.existsSync(log)) console.error(fs.readFileSync(log, 'utf8').split('\n').slice(-60).join('\n'));
  }
  fail(`timed out waiting for ${what}.`);
}


function writeState(patch) {
  const state = readState();
  fs.writeFileSync(stateFile, JSON.stringify({ ...state, ...patch, pids: { ...state.pids, ...(patch.pids || {}) } }, null, 2));
}

function stopOne(name) {
  const pid = readState().pids?.[name];
  if (!pid || !alive(pid)) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    process.kill(pid, 'SIGTERM');
  }
}

async function waitPortFree(port) {
  await waitFor(`port ${port} to be released`, () => portFree(port), 20_000);
}

async function startApi(secrets, build) {
  if (build) {
    sh('pnpm --filter @microloan/shared build && pnpm --filter @microloan/db build');
    sh('pnpm --filter api build');
  }
  stopOne('api');
  await waitPortFree(apiPort);
  const docsDir = path.join(stackDir, 'documents');
  fs.mkdirSync(docsDir, { recursive: true });
  const apiEnv = {
    ...secrets,
    NODE_ENV: 'test',
    PORT: String(apiPort),
    DATABASE_URL: appUrl(),
    MIGRATION_DATABASE_URL: ownerUrl,
    DB_ROLE_MUST_RESPECT_RLS: 'true',
    CORS_ORIGINS: `http://localhost:${webPort}`,
    DOCUMENT_STORAGE_DIR: docsDir,
    // A browser run takes longer than the default 15-minute access token and
    // MFA freshness window; refreshing one stored session from several
    // parallel tests would trip refresh-token reuse detection.
    JWT_ACCESS_TTL: '4h',
    AUTH_MFA_STEP_UP_MINUTES: '240',
    REDIS_URL: '',
    SENTRY_DSN: '',
    RESEND_API_KEY: '',
    GOOGLE_CLIENT_ID: '',
  };
  const apiPid = start('api', 'node', ['dist/main.js'], path.join(root, 'apps/api'), apiEnv);
  writeState({ pids: { api: apiPid }, apiUrl: `http://localhost:${apiPort}/v1` });
  const apiLog = path.join(stackDir, 'api.log');
  await waitFor(
    'the API and the lending catalogue sync',
    async () => {
      if (!alive(apiPid)) fail(`the API exited:\n${fs.readFileSync(apiLog, 'utf8').split('\n').slice(-60).join('\n')}`);
      const res = await fetch(`http://localhost:${apiPort}/v1/health/ready`);
      return res.ok && fs.readFileSync(apiLog, 'utf8').includes('Lending catalogue synchronised');
    },
    120_000,
    'api',
  );
}

async function startWeb(secrets, build) {
  const webEnv = {
    API_URL: `http://localhost:${apiPort}/v1`,
    NEXT_PUBLIC_API_URL: `http://localhost:${apiPort}/v1`,
    WEB_PROXY_SECRET: secrets.WEB_PROXY_SECRET,
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_CLARITY_PROJECT_ID: '',
  };
  if (build) sh('pnpm --filter web build', webEnv);
  stopOne('web');
  await waitPortFree(webPort);
  const webOrigin = `http://localhost:${webPort}`;
  const webPid = start(
    'web',
    path.join(root, 'apps/web/node_modules/.bin/next'),
    ['start', '-p', String(webPort)],
    path.join(root, 'apps/web'),
    { ...webEnv, NODE_ENV: 'production' },
  );
  writeState({ pids: { web: webPid }, webUrl: webOrigin });
  await waitFor(
    'the web app',
    async () => {
      if (!alive(webPid)) fail('the web app exited (see apps/e2e/.stack/web.log).');
      return (await fetch(`${webOrigin}/en/login`)).ok;
    },
    90_000,
    'web',
  );
}

async function up() {
  fs.mkdirSync(stackDir, { recursive: true });
  down();
  for (const port of [apiPort, webPort]) if (!(await portFree(port))) fail(`port ${port} is in use.`);
  const { DEMO_PASSWORD: generatedPassword, ...secrets } = testSecrets();
  const demoPassword = process.env.DEMO_PASSWORD?.trim() || generatedPassword;
  const build = process.env.E2E_SKIP_BUILD !== '1';
  const started = Date.now();
  const stamp = (label) => console.log(`\n== ${label} (${Math.round((Date.now() - started) / 1000)}s)`);

  // 1. Database from empty, production order.
  stamp('database');
  sql('reset', 'DROP SCHEMA IF EXISTS public CASCADE;\nCREATE SCHEMA public;\n');
  const owner = decodeURIComponent(new URL(ownerUrl).username);
  const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const runbook = fs
    .readFileSync(path.join(root, 'ops/db/app-role.sql'), 'utf8')
    .split('\n')
    .filter((line) => !line.startsWith('\\'))
    .join('\n')
    .replaceAll(":'app_role'", quote(appRole))
    .replaceAll(":'app_password'", quote(appRole))
    .replaceAll(":'owner_role'", quote(owner));
  if (/:'[a-z_]+'/.test(runbook)) fail('ops/db/app-role.sql uses a psql variable this script does not fill in.');
  sql('app-role', runbook);
  sh('pnpm --filter @microloan/db exec prisma migrate deploy', { DATABASE_URL: ownerUrl });
  fs.rmSync(path.join(stackDir, 'documents'), { recursive: true, force: true });
  writeState({ databaseUrl: ownerUrl, demoPassword });

  // 2. API (its boot synchronises the lending catalogue the seed needs).
  stamp('API');
  await startApi(secrets, build);

  // 3. Demo data (as the owner, like the hosted demo), with the API's field key.
  stamp('demo seed');
  sh('pnpm --filter @microloan/db demo:lending', {
    DATABASE_URL: ownerUrl,
    DEMO_SEED_ALLOW: 'true',
    DEMO_PASSWORD: demoPassword,
    FIELD_ENCRYPTION_KEY: secrets.FIELD_ENCRYPTION_KEY,
    JWT_ACCESS_SECRET: secrets.JWT_ACCESS_SECRET,
    NODE_ENV: 'test',
  });

  // 4. The hosted demo's QA accounts have no authenticator; the tests enrol one.
  resetQaMfa();

  // 5. Web.
  stamp('web');
  await startWeb(secrets, build);
  stamp(`stack ready: web http://localhost:${webPort}, API http://localhost:${apiPort}/v1, database ${dbName}`);
}

/**
 * The four qa.* accounts back to "no authenticator", as on the hosted demo,
 * and to a first sign-in (no Learning centre progress); every demo account
 * unlocked; and the demo organisation back to requiring an authenticator for
 * its admins, as real organisations do (the demo seed turns that off).
 * The browser tests' global setup calls it, so every run enrols them afresh.
 */
function resetQaMfa() {
  sql(
    'qa-mfa-off',
    `UPDATE "User" SET "twoFactorEnabled" = false, "twoFactorSecret" = NULL, "totpLastStep" = NULL WHERE email LIKE 'qa.%@demo-lending.test';\n` +
      // The wrong-password test counts towards the lockout; start every run unlocked.
      `UPDATE "User" SET "loginAttempts" = 0, "lockedUntil" = NULL WHERE email LIKE '%@demo-lending.test';\n` +
      `DELETE FROM "LearningProgress" WHERE "userId" IN (SELECT id FROM "User" WHERE email LIKE 'qa.%@demo-lending.test');\n` +
      // The hosted demo lets its admins sign in with a password only; the
      // browser tests exercise what every real organisation gets: tenant
      // admins must enrol an authenticator (D-128) and step up for approvals.
      `UPDATE "TenantLendingSettings" SET settings = jsonb_set(settings::jsonb, '{security,requireMfaForAdmins}', 'true'::jsonb, true) ` +
      `WHERE status = 'ACTIVE' AND "tenantId" IN (SELECT "tenantId" FROM "User" WHERE email = 'qa.maker@demo-lending.test');\n`,
  );
}

/** Rebuild and restart one service against the existing database (after a fix). */
async function restart(which) {
  if (!fs.existsSync(stateFile)) fail('no stack is running; use `up` first.');
  const { DEMO_PASSWORD: _unused, ...secrets } = testSecrets();
  const build = process.env.E2E_SKIP_BUILD !== '1';
  if (which === 'api' || which === 'all') await startApi(secrets, build);
  if (which === 'web' || which === 'all') await startWeb(secrets, build);
  if (!['api', 'web', 'all'].includes(which)) fail('restart api | web | all');
  console.log(`restarted ${which}`);
}

const command = process.argv[2] || 'up';
if (command === 'down') down();
else if (command === 'status') console.log(JSON.stringify(readState(), null, 2));
else if (command === 'up') await up();
else if (command === 'reset-qa-mfa') resetQaMfa();
else if (command === 'restart') await restart(process.argv[3] || 'all');
else fail(`unknown command "${command}" (up, down, restart, status).`);
