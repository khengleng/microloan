# Tenant isolation (the "Chinese wall")

One deployment serves many lending organisations. Nothing one organisation
does through the API may read, change or reference another organisation's
data. This page lists the walls, what proves each one, and what is still open.
Last reviewed 17 Oct 2026.

## The walls

| # | Layer | What it does | Where |
|---|---|---|---|
| 1 | Identity | The tenant comes from the database row of the signed-in user (re-checked against the token on every request), the borrower session or the service key — never from a header, query or body. A token whose tenant claim does not match its user is refused. | `auth/jwt.strategy.ts`, `borrower-portal/borrower-jwt.strategy.ts`, `lending/policy/lending-action.guard.ts` |
| 2 | Request | A `tenantId` named in the path, body or query must be the caller's own (only the platform operator may name another). | `authz/tenant-scope.guard.ts` |
| 3 | Authorization | Lending actions are decided per resource (tenant, branch, portfolio, maker-checker, authority); legacy routes use `scopeWhere` + `assertBranchAccess` / `branchFilter`. | `lending/policy/*`, `authz/authz.service.ts` |
| 4 | ORM (Prisma tenant guard) | Every query on a tenant-owned model is scoped to the caller's tenant or refused. Writes may not reference another tenant's row (scalar foreign key or nested `connect`), may not move a row to another tenant, and may not use nested update/delete; nested creates are checked like top-level ones. Fails closed for unknown models and actions; `warn` mode cannot run in production. | `prisma/tenant-guard.ts` |
| 5 | Database (row-level security) | Lending, access and configuration tables (including the trade-finance and syndication tables) carry forced RLS: inside a tenant transaction (`app.tenant_id` set) only that tenant's rows exist and writes for another tenant are rejected. | lending migrations, `20261018000002_lending_rls_all_tables` |
| 6 | Storage | Document keys are only signed, read or deleted under the owner's prefix: `tenants/<tenant>/loans/<loan>/` (legacy vault) and `tenants/<tenant>/customers/` (customer library, also a database CHECK). API download links are HMAC-signed for one tenant and one version and expire within minutes. | `document-vault/document-vault.service.ts`, `lending/documents/document-storage.ts` |
| 7 | Jobs | End of day and the penalty cron do each tenant's (or loan's) work inside that tenant's wall; bot handlers require a tenant id. | `eod-scheduler.service.ts`, `penalty-cron.service.ts`, `prisma/tenant-context.ts` |

## What proves it

- `apps/api/test/lending/tenant-wall.int-spec.ts` (runs in CI with the lending integration suite):
  - **Every registered route** (289, plus the 29 trade-finance and syndication routes added on 17 Oct 2026) is replayed by another tenant's staff user holding every lending role, a borrower-portal session, a service account and the platform operator, with the victim tenant's ids in the path and a valid body generated from the route's own schema. Afterwards no row of any other tenant has changed (hashed per table) and no response contained another tenant's id. A new route whose parameters the suite cannot map fails the build.
  - Foreign ids smuggled in request bodies (borrower, product, refinanced loan, branch, role, user, group member, legacy loan and repayment, a document pointing at another tenant's file) are refused.
  - Tenant headers / query parameters are ignored or refused; forged and re-scoped tokens are refused.
  - A phone number shared by two organisations signs in only where its code was issued.
  - **Row-level security, alone** (raw SQL, no Prisma guard): another tenant's rows are invisible and writes for another tenant are rejected; every tenant-owned lending table has forced RLS.
- The integration suite connects as `lending_app_test`, a `NOSUPERUSER NOBYPASSRLS` role, so the database policies are actually exercised (a superuser skips them).
- `apps/api/src/prisma/tenant-guard.spec.ts`, `tenant-guard-coverage.spec.ts` (every tenant-owned model is classified), `document-vault/storage-key.spec.ts`, `authz/access-control.spec.ts`.

## Still open

| Item | Risk | Action |
|---|---|---|
| **Production database role.** If the API connects as `postgres` (Railway's default), PostgreSQL skips every RLS policy and wall 5 is inactive. The API now logs an error at startup when this is the case. | High (defence in depth) | Create a `NOSUPERUSER NOBYPASSRLS` role that does not own the tables, grant it DML, point `DATABASE_URL` at it, then set `DB_ROLE_MUST_RESPECT_RLS=true`. Migrations keep running as the owner. |
| RLS policies allow every row when `app.tenant_id` is unset, and it is only set inside lending tenant transactions. Reads outside a transaction rely on walls 1–4. | Medium | Set the tenant on every request-scoped connection (Prisma client extension), then make the policies deny when unset, with an explicit bypass for system jobs. |
| Legacy core-app tables have no RLS (listed in the test). | Medium | Add policies once the tenant is set per request (previous item). |
| Lending references without a database foreign key (e.g. `LoanAccount.borrowerId`) are protected by the guard and the services, not by the database. | Low | Add composite `(tenantId, id)` foreign keys, `NOT VALID` first, then validate after checking production data. |

## Fixed in this review

- A document could be pointed at another tenant's stored file and downloaded or deleted (document content doubled as the storage key).
- A phone number shared by two organisations signed the borrower in to whichever organisation touched it last.
- Borrower one-time codes could be re-requested to reset the attempt limit, and attempts were not counted atomically.
- Group, flag-rule and cohort requests accepted another tenant's branch, product, user or borrower id (stored as a dangling reference).
- The Prisma guard did not check foreign keys, nested writes or a change of `tenantId` on update.
- The same Telegram bot token could be saved by two organisations; Google sign-in auto-linked the platform operator and ignored the lockout.
- Inside a tenant: a tenant admin could take over a fellow admin; Excel exports, agreement key facts and the KPI overview ignored branch scope.
