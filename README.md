# Magic Money — multi-tenant lending platform

Magic Money is a multi-tenant, Khmer/English lending operations platform for
Cambodian lenders (MFIs, digital lenders and banks). One deployment serves many
lending organisations (tenants), each isolated from the others at the
application, query and database level.

The repository contains two lending stacks that run side by side:

| | What it is | Where |
|---|---|---|
| **Core app** | The original Magic Money micro-lending operations app: borrowers, flat / reducing-balance loans, repayments, collections, reports, KYC, borrower portal, billing. | `apps/api/src/{borrowers,loans,repayments,…}`, legacy web pages |
| **Configurable lending platform** | A product-configurable lending engine for consumer, microfinance, SME, mortgage and agricultural lending, with maker-checker product governance, RBAC + ABAC + feature flags, immutable double-entry accounting, and loan restructuring / hardship management. | `packages/shared/src/lending`, `apps/api/src/lending`, `apps/web/src/app/[locale]/(app)/lending` |

They share tenants, users, branches, borrowers, authentication and the chart of
accounts. They do not share loan records: loans created in one stack are
serviced in that stack.

---

## Tech stack

* **Monorepo**: pnpm 9 workspaces + Turborepo
* **API** (`apps/api`): NestJS 11, Prisma 5, PostgreSQL, JWT (HttpOnly cookies) with optional TOTP MFA and Google sign-in
* **Web** (`apps/web`): Next.js 16 (App Router), React 19, Tailwind CSS 4, next-intl (English / Khmer)
* **Database** (`packages/db`): PostgreSQL via Prisma; tenant isolation enforced by a Prisma middleware, composite tenant foreign keys and row-level security on lending tables
* **Shared** (`packages/shared`): currency rules, legacy loan formulas, provisioning, scorecard, EIR — and the **lending engine** (decimal arithmetic, no floating point for money)

---

## Core app features

* **Organisations & users** — self-serve signup with plan payment by KHQR (confirmed by the platform operator), subscription plan tiers with quotas, users with roles, branch scoping, TOTP MFA, Google sign-in, password reset, audit log.
* **Borrowers** — profiles with encrypted-at-rest PII (blind-indexed national ID and phone), manual KYC / AML status, KYC document review.
* **Loan products & loans** — flat and reducing-balance products with credit-rating pricing policies, NBC interest-rate cap (18%), approval with maker-checker, disbursement with origination fees, write-off, restructuring, collateral, guarantors, interactions, documents (S3).
* **Repayments** — idempotent posting, reversals, penalties (daily cron), payoff quotes, KHQR static payment QR per tenant / branch.
* **Agreements** — key facts statement with EIR / total cost of credit and e-signature (hash-anchored).
* **Risk & credit** — internal scorecard, Credit Bureau Cambodia (CBC) checks (sandbox when not configured).
* **Finance** — dual currency (USD / KHR) with FX rates, general ledger with trial balance, NBC loan-loss provisioning runs, KPIs, portfolio-at-risk dashboard and reports, CSV / Excel exports.
* **Collections** — overdue queue and promise-to-pay tracking.
* **Borrower portal** — phone + OTP sign-in, loan view, e-KYC uploads, agreement signing.
* **Telegram bot** — per-tenant bot for borrower notifications and reminders.

---

## Configurable lending platform

Built as a modular monolith inside the same API. Detailed design in
[`docs/lending/`](docs/lending):
[architecture](docs/lending/ARCHITECTURE.md) ·
[access control](docs/lending/ACCESS_CONTROL.md) ·
[restructuring](docs/lending/RESTRUCTURING.md) ·
[capability matrix](docs/lending/CAPABILITY_MATRIX.md) ·
[operations & demo](docs/lending/OPERATIONS.md) ·
[reference cases](docs/lending/REFERENCE_CASES.md).

### Product catalogue

* **10 loan families, 55 product templates** — personal / consumer, property,
  vehicle / assets, education, microfinance, SME / commercial, agriculture,
  corporate / project, trade / receivables, institutional / public — plus Murabaha
  and Ijarah as separate structures.
* Secured / unsecured, fixed / floating rate, green purpose, digital channel and
  recourse type are separate attributes.
* Templates that need a capability the engine does not yet have (credit cards,
  BNPL, factoring, forfaiting, revolving facilities, construction drawdowns,
  group lending, syndicated / project finance, income-contingent, Islamic
  structures, …) are seeded **unavailable**: a product cannot be activated while
  any required capability is missing. See the
  [capability matrix](docs/lending/CAPABILITY_MATRIX.md) (generated from code).

### Products, versions and agreements

* Products are configured through a validated, strict schema (identity and
  eligibility, pricing, fees and taxes, penalties, repayment, prepayment and
  settlement, allocation order, security and LTV, documents and conditions,
  delinquency buckets and collection stages, restructuring rules, accounting
  mapping, integrations). Configuration selects engine behaviour; it can never
  contain code.
* Lifecycle `Draft → Submitted → Approved → Active → Retired` with maker-checker;
  approved versions are immutable (also enforced by a database trigger) and
  changes create a new version, reviewed through a configuration diff.
* Every booked loan keeps an immutable agreement snapshot of the product version
  and negotiated terms; product edits never change existing agreements.
  Amendments (prepayment recasts, restructures) are new agreement versions.

### Calculation engine (`packages/shared/src/lending`)

Equal instalments (annuity, including zero rate), equal principal, flat interest,
interest-only with bullet, balloon, seasonal / explicitly dated schedules,
principal and interest grace with capitalization, irregular first periods with
actual-interval interest, weekly / fortnightly / monthly / quarterly / custom
frequencies, holiday calendars with business-day adjustment, nominal vs
effective rate conventions, ACT/365F · ACT/360 · ACT/ACT ISDA · 30/360 ISDA ·
30E/360 day counts (others rejected), daily accrual, upfront fees (deducted /
financed / separately collected) with tax, effective annual rate (XIRR),
prepayment with recast or shortened tenor, configurable payment allocation,
currency-specific minor units and rounding with final-instalment residuals.
Floating-rate pricing re-prices booked loans on their reset cycle: the
benchmark observed on or before each reset date, plus the margin, bounded by
the product's floor and cap. A reset takes effect from the next interest
period, keeps the balance and remaining term, and applies exactly once per
reset date; missed resets catch up oldest first, each at the benchmark that
applied then. Instalments beyond the next reset are marked **projected**, never
contractual. Every calculation records its inputs, product and engine versions,
rate sources, rounding rule and an operator-readable explanation.

### Lending operations

Application and documents → assessment (KYC, eligibility, debt-service ratio,
collateral LTV with haircuts and valuation age, guarantors) → recommendation →
approval within authority (configurable multi-level approvals) → booking →
conditions precedent → disbursement (prepare / approve / execute) → daily
accrual and capitalization → repayment and partial prepayment → penalties,
delinquency buckets and collection stages → early settlement with cash rounding
→ reversal → write-off (propose / approve) → closure.

Every money movement is an immutable financial event with balanced double-entry
postings in the same transaction, idempotency keys, per-loan locking and
optimistic concurrency, reversal entries instead of deletes, business-date
controls, and sub-ledger ↔ general-ledger reconciliation.

### Restructuring and hardship

Customer self-service requests (borrower portal), staff requests on a documented
customer request, collections and credit-review cases, and system referrals →
evidence and affordability assessment (individual, household, business DSCR and
seasonal templates, configurable buffers and thresholds; insufficient capacity
routes to specialist review) → side-effect-free option simulation and
comparison (term extension, payment deferral, interest-only, rate reduction,
seasonal alignment, due-date change, balloon, arrears rescheduling, permitted
capitalization, waivers, separately controlled principal forgiveness; term
solved from a sustainable payment capacity, never negative amortization) →
proposal → approval with concession authority (separate from) customer
acceptance → execution with balance revalidation → monitoring and probation.
Original agreements, schedules and arrears history are preserved, and
delinquency is not reset by a restructure. See
[RESTRUCTURING.md](docs/lending/RESTRUCTURING.md).

### Access control

Action-based RBAC with 14 seeded roles (platform administrators get no tenant
data or approval rights), ABAC on trusted server-side attributes (branch /
portfolio / legal-entity scope, maker-checker, approval authority by currency
with approved-FX conversion, MFA, workflow state, constrained tenant policies),
feature flags with deterministic precedence and emergency-off (availability only
— a flag never grants access), delegations with expiry, tenant-bound service
accounts, a capabilities endpoint for the UI, and a side-effect-free policy
simulator answering *"can this user do this to this loan, and why?"*. See
[ACCESS_CONTROL.md](docs/lending/ACCESS_CONTROL.md).

Group lending adds solidarity groups: formation, leadership and member
tenure, equal or negotiated shares, and joint liability for the whole balance
rather than a share of it. Liability is frozen onto the loan at booking, so a
later membership change never alters a contract already running.

A loan can also be closed for less than it owes: a negotiated settlement
itemises the concession by component, posts it as an expense rather than
letting a receivable vanish, and authorizes forgiving principal separately
from waiving charges. Money arriving after a write-off is posted as a
recovery, attributed against what was written off, without reviving the loan.

### Administration screens

Under **Lending** in the web app: product catalogue and capability matrix,
product configuration wizard, pricing and repayment simulator, version diff and
approvals, workflow builder, roles and permissions, ABAC policy editor, feature
flags, access-policy simulator, applications, loan accounts, servicing and
collections, accounting reconciliation, audit explorer, and restructuring cases.
The borrower portal adds restructure requests and proposal acceptance.

### What is not implemented yet

Refinancing, stand-alone payment holidays, borrowing bases, connected-party
exposure, break-glass access and the specialised modules (cards, BNPL, trade,
factoring, income-contingent, syndicated, project finance, Islamic) are still
outstanding. Revolving facilities, overdrafts, staged drawdowns, contractual
floating-rate resets, joint-liability group lending, negotiated settlement and
post-write-off recovery shipped in Phase 2. Payment rails,
external KYC, credit bureau, notifications and external accounting have adapter
interfaces with clearly labelled mocks that are refused in production. The full
list of gaps and limitations is in [OPERATIONS.md](docs/lending/OPERATIONS.md).

---

## Local development

### Prerequisites

* Node.js 20+ (22 recommended) and pnpm 9 (`npm install -g pnpm@9`)
* PostgreSQL 14+

### Setup

```bash
pnpm install
cp .env.example .env
# Fill at least: DATABASE_URL, JWT_ACCESS_SECRET (≥32 chars), JWT_REFRESH_SECRET (≥32),
# JWT_REFRESH_TOKEN_PEPPER (≥16), CORS_ORIGINS. Production also needs REDIS_URL and the AWS_* S3 settings.

pnpm --filter @microloan/db build       # prisma generate
pnpm --filter @microloan/shared build
pnpm db:migrate:deploy
pnpm db:seed                            # dev: sample data; staging/production: platform superadmin only
pnpm dev                                # API http://localhost:3001  ·  web http://localhost:3000
```

The API synchronises the lending catalogue (families, templates, permissions,
feature flags) on boot. For a ready-made lending demo organisation with a user
per role and five active products:

```bash
pnpm demo:lending
```

Walkthrough and credentials: [OPERATIONS.md](docs/lending/OPERATIONS.md#demo-data).

### Tests and checks

```bash
pnpm test                 # lint + typecheck + prisma validate (turbo)
pnpm test:engine          # lending engine: decimal reference cases, restructuring, configuration
pnpm test:api             # API unit tests (incl. decision-engine security tests)

# Lending integration tests against a real PostgreSQL (throwaway DB; name must contain "test" or "ci")
export LENDING_TEST_DATABASE_URL=<postgres connection string>
pnpm test:lending:db      # reset + schema + database invariants (triggers, RLS)
pnpm test:lending:int     # Phase 1, security, restructuring, facilities, floating rates, groups, settlement

pnpm docs:capabilities    # regenerate docs/lending/CAPABILITY_MATRIX.md from code
```

Security and production-readiness checks (also run in CI):

```bash
pnpm run security:scan-hardcodes
pnpm run security:scan-timebombs
pnpm run security:scan-memory-stores
pnpm run security:prod-config-check
```

---

## Repository layout

```
apps/
  api/                 NestJS API (core modules + src/lending)
    test/lending/      lending integration suites (real HTTP API + PostgreSQL)
  web/                 Next.js web app (staff app, lending admin, borrower portal)
packages/
  db/                  Prisma schema, migrations, seed, lending demo seed
  shared/              shared domain logic and the lending engine (+ engine tests)
docs/lending/          lending platform documentation
scripts/               security scans, production config check, lending test-DB and capability-matrix tools
```

---

## Deployment

Production runs on Railway (API and web as separate services from this
repository; see [DEPLOYMENT.md](DEPLOYMENT.md) for the runbook, current
environment layout and the backup caveat).

* **API** — root `apps/api`; `start:prod` runs `prisma migrate deploy`, then the
  seed, then the server; health check `GET /v1/health`.
* **Web** — root `apps/web`; set `NEXT_PUBLIC_API_URL` / `API_URL` to the API's `/v1` URL.
* Required API variables: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
  `JWT_REFRESH_TOKEN_PEPPER`, `CORS_ORIGINS`, `REDIS_URL`, `AWS_*`, `NODE_ENV=production`;
  recommended `FIELD_ENCRYPTION_KEY`; optional lending variables are listed in `.env.example`.
* The Phase 1 lending migration (`20261016_lending_platform_phase1`) is
  additive and was rehearsed against the production schema with no drift — but
  there is no staging environment, so take a database snapshot before
  deploying it.
* The rate-reset (`20261017_lending_rate_resets`) and group-liability
  (`20261017_lending_group_liability`) migrations are additive — new tables,
  and columns that are all nullable or defaulted — but have not been run
  against a production-shaped database; their invariants run in CI through
  `scripts/lending-test-db.mjs`.
* The facilities migration (`20261017_lending_facilities_phase2`) has **not**
  been rehearsed against a production-shaped database. Its invariants
  (constraints, triggers, row-level security) run in CI through
  `scripts/lending-test-db.mjs`, but its `DROP TABLE` / `CREATE TABLE` of
  `Facility` and `Drawdown` has not been executed anywhere. Those two tables
  shipped in Phase 1 as structure only and no code path ever wrote to them, so
  they are expected to be empty — confirm that against the target database
  (`SELECT count(*) FROM "Facility"; SELECT count(*) FROM "Drawdown";`) before
  applying it, because the migration discards their contents.
