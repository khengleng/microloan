# Row-level security — the database tenant wall

Wall 5 of [TENANT_ISOLATION.md](TENANT_ISOLATION.md). Decisions D-141…D-143
(`docs/servicing/DECISIONS.md`). Last reviewed 20 Oct 2026.

The Prisma tenant guard (wall 4) scopes every model query to the caller's
tenant. It cannot see raw SQL, and it is application code: a bug in it, or a
query that reaches the database some other way, would cross tenants silently.
Row-level security (RLS) is the same rule enforced by PostgreSQL itself.

## The rule

Every tenant-owned table has `ENABLE` + `FORCE ROW LEVEL SECURITY` and one
policy (`<table>_tenant_wall`) for reads and writes alike:

```sql
USING      (current_setting('app.system', true) = 'on'
            OR "tenantId" = current_setting('app.tenant_id', true))
WITH CHECK (same)
```

| What the transaction declared | Rows it sees and may write |
|---|---|
| `app.tenant_id = T` | tenant T's rows only |
| `app.system = on` | every row, including rows with no tenant |
| nothing | **none** |

The last line is the change made by D-141. Until migration
`20261021000100_rls_strict_tenant_wall`, the lending policies admitted every
row when no tenant was set, and the core tables (Borrower, Loan, User,
AuditLog, …) had no RLS at all.

Variants of the same rule:

- **Tables with a nullable `tenantId`** (`User` — platform users, `AuditLog`
  and `AuditEvent` — platform entries, `OperationalAlert` — platform-wide
  alerts, D-150): the same policy; `NULL` never equals a
  tenant id, so those rows exist only in system context.
- **`Tenant`**: `id = app.tenant_id`, or system.
- **Tables without a `tenantId`** reach it through their parent:
  `RepaymentSchedule`, `Collateral`, `Guarantor`, `LoanInteraction` (→ `Loan`),
  `JournalLine` (→ `JournalEntry`), `LoanProvision` (→ `ProvisionRun`),
  `LoanPolicy` (→ `LoanProduct`), `RolePermission` (→ `AccessRole`),
  `Holiday` (→ `HolidayCalendar`), `RefreshToken`, `PasswordResetToken`,
  `MfaChallenge`, `FederatedIdentity` (→ `User`). The policy is
  `EXISTS (SELECT 1 FROM parent p WHERE p.id = fk AND p."tenantId" = app.tenant_id)`,
  or system — so a child row cannot be read through, or hung under, another
  tenant's parent.
- **Platform-only tables** (`PlatformApproval`, `TenantArchive`,
  `PlatformPaymentQr`): system only (`<table>_platform_only`).
- **Left open**: the platform catalogue (`PlanTier`, `LoanFamily`,
  `ProductTemplate`, `AccessPermission`, `FeatureFlag`, `PlatformFlagRule`) —
  no tenant data, read by everyone including the sign-up page — and Prisma's
  `_prisma_migrations`. The guard keeps the catalogue read-only for tenants.

`apps/api/test/lending/database-wall.int-spec.ts` asserts that exactly that
list is open and that no policy admits rows when nothing is declared.

## How the api declares the context

`apps/api/src/prisma/db-tenant-context.ts`. `PrismaService` hands Nest an
extended Prisma client (`$extends`), so every service gets it without
change. The context comes from the same `AsyncLocalStorage` the tenant guard
reads (`prisma/tenant-context.ts`):

| Ambient context | Declared |
|---|---|
| `tenant` (a signed-in staff user, borrower, service account; `runAsTenant`; `LendingPrisma.tenantTx`) | `app.tenant_id = <tenant>`, `app.system = off` |
| `platform` (SUPERADMIN) | `app.system = on` |
| `system` (`runAsSystem`, `@SystemContext`) | `app.system = on` |
| none | nothing — no tenant-owned row is visible |

How each kind of query carries it:

- **A query outside a transaction** is sent as a two-statement batch
  transaction: `SELECT set_config('app.tenant_id', $1, true), set_config('app.system', $2, true)`,
  then the query. Raw SQL (`$queryRaw`, `$executeRaw`, the `Unsafe` forms) is
  included. A plain read of a catalogue model that reaches no relation is sent
  as it is (nothing walled to protect).
- **An interactive transaction** (`$transaction(async (tx) => …)`, which is
  also what `tenantTx` uses) runs the `set_config` as its first statement,
  from the context at the moment it opens. Queries on `tx` then run as they
  are — no per-query overhead inside a transaction, so end of day and other
  batch work, which already runs in `tenantTx`, costs one extra statement per
  transaction, not per query.
- **A batch transaction** (`$transaction([…])`) gets the `set_config`
  prepended; its result is dropped from the array returned.

`set_config(…, is_local => true)` lasts until the end of the transaction, so a
setting never travels to the next user of a pooled connection (tested: after
tenant and system work fills the pool, every connection reports both settings
empty).

**What is not covered:** a `PrismaClient` created outside `PrismaService`
(scripts) has no context unless it is wrapped with
`withDatabaseTenantContext` and run inside `runAsSystem` — see
`apps/api/src/scripts/encrypt-at-rest-backfill.ts`. Seeds and demo scripts in
`packages/db` use a bare client: run them with the owner's URL
(`DATABASE_URL="$MIGRATION_DATABASE_URL" pnpm db:seed`); as `lending_app`
they now see no rows and their writes are refused.

## System context

`app.system = on` is declared only where the code has already entered
`system` or `platform` context — the same places the Prisma guard lets
through, each with a written reason (`runAsSystem(reason, …)` /
`@SystemContext(reason)`): sign-in, token refresh and password reset (before
a principal exists), the JWT strategies' own look-ups, the platform
operator's routes, cross-tenant cron loops (end of day's tenant discovery,
document expiry, the outbox and webhook delivery, metrics), and the guard's
own ownership pre-flights. Each tenant's share of a cron's work then runs in
`runAsTenant`, which declares that tenant again.

Code paths changed by D-142 because they relied on the old "nothing set =
every row" hole:

| Path | Now |
|---|---|
| `JobClaimService.once / lease / release` (raw `INSERT … ON CONFLICT` into `ScheduledJobClaim`, called from cron loops and shutdown hooks) | declares the tenant it is given (`runAsTenant`) |
| `PUT /settings` — "is this Telegram bot already connected to another organisation?" (raw SQL over every `Tenant`) | a declared system look-up that returns only whether the token is taken |
| `pnpm encrypt:backfill` (all tenants' PII) | wrapped client, run as system |

## Database roles

PostgreSQL skips RLS for a superuser and a `BYPASSRLS` role. The api must
connect as `lending_app` (`NOSUPERUSER NOBYPASSRLS`, owns nothing —
`ops/db/app-role.sql`, DEPLOYMENT.md → Database roles) with
`DB_ROLE_MUST_RESPECT_RLS=true`. The integration suite connects as
`lending_app_test`, created by the same runbook, so the policies are exercised
on every CI run.

`FORCE` makes the policies apply to a **non-superuser table owner** too. In
production the owner is `postgres` (a superuser) and migrations are
unaffected. If the owner is ever a plain role, a migration that reads or
changes rows of a walled table must start with
`SELECT set_config('app.system', 'on', true);`.

## Performance

Measured on the development machine (PostgreSQL 16 on localhost, Prisma 5.13):

| | Before | After |
|---|---|---|
| One `findFirst` outside a transaction (3,000 runs) | 0.11 ms | 0.22 ms |
| Lending integration suite (73 → 74 suites, `--runInBand`, 744 → 751 tests) | 242.6 s | 253–259 s (+4–7%, two runs) |

The per-query cost is the batch transaction's three extra statements
(`BEGIN`, `set_config`, `COMMIT`) on the same connection; over a network it
grows with the round-trip time (≈ 3 × RTT per query outside a transaction).
Queries inside a transaction pay nothing extra. If that matters for a hot
read path, run it in one interactive transaction.

Plans: the policy is a filter on top of the query's own conditions; indexes
are used as before (`EXPLAIN` of `Loan` by id, `Borrower` and `LoanAccount` by
tenant shows the same index scans). Every table with a `tenantId` has an index
on it except `AgreementVersion`, `BorrowerOtp`, `CollateralPledge`,
`ConditionPrecedent`, `LoanProduct`, `OutboxMessage` and
`RestructureCondition`, which are reached by their own keys (parent id,
phone hash, status) or are small. The migration adds the missing indexes the
parent-scoped policies and the core screens need: `loanId` on
`RepaymentSchedule`, `Collateral`, `Guarantor`, `LoanInteraction` and
`Document`, and `tenantId` on `Document`.

## Tests

- `apps/api/test/lending/database-wall.int-spec.ts` — no context sees no row
  (raw SQL, interactive transaction, and writes refused); raw SQL in tenant A
  sees, changes and adds nothing of tenant B's on the core tables (Tenant,
  Branch, User, Borrower, KycDocument, LoanProduct, LoanPolicy, Loan,
  RepaymentSchedule, Repayment, Document, AuditLog, RefreshToken), also inside
  interactive and batch transactions; platform users only in system context;
  system context (cron paths: end of day's entry point, job claims) sees every
  tenant; settings never outlive their transaction on the pool; the list of
  open tables.
- `apps/api/test/lending/tenant-wall.int-spec.ts` — every table with a
  `tenantId` has forced RLS (no exceptions any more).
- `apps/api/src/prisma/db-tenant-context.spec.ts` — which context declares
  what, and that each query shape is wrapped (or not) as described above.
