# Lending platform — setup, demo and operations

## Setup (local)

Prerequisites: Node 20+ (22 recommended), pnpm 9, PostgreSQL 14+.

```bash
pnpm install
cp .env.example .env               # set DATABASE_URL, JWT_* secrets, CORS_ORIGINS …
pnpm --filter @microloan/db build  # prisma generate
pnpm --filter @microloan/shared build
pnpm db:migrate:deploy             # applies 20261016_lending_platform_phase1 (see "Migrations" below)
pnpm dev                           # API :3001, web :3000
```

On boot the API synchronises the platform catalogue (loan families, product
templates, permissions, feature-flag definitions) from code. Set
`LENDING_CATALOGUE_SYNC=false` to skip.

### Demo data

```bash
pnpm demo:lending        # requires the API to have booted once (catalogue sync)
```

Creates **Demo Lending Co** with a user per role (`<role>@demo-lending.test`,
password `Demo#Lending2026` or `$DEMO_PASSWORD`), branch-scoped relationship
officers, approval authorities, the `KH` holiday calendar, the five Phase 1
products already approved by a different checker and active, and verified
borrowers. It refuses to run in production unless `DEMO_SEED_ALLOW=true`.

Approvals, executions and reversals require multi-factor sign-in: enrol TOTP on
the Settings page (`/en/settings`, MFA setup — open the URL directly; the
sidebar link is shown to administrators only) for `approver`, `approver2`, `ops.checker` and
`committee` before walking the flows.

### Demo walkthrough

1. **Products** (Lending → Products): `product.maker` creates a product from a
   template and submits; `product.checker` reviews the diff, approves and
   activates. A floating-rate draft cannot be activated (simulation only).
2. **Origination**: `officer.pnh` creates an application for a Phnom Penh
   borrower, uploads documents, submits; `analyst` recommends; `approver`
   approves (MFA, within authority); `ops.maker` books, satisfies the
   conditions and prepares the disbursement; `ops.checker` approves and executes.
3. **Servicing**: `finance` advances the business date and runs the
   end-of-day batch; `ops.maker` posts repayments; settlement quote and payoff;
   `ops.checker` reverses a repayment.
4. **Restructuring**: the customer (borrower portal) or `officer.pnh` requests
   lower payments → `analyst` records evidence and an affordability assessment →
   simulates options and proposes → `committee` approves (waivers need its
   authority) → the customer accepts in the portal, or `officer.pnh` records a
   signed acceptance → `ops.checker` executes → the batch monitors the revised
   repayments and probation.
5. **Accounting** (Lending → Accounting): trial balance and reconciliation show
   no breaks; **Audit** lists every step, including denials with reasons.

The same flows run end-to-end in `apps/api/test/lending/*.int-spec.ts`.

## Tests

```bash
pnpm test:engine          # 71 engine tests (decimal reference cases, restructuring, configuration)
pnpm test:api             # API unit tests, including the decision-engine security tests
# Integration — real HTTP API, guards and PostgreSQL with the migration's triggers and RLS:
export LENDING_TEST_DATABASE_URL=<throwaway database whose name contains "test" or "ci">
pnpm test:lending:db      # resets that database: schema push + migration invariants
pnpm test:lending:int     # 48 tests: Phase 1 slice, security & lifecycle, restructuring
```

CI runs all three in the `lending-tests` job of `.github/workflows/security.yml`.

## End-of-day routine

1. Post the day's repayments and disbursements.
2. Advance the business date (at most 31 days per step): `POST /v1/lending/ops/business-date`.
3. Run the batch: `POST /v1/lending/loans/batch/run` — accrual, interest
   capitalization, penalties, delinquency buckets and collection stages,
   restructure monitoring and system referrals. It is idempotent and processes
   only accounts in the caller's scope; each account is its own transaction.
4. Check reconciliation: `GET /v1/lending/ops/reconciliation` must report no breaks.

## Migrations and deployment

* `packages/db/prisma/migrations/20261016_lending_platform_phase1/migration.sql`
  is additive: new tables, a new `Tenant.authzVersion` column, new unique
  indexes on `(tenantId, id)` for `User`, `Borrower`, `LedgerAccount`, plus the
  triggers, constraints and RLS policies. It was rehearsed against the
  production starting schema (old schema + recorded history → `migrate deploy`)
  with `prisma migrate diff --exit-code` reporting no drift.
* **There is no staging environment and no backups** (see `DEPLOYMENT.md`).
  Take a database snapshot before deploying this migration.
* The API's `start:prod` runs `prisma migrate deploy`; a failed migration leaves
  the previous container serving.
* New env vars (optional): `SERVICE_KEY_PEPPER` (service-account keys; falls
  back to `JWT_REFRESH_TOKEN_PEPPER`), `LENDING_OUTBOX_DISABLED`,
  `LENDING_CATALOGUE_SYNC`.
* The tenant GDPR hard-delete now declares `SET LOCAL lending.purge = 'on'` so
  it can remove immutable lending rows; nothing else can.

## Integration gaps (clearly labelled mocks, blocked in production)

| Integration | Status |
|---|---|
| Payment rails (automated payout / collection) | Mock only. Disbursements are recorded by operations with an external bank/cash reference (manual rail, fully supported). Products requiring an adapter cannot be activated. |
| Identity / KYC | Manual KYC status only; `EXTERNAL_REQUIRED` products cannot be activated. |
| Credit bureau | Products with `creditBureau: REQUIRED` cannot be activated (the legacy CBC module is not wired into lending). |
| Notifications | Outbox messages are written transactionally; the delivery worker uses a mock in development and leaves messages pending in production. |
| Document storage | S3 when configured; otherwise a local-disk mock in development (refused in production). |
| External accounting | Not wired; the lending journal and reconciliation are internal. |

## Known limitations (Phase 1 + restructuring)

* Floating-rate products are **simulation only** (projected schedules from the
  latest benchmark + margin, with floor/cap); contractual resets on booked loans
  are Phase 2.
* Not implemented (templates seeded unavailable): revolving facilities,
  overdrafts, staged drawdowns, group/joint liability, borrowing bases,
  connected-party exposure, credit cards, BNPL, trade finance, factoring,
  forfaiting, supply-chain finance, income-contingent education, syndication,
  project finance, institutional lending, Murabaha, Ijarah, post-write-off
  recoveries, refinancing, negotiated settlement, stand-alone payment holidays,
  emergency (break-glass) access.
* Reversal is latest-first and not available for repayments that triggered a
  prepayment reschedule; amendment reversal only before later activity.
* No unapplied-cash (suspense) account: overpayments beyond the payoff are refused.
* Penalty interest uses ACT/365F on overdue principal + interest.
* Modification accounting, impairment staging and regulatory classification
  beyond the restructure delinquency floor need integration review.
* The business date is per tenant (not per branch or legal entity).

## API index (`/v1/lending/...`)

| Area | Endpoints |
|---|---|
| Catalogue | `GET catalogue`, `GET capability-matrix`, `GET templates/:code` |
| Products | `GET/POST products`, `POST products/:id/versions`, `GET/PUT product-versions/:id`, `POST product-versions/:id/{submit,approve,reject,activate,retire,simulate}` |
| Workflows | `GET/POST workflows`, `POST workflows/:id/decision` |
| Applications | `GET/POST applications`, `GET applications/:id`, `PUT :id/terms`, `POST :id/{documents,collateral,guarantees,submit,simulate,recommend,approve,reject,book}`, `POST :id/conditions/:code` |
| Loans | `GET loans`, `GET loans/export.csv`, `POST loans/batch/run`, `GET loans/:id`, `GET :id/settlement-quote`, `POST :id/disbursements`, `POST :id/disbursements/:taskId/decision`, `POST :id/disbursements/execute`, `POST :id/repayments`, `POST :id/settlement`, `POST :id/events/:eventId/reverse`, `POST :id/write-offs`, `POST :id/write-offs/:taskId/decision` |
| Restructuring | `GET restructures`, `GET restructures/tasks`, `POST restructures/loans/:loanId`, `GET/POST restructures/:id/...` (`evidence`, `more-info`, `assessments`, `simulate`, `proposals`, `proposals/:pid/approve`, `reject`, `proposals/:pid/acceptance`, `conditions/:code`, `execute`, `reverse`, `withdraw`), `GET restructures/policy/current`, `POST restructures/policy`, `POST restructures/policy/:id/decision` |
| Customer portal | `POST portal/loans/:loanId/restructure-requests`, `GET portal/restructures`, `GET portal/restructures/:id`, `POST portal/restructures/:id/proposals/:pid/accept` |
| Access | `GET access`, `POST access/{roles,assignments,delegations,authorities,policies,cohorts,simulate,service-accounts}`, decisions and revocations, `GET access/flags`, `POST access/flags/rules`, `GET access/capabilities/:type/:id` |
| Integrations | `POST integrations/loans/:id/repayments` (service-account key) |
| Operations | `GET/POST ops/business-date`, `GET/POST ops/calendars`, `GET/POST ops/rates`, `GET ops/journal`, `GET ops/trial-balance`, `GET ops/reconciliation`, `GET ops/audit`, `GET ops/integrations` |

Money endpoints require an `Idempotency-Key` header.
