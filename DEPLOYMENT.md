# Deployment & Promotion Runbook

**One Railway environment.** `staging` was deleted on 2026-07-29 to cut cost.
See [Bringing staging back](#bringing-staging-back) before recreating it — the
old setup had a wiring bug that made its gate ineffective for the api.

| Environment | Deploys from | API | Web |
|---|---|---|---|
| **production** | `main` | `api-production-c3fb.up.railway.app` | `dbank.cambobia.com` (+ `web-production-6e20.up.railway.app`) |

## Flow

```
feat/*  ──PR──▶  main  ──▶  Railway deploys PRODUCTION (api + web)
          CI must pass
```

1. **Branch** off `main`: `git checkout -b feat/xyz`.
2. **PR into `main`.** CI (`Security & Production Readiness`) must pass.
   Branch protection requires both.
3. **Merge → production deploys.** Watch it (below).

> ⚠️ **There is no staging gate any more.** Whatever merges to `main` reaches
> customers, and a schema change reaches the only database that exists. For
> anything touching `packages/db/prisma`, rehearse it locally against a real
> Postgres first — `prisma migrate deploy` plus `prisma migrate diff
> --exit-code` against a copy of the schema catches most of what staging did.

## Watching a deploy

```bash
railway deployment list -e production -s api     # or -s web
railway logs -d <deployment-id> -e production -s api
```

`railway logs` defaults to the last **successful** deployment, so while a new
one is building you will be reading the old one. Pass the deployment id.

Verify by response, never by deploy status — a green deploy with a failed
migration leaves the *old* container serving and looks identical from outside:

```bash
curl -s https://api-production-c3fb.up.railway.app/v1/health      # {"status":"ok"}
curl -s https://api-production-c3fb.up.railway.app/v1/auth/plans  # tier catalogue
```

## Migrations

- `prisma migrate deploy` runs in `start:prod` on every boot (Railway does not
  honour `preDeployCommand` here). The wired **healthcheck** is the safety net:
  a failed migration → new container unhealthy → previous deployment keeps
  serving. No outage, and it will not silently pass.
- ⚠️ **No baseline migration.** Migrations cannot build a database from scratch;
  a fresh DB or a DR restore will not come up from migrations alone. Verified
  2026-07-29: `migrate deploy` against an empty database fails at
  `20260302_add_penalty_last_applied_at` because `RepaymentSchedule` was never
  created by any migration. Fix pending: squash a baseline.

## ⚠️ Backups — currently NONE

Verified 2026-07-29 against the Railway API:

```bash
railway api 'query { volumeInstanceBackupScheduleList(volumeInstanceId: "<id>") { id kind } }'
railway api 'query { volumeInstanceBackupList(volumeInstanceId: "<id>") { id createdAt } }'
# both returned []
```

The production Postgres volume (`postgres-volume`, instance
`a027f85d-742c-4791-925d-bf408fb30a6a`) has **no backup schedule and no
backups**. Combined with the missing baseline above, losing that volume means
losing the data outright — migrations cannot rebuild it.

Two things to fix, in this order:

1. **Enable a backup schedule** (Railway dashboard → Postgres → Backups, or
   `volumeInstanceBackupScheduleUpdate`).
2. **Store `FIELD_ENCRYPTION_KEY` outside Railway.** Borrower PII is encrypted
   at rest with it. A backup restored without that key is unreadable, so a
   backup and the key living only in the same Railway project is not a
   recovery plan.

## Rollback

- Railway → the service → **Deployments** → last good deployment → **Redeploy**
  (or `railway redeploy`).
- For a bad migration, roll the code back via git **and** resolve migration
  state in the DB (`prisma migrate resolve`).

## Bringing staging back

Recreating the environment is not enough — the previous one had a defect that
made it useless as a gate for the api. In order:

1. Create the environment; add **api, web, Postgres, Redis**.
2. **Set the deploy branch per service, per environment** — api *and* web.
   Until 2026-07-29 the api service in staging pointed at `main`, not
   `staging`, so merges to `staging` never deployed the api and "migrations
   pass on staging" was validating `main`. Verify, don't assume:

   ```bash
   railway api 'query { project(id: "<projectId>") { services { edges { node {
     name repoTriggers { edges { node { branch environmentId } } } } } } } }'
   ```

   Symptom if it regresses: the merge lands on `origin/staging` but
   `railway deployment list -e staging -s api` shows nothing new.
3. **Separate secrets** — its own `FIELD_ENCRYPTION_KEY`, its own DB. Shared
   keys defeat the isolation.
4. **A separate Google OAuth client.** Verification checks the ID token's `aud`
   against `GOOGLE_CLIENT_ID`; one shared client means a staging-minted token
   is cryptographically valid on production. Authorized JavaScript origins are
   the **web** service's domains, not the api's.
5. Restore the two-step flow in this document: `feat/*` → `staging` → validate
   → `main`.

## Configuration that is not in the code

- **`GOOGLE_CLIENT_ID`** on the **api** service only. The web app fetches it
  from `/auth/providers` at runtime, so enabling Google needs an api restart —
  no web rebuild, and the id is not baked into the JS bundle. Authorized
  JavaScript origins must list **every** live web domain; `dbank.cambobia.com`
  and `web-production-6e20.up.railway.app` both serve the app.
- **KHQR merchant QR** — uploaded in the SUPERADMIN panel (Platform ops →
  Payments). Until one exists, `/auth/plans` reports `khqrConfigured: false`
  and paid tiers cannot be selected at signup.
- **Plan prices** are rows in `PlanTier`, edited under Platform ops →
  Subscription Plans. The `PLAN_PRICE_*` environment variables were removed and
  are no longer read; the api logs a warning at boot if any are still set.

## Guardrails in place

- CI security scans on every PR and on pushes to `main`.
- Branch protection on `main`: PR + passing CI required.
- Healthcheck-gated deploys.

## CLI cheatsheet

```bash
railway status -e production          # linked service + health
railway logs -d -e production -s api  # runtime (-b build, --http requests)
railway connect Postgres --ssh        # psql over an SSH tunnel
railway redeploy --service api -y
railway api '<graphql>'               # anything the CLI does not expose
```

Note `-e` / `-s` flags: they target an environment/service without changing
what your CLI is linked to.
