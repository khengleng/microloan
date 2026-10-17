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
pnpm test:lending:int     # Phase 1, security, restructuring, facilities, floating, groups, settlement, relief
```

CI runs all three in the `lending-tests` job of `.github/workflows/security.yml`.

## End-of-day routine

1. Post the day's repayments and disbursements.
2. Advance the business date (at most 31 days per step): `POST /v1/lending/ops/business-date`.
3. Run the batch: `POST /v1/lending/loans/batch/run` — auto-debit collection
   under active mandates (first, so a collected instalment is never late), accrual, interest
   capitalization, penalties, delinquency buckets and collection stages,
   restructure monitoring and system referrals. It is idempotent and processes
   only accounts in the caller's scope; each account is its own transaction.
4. Check reconciliation: `GET /v1/lending/ops/reconciliation` must report no breaks.

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
flags (two administrators), then activate a facility product:

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

Not yet covered for groups:

* **Contributions are recorded with the repayment.** A group repayment may
  carry `contributions` by member (they must add up to the payment); the loan
  is still repaid as a whole, and reversed repayments drop out of members'
  totals.
* **Delinquency is at loan level**, not per member: the group is in arrears or
  it is not.

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

## Known limitations

* Not implemented (templates seeded unavailable): borrowing bases, connected-party exposure, credit cards, BNPL, trade finance,
  factoring, forfaiting, supply-chain finance, income-contingent education,
  syndication, project finance, institutional lending, Murabaha, Ijarah,
  emergency (break-glass) access.
* Reversal is latest-first and not available for repayments that triggered a
  prepayment reschedule; amendment reversal only before later activity.
* Money with no loan goes to the unidentified-payments suspense account
  (Lending › Unidentified payments) and is matched or refunded; money beyond
  what is due is held as an advance or prepaid per the product.
* Penalty interest uses ACT/365F on overdue principal + interest.
* Impairment (regulatory class rates or ECL by stage) posts only once a
  policy is approved; modification accounting still needs integration review.
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
| Customer portal | `POST portal/loans/:loanId/restructure-requests`, `GET portal/restructures`, `GET portal/restructures/:id`, `POST portal/restructures/:id/proposals/:pid/accept` |
| Payment channels | `GET/PUT payment-channels/settings`, `POST payment-channels/{settlement-files,payroll-files}`, `GET payment-channels/files`, `GET payment-channels/files/:fileId`, `GET payment-channels/reconciliation?date=&channel=`, `GET payment-channels/payroll-summary`, `GET payment-channels/auto-debit/attempts`; loans: `GET/POST :id/mandates`, `POST :id/mandates/:mandateId/revoke`, `GET :id/fx-quote`, `POST :id/fx-repayments`; service key: `POST integrations/{settlement-files,payroll-files}` |
| Access | `GET access`, `POST access/{roles,assignments,delegations,authorities,policies,cohorts,simulate,service-accounts}`, decisions and revocations, `GET access/flags`, `POST access/flags/rules`, `GET access/capabilities/:type/:id` |
| Integrations | `POST integrations/loans/:id/repayments` (service-account key) |
| Operations | `GET/POST ops/business-date`, `GET/POST ops/calendars`, `GET/POST ops/rates`, `GET ops/journal`, `GET ops/trial-balance`, `GET ops/reconciliation`, `GET ops/audit`, `GET ops/integrations` |

Money endpoints require an `Idempotency-Key` header.
