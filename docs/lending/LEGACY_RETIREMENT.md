# Retiring the original loan module

The platform started with one loan module ("original", "legacy": `/loans`,
`Loan`, `RepaymentSchedule`, the legacy journal) and later gained the lending
platform (`apps/api/src/lending`, `LoanAccount`, the lending journal,
`PolicyService` permissions). Since D-097 the original module was frozen by
default and running loans were moved across with the loan-book migration
(`LEGACY-<id>` rows, D-036). This document is the plan to end with **one
lending system**.

* **Phase 1 (done, D-153 – D-159):** no screen, route, job or write path of
  the original module is left except a read-only **legacy loan archive**,
  what the loan-book migration needs, and read-only use of the legacy tables
  by the regulatory return and the combined ledger while legacy loans
  remain. Reports, performance, the KPI dashboard, exports, the borrower
  portal and the Telegram bot read the lending book. **No table is dropped
  and no row is changed.**
* **Phase 2 (not done; plan below):** drop the legacy tables and the code
  that still reads them, once every organisation's legacy book is migrated
  and archived.

---

## 1. Inventory (before phase 1)

### 1.1 API modules of the original module

| Module (`apps/api/src/…`) | What it did | Routes | Jobs | Phase 1 |
|---|---|---|---|---|
| `loans` | Create, approve, disburse, write off, delete loans; documents and interactions; payoff quotes; the freeze gate (`legacy-loan-gate.ts`) and the money helpers (`legacy-money.ts`) | `POST/GET /loans`, `GET /loans/legacy-status`, `GET /loans/overdue`, `GET/DELETE /loans/:id`, `PUT /loans/:id/status`, `GET /loans/:id/payoff-quote`, `POST /loans/:id/write-off`, `POST/DELETE /loans/:id/documents…`, `POST /loans/:id/interactions` | — | **Removed.** The row lock the migration takes moved to `lending/migration/legacy-lock.ts`. |
| `repayments` | Post, settle, reverse repayments; receipts; list | `POST /repayments`, `POST /repayments/settlements`, `POST /repayments/:id/reverse`, `GET /repayments/:id/receipt`, `GET /repayments` | — | **Removed** |
| `penalty-cron` | Daily late penalty and DEFAULTED marking; upcoming-due reminders | — | `LEGACY_PENALTY_CRON` (00:00), `LEGACY_UPCOMING_REMINDER_CRON` | **Removed** (the lending end of day charges late penalties on lending loans, D-133) |
| `reminder` | Telegram "due tomorrow" reminders | — | `LEGACY_REMINDER_CRON` (08:00) | **Ported** to the bot on lending instalments (`REMINDER_CRON`) |
| `provisioning` | Legacy provisioning runs posting to the legacy journal | `POST /provisioning/run`, `GET /provisioning/runs[/:id]` | — | **Removed** (lending impairment, OPS-5) |
| `loan-products` | Legacy products and rate tiers | `POST/GET/PUT/DELETE /loan-products[/:id]` | — | **Removed** (lending products) |
| `kpi` | Performance page (PAR, ratios, GL income) from legacy schedules and journal | `GET /kpi/overview` | — | **Ported**: `GET /lending/reports/performance` |
| `reports` | Overview, portfolio, collections, borrowers, risk, dashboard, loan book, repayments, cash flow, Excel/CSV exports | 14 `GET /reports/*` routes | — | **Ported**: `GET /lending/reports/portfolio[.csv]`, `GET /lending/reports/receipts[.csv]`, `GET /lending/reports/performance`, `GET /lending/overview` (dashboard) |
| `exports` | Excel exports of loans and repayments | `GET /exports/loans/excel`, `GET /exports/repayments/excel` | — | **Ported**: the CSV exports above, `GET /lending/loans/export.csv`, `GET /lending/legacy-archive/export.csv` |
| `agreements` | Legacy key facts and e-signature on a legacy loan (staff and portal) | `GET /agreements/loan/:loanId/key-facts`, `POST /agreements/loan/:loanId/sign`, portal `…/borrower/loans/:id/key-facts|sign` | — | **Removed** (lending key facts statement, D-123: `/lending/portal/key-facts`) |
| `risk` | Legacy scorecard and restructure | `POST /risk/loan/:loanId/score`, `GET …/scores`, `POST …/restructure` | — | **Removed** (lending scoring and restructuring) |
| `collections` | Legacy collections queue, promises to pay, contact log; nightly promise review | `GET /collections/queue`, `GET/POST /collections/loans/:loanId/promises`, `PATCH /collections/promises/:id`, `POST /collections/loans/:loanId/log` | `COLLECTIONS_PTP_REVIEW_CRON` (01:30) | **Removed** (lending collections, UC-58; see §4 for the promise-to-pay gap) |
| `document-vault` | Upload, list and download documents on a legacy loan | `POST /documents/upload/:loanId`, `GET /documents/loan/:loanId`, `GET /documents/download/:documentId` | — | **Removed**; legacy files are still read through the customer document library (`linkLegacy`, `LEGACY_VAULT`); the key check moved to `lending/documents/legacy-storage-key.ts` |
| `ledger` | Chart of accounts; legacy journal writer; legacy journal and trial-balance read API | `GET /ledger/accounts`, `GET /ledger/journal`, `GET /ledger/trial-balance` | — | **Read API removed.** The service stays: the chart of accounts is shared, and the migration posts the clearing entry that closes a legacy loan. The combined ledger shows the legacy journal's balances. |

### 1.2 Shared modules that touched legacy loans

| Module | Dependency | Phase 1 |
|---|---|---|
| `borrowers` | Borrower is shared and stays. `GET /borrowers/:id` returned the legacy loans | Returns `legacyLoanCount`; the page lists lending loans (`GET /lending/loans?borrowerId=`) and links the archive |
| `borrower-portal` | Listed legacy loans, statements, legacy key facts and signature; KHQR | Lists the customer's **lending** loans, schedule, receipts and statement PDF; legacy key facts and signing removed (lending key facts stay); the tenant collection QR (`payment-instruments`) stays |
| `bot` (Telegram) | Created legacy loans (`originate_loan`), read legacy balances and products, late alerts on legacy schedules | Balances, products, late alerts and due reminders read **lending** loans; chat applications are **paused** (D-155) |
| `payment-instruments` | `GET /payment-instruments/for-loan/:loanId` resolved the QR of a legacy loan | That route removed; tenant QR settings stay |
| `tenants` | Platform statistics and the organisations list counted legacy loans and repayments | Count lending loans and receipts |
| `common/quota.guard` | `maxLoans` counted legacy loans on `POST /loans` | No route uses it any more (see §4) |
| `audit` (`AuditLog`) | Legacy loan events among sign-in, user and settings events | **Kept**: the audit log screen is the administration and sign-in log, not a legacy screen |
| `fx` | Exchange rates | **Kept**: lending reads them (overview, approval limits, payment channels) |
| `credit-bureau` | CBC checks per borrower | **Kept** (borrower-level) |
| `tenant-settings` | `accounting.legacy` accounts; `legacyServicing` thresholds | Kept; `accounting.legacy` is read by the return, the combined ledger and the migration; `legacyServicing` is unused (phase 2) |
| `tenants/tenant-purge` | Deletes the legacy tables of a purged tenant | Kept until the tables go |
| `authz` (legacy roles and `Permission` enum) | Gates the shared screens (borrowers, team, settings, FX, audit log, payment instruments) | Kept; the legacy loan permissions (`LOAN_*`, `LEDGER_VIEW`, `PROVISION_VIEW`…) gate nothing now (phase 2) |

### 1.3 Lending code that depends on legacy code or tables

| Lending code | Dependency | Phase 1 |
|---|---|---|
| `migration/loan-migration.service.ts` | Reads `Loan` and `RepaymentSchedule` (legacy export), locks and closes the legacy loan, posts the clearing entry via `LedgerService` | Kept (it is how loans leave the legacy book) |
| `reporting/regulatory-return.service.ts` | Reads `JournalEntry/Line`, `Loan`, schedules, repayments, `ProvisionRun/LoanProvision` (D-046) | Kept read-only while the legacy book has anything left; skipped once it is empty (D-157) |
| Combined trial balance (`/lending/regulatory/combined-trial-balance`) | Sums `JournalLine` | Kept (read-only) |
| `workspace/workspace-search.service.ts` | Searched legacy loans for legacy-screen users | Searches them for archive readers; results open the archive |
| `documents/customer-documents.service.ts` | Links `KycDocument`, legacy vault `Document`, application documents into the library | Kept |
| `accounting/posting.service.ts`, `lending-settings.service.ts`, `products.service.ts` | `LedgerService.ensureChartOfAccounts`, `DEFAULT_CHART_OF_ACCOUNTS` | Kept (shared chart) |
| `policy/catalogue.ts` | Flag `lending.legacy_loans.readonly` | Kept, documented as having no effect (phase 2) |

### 1.4 Web screens (`apps/web`)

| Screen (menu label) | Route | Phase 1 |
|---|---|---|
| Loans (original) and the loan page (early settlement, QR, risk panel, tools) | `/loans`, `/loans/[id]` | **Removed** |
| Repayments | `/repayments` | **Removed** |
| Collections (original) | `/collections` | **Removed** |
| Accounting (original) | `/accounting` | **Removed** (Combined ledger shows the legacy journal) |
| Provisioning | `/provisioning` | **Removed** |
| Products (original) | `/products` | **Removed** |
| Reports | `/reports` | **Rebuilt on the lending book** (portfolio, money received, CSV) |
| Performance | `/kpi` | **Rebuilt on the lending book** (ageing, PAR, ratios, income from the lending journal) |
| KPI dashboard | `/dashboard` | **Lending only** (was gated by legacy roles; now `loan.read`) |
| Audit log | `/audit` | Kept (administration and sign-in log) |
| FX rates | `/fx` | Kept (shared) |
| Borrowers, Team members, Settings | `/borrowers`, `/users`, `/settings` | Kept (shared); the borrower page lists lending loans |
| Borrower portal | `/portal` | Lending loans |
| — | `/lending/legacy-archive` | **New**: the legacy loan archive |

Components removed: `LoanModal`, `RepaymentModal`, `ProductModal`,
`EarlySettlementPanel`, `LegacyLoanTools`, `LegacyBanner`, `LegacyModuleNote`,
`LoanPaymentQr`, `RiskDecisionPanel`, `KeyFactsAgreement`, `SignaturePad`,
`components/reports/*`. Message namespaces removed: `Agreement`, `Collections`,
`LegacyFreeze`, `LoanDetails`, `Loans`, `PortfolioKpi`, `Products`,
`Repayments`, `Reports`, `Servicing.legacy` and the legacy keys of
`Overview`, `Dashboard`, `Borrowers.profile`, `Payments`, `Workspace.nav`.

### 1.5 Tables of the original module

`Loan`, `LoanProduct`, `LoanPolicy`, `RepaymentSchedule`, `Repayment`,
`JournalEntry`, `JournalLine` (the legacy journal), `ProvisionRun`,
`LoanProvision`, `LoanRestructure`, `CreditScore`, `Collateral`, `Guarantor`,
`LoanInteraction`, `Document` (the legacy vault), `LoanAgreement`,
`PromiseToPay`, and the enums `LoanStatus`, `InterestMethod`, `JournalSource`.
Shared and staying: `Borrower`, `KycDocument`, `LedgerAccount` (one chart for
both journals), `ExchangeRate`, `PaymentInstrument`, `AuditLog`, `Branch`,
`Tenant`.

---

## 2. What phase 1 changed

**Ported to the lending book**

* Reports (`/reports`): loan portfolio with filters (status, currency,
  branch, product, ageing band, reference), per-currency summary and PAR 30;
  money received for a date range with the principal / interest / charges
  split from the payment allocations; CSV exports (`loan_data.export`,
  audited, formula-safe).
* Performance (`/kpi`): arrears ageing, PAR 30/90, collection rate, allowance
  coverage, write-off rate, disbursed / collected / written off to date, and
  — for readers of the lending accounts — income and expense of the lending
  journal for the year to the business date, by ledger account.
* KPI dashboard (`/dashboard`): lending overview only.
* Borrower portal: the customer's lending loans, schedule, receipts and
  statement PDF.
* Telegram bot: balance and next instalment, product list, late notices and
  due-tomorrow reminders from lending loans and the business date.
* Platform statistics: lending loans and receipts.

**Kept, read-only**

* `GET /lending/legacy-archive/summary|loans|loans/:id|export.csv`
  (`legacy_loan.read`; Finance officer, Risk / compliance, Auditor), within
  the reader's branch scope.
* The loan-book migration's legacy export and the closing of a migrated
  legacy loan.
* The regulatory return's legacy part while the legacy book is not empty,
  and the combined ledger.

**Removed** — every other route, job and screen in §1.

## 3. The archive

Lending › Finance › **Legacy loan archive** (`/lending/legacy-archive`). In
the menu only for holders of `legacy_loan.read` and only while the
organisation still has a legacy loan. It shows counts (all, running, never
paid out, moved to lending), the principal still owed per currency, and every
legacy loan with its schedule and repayments. Each loan says whether it can
go through the migration file, where it went if it was migrated, or that it
is past maturity (no future instalment, so the migration file leaves it
out). **Export CSV** downloads the whole archive (or the filtered part).
Users with the migration permissions get links to Lending › Migration and to
the migration file of running loans.

## 4. Decisions needed from people

* **Matured legacy loans with arrears** (no instalment after the business
  date) cannot be moved by the migration file and can no longer be settled or
  written off in the original module. Options: extend the migration to carry a
  single overdue line, write them off in the general ledger outside the
  platform, or book a replacement loan. Until decided they stay in the archive
  and in the regulatory return. (D-158)
* **Pending or approved legacy applications** can no longer be paid out or
  rejected. Phase 2 marks them `REJECTED` with a reason; re-originate any
  still wanted in Lending › Applications.
* **Telegram chat applications** are paused. Rebuilding them on lending
  applications needs consent and affordability capture in the chat — a product
  and compliance decision (D-155).
* **Promise-to-pay follow-up** (UC-59: kept / broken automatically) existed
  only in the original module. Lending collections record `PROMISE_TO_PAY` as
  a task outcome without the automatic review.
* **Plan quota `maxLoans`** was enforced only on legacy loan creation. Decide
  whether lending booking should enforce it.
* **Tenants that had opted out of the freeze** (rule switching
  `lending.legacy_loans.readonly` off) could still collect in the original
  module; they can no longer do so and must migrate (D-153).

## 5. Phase 2 — dropping the legacy tables (not done)

### Preconditions (per organisation, then globally)

1. `GET /lending/legacy-archive/summary` shows `open = 0` for every tenant:
   every running legacy loan migrated (or the human decision in §4 applied to
   matured ones).
2. Pending/approved legacy applications closed (`REJECTED`, reason
   "original module retired").
3. Each organisation has downloaded the archive CSV and the combined trial
   balance at the cut-over, and the archive export is stored with its
   records-retention evidence (NBC record keeping; at least the statutory
   retention period after the last legacy loan closed). A full database
   backup taken just before the drop is retained for the same period.
4. The legacy journal is cleared: receivable and allowance balances
   (`accounting.legacy.loansReceivable`, `loanLossAllowance`) are zero for
   every currency in the combined trial balance; any residual is cleared
   against migration clearing (3900) by finance in the general ledger first.
5. The last regulatory return that includes legacy loans has been submitted;
   the next months' returns already show no legacy book (D-157).
6. Legacy vault documents are copied into the customer document library
   (Documents › link legacy, `POST /lending/document-library/link-legacy`)
   and their objects re-keyed, or confirmed out of retention.
7. No API call to a removed route in the access logs for 30 days.

### Steps

1. **Code, release N:** remove the archive (`lending/migration/legacy-archive.*`,
   the `/lending/legacy-archive` page, the menu entry, `LegacyArchive`
   messages), the legacy export and closing in `loan-migration.service.ts`
   and `legacy-lock.ts`, `gatherLegacy`/`legacyBookEmpty` and the combined
   trial balance's legacy column, the legacy search results, the `LEGACY_*`
   sources in `customer-documents.service.ts` (after step 6),
   `legacy-storage-key.ts`, `LedgerService.postEntry`, the
   `lending.legacy_loans.readonly` flag definition, `legacyServicing` and
   `accounting.legacy` in the tenant settings schema (a migration strips
   them from stored settings first), the legacy `Permission` codes and role
   mappings that gate nothing, `QuotaGuard`'s `loans`/`loanProducts` cases,
   `tenant-purge.service.ts`'s legacy deletes, the `legacyLoanCount` of
   `GET /borrowers/:id`, and the tenant-wall/tenant-guard entries for the
   legacy models. Ship and run for one full month-end.
2. **Schema, release N+1:** a migration (own prefix) that drops, in order:
   `PromiseToPay`, `LoanAgreement`, `LoanInteraction`, `Document` (vault),
   `Guarantor`, `Collateral`, `CreditScore`, `LoanRestructure`,
   `LoanProvision`, `ProvisionRun`, `JournalLine`, `JournalEntry`,
   `Repayment`, `RepaymentSchedule`, `Loan`, `LoanPolicy`, `LoanProduct`, then
   the enums `LoanStatus`, `InterestMethod`, `JournalSource`, and the
   `FeatureFlag`/`FlagRule`/`PlatformFlagRule` rows of
   `lending.legacy_loans.readonly`. Their RLS policies, triggers and
   `FORCE ROW LEVEL SECURITY` go with them. Generate it with
   `prisma migrate diff` from the previous schema, remove the models and
   back-relations (`Tenant`, `Borrower`, `Branch`, `LedgerAccount.lines`)
   from `schema.prisma`, and keep `LedgerAccount`.
3. **Checks:** `node scripts/check-migrations.mjs` (no drift), the
   integration suite from an empty database, the tenant-wall and RLS suites,
   a restore test of the pre-drop backup into a scratch database.
4. **Docs:** remove this document's archive sections, user-guide chapter 21,
   the legacy rows of the regulatory return in OPERATIONS.md and the
   decisions that only concern the original module (mark them superseded).

Rollback: release N is reversible by redeploying N-1 (no data changed).
Release N+1 is not reversible except by restoring the pre-drop backup, which
is why steps 3–6 of the preconditions come first.
