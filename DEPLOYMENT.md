# Deployment & Operations Runbook

Current as of 2026-10-19. No secrets in this file: values live in Railway's
variables and in the key escrow described below.

## Where it runs

Railway project **`microloan`**, one environment (`production`), four services:

| Service | What | Public URL |
|---|---|---|
| **api** | NestJS API (`apps/api`) | https://api-production-52b47.up.railway.app/v1 |
| **web** | Next.js app (`apps/web`) | https://dbank.cambobia.com (custom domain) and https://web-production-41b26.up.railway.app |
| **Postgres** | PostgreSQL, the system of record | private network only |
| **Redis** | shared rate limits | private network only |

The api has a volume mounted at **`/data`**; `DOCUMENT_STORAGE_DIR=/data/documents`
keeps customer documents there (one api instance; with several, move documents
to S3 — every instance must see the same store).

There is no staging environment. See [Bringing staging back](#bringing-staging-back).

## Flow: PR → CI → merge → deploy

```
feat/*  ──PR──▶  main  ──▶  Railway deploys main (api + web)
          CI must pass
```

1. **Branch** off `main`: `git checkout -b feat/xyz`.
2. **Push.** CI (`.github/workflows/security.yml`) runs on every push to every
   branch and on every pull request.
3. **PR into `main`.** Branch protection on `main` requires the PR and the CI
   jobs to pass.
4. **Merge → Railway deploys `main`.** Watch it (below).

> **Deploy branch.** Both app services must deploy from `main`. During the
> 2026-10 rebuild they deployed from `feat/composable-policies`; once that work
> is merged, switch each service (api *and* web) to `main` in Railway →
> service → Settings → Source, and verify:
>
> ```bash
> railway api 'query { project(id: "<projectId>") { services { edges { node {
>   name repoTriggers { edges { node { branch environmentId } } } } } } } }'
> ```

### What CI checks

| Job | Blocking | What |
|---|---|---|
| `security` | yes | hard-code, time-bomb and memory-store scans; config audit; production config check |
| `migrations` | yes | `migrate deploy` on an **empty** PostgreSQL 16 (after `ops/db/app-role.sql`), a second deploy is a no-op, no drift against `schema.prisma` (from the database and from the migration history via a shadow database), the baseline/fresh-build migrations are no-ops on a built database, the runtime role does not bypass RLS and received a late migration's table through default privileges |
| `lint` | lending only | lending files the change adds or modifies must lint clean (`scripts/lint-changed-lending.mjs`); the whole-repo lint (`lint:check`, never `--fix`) runs informationally — about 4,000 legacy prettier errors remain |
| `web-build` | yes | `pnpm --filter web build` |
| `lending-tests` | yes | typecheck, engine and API unit tests, lending integration suite against a database built exactly like production (below) |
| `browser-e2e` | yes | the web portal in Chromium (Playwright, `apps/e2e`) against a full stack built by `scripts/e2e-stack.mjs`: sign-in and authenticator enrolment, step-up, the loan journey from new borrower to repayment, guided tours, Help, AML, scorecards, My account, English and Khmer. About 6–8 minutes; the report, traces and server logs are uploaded when it fails. See [Browser tests](#browser-tests) |

Node 22 everywhere: `.nvmrc`, `engines.node` (`>=22 <23`) and CI read the same
version. Railway's builder also honours them.

### Browser tests

`apps/e2e` drives the real web app in Chromium with Playwright
(`@playwright/test` 1.63.0). It has its own workspace package so the browser
tooling stays out of the web build. To run it locally:

```bash
pnpm install
pnpm --filter e2e exec playwright install chromium   # once
node scripts/e2e-stack.mjs up      # ~1–3 min: DB, API :3031, web :3030, demo data
pnpm --filter e2e test             # the suite (~1 min); report: pnpm --filter e2e report
node scripts/e2e-stack.mjs down    # stop the API and web
```

`scripts/e2e-stack.mjs up` never touches ports 3000/3001 or the `microloan`
database. It **wipes and rebuilds** `E2E_DATABASE_URL` (default
`postgresql://postgres@localhost:5432/microloan_e2e_browser`; the name must
contain `e2e`, `test` or `ci`) the production way — `ops/db/app-role.sql`,
then `prisma migrate deploy` — and runs the API as the RLS-bound role
`lending_app_e2e` with `NODE_ENV=test` (no schedulers, no Redis), throwaway
JWT secrets and encryption keys generated into `apps/e2e/.stack/secrets.json`,
documents in `apps/e2e/.stack/documents`, a 4-hour access token and MFA
window (a run reuses one session per account). It then waits for the
catalogue sync, runs `pnpm demo:lending` with a generated `DEMO_PASSWORD`
(or yours) and switches the four `qa.*` accounts' authenticators off, as on
the hosted demo. Logs: `apps/e2e/.stack/api.log`, `web.log`.

* After fixing the app: `node scripts/e2e-stack.mjs restart api|web|all`
  rebuilds and restarts one service on the same database
  (`E2E_SKIP_BUILD=1` to skip the build).
* Every run first resets the `qa.*` accounts (authenticator off, learning
  progress cleared, demo accounts unlocked); the `setup` project then signs
  each in, enrols an authenticator through **My account** (the code is
  computed from the key shown next to the QR code) and saves the session for
  the other tests.
* The API allows **10 sign-ins per account per 15 minutes**; a full run uses
  two for `qa.checker`. After about five runs in a row, `restart api` resets
  the (in-memory) budget. To re-run one spec without signing in again:
  `E2E_KEEP_SESSIONS=1 pnpm --filter e2e exec playwright test --no-deps tests/help.spec.ts`.
* A test fails on any `console.error`, uncaught page error or React
  hydration error, and on a raw message key (`LendingServicing.x`) or
  `MISSING_MESSAGE` on the page; a test that expects a refused request
  allows that one error explicitly. UI strings are looked up in
  `apps/web/messages/*.json`, so a translation change does not break a test.
* `E2E_BASE_URL` points the suite at another web origin.

## Service configuration

Railway reads `apps/api/railway.json` and `apps/web/railway.json` **only if the
service's config path points at them** (service → Settings → Config-as-code →
`/apps/api/railway.json` or `/apps/web/railway.json`). Without that, the
values in the dashboard apply and these files are documentation — keep the two
in step either way. Values in a config file override the dashboard.

### api

| Setting | Value |
|---|---|
| Build | `pnpm turbo run build --filter=api...` |
| Start | `sh -c 'DATABASE_URL="$MIGRATION_DATABASE_URL" pnpm --filter @microloan/db exec prisma migrate deploy && NODE_ENV=production node apps/api/dist/main.js'` |
| Healthcheck | `/v1/health/ready` (`SELECT 1`; 503 when the database is unreachable), timeout 300 s |
| Volume | `/data` |

### web

| Setting | Value |
|---|---|
| Build | `pnpm turbo run build --filter=web...` |
| Start | `pnpm --filter web exec next start -p $PORT` |
| Healthcheck | `/login` (`/` answers 307; the check needs a page that answers 200) |

After changing service settings, deploy anew (`railway up`, or
`serviceInstanceDeployV2`); redeploying an old deployment reuses that
deployment's old configuration.

## Database roles

Two roles, two URLs on the api service:

| Variable | Role | Used by |
|---|---|---|
| `MIGRATION_DATABASE_URL` | the table owner (`postgres`) | `prisma migrate deploy` in the start command, `scripts/mark-baseline-applied.mjs`, `ops/db/app-role.sql` |
| `DATABASE_URL` | `lending_app` — `NOSUPERUSER NOBYPASSRLS`, owns nothing | the running api |

`DB_ROLE_MUST_RESPECT_RLS=true` makes the api refuse to boot if
`DATABASE_URL`'s role is a superuser or has `BYPASSRLS` (PostgreSQL skips every
row-level-security policy for those; `FORCE` makes them apply to a
non-superuser owner).

**The database wall denies by default** (D-141…D-143,
[docs/security/RLS.md](docs/security/RLS.md)). Every tenant-owned table only
shows rows to a transaction that declared their tenant (`app.tenant_id`) or a
system path (`app.system = on`); the api declares one on every query. A
client that declares nothing — `psql` as `lending_app`, a script with a bare
`PrismaClient` — sees **no** tenant-owned rows and cannot write them. So:

- run seeds and demo data (`pnpm db:seed`, `pnpm demo:lending`,
  `npx tsx seed-admin.ts`) with the owner's URL:
  `DATABASE_URL="$MIGRATION_DATABASE_URL" pnpm db:seed`;
- `pnpm encrypt:backfill` declares system context itself and runs as either
  role;
- to look at data as `lending_app` in psql, open a transaction and declare:
  `BEGIN; SELECT set_config('app.tenant_id', '<tenant id>', true); … COMMIT;`
  (or `set_config('app.system', 'on', true)` for every tenant — prefer the
  owner's URL for support work across tenants);
- a migration that changes rows of a walled table runs as the owner
  (`postgres`, a superuser, so unaffected); with a non-superuser owner it must
  start with `SELECT set_config('app.system', 'on', true);`.

**Grants for new tables come from default privileges.** A migration creates
its tables as the owner; `lending_app` can use them only because of
`ALTER DEFAULT PRIVILEGES FOR ROLE postgres … TO lending_app`. Production
received this by hand on 2026-10-18; the reproducible version is the
idempotent runbook **`ops/db/app-role.sql`**:

```bash
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v app_role=lending_app -v owner_role=postgres \
  -v app_password="$LENDING_APP_PASSWORD" \
  -f ops/db/app-role.sql
# -v app_password=   (empty) keeps the existing password
```

It creates the role if missing, re-asserts `NOSUPERUSER NOBYPASSRLS`, grants on
existing tables, sequences and functions, sets the default privileges and
revokes the role's access to `_prisma_migrations`. Safe to re-run; run it on
every new database (before the first deploy, and once more after it so the
`_prisma_migrations` revoke applies). The integration tests build their
database through this same file, so CI fails if a migration's tables would be
unreachable for the runtime role.

To reach Postgres with psql: `railway connect Postgres` (or create a TCP proxy
on port 5432 with `tcpProxyCreate`, use it, and delete it again).

## Migrations

- `prisma migrate deploy` runs in the api's start command, as the owner, on
  every boot. The healthcheck is the safety net: a failed migration leaves the
  new container unhealthy and the previous deployment keeps serving.
- **Migrations build a database from empty.** `00000000000000_baseline` holds
  the schema that predates the first migration (it was built with `db push`),
  and three `20260702_*_fresh_build_currency_*` migrations fix an ordering
  problem among the 2026-07-02 migrations. On a database that already has
  its schema all four are no-ops by construction, but they should be
  **recorded as applied** instead of run:

  ```bash
  # Once per existing database (production, local dev, a restore of either).
  # Run from a checkout of the release that adds the baseline, with the
  # owner's URL. Dry run first:
  DATABASE_URL="$MIGRATION_DATABASE_URL" node scripts/mark-baseline-applied.mjs --dry-run
  DATABASE_URL="$MIGRATION_DATABASE_URL" node scripts/mark-baseline-applied.mjs
  DATABASE_URL="$MIGRATION_DATABASE_URL" pnpm --filter @microloan/db exec prisma migrate status
  ```

  On Railway: `railway run -s api -- sh -c 'DATABASE_URL="$MIGRATION_DATABASE_URL" node scripts/mark-baseline-applied.mjs'`
  from the repository root (needs the generated Prisma client:
  `pnpm install && pnpm --filter @microloan/db build`). The script refuses an
  empty database or one without migration history, and skips migrations
  already recorded. If the release deploys before anyone runs it, the start
  command applies the four migrations, they change nothing, and the script
  then reports "Nothing to mark".
- **Never edit an applied migration.** Prisma refuses to deploy when an applied
  migration's checksum changes. Fix forward with a new migration.
- A schema change is rehearsed in CI (`migrations` job). For anything risky,
  also rehearse against a copy of production restored from a backup.

## Backups and restore

**Scheduled backups** (Railway volume backups), enabled 2026-10-19: daily,
weekly and monthly, for the **Postgres** volume and the **api `/data`**
volume. Check them in Railway → service → Backups, or:

```bash
railway api 'query { volumeInstanceBackupScheduleList(volumeInstanceId: "<id>") { id kind } }'
railway api 'query { volumeInstanceBackupList(volumeInstanceId: "<id>") { id createdAt } }'
```

Take a manual backup before any risky migration.

### Restore

1. **From a Railway backup (preferred).** Railway → Postgres (or api) → Backups
   → pick the backup → Restore. Railway stages the restore; deploy it. Restore
   the Postgres and `/data` backups from the same point in time — documents
   reference database rows. The restored database keeps its roles, grants,
   default privileges and `_prisma_migrations`, so the next api deploy just
   continues.
2. **From scratch (new environment, or no usable backup).**
   1. Create Postgres; note the owner URL.
   2. `psql "$OWNER_URL" -v ON_ERROR_STOP=1 -v app_role=lending_app -v owner_role=postgres -v app_password=... -f ops/db/app-role.sql`
   3. `DATABASE_URL="$OWNER_URL" pnpm --filter @microloan/db exec prisma migrate deploy`
      (builds everything from the baseline), then re-run step 2 once.
   4. Load data if you have it (a data-only `pg_dump`/`pg_restore` as the
      owner), or start empty and bootstrap the super admin
      (`BOOTSTRAP_SUPERADMIN_*`, see `.env.example`).
   5. Point the api's `MIGRATION_DATABASE_URL` (owner) and `DATABASE_URL`
      (`lending_app`) at it; set the **same** `FIELD_ENCRYPTION_KEY` as the
      data was written with.
   If you load a full schema+data dump of an older database instead of
   building with migrations, run `scripts/mark-baseline-applied.mjs` on it
   before the first deploy.

## Secrets and key escrow

All secrets are Railway variables on the service that reads them; nothing
secret is in the repository. In production the api refuses to boot without
`FIELD_ENCRYPTION_KEY` (32 bytes, base64 or 64 hex characters),
`DOCUMENT_LINK_SECRET` (≥ 32 characters) and `SERVICE_KEY_PEPPER`
(≥ 32 characters), alongside the JWT secrets, `CORS_ORIGINS` and `REDIS_URL`;
none of them is derived from another. `pnpm security:prod-config-check` checks
the same list; run it against the live variables before a release that
changes requirements:

```bash
railway run -s api -- pnpm security:prod-config-check
```

**`FIELD_ENCRYPTION_KEY` must be escrowed outside Railway.** TOTP seeds, KYC
images and bot tokens are encrypted with it; a database backup restored
without the key is unreadable, so a backup and the only copy of the key in the
same Railway project is not a recovery plan.

- Keep the key in the organisation's password manager / secrets vault, in an
  entry readable by at least two named people, labelled with the environment
  and the date it took effect.
- Optionally a second, offline copy (sealed, in a safe) for the loss of the
  vault.
- Never e-mail it, paste it in chat, or commit it. Retrieve it from Railway
  only to put it in escrow: `railway variables -s api --kv | grep FIELD_ENCRYPTION_KEY`.
- **Rotation** is not automatic: changing the key makes existing ciphertext
  unreadable. Rotate only with a re-encryption run
  (`pnpm encrypt:backfill`, see `apps/api/src/scripts/encrypt-at-rest-backfill.ts`)
  and keep the old key in escrow until it is verified.
- Changing `SERVICE_KEY_PEPPER` invalidates every issued service key;
  changing `DOCUMENT_LINK_SECRET` invalidates outstanding download links (they
  expire within minutes anyway).

**`DOCUMENT_ENCRYPTION_KEY` — customer documents on a disk volume.** When S3
is not configured, customer documents are written to `DOCUMENT_STORAGE_DIR`
and the API encrypts each file (AES-256-GCM, a random data key per file,
wrapped under a key derived from this one; DECISIONS D-137). In production the
api refuses to boot without it whenever S3 is not configured, and
`pnpm security:prod-config-check` checks it (32 bytes, base64 or 64 hex
characters). It is a separate key from `FIELD_ENCRYPTION_KEY`; generate it in
the secrets vault, never in a terminal session that is logged.

- Escrow it exactly like `FIELD_ENCRYPTION_KEY`, and separately from the
  volume and its backups: a volume snapshot without the key is unreadable.
- **Turning it on for an existing volume**: set the variable and redeploy (new
  uploads are encrypted; older files are still read as plaintext), then run
  once with the volume mounted:
  `railway run -s api -- pnpm encrypt:documents --dry-run`, then without
  `--dry-run`. The run is idempotent — encrypted files are skipped — so it can
  be repeated or resumed.
- **Rotation** needs the data keys re-wrapped under the new key; there is no
  automated tool yet. Do not change the variable without one: files written
  under the old key would become unreadable.

## Watching a deploy

```bash
railway deployment list -s api     # or -s web
railway logs -d <deployment-id> -s api
```

`railway logs` defaults to the last **successful** deployment, so while a new
one builds you are reading the old one. Pass the deployment id.

Verify by response, never by deploy status — a failed migration leaves the
*old* container serving and looks identical from outside:

```bash
curl -s https://api-production-52b47.up.railway.app/v1/health/ready
curl -s -o /dev/null -w '%{http_code}\n' https://dbank.cambobia.com/login   # 200
```

Shutdown is graceful: on SIGTERM the api runs its shutdown hooks (closes the
Prisma pool, stops scheduled jobs).

## Rollback

- Railway → service → **Deployments** → last good deployment → **Redeploy**
  (or `railway redeploy`).
- A bad migration: roll the code back via git **and** resolve the migration
  state (`prisma migrate resolve --rolled-back <name>` after undoing its
  effect, as the owner). Restore from backup if data was damaged.

## Bringing staging back

1. Create the environment; add **api, web, Postgres, Redis**.
2. Build its database from migrations (Restore → *From scratch* above) — no
   more copying a production schema dump.
3. **Set the deploy branch per service** — api *and* web — and verify it with
   the `repoTriggers` query above.
4. **Separate secrets** — its own `FIELD_ENCRYPTION_KEY`, its own database,
   its own `lending_app` password.
5. **A separate Google OAuth client** (a shared client means a staging-minted
   ID token is valid on production). Authorized JavaScript origins are the
   **web** service's domains.
6. Then restore a two-step flow: `feat/*` → `staging` → validate → `main`.

## Configuration that is not in the code

- **`GOOGLE_CLIENT_ID`** on the **api** service only. The web app fetches it
  from `/auth/providers` at runtime, so enabling Google needs an api restart —
  no web rebuild, and the id is not baked into the JS bundle. Authorized
  JavaScript origins must list **every** live web domain; `dbank.cambobia.com`
  and `web-production-41b26.up.railway.app` both serve the app.
- **KHQR merchant QR** — uploaded in the SUPERADMIN panel (Platform ops →
  Payments). Until one exists, `/auth/plans` reports `khqrConfigured: false`
  and paid tiers cannot be selected at signup.
- **Plan prices** are rows in `PlanTier`, edited under Platform ops →
  Subscription Plans. The `PLAN_PRICE_*` environment variables were removed and
  are no longer read; the api logs a warning at boot if any are still set.
- **Every environment variable** the code reads is documented in `.env.example`
  with its default (CI fails otherwise — `pnpm security:config-audit`).
  Operational limits (retries, batch sizes, lockout and OTP windows, cron
  schedules, the regulator's rate ceiling, `PLATFORM_NAME`) are validated at
  boot: a malformed value stops the api. Production also refuses to start with
  `AWS_S3_BUCKET_NAME` but no `AWS_REGION`, or `RESEND_API_KEY` but no
  `EMAIL_FROM`. Links in e-mails and payment redirects use `WEB_URL`, else the
  first `CORS_ORIGINS` entry.
- **Lender rules** (regulatory return bands and classes, tenant-level ledger
  accounts, payment-file and delegation limits) are per tenant under
  Lending › Operations › Lending settings, maker-checker. See
  `docs/security/HARDCODING_AUDIT.md`.
- **`WEB_PROXY_SECRET` on both api and web** (same value, ≥ 32 random
  characters). Every browser request reaches the api through the web server's
  route handlers (login, MFA, Google, borrower OTP, refresh, logout,
  `/api/proxy`), so the api would otherwise see the web server's address for
  everyone: one rate-limit bucket for all tenants and the web server's IP in
  every audit row. The web server sends the browser's IP (the rightmost
  `X-Forwarded-For` hop) as `X-Client-IP` with `X-Web-Proxy-Secret`; the
  api believes `X-Client-IP` only when the secret matches, else uses
  `req.ip`. Unset, the api ignores `X-Client-IP` and warns at boot.
- **`API_URL` on the web service** (server-only) may point at Railway private
  networking — `http://api.railway.internal:<api PORT>/v1` — instead of the
  api's public domain. Every route handler reads `API_URL` first, then
  `NEXT_PUBLIC_API_URL`.
- **Rate limits** are counted in Redis (`REDIS_URL`, required in
  production): per user for signed-in requests (the api verifies the access
  token itself), per client IP otherwise, and additionally per email / phone /
  MFA account on login, forgot-password, MFA and borrower OTP, so one address
  cannot exhaust another's budget and one account cannot be hammered from many
  addresses.
- **Several api instances** are supported: outbox and webhook deliveries,
  legacy reminders and penalties, and Telegram polling are claimed in
  PostgreSQL; rate limits share Redis. Customer documents need S3 (or one
  volume every instance mounts) — today they are on the single api's `/data`
  volume.

## Platform super-administrators, MFA and tenant purges

- **Super-administrators must use an authenticator** (`AUTH_MFA_REQUIRED_SUPERADMIN`,
  default `true`; D-128). A SUPERADMIN without one reaches only `auth/me`,
  `auth/mfa/{status,generate,enable,step-up}`, `auth/change-password`,
  `auth/sessions/revoke-all` and sign-out; everything else answers 403
  `MFA_ENROLMENT_REQUIRED` and the web sends them to My account. Tenant
  administrators follow their tenant's `security.requireMfaForAdmins` (default
  on). **After this deploy the production super-admin (contact@cambobia.com)
  has no authenticator** and will be sent to My account at the next sign-in:
  have the phone ready, scan the QR, enter the code — the session is upgraded
  on the spot. Keep `FIELD_ENCRYPTION_KEY` escrowed: the authenticator secret
  is encrypted with it.
- **Step-up window** `AUTH_MFA_STEP_UP_MINUTES` (default 15; D-129). MFA-gated
  actions (25 lending actions with `minAssurance: 'MFA'`, authenticator
  resets, super-admin grants, purges) need a code at most this old; refresh
  keeps `amr=mfa` but never moves `mfaAt`. Sessions issued before this deploy
  carry no `mfaAt`, so the first gated action after the deploy asks for a
  code (the web shows a "Confirm it is you" box and retries).
- **TOTP codes are single-use** (the accepted time step is stored per user)
  and the login `mfaToken` is redeemed once (`MfaChallenge` rows). Expired
  challenge rows are harmless; prune them with
  `DELETE FROM "MfaChallenge" WHERE "expiresAt" < now() - interval '1 day'`
  if the table grows.
- **Second super-administrator** (D-130): granting SUPERADMIN and purging a
  tenant are `PlatformApproval` requests another super-administrator approves
  (`PLATFORM_APPROVAL_TTL_DAYS`, default 7). With a single super-administrator
  a grant proceeds on MFA alone and logs `SUPERADMIN_SOLE_APPROVER` (warning
  in the api log). **Add a second super-administrator** — a tenant purge
  cannot be requested without one.
- **Tenant purge** (D-131): erasure request → grace period
  (`TENANT_ERASURE_GRACE_DAYS`, default 30, now enforced) → archive (a JSON
  bundle of every tenant row, credentials excluded, written to document
  storage under `platform/tenant-archives/<tenantId>/`, SHA-256 recorded in
  `TenantArchive`, which is immutable) → purge request → second approval →
  purge. Refused while any customer document is under legal hold, a customer
  relationship is open, or anything is inside its retention period (KYC/AML
  and loan periods from the tenant's document retention rules, D-020). The
  purge deletes the tenant's stored files (`tenants/<id>/`, `lending/<id>/`,
  `<id>/` in S3 or under `DOCUMENT_STORAGE_DIR`) first, then its rows, in a
  transaction bounded by `TENANT_PURGE_TX_TIMEOUT_MS`. The archive is held in
  memory while it is written: archive very large tenants on an instance with
  headroom. **Keep archives** under your records policy; they contain PII.

## Monitoring

Details and the metric list: `docs/lending/OPERATIONS.md` → Monitoring.

- **Probes.** Point the platform's liveness check at `GET /v1/health/live`
  (no database) and its readiness/deploy healthcheck at
  `GET /v1/health/ready` (`SELECT 1`, 503 when the database is unreachable).
  `GET /v1/health` is unchanged.
- **Scraping.** Set `METRICS_BEARER_TOKEN` (≥ 16 random characters, kept in
  the platform's secret store) on the **api** service and configure the
  scraper:

  ```yaml
  scrape_configs:
    - job_name: microloan-api
      metrics_path: /v1/metrics
      scheme: https
      authorization:
        type: Bearer
        credentials_file: /etc/prometheus/microloan-metrics-token
      static_configs:
        - targets: ['<api host>']
  ```

  With a scraper on the same private network instead, set
  `METRICS_ALLOW_PRIVATE_NETWORK=true` and scrape the instance directly (not
  through the public proxy: a request carrying `X-Forwarded-For` is always
  refused). With neither set, `/v1/metrics` answers 404.
- **Rules and dashboard.** Load `ops/monitoring/prometheus-alerts.yml` in
  Prometheus (`rule_files`) and import
  `ops/monitoring/grafana-lending-dashboard.json` into Grafana. The rules
  expect the job name `microloan-api`.
- **Optional settings.** `LENDING_METRICS_REFRESH_SECONDS` (60),
  `LENDING_RECONCILIATION_CRON` (`40 */6 * * *`),
  `LENDING_RECONCILIATION_JOB_DISABLED`, `LENDING_METRICS_REFRESH_DISABLED`,
  `READINESS_DB_TIMEOUT_MS` (2000).

### E-mail alerts (DECISIONS D-150…D-152)

Two layers, both through the Resend account the platform already uses for
e-mail. No other service is needed.

**1. Inside the API — the health monitor.** Every 10 minutes one API
instance (it claims the time slot in `ScheduledJobClaim`) checks:

| Alert (key) | Raised when | Severity |
| --- | --- | --- |
| End of day behind (`eod.stale`) | a tenant with active loans: the last end-of-day run (else the business date) lags today in Asia/Phnom_Penh by more than `ALERT_EOD_MAX_LAG_DAYS` (1) | critical |
| End of day left accounts (`eod.failures`) | the last run recorded failed accounts (`TenantBusinessDate.lastBatchFailures`) | warning |
| Month end not closed (`month_end.overdue`) | a month with postings, before the current one, is not closed `ALERT_MONTH_END_CLOSE_DAYS` (10) days into the next month | warning |
| Outbox / webhooks backed up (`outbox.backlog`, `webhooks.backlog`) | the oldest pending message or delivery is older than `ALERT_BACKLOG_MAX_AGE_MINUTES` (30) | warning |
| Reconciliation breaks (`reconciliation.breaks`) | the latest reconciliation run (six-hourly job) found differences | critical |
| Scheduled jobs failed (`jobs.failed`) | a system job wrote a FAILURE to the tenant's audit trail in the last `ALERT_JOB_FAILURE_LOOKBACK_HOURS` (24) — e.g. one tenant's end of day failing while the others ran | critical for end of day, else warning |
| Database (`database.unreachable`, `database.connections`, platform-wide) | the readiness probe's `SELECT 1` does not answer in `READINESS_DB_TIMEOUT_MS`, or connections reach `ALERT_DB_CONNECTIONS_PCT` (80) % of `max_connections` | critical / warning |

An e-mail goes out when an alert **opens**, when it **resolves**, and as a
**reminder** at most every `ALERT_REMINDER_HOURS` (6) while it stays open —
never every 10 minutes. Open alerts also show on the platform home
(Organisations page) and, for each lender, on Lending › End of day &
operations. If the API or its database is completely down the monitor cannot
run; that is what layer 2 is for.

Set on the **api** service in Railway (Variables → New variable, then
redeploy):

| Variable | Value |
| --- | --- |
| `ALERT_EMAIL_TO` | the operator addresses, comma-separated, e.g. `ops@cambobia.com,oncall@cambobia.com` |
| `RESEND_API_KEY`, `EMAIL_FROM` | already set in production (`EMAIL_FROM=contact@cambobia.com`); alerts use them |
| optional | `ALERT_CHECK_INTERVAL_MINUTES` (10), `ALERT_REMINDER_HOURS` (6), `ALERT_EOD_MAX_LAG_DAYS` (1), `ALERT_MONTH_END_CLOSE_DAYS` (10), `ALERT_BACKLOG_MAX_AGE_MINUTES` (30), `ALERT_JOB_FAILURE_LOOKBACK_HOURS` (24), `ALERT_DB_CONNECTIONS_PCT` (80), `ALERT_MONITOR_DISABLED` (false) |

```sh
railway variables --service api --set "ALERT_EMAIL_TO=ops@cambobia.com"
```

Without `ALERT_EMAIL_TO` (or without `RESEND_API_KEY`) nothing is e-mailed:
each notice is logged (`OperationalAlertService … not e-mailed`) and the
platform home says so. A malformed address stops the API at boot. Each
lender can add its own contacts in its lending settings
(`operations.alertEmails`, maker-checker); they receive that lender's alerts
only, in a separate e-mail from the operator's.

**2. Outside — the GitHub uptime check** (`.github/workflows/uptime.yml`).
Every 10 minutes GitHub Actions requests the web sign-in page and the API
readiness probe (three attempts, 20 s apart, so a single slow answer is not
an outage). When something is down it opens an issue labelled `uptime` and
e-mails; while it stays down it comments and e-mails again at most every
`UPTIME_REMIND_HOURS` (6); when everything answers it closes the issue and
sends a "recovered" e-mail. It uses the built-in `GITHUB_TOKEN`
(`issues: write`) and needs, under Settings → Secrets and variables →
Actions:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `RESEND_API_KEY` | the Resend API key (the same one as the api service) |
| Variable | `ALERT_EMAIL_TO` | recipients, comma-separated |
| Variable | `ALERT_EMAIL_FROM` | sender on the verified domain, e.g. `contact@cambobia.com` |
| Variable (optional) | `UPTIME_WEB_URL` | default `https://dbank.cambobia.com/en/login` |
| Variable (optional) | `UPTIME_API_URL` | default `https://api-production-52b47.up.railway.app/v1/health/ready` |
| Variable (optional) | `UPTIME_REMIND_HOURS` | default 6 |

```sh
gh secret set RESEND_API_KEY            # paste the key when asked
gh variable set ALERT_EMAIL_TO --body "ops@cambobia.com"
gh variable set ALERT_EMAIL_FROM --body "contact@cambobia.com"
gh workflow run uptime.yml              # try it once
```

Without the secret or the recipients the workflow still opens and closes the
issue (GitHub notifies the repository's watchers) and logs a warning. GitHub
runs schedules from the default branch only, can start a run several minutes
late, and pauses a schedule after 60 days without repository activity
(re-enable it under Actions).

## End of day and the connection pool

- End of day runs per tenant. A tenant whose run throws is logged, recorded in
  that tenant's audit trail (`servicing.eod.run`, outcome `FAILURE`) and
  skipped; the other tenants still run, and the failed tenant catches up on
  the next run (its business date stays where it stopped).
- `LENDING_EOD_CONCURRENCY` (default 4) loans are processed at once, each
  holding one connection for its transaction; it is capped at the pool size
  (`connection_limit` in `DATABASE_URL`, else Prisma's default of CPUs × 2 + 1)
  minus two. Measured throughput and sizing: `docs/lending/PERFORMANCE.md`.
- Migration `20261019001600_lending_eod_scale` adds an index on
  `LendingJournalLine("entryId")`; building it blocks writes to the journal
  for its duration (seconds per few million lines). Deploy outside end of day.
- Every query outside a transaction is sent as a short batch transaction
  that first declares the tenant to PostgreSQL (D-142): three extra
  statements on the same connection (≈ 0.1 ms on localhost, ≈ 3 × RTT over a
  network). Work inside a transaction — end of day's per-loan `tenantTx` —
  declares once per transaction. The settings are transaction-local, so they
  are safe with any pooler that keeps a transaction on one connection
  (PgBouncer transaction mode included).
- Set `connection_limit` explicitly in `DATABASE_URL` and keep
  `instances × connection_limit` comfortably under PostgreSQL's
  `max_connections` (plus anything else connecting). The API now opens **one**
  pool per instance; before this change three modules each opened their own,
  so an instance could hold up to four times `connection_limit`.

## Guardrails in place

- CI on every push and pull request (jobs above); branch protection on `main`
  requires it.
- Migrations proven to build a database from empty on every push.
- Healthcheck-gated deploys; graceful shutdown.
- The api refuses to boot in production without its dedicated secrets, or
  (with `DB_ROLE_MUST_RESPECT_RLS=true`) as a role that bypasses RLS.

## CLI cheatsheet

```bash
railway status                         # linked project/service
railway logs -d -s api                 # runtime (-b build, --http requests)
railway connect Postgres               # psql
railway redeploy --service api -y
railway run -s api -- <command>        # a command with the api's variables
railway api '<graphql>'                # anything the CLI does not expose
```

`-e` / `-s` target an environment/service without changing what your CLI is
linked to.
