# Magic Money — multi-tenant lending platform

Magic Money is a multi-tenant, Khmer/English lending operations platform for
Cambodian lenders (MFIs, digital lenders and banks). One deployment serves many
lending organisations (tenants), each isolated from the others at the
application, query and database level.

**Staff using the web portal**: the end-user manual (sign-in, roles and
approvals, origination to closure, collections, accounting, reports,
administration, and a guided demo) is in [`docs/user-guide/`](docs/user-guide/README.md).

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
* **Risk & credit** — internal scorecard; Credit Bureau Cambodia (CBC) checks only once CBC credentials (`CBC_API_URL` / `CBC_API_KEY`) are configured — until then the check answers "CBC integration is not ready." and there is no sandbox.
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
* **46 of the 56 templates are available** today. A template that needs a
  capability the engine does not have is seeded **unavailable**, and a product
  cannot be activated while any required capability is missing — the guard is
  enforced at activation, not documented and hoped for.
* Currently unavailable: income-contingent education, inventory-backed
  lending, project / infrastructure / acquisition finance, interbank /
  municipal / sovereign / concessional lending and Murabaha. See the
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
* **Regulatory returns** — one monthly NBC-style return for the lending and
  legacy loans together (classification and provisioning, PAR, breakdowns,
  write-offs and recoveries, largest borrowers, rates against the cap),
  generated from a closed month, reconciled to both ledgers, immutable and
  versioned, submitted under maker-checker, CSV and Excel export; a combined
  trial balance of both journals; and a flag that closes the legacy book to
  new business ([OPERATIONS.md](docs/lending/OPERATIONS.md)). Gender, sector
  and related-party data are not captured yet (DECISIONS D-045..D-049).
* **Collateral on running loans** — revaluation and margin calls, more
  collateral, release after closure; combined LTV behind prior liens.
* **Late charges and payments** — flat, percentage or penalty-interest late
  charges with caps per instalment and per loan; returned-payment fee;
  third-party payers; group repayments split by member; fee waivers under
  maker-checker; Rule of 78 and actuarial payoff rebates for flat loans.
* **Facilities** term out into an amortizing schedule, and unpaid minimum
  payments are aged like any arrears.
* **Disbursement** — minimum down payments collected before payout, payout
  split between seller, dealer, school, previous lender or the borrower, and
  consolidation loans that settle the borrower's other loans from the proceeds.
* **Pricing and schedules** — promotional campaign rates, stepped (graduated
  or step-down) instalments, payoff letters good through a date and takeover
  quotes for another lender; a rescheduling prepayment can be reversed.
* **Collections** — an escalation ladder per product (SMS, call, visit,
  notice, legal review) feeding collector work queues; guarantor demands and
  payments; set-off of the borrower's deposit under maker-checker.
* **Webhooks** — the organisation's lending events (disbursed, repaid,
  closed, arrears notices, covenant breaches, month-end ready…) delivered to
  its own systems, signed and retried, activated by a second administrator;
  Lending › Webhooks.
* **Loan-book migration** — take over running loans from another system:
  a CSV checked row by row (products, branches, customers, schedules) and
  against control totals, approved by a second person, posted with opening
  balances that reconcile; Lending › Migration.
* **Month-end and year-end close** — month end is a stage of end of day:
  checks, a frozen snapshot of the books and the portfolio, a lock approved
  by a second person (enforced in the posting service and the database),
  reopening under maker-checker, and year-end close into retained earnings;
  Lending › Period close.
* **Customer outputs and reporting** — statements for any period, due-soon
  and overdue notices, closure letters, the credit bureau file and a
  general-ledger export.
* **Underwriting and commercial loans** — configurable, versioned scorecards
  under maker-checker (defaults shipped as templates), a per-product decision
  strategy (grade outcomes, knock-outs, limits and risk pricing by grade), a
  silent champion/challenger, every score stored with its inputs and
  explained, scorecard monitoring (bad rate, Gini, KS, PSI) on the lender's
  own data; DSCR gate, and DSCR / LTV / financial-statement covenants with
  breach, cure and waiver.
* **Alternative data for thin-file borrowers** — per-source consent with
  revocation, the lender's own repayment / KHQR-wallet / group-contribution
  history, officer-captured utility, telco, rent and cash-flow data verified
  by a second person, and a thin-file scorecard. Smartphone, telco and
  e-wallet providers are adapter interfaces only (requires integration).
* **Recovery** — repossession, pawn custody and auction, credit insurance
  claims and debt sale.
* **Payment channels** — direct-debit mandates and auto-debit (mock bank),
  settlement and payroll files with daily reconciliation, cross-currency
  payments with FX gain/loss.
* **Specialised products** — credit cards (grace period, cash advances,
  instalment plans), BNPL with merchant settlement and refunds, Ijarah
  leases, invoice finance with recourse, letters of credit and syndicated
  loans; facility over-limit allowance and fee, and annual renewal.
* **Customer documents** — one library with review, versions, expiry,
  retention, legal hold and audited short-lived downloads.

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
| Navigation | ✅ | Menus are computed from `GET /v1/me/access` (lending permissions) plus the legacy screens' own permissions, so each access role sees its own work and the lending section is hidden from people with no lending permission; lending sub-tabs follow the same rules; queue badges come from `/me/work` |
| Home | ✅ | `/home` shows the person's queues from `GET /v1/me/work` (counts, oldest items, deep links, "you approve" / "needs MFA" / "above your limit"); the KPI dashboard stays in the menu for those who had it, and people without lending permissions still land on it |
| Search | ✅ | `GET /v1/search` and a search box in the top bar (`/` or Ctrl/⌘-K): borrowers by name, phone or national ID (blind index), loans, legacy loans, applications, facilities, cards and restructure cases by reference, within the caller's tenant and scope |
| Explaining refusals | 🟡 | Lending applications, loans and product versions show the policy reason on disabled buttons; restructure cases, facilities and legacy pages do not; the browser treats unknown actions as allowed |
| Scope, authority, MFA, delegation in the shell | ✅ | Top-bar chips for business date, scope, approval limit and sign-in strength; banners for "verify to approve" and delegated authority. No inline MFA step-up yet (the banner sends the person to sign in again) |
| Duplicate screens | 🟡 | Two loan lists, collections, accounting, audit, products and team pages (legacy and lending); the legacy ones are now grouped and labelled "Legacy", and the legacy book can be closed to new business (`lending.legacy_loans.readonly`) |
| Phase 2 screens | ✅ | Facilities, groups, policy library, unidentified payments, relief programmes, operations, and the servicing panels on the loan screen |
| Role management | 🟡 | `/users` assigns only legacy roles; access roles are assigned separately under Lending › Access |
| Khmer | 🟡 | Legacy screens, the portal page, the new menu, lending sub-tabs, home queues, shell chips and search are translated; the lending, accounting, FX, provisioning, KPI and audit screens themselves are English only |
| Borrower portal | 🟡 | Sign-in, loans, KHQR, documents, signing and relief acceptance work; one-time codes need an SMS provider; payment-holiday programmes are not offered |
| Platform console | ✅ | Organisations, plan payments, plans, team and audit; platform flag rules are API-only |

The workspace runs on three endpoints: `GET /v1/me/access` (effective
permissions, scope, authorities, delegations, MFA, flags, with platform and
borrower-portal variants), `GET /v1/me/work` (queue counts and oldest items,
scope-filtered and maker-checker aware) and `GET /v1/search`. Still to come:
capabilities for restructure cases, facilities, groups and tenant actions, and
a fail-closed browser capability check.

### What is implemented, and what is not

The [capability matrix](docs/lending/CAPABILITY_MATRIX.md) is generated from
code (`pnpm docs:capabilities`) and is the authoritative answer. A product
version can only be activated when every capability it requires is fully
implemented, so the matrix is enforced, not aspirational. As it stands:

| | Count |
|---|---|
| ✅ Fully implemented | 67 |
| 🔌 Requires integration (adapter ships, no real provider) | 8 |
| ⛔ Not implemented | 2 |

**Needs a third-party provider** — payment rails, external KYC, credit bureau,
notifications and external accounting have adapter interfaces with clearly
labelled mocks that are refused in production. These stay at "requires
integration" until a real provider is wired and tested; the matrix will not
claim otherwise. Alternative-data providers (smartphone, telco, e-wallet) have
adapter interfaces and encrypted configuration but no mock at all: their
inputs stay missing until a real adapter is added.

**Still to build** — borrowing bases, connected-party exposure, break-glass
access, and the remaining specialised modules: income-contingent education,
project finance, institutional counterparty limits and Murabaha. Credit
cards, BNPL, Ijarah leases, invoice financing with recourse, import letters
of credit and syndicated loans are implemented; their assumed rules are in
DECISIONS D-024..D-034. Factoring, supply-chain finance, forfaiting and
import / export loans against trade documents are implemented too
(DECISIONS D-055..D-059).

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
| Loan types | 24 | 0 | 0 | 24 |
| Use cases | 74 | 1 | 0 | 75 |
| Operations | 7 | 1 | 0 | 8 |
| Customer documents | 10 | 0 | 0 | 10 |
| Test vectors | 20 match to the cent | 0 | 0 | 20 |

**Strong today:** every schedule method and golden test vector, configurable
allocation with advances, both prepayment options with lock-in charges and
waivers, Rule of 78 / actuarial rebates, composable loan policies,
non-accrual and impairment (regulatory or ECL), suspense and refunds,
restructuring, payment holidays, refinance, negotiated settlement, write-off
and recovery, floating-rate resets, facilities with term-out and arrears,
group lending with member contributions, collateral margin calls and release,
recovery workflows (repossession, pawn custody and auction, credit insurance
claims, debt sale), maker-checker throughout, an automatic end-of-day run, one customer
document library (object storage, review by another user, versions, expiry
reminders, retention and legal hold, audited short-lived downloads, filed
key facts and letters, portal requests), and a tested tenant
wall ([TENANT_ISOLATION.md](docs/security/TENANT_ISOLATION.md)).

**Remaining gaps** (full list in
[TRACEABILITY.md](docs/servicing/TRACEABILITY.md)):

1. Auto-debit, SMS, KYC and credit-bureau submission run on mock adapters
   that production refuses (UC-16 and the integration rows of the
   capability matrix).
2. Borrower notices are produced on demand, not sent by the end-of-day
   batch (OPS-4).
3. Several money rules are documented assumptions awaiting product-owner,
   finance or Sharia sign-off (DECISIONS D-011..D-034).

End-to-end QA journeys (onboarding → KYC → application → approval →
disbursement → servicing → closure) for every loan type are in
`apps/api/test/lending/e2e/` and the module specs; the scenario matrix is
[docs/servicing/SCENARIOS.md](docs/servicing/SCENARIOS.md).

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

Browser tests (Playwright, Chromium) against a full local stack on ports
3030/3031 — see [DEPLOYMENT.md › Browser tests](DEPLOYMENT.md#browser-tests):

```bash
node scripts/e2e-stack.mjs up && pnpm --filter e2e test
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

* **API** — the start command runs `prisma migrate deploy` as the table owner
  (`MIGRATION_DATABASE_URL`), then the server; readiness check
  `GET /v1/health/ready`. Build, start and healthcheck are in
  `apps/api/railway.json` (and `apps/web/railway.json` for the web).
* **Web** — set `NEXT_PUBLIC_API_URL` / `API_URL` to the API's `/v1` URL.
* Required API variables: `DATABASE_URL`, `MIGRATION_DATABASE_URL`,
  `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_TOKEN_PEPPER`,
  `CORS_ORIGINS`, `REDIS_URL`, `FIELD_ENCRYPTION_KEY`, `DOCUMENT_LINK_SECRET`,
  `SERVICE_KEY_PEPPER`, `NODE_ENV=production` (the api refuses to boot in
  production without the last three); optional variables are listed in
  `.env.example`.
* **Migrations build a database from empty** (baseline migration
  `00000000000000_baseline`). A database that existed before it must be marked
  once with `scripts/mark-baseline-applied.mjs` — see DEPLOYMENT.md.
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
* The payment-channels migration (`20261019000300_lending_payment_channels`:
  mandates, auto-debit attempts, channel files and lines, channel settings) is
  additive — new tables only, with CHECKs, an immutability trigger on imported
  lines and forced RLS. Two ledger accounts (1050 FX position, 4400 FX
  gain/loss) are added to the chart on first use.
* **Database role.** Row-level security does nothing for a superuser or a
  `BYPASSRLS` role, and Railway's default user is `postgres`. Run the API as a
  `NOSUPERUSER NOBYPASSRLS` role that does not own the tables (migrations keep
  running as the owner) and set `DB_ROLE_MUST_RESPECT_RLS=true`; until then the
  API logs an error at startup. `ops/db/app-role.sql` creates that role and
  the default privileges that grant it every table a later migration adds. See
  [TENANT_ISOLATION.md](docs/security/TENANT_ISOLATION.md).
* **Impairment** posts nothing until finance proposes and risk approves a
  policy (Lending › Operations › Impairment policy; DECISIONS D-010).
