# Lending platform — setup, demo and operations

## Setup (local)

Prerequisites: Node 20+ (22 recommended), pnpm 9, PostgreSQL 14+.

```bash
pnpm install
cp .env.example .env               # set DATABASE_URL, JWT_* secrets, CORS_ORIGINS …
pnpm --filter @microloan/db build  # prisma generate
pnpm --filter @microloan/shared build
pnpm db:migrate:deploy             # applies the lending migrations (see "Migrations" below)
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
password `$DEMO_PASSWORD`, or a random one the run prints when it is unset —
users created by an earlier run keep theirs), branch-scoped relationship
officers, approval authorities, the `KH` holiday calendar, the five Phase 1
products already approved by a different checker and active, and verified
borrowers. It refuses to run in production unless `DEMO_SEED_ALLOW=true`.
It also registers five institutional counterparties (two banks, a
municipality, a sovereign and a development bank, all in `KH`) with approved
counterparty limits and a `KH` country limit, so the interbank, municipal,
sovereign and development products can be originated straight away.

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
pnpm test:lending:int     # Phase 1, security, restructuring, facilities, floating, groups, settlement, relief
```

The integration suite includes end-to-end journeys (`apps/api/test/lending/e2e/`)
that take a customer from onboarding to closure for every available loan
type; see [docs/servicing/SCENARIOS.md](../servicing/SCENARIOS.md) for the
scenarios, the use-case coverage matrix and the defects they found.

CI runs all three in the `lending-tests` job of `.github/workflows/security.yml`.

## End-of-day routine

1. Post the day's repayments and disbursements.
2. Advance the business date (at most 31 days per step): `POST /v1/lending/ops/business-date`.
3. Run the batch: `POST /v1/lending/loans/batch/run` — auto-debit collection
   under active mandates (first, so a collected instalment is never late), accrual, interest
   capitalization, penalties, delinquency buckets and collection stages,
   restructure monitoring and system referrals, and — once an impairment
   policy is approved — each loan's classification and the change in its loss
   allowance (see *Classification and provisioning* below). It is idempotent and processes
   only accounts in the caller's scope; each account is its own transaction.
4. Check reconciliation: `GET /v1/lending/ops/reconciliation` must report no breaks.

The scheduler (`EodSchedulerService`, LENDING_EOD_CRON, default 00:15 in
LENDING_EOD_TZ) does steps 2–3 automatically, a day at a time, on one instance.
Loans are processed `LENDING_EOD_CONCURRENCY` at a time (default 4, capped at
the connection pool size minus two); each loan is still its own transaction
with its row lock and compare-and-set. Sizing and measured throughput are in
[PERFORMANCE.md](PERFORMANCE.md).

## Monitoring

### Endpoints

| Path | Purpose | Access |
| --- | --- | --- |
| `GET /v1/health/live` | Liveness: the process answers. Never touches the database, so a database outage does not get instances restarted. | Public |
| `GET /v1/health/ready` | Readiness: `SELECT 1` within `READINESS_DB_TIMEOUT_MS` (default 2000). 503 `{status:"unavailable"}` otherwise, so the load balancer drains the instance. | Public |
| `GET /v1/health` | Unchanged minimal probe (`{status:"ok"}`). | Public |
| `GET /v1/metrics` | Prometheus text format. | `Authorization: Bearer $METRICS_BEARER_TOKEN` (at least 16 characters), or — with `METRICS_ALLOW_PRIVATE_NETWORK=true` — a direct request from a loopback/private address carrying no `X-Forwarded-For`/`Forwarded` header. Anything else gets 404. Unconfigured, the endpoint is closed. |

The metrics carry **aggregates only**: no label holds a tenant, user, loan,
branch or any other record id (tenants appear only as counts), and HTTP routes
are labelled with their pattern (`/v1/lending/loans/:id`), never the raw path.
`monitoring.int-spec.ts` scrapes after real activity and checks that no id of
any tenant, user, branch or loan appears anywhere in the body.

Gauges that need the database are refreshed by a periodic job on every
instance (`LENDING_METRICS_REFRESH_SECONDS`, default 60, minimum 10;
`LENDING_METRICS_REFRESH_DISABLED=true` turns it off); a scrape reads the last
values and never queries. The reconciliation itself runs on
`LENDING_RECONCILIATION_CRON` (default `40 */6 * * *`) on one instance (advisory
lock) for every tenant with loans; each run is written to the audit trail
(`accounting.reconciliation`), which is what the breaks gauge reads, so every
instance reports the same figure and a restart loses nothing.
`LENDING_RECONCILIATION_JOB_DISABLED=true` turns the job off.

### Metrics

| Metric | Type | Meaning |
| --- | --- | --- |
| `lending_eod_run_duration_seconds` | histogram | One end-of-day batch run (one tenant, one business date). |
| `lending_eod_loan_duration_seconds` | histogram | One loan in the batch. |
| `lending_eod_loans_processed_total` / `lending_eod_loans_failed_total` | counter | Loans processed / failed by end of day. |
| `lending_eod_runs_total{outcome}` | counter | Runs, `success` (no loan failed) or `failure`. |
| `lending_eod_last_run_loans_processed` / `_failed`, `lending_eod_last_run_finished_timestamp_seconds` | gauge | The latest run on this instance. |
| `lending_eod_tenants_behind` | gauge | Tenants with active loans whose end of day has not processed yesterday (the 00:15 run processes the day it starts on). |
| `lending_eod_tenants_with_failures` | gauge | Tenants whose last end of day left failed accounts (blocks month end). |
| `lending_tenants_with_active_loans` | gauge | Denominator for the two above. |
| `lending_month_end_closes_pending{status}` | gauge | Closes `PENDING` approval, and reopen requests (`REOPEN_PENDING`). |
| `lending_month_end_closes_not_prepared` | gauge | Tenants whose previous month had postings but has no close prepared or approved. |
| `lending_reconciliation_breaks` | gauge | Breaks in the latest reconciliation of each tenant, summed. |
| `lending_reconciliation_tenants_with_breaks` | gauge | Tenants whose latest reconciliation found a break. |
| `lending_reconciliation_oldest_run_timestamp_seconds` | gauge | Oldest of the tenants' latest reconciliations (0 if a tenant with loans has none in the last 7 days). |
| `lending_outbox_backlog{status}` | gauge | Outbox messages `PENDING` and `FAILED`. |
| `lending_outbox_oldest_pending_age_seconds` | gauge | Age of the oldest pending message. |
| `lending_db_connections{state}` | gauge | Connections the application role holds on its database, all instances (`pg_stat_activity`). |
| `lending_db_pool_size` | gauge | `connection_limit` of this instance's pool. |
| `prisma_pool_connections_open` / `_busy` / `_idle`, `prisma_client_queries_wait`, … | Prisma | The pool itself, per instance (Prisma `metrics` preview feature; read from the client's own counters). |
| `http_request_duration_seconds{method,route,status}` | histogram | Latency by route pattern and status class (`2xx`, `4xx`, `5xx`). |
| `http_requests_total{method,route,status}` | counter | Requests; the error rate is the `5xx` share. |
| `lending_metrics_collector_errors_total{job}`, `lending_metrics_collector_last_success_timestamp_seconds{job}` | counter, gauge | Health of the refresh (`refresh`) and reconciliation (`reconciliation`) jobs. |
| `process_*`, `nodejs_*` | default | Node.js process metrics. |

### Alerts and dashboard

* `ops/monitoring/prometheus-alerts.yml` — Prometheus alerting rules: API down,
  5xx rate above 2 %, p95 latency above 2 s, pool ≥ 90 % busy, more than 80
  server connections, end of day behind (2 h) or leaving failures, loans failing,
  runs over an hour, any reconciliation break, reconciliation older than two
  days, a close waiting three days or a month not prepared for five, outbox not
  draining, and the metrics refresh failing.
* `ops/monitoring/grafana-lending-dashboard.json` — Grafana dashboard (import,
  choose the Prometheus data source): lending health tiles, end of day, HTTP
  and database rows.

Errors themselves still go to Sentry (`SENTRY_DSN`); the metrics say *that*
something is wrong, Sentry and the logs say *what*.

### Responding

| Alert | First steps |
| --- | --- |
| `LendingEndOfDayBehind` | Logs: `End-of-day run failed` or `End-of-day already running on another instance`. Fix the cause, then let the next 00:15 run catch up (up to `LENDING_EOD_MAX_CATCHUP_DAYS` days per run) or run the batch from Lending › Operations. |
| `LendingEndOfDayFailures` | Logs `EOD <tenant> <date>: N account(s) failed — <id>: <error>`. Failed loans are rolled back and retried by the next run; month end stays blocked until a clean run. |
| `LendingReconciliationBreaks` | Accounting › Reconciliation for the tenant; nothing is corrected automatically. Do not close the month. |
| `LendingMonthEndNotPrepared` | Lending › Period close shows the failing check. |
| `DatabasePoolSaturated` | During end of day: lower `LENDING_EOD_CONCURRENCY` or raise `connection_limit` (keeping the total under the server's `max_connections`). |

## Month-end and year-end close

Lending › Period close. Month end and year end are stages of end of day, as
in core banking systems: once end of day processes the last day of a month,
the month's close is **prepared automatically** (checks plus a frozen
snapshot) and waits for a person to approve it.

* **Checks** — the business date has reached month end; end of day has
  processed every day without failures; the previous month is closed;
  debits equal credits; **an impairment policy is approved** whenever lending
  loans are active (`IMPAIRMENT_POLICY`, D-116: without one no allowance has
  been posted, so the month cannot close); the sub-ledgers reconcile. Open
  money approvals and unidentified payments are warnings shown to the
  approver, and so is REGULATORY impairment mode (`REGULATORY_RESERVE`: the
  books are not CIFRS 9 compliant).
* **Regulatory reserve** (ECL policy, D-115) — preparing the close measures
  the NBC provision on the active lending loans against the ECL allowance
  held, per currency, and brings the regulatory reserve to the excess with a
  journal dated the month end: Dr retained earnings (3100) / Cr regulatory
  reserve (3200, lending setting `accounting.regulatoryReserve`) to raise it,
  the reverse to release it (event `REGULATORY_RESERVE`). It is measured
  against the ledger, so preparing again posts nothing; the figures are kept
  in `snapshot.regulatoryReserve`. In REGULATORY mode the reserve is released
  to zero.
* **Snapshot** — trial balance at month end, the month's disbursements,
  collections, write-offs and net income, and the portfolio (outstanding,
  PAR 1/30/90, buckets, allowance), kept with the close.
* **Lock** — finance (`accounting.period.close`) prepares; another person
  (`accounting.period.approve`, Risk / compliance by default) approves. A
  locked month accepts no posting: the posting service refuses it with
  `PERIOD_CLOSED`, and the database trigger `LendingJournalEntry_period_lock`
  refuses it again. Postings carry the business date, so normal work simply
  continues in the next month.
* **Reopen** — only the latest closed month, with a reason, approved by a
  second person; never once its year is closed.
* **Year end** — when every month with activity is closed (and the previous
  year), finance prepares and another person approves; the approval posts a
  balanced journal per currency dated 31 December that brings every income
  and expense account to zero against retained earnings (3100).

The close covers the lending ledger. The legacy ledger is closed separately.

## Classification and provisioning (NBC)

Assumptions: DECISIONS D-113 – D-117 (need compliance sign-off).

* **Policy** — Operations › Impairment: finance proposes, risk approves. Until
  one is approved no allowance is posted and month-end close is refused while
  loans are outstanding (D-010, D-116).
* **Bands by term** — lending settings `regulatory.classes` (short-term,
  original maturity up to `regulatory.shortTermMaxDays`, default 366 days:
  0–14 / 15–30 / 31–60 / 61–90 / 91+) and `regulatory.longTermClasses`
  (0–29 / 30–89 / 90–179 / 180–359 / 360+); rates 1 / 3 / 20 / 50 / 100 %.
  The term is disbursement → original maturity
  (`LoanAccount.originalMaturityDate`, kept by a trigger through restructures).
  In REGULATORY mode end of day provisions on these settings; in ECL mode the
  allowance is PD × LGD × exposure and the NBC figure drives the reserve.
* **Restructured loans** — while on probation a loan is graded on max(actual
  days past due, days past due at the restructure) and, in REGULATORY mode and
  the return, at least `regulatory.restructured.minClass` (default
  Substandard). Probation ends after max(product
  `restructuring.probationInstalments`,
  `regulatory.restructured.minProbationInstalments` (default 3)) consecutive
  on-time revised instalments.
* **Regulatory reserve** — under ECL, the NBC provision above the allowance
  is appropriated to equity at each month-end close (see above).
* **Write-off floor** — a write-off needs max(product `writeOffMinDpd`,
  `regulatory.writeOffMinDpd.shortTerm` / `.longTerm`; default the Loss class
  of the loan's bands: 91 / 360 days), checked at proposal and approval
  (`WRITE_OFF_TOO_EARLY`). Loss loans at the floor appear in the work queue
  **Loss loans due for write-off** (`AGED_LOSS`, `loan.writeoff.propose`).
* Changing any of these is a lending-settings version (Operations › Lending
  settings), maker-checker. A version approved before this change keeps its
  25% Substandard rate until a new one is approved.

## Regulatory returns and the two loan books

Lending › Regulatory returns. One monthly NBC-style return per organisation
covers the lending platform **and** the legacy loans, per currency
(assumptions: DECISIONS D-045..D-049).

* **Tables** — portfolio by currency and book; classification and
  provisioning (NBC classes on the short- or long-term bands by each loan's
  original term, restructured loans held at their probation floor and
  minimum class; required provision against allowance held);
  PAR 1/30/90; by product and family, branch, purpose, borrower type (group
  or individual) and loan size; restructured loans by class; disbursed,
  written off and recovered in the month; the 20 largest borrowers; interest
  rates against the cap; the **regulatory provision and reserve** (NBC
  provision, allowance held, reserve required and reserve on the ledger, with
  a note that REGULATORY-mode books are not CIFRS 9 compliant). Every table
  carries per-currency totals, and the return checks that every breakdown
  adds up to the portfolio and that an impairment policy is approved while
  lending loans are outstanding. Loss loans at the write-off floor that are
  not written off are listed as a warning.
* **Reconciliation** — for each currency and book, principal and allowance of
  the loans in the return against loans receivable and the allowance in that
  book's journal at month end (the lending book also against the trial
  balance frozen at the close). Legacy loans already moved by a loan-book
  migration appear once, under the lending platform, and as a reconciling
  item on the legacy line until cleared against 3900.
* **Workflow** — any month can be **previewed**; only a **closed** month can
  be **generated** (finance, `regulatory.prepare`). The stored return and its
  SHA-256 hash never change (database trigger); a correction is a new
  version, which supersedes the draft or amends a submitted return. Finance
  **sends it for submission** — refused while anything fails to tie — and a
  different person (`regulatory.submit`, Risk / compliance) **submits** it
  with the regulator's reference, or sends it back.
* **Export** — CSV (whole return or one table; UTF-8 with BOM, formula-safe)
  and a workbook with a sheet per table.
* The close now keeps each live loan's days past due and class
  (`snapshot.loanGrades`), so a closed month's return grades loans as they
  stood at the close.

API: `GET /v1/lending/regulatory/returns?year=`, `GET …/preview?year=&month=`,
`POST …/returns {year, month}`, `GET …/returns/:id`,
`GET …/returns/:id/export.csv[?table=CODE]`, `GET …/returns/:id/export.xlsx`,
`POST …/returns/:id/request-submission`, `POST …/returns/:id/decision
{approve, reference?, comment?}`.

**Combined ledger** (Lending › Combined ledger,
`GET /v1/lending/regulatory/combined-trial-balance?asOf=`): the legacy and the
lending journals side by side per account and currency, with the combined
balance and whether each book, and the two together, balance.

**The legacy book is read-only (D-097).** The flag
`lending.legacy_loans.readonly` is **on by default** for every tenant. While
it is on, the original module moves no money: it refuses new loans,
disbursements, repayments, early settlements, repayment reversals,
write-offs, restructures and legacy provisioning runs with
`409 LEGACY_LOANS_READONLY` (the body names the `operation` and links to
Lending › Loans and Lending › Migration), and the late-penalty job skips the
tenant. Reading loans, schedules, repayments and receipts, payoff quotes,
exports, statements, the combined ledger and the loan-book migration
(Lending › Migration) all continue. Legacy screens hide every money button and
show a banner pointing to Lending › Loans and Lending › Migration
(`GET /v1/loans/legacy-status` returns `readonly` and `frozenOperations`). The
original screens stay in the menu, labelled "(original)"; nothing is deleted.

The way out is to migrate running legacy loans to the lending platform. A
tenant that must keep collecting in the original module meanwhile opts out
with a **TENANT rule switching the flag off** (Lending › Access & policy ›
Flags; one administrator proposes, a second approves). Remove the rule to
freeze the book again. Existing databases are moved to the new default by
migration `20261019003100_legacy_freeze`; a tenant rule created earlier is
kept.

For a tenant that opted out, the legacy money operations are safe to run
concurrently (D-098 – D-104): each locks the loan row and re-reads it inside
its transaction and allocates in exact decimals; disbursement and write-off
move the status at most once; a write-off uses the provision held for the
loan (shortfall to write-off expense 5100, any excess released to provision
expense) and the next provisioning run does not release it again;
provisioning runs and write-offs of a tenant are serialised by an advisory
lock (`LEGACY_PROVISIONING_TX_TIMEOUT_MS`, default 120 000, bounds a run); only
the latest repayment of a loan can be reversed, and reversing a settlement
makes its waived interest owed again. The legacy jobs (penalties, reminders,
late alerts, promise reviews) run in `LENDING_EOD_TZ` (Asia/Phnom_Penh); an
instalment is late from the calendar day after its due date, only
instalments with principal or interest unpaid are charged, and one
instalment's penalty stops at `legacyServicing.penaltyCapRate` (lending
settings, default 0.25) × its principal + interest.

## Taking over a loan book (migration)

Lending › Migration. Running loans from another system are loaded as a CSV
(template: `GET /v1/lending/migrations/template.csv`), one row per loan, as at
the cut-over date.

1. **Load and check** (finance, `loan.migration.manage`). Every row is checked:
   fields and dates, an active fixed-rate term product, the branch, the
   customer (matched on national ID through the blind index, else created —
   one customer per `customer_id` in the file), loans already migrated, and
   the remaining schedule rebuilt by the engine from the current period. The
   old system's control totals (loans and principal per currency) must
   agree. The interest accrued by the old system is compared with the
   contract's accrual and any difference shown. Nothing is posted.
2. **Approve** (another person, `loan.migration.approve`), on the cut-over
   business date. Each loan is posted in its own transaction: customer,
   application and agreement (reason MIGRATION), account, remaining schedule
   plus one arrears line due on the oldest overdue date (so days past due
   carry on), and an opening journal — principal, interest (contract accrual
   plus overdue interest), fees, penalties, allowance — against migration
   clearing **3900**; non-accrual loans put their interest in suspense. The
   accrual already earned is recorded, so end of day accrues only what follows.
   A row that fails is marked and can be posted by approving again.
3. **Verify**: Accounting › Reconciliation shows no breaks; the 3900 balance
   equals the old system's net loan balances and is cleared against the
   balances transferred in the general ledger.

Loans still in the legacy module are exported as a migration file at the
business date (`GET /v1/lending/migrations/legacy-export.csv?productCode=…`,
also on the Migration page): review it, then load it like any other file.
When such a loan is posted it is closed in the legacy module and its legacy
principal (account 1200) is cleared against migration clearing (3900) in the
legacy ledger, so the combined books hold it once.

Out of scope for files: facilities, cards, group loans, floating-rate,
balloon and explicitly dated schedules (book them in the platform or migrate
them as instalment loans).

## Webhooks

The Webhooks screen (menu: Webhooks; administrators: `access_policy.manage` registers,
`access_policy.approve` — a different person — activates). An endpoint is an
HTTPS URL on the public internet (private, loopback and link-local addresses
are refused when registered and again before every delivery;
`WEBHOOK_ALLOW_PRIVATE_NETWORKS=true` relaxes this outside production for
local testing). Its signing secret is shown once and stored encrypted.

Every lending event already passes through the transactional outbox; a job
(every 15 s, `LENDING_WEBHOOKS_DISABLED=true` to stop it) fans each message out
once to the matching active endpoints and POSTs `{ id, type, createdAt, data }`
with `X-Webhook-Id`, `X-Webhook-Timestamp` and `X-Webhook-Signature`
(`v1=` HMAC-SHA256 of `timestamp.body`). Non-2xx answers are retried with
backoff up to 15 times; an endpoint failing 50 times in a row is switched off
and needs a second administrator to turn back on. The console shows each
endpoint's deliveries, lets a failed one be retried, sends a test event and
rotates the secret.

## Migrations and deployment

* `packages/db/prisma/migrations/20261016_lending_platform_phase1/migration.sql`
* `packages/db/prisma/migrations/20261017_lending_facilities_phase2/migration.sql`
* `packages/db/prisma/migrations/20261017_lending_rate_resets/migration.sql`
* `packages/db/prisma/migrations/20261017_lending_group_liability/migration.sql`
* `packages/db/prisma/migrations/20261017_lending_relief_refinance/migration.sql`
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
| Bank auto-debit (UC-16) | Mock only (`MOCK_BANK_DEBIT`, deterministic by account number). Mandates and attempts are recorded; production refuses the mock, so no debit is attempted there. |
| Exchange rates (UC-21) | The organisation's own published rate table (real). `LENDING_FX_SOURCE=MOCK` selects fixed development rates, refused in production. |
| Payment rails (automated payout / collection) | Mock only. Disbursements are recorded by operations with an external bank/cash reference (manual rail, fully supported). Products requiring an adapter cannot be activated. |
| Identity / KYC | Manual KYC status only; `EXTERNAL_REQUIRED` products cannot be activated. |
| Credit bureau | Products with `creditBureau: REQUIRED` cannot be activated (the legacy CBC module is not wired into lending). |
| Notifications | Outbox messages are written transactionally; the delivery worker uses a mock in development and leaves messages pending in production. |
| Document storage | S3 when configured; otherwise a local-disk mock in development (refused in production). |
| External accounting | Not wired; the lending journal and reconciliation are internal. |

## Facilities

Revolving lines, overdrafts and staged drawdowns are live. Each type is behind
its own flag, all **off by default**; switch one on under Access → Feature
flags (two administrators), then activate a facility product. Every drawdown
(request, approval, release) and every card purchase or cash advance checks
the facility-type flag, the product family's flag, `lending.accounting.posting`
and `lending.servicing`; cards are revolving lines and need
`lending.revolving.drawdown` (D-085). Rejecting or cancelling a pending
drawdown is never blocked by a flag.

| Type | Flag | Templates |
|---|---|---|
| Revolving | `lending.revolving.drawdown` | `REVOLVING_CREDIT`, `HOME_EQUITY_LINE` |
| Overdraft | `lending.facility.overdraft` | `OVERDRAFT` |
| Staged drawdown | `lending.facility.staged_drawdown` | `CONSTRUCTION` |

Day-to-day operation:

* **Booking** an approved application on a facility product creates the
  facility, its agreement and its loan account; the approved principal is the
  committed limit. Tranche conditions are created from the product
  configuration.
* **Drawing**: operations request a drawdown, a second person approves it
  (MFA + approval authority), and release posts the payout against an external
  bank or cash reference with an `Idempotency-Key`. One drawdown is in flight
  at a time.
* **Charges** are raised by generating a statement for a period
  (`POST /lending/facilities/:id/statements`). Periods never overlap: the next
  one starts where the last ended, and a statement cannot close after the
  business date. Interest, over-limit interest and the commitment fee post as
  one `ACCRUAL` event.
* **Repayments** go through the ordinary loan endpoints — a facility's balance
  is a loan account.
* **Limit changes** are maker-checker and cannot cut a limit below what is
  already drawn.
* **Suspension** blocks new drawdowns and leaves servicing untouched.
* **Term-out** converts the drawn balance to an amortizing monthly schedule
  on the same loan account once availability ends (state the facility up to
  the term-out date first; stated charges fall due with the first
  instalment); an overdraft is repayable on demand and does not term out.
  After term-out, repay through the loan, not the facility.
* **Minimum-payment arrears** are aged by end of day: repayments since the
  first statement cover minimum payments oldest first, and the oldest still
  uncovered after its due date sets days past due and the collections stage.

Nothing is reversed by editing: a released drawdown is immutable at the
database level, and a correction is a reversal of its disbursement.

Not yet covered for facilities:

* **Statements are raised on demand**, not by the end-of-day batch.
* **Interest is not capitalized** into the drawn balance; it stays as interest
  receivable until paid.

## Floating-rate loans

Floating pricing is behind `lending.pricing.floating_rate`, **off by default**;
switch it on under Access → Feature flags (two administrators).

Daily operation:

* **Record the benchmark** before its reset date:
  `POST /lending/ops/rates` with `{ benchmarkCode, observationDate, rate,
  source }` (finance officers). Observations are history — a correction is a
  new observation for a new date, never an edit, so a past reset stays
  explainable.
* **Resets apply in the end-of-day batch** (`pnpm`-triggered or
  `POST /lending/ops/batch`). To re-price one loan on demand:
  `POST /lending/loans/:id/rate-resets`. Both go through the same code.
* **Check what is due**: `GET /lending/loans/:id/rate-resets` returns the full
  reset cycle, every reset already applied, and anything outstanding.

If a reset reports `BENCHMARK_MISSING`, no observation exists on or before that
reset date. Record it and re-run; the loan is not re-priced until you do, and
nothing else about it is blocked in the meantime.

Reading a reset: `indicatedRate` is what `benchmark + margin` gave,
`newAnnualRate` is what the contract charges, and `bound` says which of
`BENCHMARK`, `FLOOR` or `CAP` decided it. When they differ, a floor or cap
bound the rate.

## Solidarity groups

Group lending is behind `lending.group.joint_liability`, **off by default**.

Forming and running a group (relationship officers):

* `POST /lending/applications/groups` — form the group, then add members with
  `POST /lending/applications/groups/:id/members` (one `LEADER`, the rest
  `MEMBER`), then set it `ACTIVE`.
* Member tenure matters: `MICRO_GROUP` requires 30 days in the group before a
  member can be on a loan, so record the real `joinedOn`.
* A borrower can be in only one active group at a time.

Lending to a group:

* The application names the group and carries the **leader** as its borrower.
* Composition is checked when the application is created and again at
  booking, because membership can change in between.
* **Affordability is assessed on the group's combined income**, not the
  leader's: one instalment is serviced by every member together. The
  assessment records `groupMembers` and `groupCombinedIncome` alongside the
  debt-service ratio.
* At booking every member is bound to the loan with their share and what they
  are liable for. Under `GROUP_JOINT` that is the **whole balance**, not the
  share — read `liableFor`, not `shareAmount`, when deciding who to pursue.
* `GET /lending/loans/:id/group-members` shows the binding, each member's
  contributions and their exposure against today's balance.

Removing a member:

* Allowed freely once no live loan names the member. While one does — booked
  or active, even before the money is disbursed — it is refused unless the
  product sets `allowExitWithOutstanding`, and then the leaver settles their
  share of the outstanding balance first.
* Leaving cannot drop the group below the product minimum, and the leader
  cannot leave without a successor.
* A group with a live loan cannot be disbanded.

Not yet covered for groups:

* **Contributions are recorded with the repayment.** A group repayment may
  carry `contributions` by member (they must add up to the payment); the loan
  is still repaid as a whole, and reversed repayments drop out of members'
  totals.
* **Delinquency is at loan level**, not per member: the group is in arrears or
  it is not.

## Settling for less, and recoveries

**Negotiated settlement** (`loan.settlement.negotiate`, or
`…negotiate_principal` when principal is forgiven — both need MFA and an
approval authority measured on the concession):

* `GET /lending/loans/:id/negotiated-settlement-quote?agreedAmount=…` shows
  what the settlement gives up, by component, without posting anything.
* `POST /lending/loans/:id/negotiated-settlement` with an
  `Idempotency-Key`, an `agreedAmount` and a `reason`.
* The product must set `restructuring.allowNegotiatedSettlement`, and must
  allow `CHARGE_WAIVER` and/or `PRINCIPAL_FORGIVENESS`. A settlement that
  would forgive a component the product does not permit is refused outright —
  it is not quietly written off.
* By default the payment clears **principal first**, so the concession lands
  on charges. `restructuring.settlementAllocationOrder` changes that, but
  reversing it means the penalties survive and the principal takes the loss.

**Recovery after write-off** (`loan.recovery.post`, held by collections):

* `POST /lending/loans/:id/recoveries` with an `Idempotency-Key` and an
  `amount`, on a loan whose status is `WRITTEN_OFF`.
* The cash is posted to recovery income (`4300`) and attributed against what
  was written off, principal first. The loan stays `WRITTEN_OFF`.
* A recovery larger than the amount still written off is refused.

## Payment holidays

Programmes are published, then loans are enrolled.

* Draft: `POST /lending/ops/payment-holiday-programmes` with the window, the
  eligibility rules, `interestTreatment` and `termTreatment`.
* Open it: `POST /lending/ops/payment-holiday-programmes/:id/status` with
  `{"status":"OPEN"}` — **a different person** from the one who drafted it.
* Check a loan: `GET /lending/loans/:id/payment-holidays/:programmeId/eligibility`
  returns whether it qualifies, for how many instalments, and every reason it
  does not.
* Grant: `POST /lending/loans/:id/payment-holidays/:programmeId` with
  `{"instalments": n}`. Eligibility is re-checked here against committed
  state, because a loan can fall past due between the offer and the grant.
* `GET /lending/loans/:id/payment-holidays` lists what was granted and the
  interest it deferred.

Tell borrowers what the holiday costs: only `WAIVE` is free. `CAPITALIZE`
adds the deferred interest to the principal and charges interest on it
thereafter.

## Refinancing

* The product must set `restructuring.allowRefinance`.
* Create the application with `refinancesLoanId` naming the loan to replace.
  Same borrower, and that loan must be `ACTIVE`.
* Everything else is ordinary origination. **At disbursement**, the new loan's
  proceeds settle the old one in the same transaction and the old loan closes.
* A new loan too small to cover the payoff is refused unless the product sets
  `allowRefinanceShortfall`; nothing is half-applied, so the old loan is left
  untouched.
* `refinanceAllowDelinquent`, `refinanceAllowArrearsRollIn`,
  `refinanceMaxDaysPastDue`, `refinanceMinInstalmentsPaid` and
  `maxRefinanceCount` gate what may be refinanced.
* Every refinance writes a `RefinanceRecord` with the arrears rolled in and an
  `evergreening` verdict. Review those: a refinance that replaces a
  delinquent loan and funds its arrears has moved a problem, not solved it.

## Project, infrastructure and acquisition finance; borrowing bases

Three corporate product types ship with their own servicing, each behind a
flag that is **off by default** (two administrators switch it on):

| Template | Flag(s) | What it is |
|---|---|---|
| `PROJECT_FINANCE`, `INFRASTRUCTURE` | `lending.facility.staged_drawdown`, `lending.project_finance` | Staged construction facility → sculpted term loan → cash waterfall |
| `ACQUISITION_FINANCE` | — | Quarterly amortizing term loan with maintenance covenants |
| `INVENTORY_BACKED` | `lending.revolving.drawdown`, `lending.collateral.borrowing_base` | Revolving line drawn against a certified borrowing base |

### Covenants (all corporate products)

* Covenants listed in the product's `covenants` section are **set up on the
  loan at booking**, first tested one period after the booking date; more can
  be added per loan (Loan › Covenants).
* Types: `MIN_DSCR`, `MAX_LTV`, `MAX_LEVERAGE` (net debt ÷ EBITDA; debt
  defaults to the loan's principal outstanding, cash to 0), `MIN_INTEREST_COVER`
  (EBITDA ÷ interest; interest defaults to the loan's scheduled interest for
  the twelve months) and `FINANCIAL_STATEMENTS`.
* A failed test is a breach and raises `lending.covenant.breached`; a later
  passing test cures it; a **different person** from whoever recorded the
  failing test can waive it.

### Project finance

1. **Construction.** Book as any facility; the project record starts in
   `CONSTRUCTION`. Satisfy each tranche's conditions (e.g. `EQUITY_CONTRIBUTED`,
   `ENGINEER_CERTIFICATE`), then request → approve (second person) → release
   drawdowns. Raise statements as usual: with
   `capitalizeConstructionInterest` the period's interest is **added to
   principal** (`CAPITALIZATION` event, Dr 1200 / Cr 1210) instead of billed.
   A balance above the limit made of capitalized interest is not over-limit.
2. **Sculpting.** `POST /lending/facilities/:id/sculpting-preview` with
   `{ cfads: [{dueDate, cfads}], balloonAmount?, principal? }` shows the
   profile: debt service in each period = CFADS ÷ k, where k = PV(CFADS) ÷
   principal ≥ the product's `targetDscr`; principal = debt service − interest;
   the last period closes to zero. A projection that cannot carry the debt is
   refused with the maximum it supports.
3. **Term-out.** When availability ends, state the facility to that date and
   `POST /lending/facilities/:id/term-out` with the same `cfads`. The loan
   gets an explicitly dated schedule; the project moves to `OPERATIONS`.
4. **Waterfall.** For each period, `POST /lending/loans/:id/project/waterfall`
   (Idempotency-Key) with `{ revenue, operatingCosts, taxes, externalReference }`
   — preview first with `.../project/waterfall-preview`. In one transaction:
   CFADS received into receipts clearing (Dr 1000 / Cr 2430) → senior debt
   service as an ordinary repayment funded from 2430 (topped up from the
   reserve, Dr 2410 / Cr 2430, if cash is short) → reserve topped up to the
   next `dsraMonths` of debt service (Dr 2430 / Cr 2410), or what it holds
   above a falling target released → `cashSweepRate` of the rest prepays
   principal, shortening the loan from the end → the rest is distributed
   (Dr 2430 / Cr 1000), or **held in lock-up** (Dr 2430 / Cr 2420) when the
   period DSCR is below `lockUpDscr`, the reserve is short or debt service
   went unpaid. Locked-up cash is released with the first distribution after
   the project passes again. When the loan is repaid, anything still held is
   released and the project closes.
5. **Controls.** 2430 is zero after every run; reconciliation checks the
   project's reserve and lock-up against 2410 and 2420. Runs are immutable
   (database trigger) and a waterfall's repayment cannot be reversed on its own.

### Borrowing base

* Operations enter the borrower's certificate (Facility › Borrowing base ›
  New certificate): lines by class with gross value, stated ineligibles and
  age. "Work out the base" previews eligibility; submit sends it for
  acceptance. One certificate awaits a decision at a time.
* A **different person** accepts or rejects it (reject needs a reason).
  Accepting supersedes the previous certificate. If the line is already drawn
  beyond the new base, `lending.borrowing_base.shortfall` is raised.
* Eligible = gross − stated ineligibles − lines older than the class's
  `maxAgeDays` − any one counterparty's value above the class's
  `concentrationLimit` share; the base is Σ eligible × advance rate by class.
* Drawings are limited to **min(limit, base) − drawn**, re-checked at request,
  approval and release. With no accepted certificate, or one older than
  `certificateMaxAgeDays`, nothing can be drawn (`BORROWING_BASE_STALE`).
* Figures of a submitted certificate cannot be edited (database trigger).
## Trade finance: bought receivables and import / export loans

Lending › Trade finance has three tabs: letters of credit, **Receivables**
(invoice finance, factoring, supply-chain finance, forfaiting) and **Import &
export loans**. The new kinds are behind two flags, **off by default** (two
administrators under Access → Feature flags):

| Product | Flag | Template | Shape |
|---|---|---|---|
| Factoring | `lending.trade.receivables_purchase` | `FACTORING` | revolving programme limit |
| Supply-chain finance | `lending.trade.receivables_purchase` | `SUPPLY_CHAIN_FINANCE` | revolving limit of the anchor buyer |
| Forfaiting | `lending.trade.receivables_purchase` | `FORFAITING` | revolving programme limit |
| Import loan | `lending.trade.documentary` | `IMPORT_LOAN` | term loan (bullet) |
| Export working capital | `lending.trade.documentary` | `EXPORT_WORKING_CAPITAL` | term loan (bullet) |

The receivables products also need `lending.revolving.drawdown`, like invoice
finance. A programme is booked like any facility (an application under the
product); for supply-chain finance the borrower is the **anchor buyer** and
the approved limit is its programme limit.

**Receivables register** (`/lending/trade/invoices/:facilityId`). Every kind
follows the invoice-finance steps — register (maker) → approve as eligible
(credit approver) → request funding → approve funding (drawdown checker, MFA,
authority) → release (not the requester, `Idempotency-Key`) — plus:

* **Acknowledgement before funding.** Factoring: record the notice of
  assignment to the debtor (`notificationRequired`, on by default).
  Supply-chain finance: record the buyer's approval of the payable.
  Forfaiting: record the aval and the avalising bank. Funding is refused
  (`ACKNOWLEDGEMENT_REQUIRED`) until it is recorded
  (`POST invoices/:id/acknowledge`, register maker).
* **Price.** Factoring advances `advanceRate` of the invoice less the
  `serviceFeeRate` service fee (income 4540), and charges `feeRatePerPeriod`
  per started period on collection, like invoice finance. Supply-chain
  finance and forfaiting buy the **face value** at a discount — `face × rate
  × days / 360 (or 365)` (straight) or to yield — for the days from release
  to maturity (+ `graceDays` for forfaiting). The receivable is carried at
  face (1200); the discount is held as **unearned discount (2340)** and
  earned straight-line by the end-of-day batch into **discount income
  (4530)**, all of it once paid.
* **Limits.** Factoring refuses an advance that would put more than
  `maxDebtorConcentration` of the limit on one debtor; a supplier's
  `sublimit` caps what may be outstanding on its invoices.
* **Suppliers** (supply-chain finance): onboarded on the register by the
  register maker, approved (or rejected / suspended) by a credit approver —
  never the same person. Only an approved supplier's invoices are taken; the
  early payment names the supplier as payee.
* **Collections.** The debtor, the buyer (supply chain) or the obligor
  (forfaiting) pays; the money clears the fee, then the face or advance; any
  surplus is the holder's reserve, paid out under maker-checker. A recourse
  payment by the holder is refused when there is no recourse, and capped at
  the recourse cap under limited recourse.
* **Default.** When the obligor has not paid by due date + grace, end of day
  applies the recourse the receivable was bought with: **FULL** (factoring
  with recourse; the buyer under supply-chain finance) → `RECOURSE`, the
  holder owes it all and the facility ages as arrears; **LIMITED** →
  `RECOURSE` up to `limitedRecourseRate × invoice`, ageing stops once the cap
  is paid; **NONE** (factoring without recourse, forfaiting) → `DEFAULTED`,
  the lender keeps the claim and the facility does not age.
* **Write-off** of what the lender bears: a write-off maker proposes
  (`POST invoices/:id/write-offs`), a write-off checker with authority
  decides (`.../write-offs/:taskId/decision`, `Idempotency-Key`). It posts
  `TRADE_WRITE_OFF`: the face/advance and fee off the books, the unearned
  discount released, the rest to **credit losses on bought receivables
  (5500)**. Under limited recourse it is refused until the holder has paid
  its cap.
* **Closing** (`POST facilities/:id/receivables/close`, facility manager):
  once every receivable is settled, written off or rejected, nothing is owed
  to the holder and the balance is zero, the facility and its loan account
  close.

**Import & export loans** (`/lending/trade/transactions/:loanId`, linked
from the loan page). The loan is originated and booked as usual (a bullet:
interest-only instalments, principal at maturity; no debt-service ratio —
the trade repays it). Before payout:

1. **Record the trade** on the booked loan (disbursement maker): the
   counterparty, goods, transaction value, the start of the cycle (shipment
   for an import, contract for an export) and the expected proceeds. It is
   refused if the loan exceeds `maxFinancingRatio` of the value, the cycle
   exceeds `maxTradeCycleDays`, or the loan matures after the expected
   proceeds + `proceedsGraceDays`.
2. **Documents** — the product's `requiredDocuments` checklist is created
   with the trade. A disbursement maker records each one received (with its
   reference); a disbursement checker verifies or rejects it — never the
   person who received it. A rejected document can be presented again.
3. **Disbursement** goes through the usual prepare → approve → execute; each
   step is refused (`TRADE_NOT_RECORDED`, `TRADE_DOCUMENTS_INCOMPLETE`,
   `TRADE_TENOR`…) until the trade is recorded, every required document is
   verified and the loan still fits the trade on the day it pays out.
4. **Proceeds** (`POST trade-transactions/:id/proceeds`, repayment poster,
   `Idempotency-Key`): proceeds at or above the payoff **settle** the loan
   (early settlement, interest to date) and the rest is recorded as passed to
   the customer (its reference is required); less is posted as a repayment.

Not yet covered: recoveries on a written-off receivable, late charges on a
defaulted obligor, credit insurance, a supplier or buyer portal, document
examination against a letter of credit, and SWIFT messaging.

## Payment channels

Lending › Payment channels; decisions D-017..D-019 in
[docs/servicing/DECISIONS.md](../servicing/DECISIONS.md).

**Auto-debit (UC-16).** Record the borrower's mandate on the loan screen
(bank, account, mandate reference, consent date; one active mandate per
loan, revocable). At the start of each end-of-day run, every active mandate
whose loan has an instalment due that day is collected for everything due
and unpaid (less any advance) through the bank adapter, and the ordinary
repayment is posted by `system:auto-debit`. A refusal is recorded with the
bank's code, a `lending.auto_debit.failed` outbox notice is queued, and the
debit is retried per the settings (default 3 attempts a day apart). Only a
mock bank exists: accounts ending in `000` fail for insufficient funds, in
`999` as closed, anything else succeeds; production refuses the mock.

**Settlement files (UC-18).** CSV with a header row, columns in any order:

```
reference,loan_ref,amount,currency,value_date,channel_txn_id[,payer_name]
R-1001,LN-260105-ABC123,120.50,USD,2026-02-05,WING-889211,Sok Dara
```

`loan_ref` is the loan account reference; leave it blank when the payer gave
none. `channel_txn_id` identifies the payment at the channel (MOBILE, QR,
WALLET or AGENT). Lines starting with `#` are comments. Value dates may be at
most 30 days back.

**Payroll files (UC-19).** The employer, period (YYYY-MM), currency and value
date are given with the upload; the CSV has `employee_ref, amount` and at
least one of `national_id` / `loan_ref` per line:

```
employee_ref,national_id,loan_ref,amount
E-001,010203040,,55.00
```

**Rules for both.** A file with any malformed line is refused and every error
listed; nothing is imported. The same file sent again returns the original
import. A line whose transaction id was imported before is recorded as a
duplicate and applies nothing (if its content differs it stays a break until
the channel confirms it). Lines that name a live loan in their currency post
the ordinary repayment; every other line, and any line the loan refuses, goes
to unidentified payments with the reason, to be matched or refunded there.
Integrations push files with a service-account key holding
`loan.repayment.post`.

**Daily reconciliation.** Per value date and channel: file total = posted +
reversed + matched from suspense + refunded + still in suspense. Breaks are
money still in suspense, posted payments since reversed, and conflicting
repeats. Payroll is also summarised per employer and period.

**Cross-currency payments (UC-21).** On the repayment form choose the currency
paid; a preview shows the bank rate (mid less the configured spread), the
amount credited and the FX gain or loss. Rates come from the organisation's
published exchange rates (`/v1/fx/rates`, FX_MANAGE); a payment is refused when
no rate is published for its value date (tolerance configurable).
`LENDING_FX_SOURCE=MOCK` uses fixed development rates instead (refused in
production). Postings: payment currency Dr cash / Cr FX position (1050); loan
currency Dr FX position at mid / Cr the loan / Cr FX gain-loss (4410).

**Settings** (FINANCE_OFFICER, `rate_observation.manage`): FX spread in basis
points, how many days old a rate may be, auto-debit attempts per due date and
days between attempts.

## Customer documents

Lending › Documents (review queue, expiries, retention) and each customer's
library (from the customer profile: Documents). Files go to S3 when
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_S3_BUCKET_NAME` are set;
otherwise to local disk under `DOCUMENT_STORAGE_DIR` (required in production
without S3; a temporary directory is used in development).

* Every upload waits for review by a different user (Credit analyst, Loan
  operations maker/checker hold `document.review`).
* Expiry: a nightly job (`DOCUMENT_EXPIRY_CRON`, default 00:45,
  `DOCUMENT_EXPIRY_DISABLED=true` to stop it) flags expired documents and
  raises one reminder `DOCUMENT_EXPIRY_REMINDER_DAYS` (default 30) before
  expiry; "Run expiry check now" does the same for your organisation.
* Retention, legal hold and deletion need `document.manage` (Risk /
  compliance). Defaults are in docs/servicing/DECISIONS.md (D-020).
* Download links expire after `DOCUMENT_LINK_TTL_SECONDS` (default 300). API
  links are signed with `DOCUMENT_LINK_SECRET` (falls back to a key derived
  from `JWT_ACCESS_SECRET`).
* Older KYC images, legacy loan documents and application uploads appear in
  the library when it is opened; "Link older documents" does every customer.

## Institutional lending (interbank, municipal, sovereign, development)

Lending › Counterparties & limits; decisions D-065 and D-068 in
[docs/servicing/DECISIONS.md](../servicing/DECISIONS.md). Off by default:
switch on `lending.institutional` (two administrators) before originating.

* **Counterparty.** An institution borrows through an ordinary borrower
  record. A credit analyst (`credit_decision.recommend`) registers it as a
  counterparty — `POST /lending/counterparties` with its type (`BANK`,
  `MUNICIPALITY`, `SOVEREIGN`, `DEVELOPMENT_INSTITUTION`), risk country, LEI
  or SWIFT, and long-term rating (S&P/Fitch scale; enter a Moody's rating at
  its equivalent). `POST …/:counterpartyId/rating` records a new rating;
  `…/status` suspends or reinstates (a suspended counterparty gets no
  approvals and no payouts).
* **Limits (maker-checker).** The analyst proposes a counterparty limit
  (`POST …/:counterpartyId/limits`) or a country limit
  (`POST /lending/exposure-limits/country`) with a currency and a review
  date; a **different** credit approver approves it
  (`POST /lending/exposure-limits/:limitId/decision`) within their approval
  authority for `credit_decision.approve` and with MFA. An approved limit
  replaces the one in force. After its review date a limit no longer counts:
  renew it before then.
* **Utilisation** is principal outstanding on active loans + loans booked but
  not paid out + approvals not yet booked, in the limit's currency. It is
  checked at **submission**, **approval** and **disbursement** (prepare and
  execute): an application or payout that would breach the counterparty or
  the country limit is refused with the figures (`COUNTERPARTY_LIMIT_EXCEEDED`,
  `COUNTRY_LIMIT_EXCEEDED`, `…_NO_LIMIT`, `…_LIMIT_REVIEW_PASSED`,
  `…_LIMIT_CURRENCY`), as is a counterparty below the product's minimum
  rating or of a type the product does not lend to.
* **Exposure view** (`GET /lending/counterparties/exposure`): each
  counterparty and country against its limit — used, headroom, utilisation
  and `WITHIN_LIMIT` / `NEAR_LIMIT` (90%+) / `BREACHED` / `LAPSED` — totals by
  counterparty type, and the limits awaiting approval.
* **Conventions.** `INTERBANK` is a money-market placement: one bullet of
  principal and interest on the agreed maturity (`firstDueDate`, up to 366
  days), interest ACT/360, no prepayment. `MUNICIPAL` is semi-annual level
  instalments; `SOVEREIGN` semi-annual equal principal after up to 6 grace
  instalments. `DEVELOPMENT_CONCESSIONAL` takes rates of 0–3% and up to 10
  years' principal grace, and is approved only when the **grant element**
  (debt service discounted at 5%) is at least 35% — the figure is on the
  credit decision's assessment.

## Income-contingent education loans

Lending › Income assessments; decision D-066. Switch on
`lending.education.income_contingent`.

* The instalment is `repaymentRate × (income − incomeThreshold) ÷ 12`.
  The application records the income declared at origination
  (`terms.declaredAnnualIncome`, blank = nil while studying); below the
  threshold nothing is due and nothing falls into arrears.
* Interest accrues at the contract rate. What the instalment does not cover
  is **capitalised** (on its own schedule line, up to
  `capitalisationCap` × the amount financed) or, with
  `unpaidInterest: SUBSIDISE`, not charged.
* **Reassessment** — every `reassessmentMonths` (12) or on a change of
  circumstances: `ops.maker` records the declared income with evidence
  (`POST /lending/loans/:id/income-assessments`; preview first with
  `GET …/income-contingent/preview?income=`); a **different** `ops.checker`
  approves (`POST …/income-assessments/:assessmentId/decision`). Approval
  rebuilds the schedule with the engine from the start of the next period
  that has not begun; instalments already due, and any arrears on them, stay.
  Without a reassessment the last instalment continues; overdue reviews are
  listed at `GET /lending/income-contingent/reviews`.
* **End of term.** At the start of end of day on the contract's last due
  date, the balance carried on the final line is forgiven
  (`ICL_FORGIVENESS`: Dr 5700 education loans forgiven, Cr loans receivable)
  and the loan closes if nothing else is owed. Instalments in arrears are not
  forgiven.
* Extra payments are held as an advance (no partial prepayment); early
  settlement repays everything; restructuring does not apply.

## Murabaha

Decision D-067 (flagged for Sharia board and finance sign-off). Switch on
`lending.islamic.murabaha`.

* After booking, `ops.maker` registers the asset being sold
  (`POST /lending/loans/:id/murabaha`: type, description, supplier, cost).
  The cost must equal what is financed plus any down payment. The payout
  must go to its supplier, dealer or seller — never the customer — and is
  refused until the asset is registered.
* The contract (`GET /lending/loans/:id/murabaha`, and on the loan screen)
  shows **cost, profit and sale price** — the profit is fixed when the
  contract is booked — the instalments, the ibra' promised on early
  settlement, and how the profit is recognised.
* Accounting: cost receivable `1350`, profit receivable as earned `1355`,
  profit income `4700` (never interest income); the unearned profit is
  carried as a memo pair (Dr `1360` / Cr `2510` deferred profit) from the
  sale and released as profit is earned — trued up at end of day and when
  the contract ends. Late charges (a flat amount per late instalment) go to
  the charity payable `2800`.
* **Early settlement**: the quote charges profit earned to date plus the
  unearned profit less the product's `murabaha.ibraShare` (default all of
  it); a product without ibra' collects the remaining sale price in full.
  No partial prepayment, restructuring or refinancing.

## Credit scoring, scorecards and alternative data

Every assessment of an application (submission, recommendation, each
approval) scores it and stores the evaluation; the application page shows
the score, grade, each characteristic's points and reason, the adverse
reasons, the strategy outcome, the explanation a customer may be given, the
input snapshot with each input's source and consent, and any challenger
(shadow) result. Credit analysts and approvers can **re-run** the score
while the application is undecided. Decisions D-075…D-081.

**Scorecards** (Lending › Scorecards). Until an organisation has its own
ACTIVE version of a scorecard code, the shipped template of that code scores:
`STANDARD_RETAIL` (the original origination score, base 450 on 300–850,
grades A ≥ 700, B ≥ 620, C ≥ 550, D) and `THIN_FILE`. To change one:

1. A credit analyst (`scorecard.manage`) installs the template (or writes a
   scorecard from scratch), edits the DRAFT in the structured editor —
   base and scale, grade bands, and per characteristic the input variable,
   bins (`value ≤ upTo`, ascending, the last open-ended) or categories or a
   linear term, the points and staff reason of each, the missing-value
   outcome and the customer-facing adverse reason — and tries it on the
   **Test score** tab. Then **Submit**.
2. A risk / compliance reviewer (`scorecard.approve`), never the maker,
   **Approves** (or rejects with a reason) and **Activates** it. Activation
   retires the version previously in force. Versions are frozen once
   submitted; change means a new version.

Inputs are ratios, counts, months, days or scores — never amounts — so one
scorecard serves USD and KHR loans alike.

**Strategy** (product configuration, `scoring`, maker-checker with the
product): `championCode` (default `STANDARD_RETAIL`), an optional
`challengerCode` scored silently on the same inputs and stored (it never
affects the decision), `thinFile` (enable, scorecard, months of history
below which a borrower without a bureau score is thin-file) and `strategy`:
grade rules (`AUTO_APPROVE` / `REFER` / `DECLINE`, maximum amount, rate
add-on in bp), a default outcome, a decline cut-off and knock-outs
(write-off, current days past due, age, debt-service ratio).
`eligibility.minCreditScore` keeps working and combines with the cut-off.
At approval a decline, an amount above the grade's maximum and (if
`enforceRateAddOn`) a rate below default + add-on block approval.
**`AUTO_APPROVE` only recommends approval**: the workflow's approvers, within
their authority, still approve. The defaults refer every grade, so existing
products behave as before.

**Monitoring** (Lending › Scorecard monitoring, `scorecard.read`): per
scorecard version and role, the distribution and approval rate by grade, the
bad rate of mature booked loans, Gini/AUC and KS, and PSI between a baseline
and a recent window. Bad = any instalment 30+ days late (or a write-off)
within 12 months of disbursement by default; the thresholds and windows are
tenant lending settings (`scoring.monitoring.*`) and can be changed per
report. Use it to compare a challenger with the champion before promoting it,
and to re-weight a scorecard once enough loans are mature.

**Consent and alternative data** (borrower page › Alternative data, or the customer documents page › Alternative data &
consent). Nothing beyond the lender's standard checks is fetched or used
without the customer's consent for that source, in force at the moment of
use:

* A relationship officer or analyst (`alt_data.consent.manage`) records
  each consent with its purpose, scope, method and expiry (at most
  `scoring.consent.maxValidityDays`, default 730 days). A signed form must
  first be filed in the customer's documents. Withdrawing it is a new entry;
  from then on the source is not used (earlier evaluations keep what they
  used). The history is append-only.
* **Internal behavioural data** (consent `INTERNAL_BEHAVIOUR`): on-time
  ratio, average and worst lateness and instalments observed on the
  customer's loans with the lender, the share of repayments arriving through
  KHQR / wallet / mobile channel files (`scoring.alternativeData.digitalChannels`)
  and months of solidarity-group contributions. There is no savings or
  deposit product in the platform, so no savings history is used.
* **Officer-captured data** (`alt_data.record`): utility bills (EDC
  electricity, water: months observed / paid on time), a telco statement
  (months with top-ups), rent history, or an observed business cash flow
  (inflow, outflow and the currency it is kept in), each backed by a
  document in the customer's library and a consent in force. It counts only
  after another person verifies it (`alt_data.verify`); records older than
  `scoring.alternativeData.maxRecordAgeDays` (365) are ignored. A cash flow
  in riel is converted to the loan's currency at the organisation's own
  published rate (Settings › FX rates) before it is compared with the
  instalment; without a rate it is left out.
* **External providers** (smartphone, telco, e-wallet data) **require an
  integration**: Lending › Scorecards › Data providers stores a provider's
  endpoint and encrypted credentials (one administrator proposes, another
  activates), but no provider adapter ships, so these inputs are always
  missing and reported as "requires integration".

To score thin-file borrowers: enable `scoring.thinFile` on the product (and
optionally install and adjust `THIN_FILE`), collect consents, capture and
verify the customer's documents' data, then submit the application.

## Authenticator step-up, platform approvals and tenant purge

- **Step-up (D-129).** Every lending action with `minAssurance: 'MFA'` needs an
  authenticator code verified within `AUTH_MFA_STEP_UP_MINUTES` (default 15).
  A stale session gets 403 `MFA_STEP_UP_REQUIRED` (the decision's only failing
  check is `ASSURANCE`; any other failure stays `ACCESS_DENIED`). The web asks
  for a code, calls `POST /auth/mfa/step-up` and retries. `GET /me/access`
  reports `assurance.stepUpNeeded` on the same rule, so "Needs MFA" in the work
  queues means "needs a fresh code".
- **Administrators (D-128).** Tenant administrators must have an authenticator
  unless the tenant's lending settings turn `security.requireMfaForAdmins` off.
- **Platform audit (D-130).** Platform actions on a tenant's users or on the
  tenant appear in that tenant's audit log as "Platform operator".
- **Tenant purge (D-131).** Grace period, archive (SHA-256 recorded), legal
  holds and retention (D-020 rules) and a second super-administrator are all
  required; see DEPLOYMENT.md › Platform super-administrators.
- **Telegram applications (D-132).** Off unless `telegramBot.allowLoanApplications`
  is on; recorded by the "Telegram bot" system principal within the product's
  limits.

## Known limitations

* Not implemented: connected-party (group) exposure checks
  (`limits.connected_exposure`) and emergency (break-glass) access
  (`access.emergency_break_glass`). Everything else listed in the generated
  [capability matrix](CAPABILITY_MATRIX.md) as ✅ is live; integrations marked
  🔌 (payment rails, external KYC, live credit bureau, notifications delivery,
  external accounting, alternative-data providers) have adapter interfaces or
  mocks only. The matrix is the source of truth — regenerate it with
  `pnpm docs:capabilities` rather than listing families here.
* Project finance: one senior tranche; CFADS and receipts are entered by
  operations; no hedging, subordinated debt or multi-account cash management.
* Borrowing bases: certificates are keyed from the borrower's report; no
  stock-system or ledger feed.
* Institutional limits are per currency (no FX conversion of exposures) and
  per counterparty and country only; connected groups are not aggregated.
* Reversal is latest-first and not available for repayments that triggered a
  prepayment reschedule; amendment reversal only before later activity.
* Money with no loan goes to the unidentified-payments suspense account
  (Lending › Unidentified payments) and is matched or refunded; money beyond
  what is due is held as an advance or prepaid per the product.
* Penalty interest uses ACT/365F on overdue principal + interest.
* Impairment (regulatory class rates or ECL by stage) posts only once a
  policy is approved, and a month cannot close without one; modification
  accounting still needs integration review. The NBC bands, the restructured
  minimum class and the write-off floor are the team's reading of the Prakas
  and need compliance sign-off (D-113 – D-117).
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
| Documents | `GET/POST customers/:borrowerId/documents`, `GET customers/:borrowerId/document-checklist`, `POST customers/:borrowerId/document-requests`, `POST document-requests/:requestId/cancel`, `GET applications/:id/document-checklist`, `GET documents/:documentId`, `POST documents/:documentId/{versions,review,link,legal-hold,delete}`, `PUT documents/:documentId/expiry`, `GET document-review-queue`, `GET document-expiries`, `POST document-expiries/run`, `GET/PUT document-retention`, `POST document-library/link-legacy`, `POST loans/:id/settlement-quote-letter`, `GET document-links/:token` (signed, public); portal: `GET /v1/borrower/document-requests`, `POST /v1/borrower/document-requests/:requestId/upload`, `GET /v1/borrower/my-documents`, `GET /v1/borrower/my-documents/:documentId/download` |
| Trade finance | `GET trade/receivables`, `GET facilities/:id/invoices`, `POST facilities/:id/invoices`, `GET invoices/:invoiceId`, `GET :invoiceId/quote`, `POST invoices/:invoiceId/{acknowledge,approve,reject,advance,advance/approve,advance/release,collections,reserve-payouts,write-offs}`, `POST :invoiceId/reserve-payouts/:taskId/decision`, `POST :invoiceId/write-offs/:taskId/decision`, `POST facilities/:id/suppliers`, `POST suppliers/:supplierId/{approve,reject}`, `POST facilities/:id/receivables/close`; `GET trade/transactions`, `GET/POST loans/:loanId/trade`, `POST trade-transactions/:transactionId/{documents,proceeds}`, `POST trade-documents/:tradeDocumentId/{verify,reject}`; letters of credit: `GET/POST letters-of-credit`, `GET :id`, `POST :id/{issue,reject,close,drawings}`, `POST :id/drawings/:drawingId/{approve,reject,pay}` |
| Customer portal | `POST portal/loans/:loanId/restructure-requests`, `GET portal/restructures`, `GET portal/restructures/:id`, `POST portal/restructures/:id/proposals/:pid/accept` |
| Payment channels | `GET/PUT payment-channels/settings`, `POST payment-channels/{settlement-files,payroll-files}`, `GET payment-channels/files`, `GET payment-channels/files/:fileId`, `GET payment-channels/reconciliation?date=&channel=`, `GET payment-channels/payroll-summary`, `GET payment-channels/auto-debit/attempts`; loans: `GET/POST :id/mandates`, `POST :id/mandates/:mandateId/revoke`, `GET :id/fx-quote`, `POST :id/fx-repayments`; service key: `POST integrations/{settlement-files,payroll-files}` |
| Access | `GET access`, `POST access/{roles,assignments,delegations,authorities,policies,cohorts,simulate,service-accounts}`, decisions and revocations, `GET access/flags`, `POST access/flags/rules`, `GET access/capabilities/:type/:id` |
| Institutional | `GET/POST counterparties`, `GET counterparties/exposure`, `GET counterparties/:counterpartyId`, `POST counterparties/:counterpartyId/{rating,status,limits}`, `GET exposure-limits`, `POST exposure-limits/country`, `POST exposure-limits/:limitId/decision` |
| Income-contingent | `GET income-contingent/reviews`, `GET loans/:loanId/income-contingent`, `GET loans/:loanId/income-contingent/preview?income=`, `POST loans/:loanId/income-assessments`, `POST loans/:loanId/income-assessments/:assessmentId/decision` |
| Murabaha | `GET/POST loans/:loanId/murabaha` (asset registration before payout; contract disclosure) |
| Integrations | `POST integrations/loans/:id/repayments` (service-account key) |
| Project finance | `GET loans/:id/project`, `POST loans/:id/project/waterfall-preview`, `POST loans/:id/project/waterfall`; `POST facilities/:id/sculpting-preview`, `POST facilities/:id/term-out` (with `cfads`) |
| Borrowing base | `GET facilities/:id/borrowing-base`, `POST facilities/:id/borrowing-base/preview`, `POST facilities/:id/borrowing-base/certificates`, `POST facilities/:id/borrowing-base/certificates/:certificateId/decision` |
| Covenants | `GET/POST loans/:id/covenants`, `POST loans/:id/covenants/:covenantId/{tests,waive}` |
| Scoring | `GET/POST scorecards`, `GET scorecards/:scorecardId`, `POST scorecards/:scorecardId/versions`, `PUT scorecard-versions/:versionId`, `POST scorecard-versions/:versionId/{submit,approve,reject,activate,retire}`, `POST scorecard-test`, `GET scorecard-monitoring`, `GET/POST applications/:id/scores` |
| Alternative data | `GET customers/:borrowerId/alternative-data`, `POST customers/:borrowerId/consents`, `POST consents/:consentId/revoke`, `POST customers/:borrowerId/alternative-data`, `POST alternative-data/:recordId/decision`, `GET/POST alternative-data-providers`, `POST alternative-data-providers/:configId/decision` |
| Operations | `GET/POST ops/business-date`, `GET/POST ops/calendars`, `GET/POST ops/rates`, `GET ops/journal`, `GET ops/trial-balance`, `GET ops/reconciliation`, `GET ops/audit`, `GET ops/integrations` |

Money endpoints require an `Idempotency-Key` header.
