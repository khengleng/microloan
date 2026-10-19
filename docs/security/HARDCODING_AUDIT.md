# Hard-coding and in-process state audit

**Requirement (owner):** "make sure there is no hard coding in this platform, or in-memory scaffolding."

**Scope:** production code in `apps/api/src`, `apps/web/src`, `packages/shared/src`, `packages/db/src` and the seeds in `packages/db/prisma`. Tests are out of scope. Line numbers are those of the code **before** the change (commit `c6a92c6`).

**Method:** not a keyword grep. Every `process.env` read, every string literal (URLs, e-mail addresses, ids, phone numbers, credentials), every named numeric constant in services, every ledger posting, every class field and module-level variable of the API, every cron/interval job and every mock class was looked at and judged against the platform's deployment model: a multi-tenant SaaS on Railway with **several API instances** and restarts at any time. The structural checks are now automated in `scripts/config-audit.mjs` (section E), which on the old code reports 142 findings and on the new code none beyond the 29 allowlisted exceptions listed in section F.

Decisions: `docs/servicing/DECISIONS.md` D-070 … D-074.

## Where a value now lives

| Layer | For | Governed by | Code |
|---|---|---|---|
| Product configuration | Terms of one loan product | Maker-checker product versions | `packages/shared/src/lending/config.ts`, editor `apps/web/src/components/lending/products/configSchema.ts` |
| **Tenant lending settings** (new) | Rules of the lender as a whole | Maker-checker versions (`tenant_settings.manage` → `tenant_settings.approve`), audited | `packages/shared/src/lending/tenant-settings.ts`, model `TenantLendingSettings`, reader `apps/api/src/tenant-settings/tenant-settings.service.ts`, admin `apps/api/src/lending/accounting/lending-settings.service.ts`, API `GET/POST /v1/lending/ops/settings`, UI Lending › Operations › Lending settings |
| Deployment environment | Operational limits, secrets, endpoints, schedules, platform identity | Operator; validated at boot, documented in `.env.example` | `apps/api/src/config/env.ts`, `apps/api/src/config/operational-config.ts`, `apps/api/src/config/s3.ts`, `apps/web/src/lib/site.ts`, `apps/web/src/lib/server-api-url.ts` |
| PostgreSQL | Anything shared between instances or surviving a restart | Database constraints and RLS | `ScheduledJobClaim` + `apps/api/src/prisma/job-claim.service.ts`, leases on `OutboxMessage.availableAt` / `WebhookDelivery.nextAttemptAt`, counters by atomic increment |

Every moved value defaults to the constant it replaced.

## Finding counts

| Category | Findings | Fixed | Verified correct / kept with reason |
|---|---:|---:|---:|
| A. Secrets, endpoints, identities, env handling (A1–A19) | 19 (A17 alone covers 32 undocumented variables) | 19 | 0 |
| B. Business rules and parameters (B1–B29) | 29 | 29 | constants kept deliberately are listed at the end |
| B. Ledger postings bypassing the account mapping (L1–L10) | 10 services, 37 posting lines | 10 | 0 |
| C. In-process state and multi-instance correctness | 22 | 11 (C1–C11) | 11 (process-local by nature) |
| C. Mocks, stubs, test-only branches | 16 | 1 deleted | 8 mock adapters refused in production, 7 test branches that only stop timers |
| D. Web app (D1–D9) | 9 | 4 | 3 verified, 2 kept |
| E. Guard | — | new audit in CI | — |

## A. Secrets, environment, endpoints and identities

| # | Where (at c6a92c6) | What it was | What was done | Now lives in (default) |
|---|---|---|---|---|
| A1 | `apps/api/src/billing/billing.service.ts:18` | Stripe client built with `process.env.STRIPE_SECRET_KEY \|\| 'dummy_key'` | Client built per use from the configured key; every caller already refuses when the key is unset, so no placeholder key exists | `STRIPE_SECRET_KEY` (no default) |
| A2 | `billing.service.ts:75,76,99` | Stripe success/cancel/portal URLs fell back to `http://localhost:3000` — in production too | `webOrigin()`: `WEB_URL`, else the first CORS origin; localhost only outside production | `WEB_URL` → `CORS_ORIGINS[0]` |
| A3 | `apps/api/src/auth/auth.controller.ts:116` | Reset link base fell back to `''` (a relative link in an e-mail) | Same `webOrigin()` | as A2 |
| A4 | `apps/api/src/notifications/notification.providers.ts:32` | Sender `no-reply@localhost` when `EMAIL_FROM` unset, in production too | Production refuses to boot with `RESEND_API_KEY` but no `EMAIL_FROM` (`runtime-config.ts`); placeholder kept for development only | `EMAIL_FROM` |
| A5 | `notification.providers.ts:33` | Provider endpoint literal | Overridable | `EMAIL_API_URL` (Resend's public endpoint) |
| A6 | `apps/api/src/document-vault/document-vault.service.ts:40`, `lending/integrations/adapters.ts:223`, `lending/documents/document-storage.ts:123` | Three S3 clients each defaulting the region to `us-east-1`, each re-reading credentials | One reader `config/s3.ts`; production must state `AWS_REGION` when a bucket is set (boot check) | `AWS_REGION`, `AWS_*` |
| A7 | `lending/documents/document-storage.ts:206` | Local-disk documents in production behind several instances lose files uploaded elsewhere | Boot warning that every instance must mount the same volume; documented | `DOCUMENT_STORAGE_DIR` |
| A8 | `apps/api/src/auth/auth.module.ts:19`, `auth.service.ts:1020,1062` | Token lifetimes read ad hoc; a malformed `JWT_REFRESH_TTL` silently became 30 days in the database while the JWT library read it differently | Validated once (`envDuration`); malformed values stop the boot | `JWT_ACCESS_TTL` (15m), `JWT_REFRESH_TTL` (30d) |
| A9 | `auth.service.ts:460,643` | MFA challenge lifetime `'5m'` | env | `AUTH_MFA_CHALLENGE_TTL` (5m) |
| A10 | `auth.service.ts:95` | Password-reset link lifetime 1 h (and the e-mail said so) | env; the e-mail states the configured lifetime | `AUTH_PASSWORD_RESET_MINUTES` (60) |
| A11 | `auth.service.ts:104,754,1007`; `loans/loans.service.ts:349`; `penalty-cron/penalty-cron.service.ts:136`; `bot/bot.service.ts:12,87,125`; `lending/integrations/webhooks.service.ts:600` | Platform name "Magic Money"/"MagicMoney" in e-mails, authenticator label, bot prompt/messages, webhook User-Agent | One setting | `PLATFORM_NAME` ("Magic Money") |
| A12 | `bot/bot.service.ts:118,179` | AI model `'gpt-4o'` | env | `OPENAI_MODEL` (gpt-4o) |
| A13 | `apps/web/src/app/{privacy-policy,refund-policy,terms-and-conditions,pricing}/page.tsx` | Operator "DBank Cambodia", product "MicroLoan" and four `@dbankcambodia.com` addresses written into the legal pages | `apps/web/src/lib/site.ts` | `NEXT_PUBLIC_OPERATOR_NAME`, `NEXT_PUBLIC_PRODUCT_NAME`, `NEXT_PUBLIC_CONTACT_EMAIL_DOMAIN`, `NEXT_PUBLIC_{SUPPORT,PRIVACY,BILLING,SALES}_EMAIL` (previous values) |
| A14 | `apps/web/src/app/api/{auth/login,auth/google,auth/mfa,borrower/otp-request,borrower/otp-verify,proxy/[...path]}/route.ts` | Six copies of the API base URL resolution; `auth/mfa` fell back to `http://localhost:3001/v1` **in production** | One helper `apps/web/src/lib/server-api-url.ts`; production throws without `API_URL`/`NEXT_PUBLIC_API_URL` | `API_URL` / `NEXT_PUBLIC_API_URL` |
| A15 | `packages/db/prisma/demo-lending.ts:28` | Demo password literal `Demo#Lending2026` (also in `docs/lending/OPERATIONS.md`) | `DEMO_PASSWORD`, or a random password generated and printed by the run; users from an earlier run keep theirs | `DEMO_PASSWORD` (random) |
| A16 | `demo-lending.ts:281` | Authenticator issuer `MagicMoney` | Follows `PLATFORM_NAME` | `PLATFORM_NAME` |
| A17 | `.env.example` | 32 variables read by code were undocumented: `WEB_URL STRIPE_PRICE_PRO STRIPE_WEBHOOK_SECRET OPENAI_API_KEY CORS_ORIGIN DOCUMENT_UPLOAD_MAX_BYTES READINESS_DB_TIMEOUT_MS DOCUMENT_EXPIRY_CRON DOCUMENT_EXPIRY_DISABLED DOCUMENT_EXPIRY_REMINDER_DAYS DOCUMENT_STORAGE_DIR DOCUMENT_LINK_TTL_SECONDS DOCUMENT_LINK_SECRET LENDING_FX_SOURCE WEBHOOK_ALLOW_PRIVATE_NETWORKS LENDING_WEBHOOKS_DISABLED LENDING_METRICS_REFRESH_DISABLED LENDING_METRICS_REFRESH_SECONDS LENDING_RECONCILIATION_CRON LENDING_RECONCILIATION_JOB_DISABLED LENDING_EOD_CONCURRENCY RESEND_API_KEY SMS_API_URL SMS_API_KEY EMAIL_FROM METRICS_BEARER_TOKEN METRICS_ALLOW_PRIVATE_NETWORK RAILWAY_GIT_COMMIT_SHA DB_ROLE_MUST_RESPECT_RLS API_URL DEMO_SEED_ALLOW DEMO_PASSWORD` | All documented with their defaults, plus every new variable; now enforced by the `env-documented` check | `.env.example` |
| A19 | `document-vault/document-vault.controller.ts:22`, `lending/documents/document-rules.ts:32`, `health/health.controller.ts:47`, `lending/servicing/eod-scheduler.service.ts:84`, `lending/monitoring/lending-metrics.collector.ts:79`, `observability/sentry.ts:13` | `Number(process.env.X \|\| default)`: a malformed value became `NaN` or was silently replaced by the default | Read through `operationalConfig()`, validated at boot | `DOCUMENT_UPLOAD_MAX_BYTES` (10 MiB), `DOCUMENT_EXPIRY_REMINDER_DAYS` (30), `READINESS_DB_TIMEOUT_MS` (2000), `LENDING_EOD_MAX_CATCHUP_DAYS` (31), `LENDING_EOD_CONCURRENCY` (4), `LENDING_METRICS_REFRESH_SECONDS` (60), `SENTRY_TRACES_SAMPLE_RATE` (0.1) |
| A18 | `.env.example` (CBC section) | Claimed a "deterministic sandbox provider" is used without CBC credentials — untrue (the service refuses) and the sandbox class was dead code (C-M1) | Text corrected | — |

Literal credentials, tokens, keys, connection strings, bucket names, tenant/user/branch ids: **none** in production code (checked by `literal-secret`, `literal-uuid`; the only UUID-shaped literal is the all-zero input placeholder). Phone numbers: only file-format samples and the development seed (section F).

## B. Business rules and parameters

### Moved to tenant lending settings (`TenantLendingSettings`, maker-checker)

| # | Where (at c6a92c6) | What it was | Setting (default) |
|---|---|---|---|
| B1 | `apps/api/src/lending/reporting/regulatory-return.ts:154` (+ 7 uses) | NBC loan classes and provision rates for the monthly return | `regulatory.classes` (NBC: 0/15/31/61/91 days, 1/3/25/50/100%) |
| B2 | `apps/api/src/provisioning/provisioning.service.ts:55` via `packages/shared/src/provisioning.ts:30` | Legacy provisioning run's class tiers | same `regulatory.classes` (`classifyByDaysOverdue` takes the tiers) |
| B3 | `regulatory-return.ts:205` | KHR size bands = USD bands × 4,000 | `regulatory.sizeBandKhrPerUsd` ("4000") |
| B4 | `regulatory-return.ts:206` | Size band edges 500/1,000/5,000/10,000/50,000 USD | `regulatory.sizeBandEdgesUsd` |
| B5 | `regulatory-return.ts:226` | Rate band edges 12% and 15% | `regulatory.rateBandEdgesPct` (["12","15"]) |
| B6 | `apps/api/src/lending/payments/channel-files.service.ts:35` | Payment-file lines back-dated at most 30 days | `payments.maxBackdateDays` (30) |
| B7 | `apps/api/src/lending/payments/suspense.service.ts:173` | Unidentified receipt back-dated at most 30 days | same `payments.maxBackdateDays` (the file limit is "the suspense account's own limit") |
| B8 | `packages/shared/src/lending/channels.ts:83` | 5,000 lines per settlement/payroll file | `payments.maxFileLines` (5000); engine takes it as a parameter |
| B9 | `apps/api/src/lending/access/access-admin.service.ts:39` and `apps/web/src/components/lending/access/DelegationsTab.tsx:15` | Delegation at most 30 days, duplicated in the web form | `access.maxDelegationDays` (30); the form reads it from the access overview (`limits`) |
| B10 | `apps/api/src/penalty-cron/penalty-cron.service.ts:80` | Legacy loan marked DEFAULTED after 30 days overdue | `legacyServicing.defaultAfterDaysOverdue` (30) |
| B10a | `apps/api/src/penalty-cron/penalty-cron.service.ts` (new, D-102) | Cap on one legacy instalment's late penalty (there was none) | `legacyServicing.penaltyCapRate` ("0.25" of principal + interest) |
| B10b | (new, not a former constant) | Whether upfront fees count toward the interest-rate cap, and whether penalty interest and the over-limit rate must fit under it (DECISIONS D-108, D-109) | `rateCap.includeFeesInEffectiveRate` (true), `rateCap.penaltyRateMustFitCap` (true) |
| B10c | (new, not a former constant; DECISIONS D-118…D-122, assumed) | AML/CFT: name-match threshold, token floor, one-word penalty, ignored titles, re-screen batch size; watch-list size; risk weights, MEDIUM/HIGH thresholds, high-risk countries / occupations / product families, cash-intensive occupations, cash-share threshold and look-back, review months; cash transaction report thresholds and cash channels; record retention | `aml.screening.*` (0.88, 0.80, 0.80, titles, 200), `aml.watchList.maxEntries` (50,000), `aml.risk.*` (weights 10/6/3/2/3, 3/6, KP·IR·MM, …, 0.5, 365 days, 36/24/12 months), `aml.ctr.thresholds` (USD 10,000, KHR 40,000,000), `aml.ctr.cashChannels` (BRANCH_CASH), `aml.retentionYearsAfterRelationship` (5) |

### Moved to product configuration (product versions, editable in the product editor)

| # | Where | What it was | Field (default) |
|---|---|---|---|
| B11 | `apps/api/src/lending/facilities/facilities.service.ts:796` | Overdraft minimum payment due 21 days after the statement | `facility.minimumPaymentDueDays` (21) |
| B12 | `apps/api/src/lending/restructuring/restructuring.service.ts:1507` | Balloon follow-up task 30 days before a restructured balloon | `restructuring.balloonReminderDays` (30) |

Existing agreements keep working: stored configurations are parsed through the schema, so the new fields take their defaults.

### Moved to deployment environment (validated in `operational-config.ts`)

| # | Where (at c6a92c6) | What it was | Variable (default) |
|---|---|---|---|
| B13 | `lending/integrations/webhooks.service.ts:73` | 15 attempts | `LENDING_WEBHOOK_MAX_ATTEMPTS` (15) |
| B14 | `webhooks.service.ts:74` | Switched off after 50 failures | `LENDING_WEBHOOK_DISABLE_AFTER_FAILURES` (50) |
| B15 | `webhooks.service.ts:597` | 10 s timeout | `LENDING_WEBHOOK_TIMEOUT_MS` (10000) |
| B16 | `webhooks.service.ts:510,536` | Batches 100 / 500 | `LENDING_WEBHOOK_BATCH_SIZE` (100), `LENDING_WEBHOOK_FANOUT_BATCH_SIZE` (500) |
| B17 | `lending/accounting/operations.service.ts:746,768` | Outbox batch 50, 20 attempts | `LENDING_OUTBOX_BATCH_SIZE` (50), `LENDING_OUTBOX_MAX_ATTEMPTS` (20) |
| B18 | `lending/migration/loan-migration.service.ts:63` | 10,000 loans per migration file | `LENDING_MIGRATION_MAX_ROWS` (10000) |
| B19 | `auth/auth.service.ts:31,32` | Lockout after 5 failures for 30 minutes | `AUTH_MAX_FAILED_LOGINS` (5), `AUTH_LOCKOUT_MINUTES` (30) |
| B20 | `borrower-portal/borrower-auth.service.ts:10-14` | OTP 5 minutes, 5 guesses, 3 codes per 15 minutes (the SMS also said "5 minutes") | `BORROWER_OTP_TTL_SECONDS` (300), `BORROWER_OTP_MAX_ATTEMPTS` (5), `BORROWER_OTP_MAX_PER_WINDOW` (3), `BORROWER_OTP_WINDOW_MINUTES` (15) |
| B21 | `borrower-portal/borrower-jwt.ts:15` | Borrower session 2 h | `BORROWER_TOKEN_TTL` (2h) |
| B22 | `billing/signup-payment.service.ts:16` | Signup QR valid 7 days | `SIGNUP_PAYMENT_TTL_DAYS` (7) |
| B23 | `tenants/tenants.service.ts:298` | Erasure notice 30 days | `TENANT_ERASURE_GRACE_DAYS` (30) |
| B24 | `app.module.ts:55` | 120 requests/second | `RATE_LIMIT_PER_SECOND` (120) |
| B25 | `main.ts:70,71` | 5 MB body limit | `API_BODY_LIMIT` (5mb) |
| B26 | `lending/policy/policy.service.ts:37` | Authorization memo 30 s | `LENDING_AUTHZ_CACHE_TTL_MS` (30000); new bound `LENDING_AUTHZ_CACHE_MAX_ENTRIES` (5000) |
| B27 | `packages/shared/src/currency.ts:93`, `tenants/settings.controller.ts:66`, `lending/reporting/regulatory-return.service.ts:415`, `risk/risk.service.ts:96,173` | NBC 18% ceiling (a tenant may only lower it) | `REGULATORY_MAX_ANNUAL_RATE_PCT` (18); the shared functions take the ceiling as a parameter; the lending platform resolves the cap in force in one place, `lending/common/rate-cap.service.ts` → `packages/shared/src/lending/rate-cap.ts` (lowest of this ceiling, `Tenant.maxAnnualInterestRatePct` and the product's `pricing.regulatoryCapAnnualRate`; D-105) |
| B28 | `penalty-cron.service.ts:19,114`, `reminder/reminder.service.ts:19`, `bot/bot.service.ts:319`, `collections/collections.service.ts:101` | Legacy job schedules | `LEGACY_PENALTY_CRON`, `LEGACY_UPCOMING_REMINDER_CRON`, `LEGACY_REMINDER_CRON`, `LEGACY_LATE_ALERT_CRON`, `COLLECTIONS_PTP_REVIEW_CRON` (previous times) |
| B29 | `penalty-cron.service.ts:66` | Penalty fallback `?? 10.0` | Removed: `Tenant.penaltyRatePerDay` is required with a column default, so the literal could never apply |
| B30 | `penalty-cron.service.ts`, `reminder/reminder.service.ts`, `bot/bot.service.ts`, `collections/collections.service.ts` (D-102) | Legacy jobs ran in the server's time zone | `timeZone: LENDING_EOD_TZ` (Asia/Phnom_Penh), shared with end of day via `loans/legacy-money.ts` |
| B31 | `provisioning/provisioning.service.ts` (new, D-101) | Transaction timeout of a legacy provisioning run under its advisory lock | `LEGACY_PROVISIONING_TX_TIMEOUT_MS` (120000) |

### Ledger postings that bypassed the account mapping

Every service that posted to `ACCOUNT_CODES.*` now takes the code from the tenant lending settings (`accounting.*`, defaults = the previous codes). Codes are checked against the tenant's chart when a version is proposed.

| # | Where (at c6a92c6) | Account(s) | Setting |
|---|---|---|---|
| L1 | `lending/accounting/period-close.service.ts:1104,1108` | Retained earnings 3100 (year-end close) | `accounting.retainedEarnings` |
| L2 | `lending/migration/loan-migration.service.ts:1248,1252,1318` | Migration clearing 3900 | `accounting.migrationClearing` |
| L3 | `loan-migration.service.ts:1298,1322` | Legacy loans receivable 1200 (clearing a migrated legacy loan) | `accounting.legacy.loansReceivable` |
| L4 | `lending/payments/payment-channels.service.ts:946-967,1006-1007` | FX position 1050, FX gain/loss 4410, cash 1000 | `accounting.fxPosition`, `fxGainLoss`, `cash` |
| L5 | `lending/payments/suspense.service.ts:189,191,283,433,436` | Cash 1000, unidentified suspense 2500 | `accounting.cash`, `unidentifiedSuspense` |
| L6 | `lending/reporting/regulatory-return.service.ts:439,440` | Legacy receivable/allowance read for the return | `accounting.legacy.*` |
| L7 | `loans/loans.service.ts:318-324,491-492` | Legacy disbursement and write-off | `accounting.cash`, `accounting.legacy.*` |
| L8 | `repayments/repayments.service.ts:92-96,263-271,444-447` | Legacy repayments, payoff, reversal | `accounting.cash`, `accounting.legacy.*` |
| L9 | `provisioning/provisioning.service.ts:132-137` | Legacy provision expense 5000 / allowance 1300 | `accounting.legacy.provisionExpense`, `loanLossAllowance` |
| L10 | `kpi/kpi.service.ts:98-102,151` | KPI income/expense read by code | `accounting.legacy.*` (default chart for the platform-wide view) |

A changed account applies to new postings only; moving a balance is a journal finance makes (D-071). Product postings already used the product's `accounting` mapping; the read-side fallbacks `?? '1300'`, `?? '2300'` … in `operations.service.ts`, `syndication.service.ts`, `invoice-finance.service.ts` and `regulatory-return.service.ts:200-205,312-316` remain: they apply only to agreements stored before a mapping key existed and equal the schema defaults; nothing posts with them.

## C. In-process state and multi-instance correctness

### Fixed

| # | Where (at c6a92c6) | What it was | Problem with several instances / a restart | What it is now |
|---|---|---|---|---|
| C1 | `lending/integrations/webhooks.service.ts:119,503-520` | `private running = false` overlap guard | Only stopped one instance overlapping itself; two instances read the same due deliveries and **sent each twice** | Guard removed; each delivery is claimed with a lease on `nextAttemptAt` (`LENDING_DELIVERY_LEASE_SECONDS`, 120 s) by a conditional update before sending |
| C2 | `webhooks.service.ts:640` | `consecutiveFailures + 1` read-then-write | Concurrent failures on two instances counted once; the switch-off threshold drifted | Atomic increment, switch-off by conditional update |
| C3 | `lending/accounting/operations.service.ts:739-775` | Outbox delivery `@Interval` on every instance, no claim | Every instance sent the same messages | Per-message lease claim on `availableAt` |
| C4 | `penalty-cron/penalty-cron.service.ts:19-110` | Midnight penalty job on every instance; the "not yet today" check was a read followed by an unconditional increment | **Every instance charged the same penalty** (money) and alerted the borrower | Conditional `updateMany` (not penalised today) is the claim; only the winner alerts |
| C5 | `penalty-cron.service.ts:114`, `reminder/reminder.service.ts:19`, `bot/bot.service.ts:319` | Daily reminders and late notices on every instance | Each borrower messaged once per instance | Claimed once per tenant per day in `ScheduledJobClaim` (`JobClaimService.once`) |
| C6 | `bot/bot.service.ts:25,195,313,329` | `Map<tenantId, Telegraf>` of bots polled from every instance; sending looked up this map | Telegram allows one poller per token (409 on the others, unhandled promise); a token changed on one instance stayed stale on the others | Polling leased per tenant in `ScheduledJobClaim` (90 s, renewed every 30 s, released on shutdown); sending reads the token from the database on any instance; `launch()` errors are caught; `TELEGRAM_POLLING_ENABLED` to opt an instance out |
| C7 | `bot/bot.service.ts:28` | `private enabled = false` | — (process flag) | Derived from the OpenAI client (getter), no stored flag |
| C8 | `lending/policy/policy.service.ts:49,50,78` | Subject/context memo; `invalidateAll()` cleared only the local maps on a platform rule change; FX rates did not invalidate; unbounded growth (old versions never evicted) | A platform flag rule approved on instance A applied on instance B up to 30 s later; same for new FX rates; memory grew with every version | Platform rule approval bumps every tenant's `authzVersion` in the database; recording an FX rate bumps the tenant's; the platform context is never cached; maps bounded and swept (`LENDING_AUTHZ_CACHE_MAX_ENTRIES`) |
| C9 | `plan-tiers/plan-tier.service.ts:65,101` | 30 s in-process tier cache, busted only on the writing instance | A lowered quota or retired tier stayed in force on other instances | Removed: one small indexed read per quota-checked write |
| C10 | `auth/auth.service.ts:590-600,710-717` | Failed-login counter `loginAttempts + 1` read-then-write | Parallel guesses across instances under-counted, weakening the lockout | Atomic increment, lock set when the counted value reaches the threshold |
| C11 | `app.module.ts:57` | Throttler storage in memory unless `NODE_ENV=production` | A multi-instance staging/preview deployment had per-instance budgets | Redis whenever `REDIS_URL` is set; in-memory only for a single development process |

### Kept (process-local by nature; allowlisted with reasons)

| Where | Why it is correct with several instances and after a restart |
|---|---|
| `lending/accounting/posting.service.ts:33` `accountIds` | Memo of committed ledger account ids. Ids are immutable, accounts are never deleted or renamed (no code path does; the journal FK restricts it); an id seen on any instance is right on every instance (D-052). |
| `lending/policy/policy.service.ts` `subjects`, `contexts` | Read-through memo validated against the database `authzVersion` on every request (C8), bounded, TTL-limited. |
| `common/field-crypto.ts:17,18,73` | Memo of keys derived from the environment (scrypt, HMAC); identical everywhere. `warned` only affects logging. |
| `prisma/tenant-guard.ts:353` `relationIndex` | Index of the Prisma schema from the generated client: code metadata. |
| `observability/sentry.ts:5` | Whether this process initialised Sentry. |
| `lending/documents/document-storage.ts:198` `store` | Lazily built storage client from the environment; no data. |
| `lending/monitoring/lending-metrics.collector.ts:51,52` | Timer handle and overlap guard of this process's own gauge refresh; each instance exposes its own `/metrics`. The cross-instance reconciliation job already holds an advisory lock. |
| `lending/servicing/servicing.service.ts` hook arrays, `lending/origination/applications.service.ts:98` | Registries of functions modules register at boot: code wiring, identical on every instance. |
| `bot/bot.service.ts` `pollers`, `renewTimer` | The live connections and timer of this process; which process polls is leased in the database (C6). |
| `lending/servicing/batch-scope.ts` (`openPeriods`, `memo`) | Per-run memo inside one end-of-day run (AsyncLocalStorage), discarded with the run; the database trigger still refuses a posting into a closed month (D-051). |
| Per-run maps in `penalty-cron`, `reminder`, `bot` jobs | Local variables of one run (thresholds and claims already read), never kept between runs. |

Jobs already correct before the change: end of day, document expiry and the reconciliation monitor hold a Postgres advisory lock for the run and are idempotent by business date; promise-to-pay review decides each promise with a conditional update.

### Mocks, stubs and test branches

| Where | Finding | Result |
|---|---|---|
| `credit-bureau/cbc.provider.ts:50` `MockCbcProvider` | Sandbox bureau producing fabricated scores; not flagged as a mock and not refused in production; unused | **Deleted** (C-M1) |
| `lending/integrations/adapters.ts` `MockPayments`, `MockKyc`, `MockBureau`, `MockNotifications`, `MockAccountingExport`, `MockBankDebit`, `MockFxFeed`, `MockDocuments` | Mock adapters | Kept: each declares `isMock = true` and `AdapterRegistry.guard()` throws in production; the capability screen shows them as MOCK. `MockFxFeed`'s fixed rates (1 USD = 4,100 KHR …) are dev-only and only selected by `LENDING_FX_SOURCE=MOCK`. |
| `NODE_ENV === 'test'` in `webhooks.service.ts` (tick), `eod-scheduler.service.ts`, `document-expiry.scheduler.ts`, `lending-metrics.collector.ts` (×2), `collections.service.ts`, `bot.service.ts` (new) | Test branches | All only disable a scheduler/timer entry point (now enforced by `test-branch`). |
| TODO/FIXME stubs returning fixed values | None found. | — |
| Seeded fake data in production paths | None: `seed.ts` skips demo data outside development; `demo-lending.ts` refuses production without `DEMO_SEED_ALLOW=true`. | — |

## D. Web app

| # | Where | Finding | Result |
|---|---|---|---|
| D1 | API route handlers (A14) | Duplicated API URL, one with a production localhost fallback | Fixed |
| D2 | Legal and pricing pages (A13) | Operator name and e-mails | Fixed |
| D3 | `DelegationsTab.tsx:15` (B9) | Business limit duplicated in the client | Fixed: read from the API |
| D4 | `tenants/page.tsx:459`, `login/page.tsx:155`, `register/page.tsx:363` | Placeholder addresses on real-looking domains (`tenant.com`, `company.com`) | Reserved `example.com` |
| D5 | Tokens in `localStorage` / `sessionStorage` | None: tokens are HttpOnly cookies set by the route handlers; the browser calls `/api/proxy` | Verified |
| D6 | Menus | Computed from `GET /me/access` permissions (`lib/nav.ts`, D-042) | Verified |
| D7 | Mock data rendered in pages | None; the integrations screen labels mock adapters as such | Verified |
| D8 | `settings/page.tsx:261`, `users/page.tsx:46,217,248`, `reports/page.tsx:81`, `billing/plan-change-card.tsx:56` | Role-name checks | Kept: they mirror server gates that are themselves by role (`@Roles('TENANT_ADMIN')` on plan change, platform vs tenant identity); `/me/access` has no permission to read instead. Removing them is part of the legacy role migration (D-042). |
| D9 | `lib/nav.ts` `legacyRoles` | Role fallback for legacy screens | Kept (D-042), same reason |

## E. The guard

`scripts/config-audit.mjs`, run by `pnpm security:config-audit`, part of `pnpm security:ci` and the CI job "Configuration and in-process state audit" (`.github/workflows/security.yml`). It parses every production file with the TypeScript compiler (about 1 s) and fails on:

| Rule | Catches | Would have caught |
|---|---|---|
| `env-documented` | Any `process.env.X`, `env.X`, `envInt('X')`… not in `.env.example` | A17 (32 variables) |
| `literal-secret` | Private keys, AWS/Stripe/Slack/GitHub/Telegram tokens, JWTs, credential-bearing connection strings, `password: '…'`, and a secret-named value falling back to a literal | A1 `'dummy_key'`, A15 `Demo#Lending2026` |
| `literal-url` / `literal-email` / `literal-uuid` / `literal-phone` | Literals outside reserved names (`localhost`, `example.*`, `*.test`) and a short list of vendor protocol endpoints | A13, D4 |
| `brand` | The operator's names outside their default files | A11, A13, A16 |
| `ledger-code` | `accountCode: ACCOUNT_CODES.…` or a literal code outside the ledger module | L1–L10 (37 lines) |
| `rule-constant` | Module constants named `MAX_*`, `MIN_*`, `*_DAYS`, `*_ATTEMPTS`, `*_TTL`, `*_LIMIT`, `*_FAILURES` … in the API | B6, B9, B13, B14, B18, B19, B20, B26, C9 |
| `module-state` | Module-level `let`/`var`, or a module-level Map/Set/array that the file mutates (API) | the kept memos (now allowlisted) |
| `instance-state` | On a framework-held class (decorated): a Map/Set/array/object field, a non-readonly flag/counter, a mutable static (API) | C1 `running`, C7 `enabled`, C9 `cache`, C6 `bots`, C8 maps |
| `test-branch` | `NODE_ENV === 'test'` outside a `@Cron`/`@Interval`/lifecycle/timer entry point | — (none present) |
| `mock-unguarded` | A `Mock*/Fake*/Stub*/Dummy*` class without `isMock = true` and the production guard | C-M1 `MockCbcProvider` |

Run against the code before this change it reports 142 findings in these rules; on the new code it passes with 29 allowlisted exceptions.

The existing keyword scans (`security-scan.mjs`) still run. Two changes make them meaningful rather than something to dodge: the time-bomb rule now needs a literal date or epoch next to a switch name (a name such as `disableAfterFailures` alone proves nothing), and the memory rule ignores comments and Markdown documents (prose describing behaviour is not a store).

## F. The allowlist (`scripts/config-audit-allowlist.json`)

29 entries, each with a rule, file, match, reason and an expiry (2027-06-30). An expired entry, or one that no longer matches anything, fails the audit.

- **Defaults of configurable identity** (4): `PLATFORM_NAME` default in `operational-config.ts`; operator name and contact domain defaults in `apps/web/src/lib/site.ts`; demo seed issuer fallback.
- **Process-local state** (19): the "Kept" table in section C.
- **Safety bound** (1): `MAX_PIXELS` in `billing/qr-image.ts` — a decompression-bomb guard of the image decoder, not a business or deployment choice.
- **Sample data** (4 + 1): the payroll file example in `components/lending/channels/types.ts`, the migration template's sample row in `packages/shared/src/lending/migration.ts` (2), the development seed borrower's phone in `seed.ts`.

## Kept as constants, deliberately

| What | Where | Why it is not configuration |
|---|---|---|
| ISO 4217 currency definitions, minor units, rounding | `packages/shared/src/lending/money.ts`, `currency.ts` | Standards, not choices. |
| Day-count conventions, date arithmetic, 360/365, 12 periods a year | `lending/dates.ts`, `income-contingent.service.ts:40` | Mathematics of the conventions a product selects. |
| PAR1/PAR30/PAR90 and the aging buckets (1–7, 8–30, 31–60, 61–90, 90+) | `period-close.service.ts:638`, `regulatory-return.ts`, `kpi.service.ts`, `reports.service.ts` | Definitions of the metrics; a lender's own risk classes are configurable (B1). |
| Legacy collections' advisory labels (8/31/90 days) | `collections/collections.service.ts:88`, `reports.service.ts:720` | Display hints in the legacy screens; the lending platform's collection strategy is product configuration (`collections`). |
| Bureau score → letter grade (750/650/550/450) | `credit-bureau/cbc.provider.ts` | Used only when the bureau's response omits its own grade. |
| Product-mapping read fallbacks (`?? '2300'` …) | see section B, ledger | Only for agreements stored before a key existed; equal to the schema defaults; never used to post. |
| Built-in workflow templates (e.g. two approvers above 100,000 USD / 400,000,000 KHR) | `lending/products/workflows.service.ts:113` | Templates; a tenant's own ACTIVE workflow version replaces them (maker-checker). |
| Catalogue templates' defaults (rates, grace days, advance rates …) | `packages/shared/src/lending/catalogue.ts` | Starting points copied into a product, then edited and approved per product. |
| Plan-tier emergency ceilings (3 users, 50 borrowers …) | `plan-tiers/plan-tier.service.ts:49` | Fail-closed fallback only when the tier table is unreachable. |
| Per-route rate limits on authentication endpoints | `auth.controller.ts`, `borrower-portal.controller.ts` | Security policy of each endpoint, reviewed with the code; the global budget is configurable (B24). |
| Advisory-lock keys | `eod-scheduler.service.ts:12`, `document-expiry.scheduler.ts:8`, `lending-metrics.collector.ts:18` | Identifiers that must be equal on every instance. |
| Webhook backoff curve (30 s doubling, 6 h cap), outbox backoff (1 min doubling, 1 h cap) | `webhooks.service.ts`, `operations.service.ts` | Retry mechanics; the limits that matter (attempts, switch-off, timeout) are configurable. |
| HTTP status codes, Prisma enums, permission and action codes, CSP directives, HSTS max-age | various | Protocol and schema constants. |
| Vendor endpoints: Google Identity Services, Microsoft Clarity loader, Telegram BotFather link | `main.ts:43`, `google-sign-in-button.tsx`, `clarity.ts`, settings page | Third-party protocol constants; whether each is used is configured (`GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_CLARITY_PROJECT_ID`). |
| `NBC_IMPAIRMENT_CLASSES`, `NBC_ANNUAL_INTEREST_CAP_PCT`, `MAX_FILE_LINES` in the shared engine | `packages/shared` | Kept as the **defaults** the settings and env use; the engine takes the actual values as parameters. |

## Operational notes for deployment

- Production now refuses to boot when `AWS_S3_BUCKET_NAME` is set without `AWS_REGION`, when `RESEND_API_KEY` is set without `EMAIL_FROM`, or when any operational variable is malformed. Check these before deploying.
- Payment links and password-reset links use `WEB_URL`, else the first `CORS_ORIGINS` entry — set `WEB_URL` if the web app is not the first CORS origin.
- With several API instances: customer documents need S3 (or one volume all instances mount); Telegram polling now runs on one instance per bot.
