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

Node 22 everywhere: `.nvmrc`, `engines.node` (`>=22 <23`) and CI read the same
version. Railway's builder also honours them.

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
row-level-security policy for those and for the table owner).

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
