# Deployment & Promotion Runbook

Two Railway environments in project **microloan-os**, each fully isolated
(own Postgres, Redis, secrets, and `FIELD_ENCRYPTION_KEY`):

| Environment | Deploys from branch | API | Web |
|---|---|---|---|
| **staging** | `staging` | `api-staging-8db0.up.railway.app` | `web-staging-fa7d.up.railway.app` |
| **production** | `main` | `api-production-c3fb.up.railway.app` | (prod web domain) |

## Promotion flow (never push straight to `main`)

```
feature/*  ──PR──▶  staging  ──▶  Railway deploys STAGING
                       │  validate (below)
                       ▼
                     main    ──▶  Railway deploys PRODUCTION
```

1. **Branch** off `main`: `git checkout -b feat/xyz`.
2. **PR the feature into `staging`.** CI (`Security & Production Readiness`)
   must pass. Merge → **staging auto-deploys**.
3. **Validate on staging** (see checklist). This is the gate — especially for
   DB migrations.
4. **PR `staging` → `main`.** CI must pass. Merge → **production auto-deploys**.

Hotfixes follow the same path; do not skip staging.

## Staging validation checklist (before promoting to prod)

- [ ] `curl https://api-staging-8db0.up.railway.app/v1/health` → `{"status":"ok"}`
- [ ] Any **DB migration applied cleanly** (check the deploy logs — a failed
      migration crashes the new container and the healthcheck keeps the old one
      serving; it will NOT silently pass).
- [ ] Smoke-test the changed flow in the staging web app.
- [ ] No new errors in Sentry / `railway logs -d` for the staging api.

## Migrations

- `prisma migrate deploy` runs in `start:prod` on every boot (Railway does not
  honor `preDeployCommand` here). The wired **healthcheck** is the safety net:
  a failed migration → new container unhealthy → previous deployment keeps
  serving (no outage).
- ⚠️ Known gap: there is **no baseline migration**, so migrations cannot build a
  DB from scratch (a fresh DB / DR restore won't come up from migrations alone).
  Fix pending: squash a baseline. Until then, treat "migrations pass on staging"
  as validating the *forward* migration only.

## Rollback

- Railway → the service → **Deployments** → pick the last good deployment →
  **Redeploy** (or `railway redeploy`). For a bad migration, roll the code back
  via git *and* resolve the migration state in the DB (`prisma migrate resolve`).

## Setup status — pipeline active (api trigger corrected 2026-07-29)

| Service | Environment | Deploy branch |
|---|---|---|
| api | staging | `staging` |
| api | production | `main` |
| web | staging | `staging` |
| web | production | `main` |

⚠️ **This was wrong until 2026-07-29 and is worth knowing about.** The **api**
service in the **staging** environment was pointing at `main`, not `staging`.
The earlier "verified end-to-end" claim held for `web` only — the tagged-commit
test exercised the web service, and nobody checked that api had the same wiring.

Two things followed from it, both of which invalidate past assumptions:

- **The staging gate was not real for the api.** Migrations run in `start:prod`
  on the api service, so "migrations pass on staging" was never actually
  validating a `staging`-branch migration. Any migration merged to `staging`
  before this date reached production without a staging rehearsal.
- **Staging and production ran the same api code.** Both tracked `main`, so
  staging was isolated by data and secrets but not by code.

Symptom to recognise if it regresses: a merge to `staging` lands on
`origin/staging`, but `railway deployment list -e staging -s api` shows no new
deployment. Verify the wiring with:

```bash
railway api 'query { project(id: "<projectId>") { services { edges { node {
  name repoTriggers { edges { node { branch environmentId } } } } } } } }'
```

Note: the per-environment branch is set in the Railway **dashboard** (api & web
service → Settings → Source → Deploy Branch, per environment) — the CLI's
`service source connect` is service-level and cannot do this.

## Guardrails in place

- CI security scans on every PR and on pushes to `main`/`staging`.
- Branch protection on `main`: PR + passing CI required.
- Healthcheck-gated deploys on both environments.
- Isolated staging secrets/DB — cannot read or write production data.

## CLI cheatsheet

```bash
railway environment staging      # or: production   (switch context)
railway status                   # linked env/service + health
railway logs -d                  # runtime logs   (-b build, --http requests)
railway connect Postgres --ssh   # psql to the env's DB over an SSH tunnel
railway redeploy --service api -y
```
