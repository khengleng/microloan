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
* **35 of the 55 templates are available** today. A template that needs a
  capability the engine does not have is seeded **unavailable**, and a product
  cannot be activated while any required capability is missing — the guard is
  enforced at activation, not documented and hoped for.
* Currently unavailable: credit cards, BNPL, income-contingent education,
  inventory-backed lending, syndicated / project / infrastructure / acquisition
  finance, import and export finance, invoice finance, factoring, supply-chain
  finance, forfaiting, interbank / municipal / sovereign / concessional
  lending, Murabaha and Ijarah. See the
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

### Facilities

Three limit-based products sit beside term lending, sharing one servicing
path: the drawn balance lives on an ordinary loan account, so repayment,
delinquency, reconciliation and the ledger are the same code.

| Type | Limit reinstates on repayment | Drawdowns | End of availability |
|---|---|---|---|
| Revolving | yes | repeated | terms out, if configured |
| Overdraft | yes | continuous balance | repayable on demand |
| Staged drawdown | **no** | tranches, released in full | terms out |

Interest is charged on the drawn balance day by day, never on the limit, using
the same daily accrual as a term loan; a balance above the limit is priced
separately so the penalty element is visible, and is refused outright when no
over-limit rate is configured. A commitment fee is priced the same way on the
undrawn amount. Drawdowns are maker-checker with one in flight at a time, and
the limit is re-checked against committed movements at request, at approval
and again at release. A staged tranche releases in full or not at all, on or
after its date, with every condition precedent satisfied with evidence or
waived as a credit concession. A limit cannot be cut below what is already
drawn.

### Group lending

Solidarity groups with formation, leadership and member tenure, equal or
negotiated shares, and **joint liability for the whole balance rather than a
share of it** — a member's share records what they agreed to carry, never what
they can be pursued for. Liability is frozen onto the loan at booking, so a
later membership change cannot alter a contract already running. Affordability
is assessed on the group's combined income, because one instalment is serviced
by every member together. A surplus from one member covers another's shortfall
and the group is current; per-member positions are still reported, because that
is what the group meeting acts on. Exit is governed by whether a live loan
names the member, not by the balance: a loan booked but not yet disbursed owes
nothing and still binds everyone on it.

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

### Settlement, recovery, relief and refinancing

**Negotiated settlement** closes a loan for less than it owes. The concession
is itemised by component and posted to an expense account — principal
forgiveness and charge concessions to different ones — so the loss appears in
the ledger instead of being implied by a receivable that stopped existing. By
default the payment recovers principal first, so the concession falls on
charges; that is deliberately the opposite of the ordinary repayment order,
which clears penalties first. Forgiving principal is a separate action with its
own approval authority, measured on the concession rather than the cash
received, and a settlement that would forgive a component the product has not
permitted is refused outright.

**Recovery after write-off** posts money arriving on a loan already written
off. The balance is zero, so the cash is income, attributed against what *was*
written off, principal first. The loan stays written off — recovering part of a
loss does not make a loan perform again.

**Payment holidays** are published programmes, not hardship cases: eligibility
is evaluated from recorded loan state and never from a justification, every
refusal returns its reasons, and publishing one is maker-checker. The programme
must state what happens to the interest (only waiving it is free; capitalizing
it grows the debt) and to the term (extend maturity, or keep it and make the
later instalments heavier).

**Refinancing** settles the replaced loan from the new one's proceeds in the
same transaction as its disbursement — a disbursement that landed without the
payoff would leave the borrower owing twice. The supervisory part matters more
than the arithmetic: each refinance records how much of the payoff was arrears,
how much of those arrears the **new loan** funded rather than the borrower, and
how delinquent the replaced loan was. Those two conditions together are
evergreening, and permitting a delinquent refinance and permitting arrears
roll-in are separate product settings.

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

### Administration screens

Under **Lending** in the web app: product catalogue and capability matrix,
product configuration wizard, pricing and repayment simulator, version diff and
approvals, workflow builder, roles and permissions, ABAC policy editor, feature
flags, access-policy simulator, applications, loan accounts, servicing and
collections, accounting reconciliation, audit explorer, and restructuring cases.
The borrower portal adds restructure requests and proposal acceptance.

#### Servicing beyond the basics

* **Advances and non-accrual** — money paid before it is due is held as an
  advance and applied on the due date, so an early payer is never late;
  loans past the product's non-accrual threshold hold interest in suspense
  instead of income until they cure.
* **Composable loan policies** — prepayment and lock-in charges, late
  charges, allocation and non-accrual are versioned policies in a governed
  library; products offer menus, contracts are composed and frozen at
  booking ([POLICY_MODEL.md](docs/servicing/POLICY_MODEL.md)).
* **Unidentified payments** — money with no loan goes to suspense, is
  matched to loans or refunded under maker-checker; advances can be refunded.
* **Impairment** — a tenant policy (regulatory class rates or ECL = PD × LGD
  × EAD by stage) approved by risk; end of day posts each loan's change in
  allowance, write-off uses it, closure releases it.
* **Collateral on running loans** — revaluation and margin calls, more
  collateral, release after closure; combined LTV behind prior liens.
* **Late charges and payments** — flat, percentage or penalty-interest late
  charges with caps per instalment and per loan; returned-payment fee;
  third-party payers; group repayments split by member; fee waivers under
  maker-checker; Rule of 78 and actuarial payoff rebates for flat loans.
* **Facilities** term out into an amortizing schedule, and unpaid minimum
  payments are aged like any arrears.

Every Phase 2 and servicing capability now has a web screen: facilities,
groups, the policy library, unidentified payments, relief programmes,
operations (business date and end of day, benchmark rates, holiday
calendars, impairment policy, integrations), and on the loan screen
advances, non-accrual, settlement and negotiated settlement, recoveries,
refunds, fee waivers, payment holidays, rate resets, group repayments,
collateral and refinancing. The product editor covers the new settings.

### Web workspace: target design and current state

The target UI is described in [docs/ui/WORKSPACE_DESIGN.md](docs/ui/WORKSPACE_DESIGN.md),
with an interactive prototype in
[docs/ui/workspace-prototype.html](docs/ui/workspace-prototype.html) (open it in
a browser and pick a role). In short: one workspace whose menus, home queue and
buttons are computed from the lending permission engine, so each of the 14
access roles, the borrower and the platform operator sees exactly the work
that is theirs, and every disabled action says why.

Measured against that design, the web app today:

| Area | Status | Gap |
|---|---|---|
| Navigation | ⛔ | Gated by legacy role names (`ADMIN`/`FINANCE`/`SALES`); most canonical roles see almost nothing, and the lending section is shown to everyone |
| Home | ⛔ | Same KPI dashboard for every role; no "waiting for me" queues or badges |
| Search | ⛔ | No global search across borrowers, loans, applications and cases |
| Explaining refusals | 🟡 | Lending applications, loans and product versions show the policy reason on disabled buttons; restructure cases, facilities and legacy pages do not; the browser treats unknown actions as allowed |
| Scope, authority, MFA, delegation in the shell | ⛔ | Enforced by the API but invisible until an action is refused |
| Duplicate screens | 🟡 | Two loan lists, collections, accounting, audit, products and team pages (legacy and lending) |
| Phase 2 screens | ✅ | Facilities, groups, policy library, unidentified payments, relief programmes, operations, and the servicing panels on the loan screen |
| Role management | 🟡 | `/users` assigns only legacy roles; access roles are assigned separately under Lending › Access |
| Khmer | 🟡 | Legacy screens and the portal page are translated; lending, accounting, FX, provisioning, KPI and audit screens are English only |
| Borrower portal | 🟡 | Sign-in, loans, KHQR, documents, signing and relief acceptance work; one-time codes need an SMS provider; payment-holiday programmes are not offered |
| Platform console | ✅ | Organisations, plan payments, plans, team and audit; platform flag rules are API-only |

The design needs three API additions first: `GET /me/access` (effective
permissions, scope, authorities, delegations, MFA, flags), `GET /me/work`
(queue counts), and capabilities for restructure cases, facilities, groups and
tenant actions.

### What is implemented, and what is not

The [capability matrix](docs/lending/CAPABILITY_MATRIX.md) is generated from
code (`pnpm docs:capabilities`) and is the authoritative answer. A product
version can only be activated when every capability it requires is fully
implemented, so the matrix is enforced, not aspirational. As it stands:

| | Count |
|---|---|
| ✅ Fully implemented | 43 |
| 🔌 Requires integration (adapter ships, no real provider) | 5 |
| ⛔ Not implemented | 17 |

**Needs a third-party provider** — payment rails, external KYC, credit bureau,
notifications and external accounting have adapter interfaces with clearly
labelled mocks that are refused in production. These stay at "requires
integration" until a real provider is wired and tested; the matrix will not
claim otherwise.

**Still to build** — borrowing bases, connected-party exposure, break-glass
access, and the specialised modules: credit cards, BNPL, trade and invoice
finance, factoring, forfaiting, supply-chain finance, income-contingent
education, syndication, project finance, institutional counterparty limits,
Murabaha and Ijarah.

Known limitations of what *is* implemented are listed in
[OPERATIONS.md](docs/lending/OPERATIONS.md) and, item by item, in
[TRACEABILITY.md](docs/servicing/TRACEABILITY.md).

---

## Scope coverage: loan servicing use cases

The full servicing scope (24 loan types, 75 use cases, 8 operations areas,
10 document-management items and 20 golden test vectors) is in
[docs/servicing/USE_CASES.md](docs/servicing/USE_CASES.md) and
[docs/servicing/TEST_VECTORS.md](docs/servicing/TEST_VECTORS.md). Each item is
traced to code, tests and a status in
[docs/servicing/TRACEABILITY.md](docs/servicing/TRACEABILITY.md).

| Group | ✅ Done | 🟡 Partial | ⛔ Missing | Total |
|---|---|---|---|---|
| Loan types | 12 | 8 | 4 | 24 |
| Use cases | 46 | 8 | 21 | 75 |
| Operations | 3 | 5 | 0 | 8 |
| Customer documents | 10 | 0 | 0 | 10 |
| Test vectors | 19 match to the cent | 1 engine only (invoice finance) | 0 | 20 |

**Strong today:** every schedule method and golden test vector, configurable
allocation with advances, both prepayment options with lock-in charges and
waivers, Rule of 78 / actuarial rebates, composable loan policies,
non-accrual and impairment (regulatory or ECL), suspense and refunds,
restructuring, payment holidays, refinance, negotiated settlement, write-off
and recovery, floating-rate resets, facilities with term-out and arrears,
group lending with member contributions, collateral margin calls and release,
maker-checker throughout, an automatic end-of-day run, one customer
document library (object storage, review by another user, versions, expiry
reminders, retention and legal hold, audited short-lived downloads, filed
key facts and letters, portal requests), and a tested tenant
wall ([TENANT_ISOLATION.md](docs/security/TENANT_ISOLATION.md)).

**Largest remaining gaps, by risk to money owed** (full list in
[TRACEABILITY.md](docs/servicing/TRACEABILITY.md)):

1. No collection escalation engine or collector work queues in the lending
   stack; no guarantor demand or set-off (UC-58, UC-60, UC-61).
2. Payment channels beyond manual and service-account posting: auto-debit,
   wallet settlement files, payroll files, cross-currency (UC-16..21).
3. Recovery workflows: repossession, pawn forfeiture, credit insurance, debt
   sale (UC-65, UC-66, UC-68, UC-71).
4. Down payment and third-party disbursement (UC-02, UC-05, UC-35).

Not started: credit cards, BNPL merchant settlement, invoice finance, letters
of credit, syndication, credit bureau reporting,
promotional rates.

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
pnpm test:engine          # lending engine: decimal reference cases, golden test vectors TV-01..TV-20, restructuring, configuration
pnpm test:api             # API unit tests (incl. decision-engine security tests)

# Lending integration tests against a real PostgreSQL (throwaway DB; name must contain "test" or "ci")
export LENDING_TEST_DATABASE_URL=<postgres connection string>
pnpm test:lending:db      # reset + schema + database invariants (triggers, RLS) + the unprivileged app role
pnpm test:lending:int     # every lending suite, then the tenant-wall suite last (WALL_STRICT=1)

pnpm docs:capabilities    # regenerate docs/lending/CAPABILITY_MATRIX.md from code
```

The integration suites connect as `lending_app_test`, a `NOSUPERUSER
NOBYPASSRLS` role created by `test:lending:db`, so row-level security is
actually exercised. The tenant-wall suite replays every registered route as
another tenant and fails if any row of another tenant changes or leaks — see
[TENANT_ISOLATION.md](docs/security/TENANT_ISOLATION.md).

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
docs/ui/               web workspace design and interactive prototype
docs/servicing/        servicing scope, golden test vectors, traceability, decisions, policy model
docs/security/         tenant isolation: the walls, their tests, what is open
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
* The servicing build-out migrations (`20261018000001` … `20261018000006`:
  loan policies, advances and non-accrual; row-level security on the
  remaining lending tables; the Telegram bot-token hash; unidentified
  payments; impairment; collateral servicing) are additive — new tables, and
  columns that are nullable or defaulted; `FinancialEvent.loanAccountId` and
  the lending journal's `loanAccountId` become nullable for tenant-level
  receipts. Their invariants run in CI. They have not been run against a
  production-shaped database: take a snapshot first.
* **Database role.** Row-level security does nothing for a superuser or a
  `BYPASSRLS` role, and Railway's default user is `postgres`. Run the API as a
  `NOSUPERUSER NOBYPASSRLS` role that does not own the tables (migrations keep
  running as the owner) and set `DB_ROLE_MUST_RESPECT_RLS=true`; until then the
  API logs an error at startup. See
  [TENANT_ISOLATION.md](docs/security/TENANT_ISOLATION.md).
* **Impairment** posts nothing until finance proposes and risk approves a
  policy (Lending › Operations › Impairment policy; DECISIONS D-010).
