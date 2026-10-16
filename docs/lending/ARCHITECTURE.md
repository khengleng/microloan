# Lending platform — architecture

The configurable lending platform is a **modular monolith** added beside the
existing Magic Money app. It reuses the app's tenants, users, branches,
borrowers, authentication, Prisma tenant guard and chart of accounts, and owns
everything about configurable products, origination, servicing, lending
accounting, restructuring and lending access governance. The legacy `/loans`
module is untouched and keeps working; the two do not share loan records.

```
packages/shared/src/lending/   pure engine: money, dates, schedules, fees, APR, servicing,
                               affordability, restructuring, config schema, catalogue, capabilities
packages/db/prisma/            schema (+ lending models), migrations 20261016_lending_platform_phase1,
                               20261017_lending_facilities_phase2, 20261017_lending_rate_resets,
                               20261017_lending_group_liability
apps/api/src/lending/
  policy/        RBAC + ABAC + feature-flag decision engine, permission/role/flag catalogue
  products/      product catalogue, versions (maker-checker lifecycle), workflows, simulation
  origination/   applications, documents, collateral, guarantees, assessment, decisions,
                 booking, solidarity groups and joint liability
  servicing/     disbursement, accrual, repayment, prepayment, settlement, reversal,
                 penalties, delinquency, write-off, floating-rate resets, export,
                 end-of-day batch
  facilities/    limits, availability, drawdown governance, tranche conditions,
                 facility charges, statements, limit changes, term-out
  restructuring/ hardship cases, affordability, proposals, approval/acceptance, amendments, monitoring
  accounting/    balanced postings, trial balance, reconciliation, journal, audit explorer, outbox
  access/        roles, assignments, delegations, authorities, ABAC policies, flags, service accounts,
                 policy simulator
  integrations/  adapter interfaces + clearly-labelled mocks (blocked in production)
apps/web/src/app/[locale]/(app)/lending/   administration screens
```

## The eight separate concepts

| Concept | Where it lives |
|---|---|
| Loan family | `LoanFamily` (platform catalogue), `LOAN_FAMILY_DEFINITIONS` |
| Product template | `ProductTemplate` (platform catalogue), `PRODUCT_TEMPLATES` |
| Product version | `ProductVersion` (+ `PricingConfiguration`, `RepaymentConfiguration`) — immutable once approved |
| Loan agreement | `LendingAgreement` + immutable `AgreementVersion` snapshots of config + terms + engine input |
| Calculation method | the engine (`generateSchedule`, `calculateRestructure`, …), selected by configuration |
| Workflow | `WorkflowVersion` (supported steps + approval levels) with built-in defaults |
| Feature flag | `FeatureFlag` + `PlatformFlagRule` + `FlagRule` + `FlagChangeApproval` + `CohortMembership` |
| Authorization policy | permissions/roles/assignments/delegations/authorities + `AccessPolicy`/`PolicyVersion` (ABAC) |

There is **one** engine and **one** servicing path for every product. A product
configuration only *selects* supported behaviour; it is validated by a strict
schema (`productConfigSchema`, every object `.strict()`), so an unknown key such
as `formula`, `script` or `sql` is a validation error.

## Name mapping to the specification's minimum data model

Some names already existed in the app, so lending models use distinct names:

| Specification | Model |
|---|---|
| Tenant, Branch, User, Borrower | existing `Tenant`, `Branch`, `User`, `Borrower` |
| LegalEntity, Portfolio | `LegalEntity`, `Portfolio` |
| Role, Permission, RoleAssignment | `AccessRole`, `AccessPermission` (+ `RolePermission`), `RoleAssignment` |
| Delegation, ApprovalAuthority | `Delegation`, `ApprovalAuthority` |
| AccessPolicy, PolicyVersion | `AccessPolicy`, `PolicyVersion` |
| FeatureFlag, FlagRule, FlagChangeApproval | `FeatureFlag`, `FlagRule` (+ `PlatformFlagRule`), `FlagChangeApproval` |
| LoanFamily, ProductTemplate, ProductVersion | same names (+ `LendingProduct`) |
| PricingConfiguration, RepaymentConfiguration, WorkflowVersion | same names |
| BorrowerGroup, GroupMembership | same names (+ `LoanGroupMember`, `GroupContribution`) |
| Application, CreditDecision, ApprovalTask | same names |
| Collateral, Guarantee, Valuation | `CollateralAsset` (+ `CollateralPledge`), `Guarantee`, `Valuation` |
| Facility, Drawdown | same names (+ `FacilityCondition`, `FacilityStatement`, `FacilityLimitChange`) |
| LoanAgreement | `LendingAgreement` + `AgreementVersion` (the existing `LoanAgreement` is the key-facts e-signature record) |
| RateObservation | same name |
| RepaymentSchedule | `ScheduleInstalment` |
| AccrualEvent, FinancialEvent, PaymentAllocation | same names |
| JournalEntry, JournalLine | `LendingJournalEntry`, `LendingJournalLine` (posting to the tenant's existing `LedgerAccount` chart) |
| RestructureAgreement | `RestructureCase`, `RestructureProposal`, `RestructureApproval`, `RestructureAcceptance`, `LoanAmendment`, … |
| AuditEvent | `AuditEvent` |

## Facilities

A facility is a limit the borrower draws against, not a principal disbursed
once. Three behaviours differ in one respect each and share one
implementation:

| Type | Limit reinstates on repayment | Drawdowns | At the end of availability |
|---|---|---|---|
| `REVOLVING` | yes | repeated | terms out, if configured |
| `OVERDRAFT` | yes | continuous balance | repayable on demand |
| `STAGED_DRAWDOWN` | no | tranches, released in full | terms out |

* **The drawn balance is an ordinary loan account.** A facility's balance,
  accrual postings, repayments, reversals, delinquency, reconciliation and GL
  entries all live on its `LoanAccount` and move through the servicing path
  that term loans use. `Facility` owns only the limit and the governance
  around drawing against it, so there is still one servicing path.
* **Interest is charged on the drawn balance day by day**, never on the limit,
  through the same `dailyAccrual` the term-loan engine uses. A balance above
  the limit is split out and priced at `overlimitRate`, so the penalty element
  is visible on the statement; with no over-limit rate configured, an
  over-limit balance is refused rather than silently charged.
* **A commitment fee is priced like interest** on the daily *undrawn* amount.
* **Drawdowns are maker-checker**: `REQUESTED → APPROVED → RELEASED`, with one
  in flight at a time. The limit is re-checked against committed movements at
  request, at approval and again at release, because the limit can be consumed
  between any two of them. Releasing posts a `DISBURSEMENT` financial event
  with a balanced journal and requires an `Idempotency-Key`.
* **A staged tranche releases in full or not at all**, on or after its date,
  with every condition precedent satisfied or waived. Satisfying a condition is
  evidence-backed; waiving one is a credit concession and needs the credit
  approver's permission and a reason.
* **A limit cannot be cut below what is already drawn** — outstanding for a
  reinstating limit, cumulative advances for a staged one.
* **Term-out** returns the principal and remaining months; the schedule itself
  is built by `generateSchedule`, so a termed-out facility is serviced from
  then on by exactly the term-loan code.

Facility behaviour is flag-gated per type (`lending.revolving.drawdown`,
`lending.facility.overdraft`, `lending.facility.staged_drawdown`), all off by
default.

## Floating rates

A floating product prices at `benchmark + margin`, bounded by an optional
floor and cap, and re-prices on a fixed cycle (`MONTHLY`, `QUARTERLY`,
`SEMI_ANNUAL`, `ANNUAL`). Projection and re-pricing are deliberately separate:

* **Projection** is what a quote or a newly booked schedule looks like if the
  benchmark never moved. The opening rate is contractual; every point after
  the first reset carries `projected: true`, and so do the instalments it
  produces, so a floating loan's later payments are never presented as fixed.
* **A reset** is the contract actually re-pricing. On each reset date the
  benchmark observed *on or before* that date is read, bounded, and the unpaid
  tail of the schedule is rebuilt at the new rate.

Rules the engine holds to:

* **A reset takes effect from the first interest period starting on or after
  the reset date.** Interest already earned in a part period is never
  re-priced, so a reset cannot change what the borrower has been billed.
* **The balance and the remaining term do not change** — only the rate does,
  so the instalment is recomputed over the same number of payments. An
  equal-principal or explicitly dated plan keeps its principal amounts and
  re-prices only the interest.
* **A reset date re-prices a loan exactly once**, enforced by a unique index
  on `(loanAccountId, resetDate)`, so a batch re-run cannot double-apply it.
* **Missed resets are caught up oldest first**, each at the benchmark that
  applied then — never by jumping the loan to today's rate.
* **An absent benchmark stops the reset** rather than inventing a rate: the
  loan waits for the observation.
* **Nothing is posted.** A reset moves no money; it changes what future
  interest will be, and accrual follows the new schedule from there.

Each reset writes an immutable `RateReset` row — the observation, the
unbounded `benchmark + margin`, which of benchmark/floor/cap bound it, and the
`AgreementVersion` it produced (reason `RATE_RESET`). The schedule it replaced
survives as `SUPERSEDED` instalments on the previous version. Resets run in
the end-of-day batch and can also be applied on demand
(`POST /lending/loans/:id/rate-resets`).

Floating pricing is flag-gated (`lending.pricing.floating_rate`), off by
default.

## Group lending

Two arrangements are distinguished, because they differ in the one respect
that matters when a member stops paying:

| `identity.liability` | One loan or many | A member is liable for |
|---|---|---|
| `GROUP_JOINT` | one loan for the group | **the whole balance** |
| `GROUP_INDIVIDUAL` | one loan, shares tracked | their own share only |

* **A share is not a liability cap.** Under `GROUP_JOINT` each member's
  `liableFor` is the entire principal; the share only records what they agreed
  to carry internally. `LoanGroupMember` stores both, so the difference cannot
  be lost by a later configuration edit.
* **Liability is frozen at booking.** Admitting or removing a member afterwards
  changes the group, never a loan already running — the binding is append-only.
* **An equal split puts the residual on the leader** rather than spreading
  sub-unit amounts the currency cannot settle; shares always sum to the
  principal exactly.
* **A surplus from one member covers another's shortfall** and the group is
  current: the loan does not care who paid. Per-member positions are still
  reported, because that is what the group meeting acts on.
* **Exit is governed.** Under joint liability a member cannot leave while the
  loan is outstanding unless the product allows it, and then only by settling
  their share; leaving must not drop the group below its minimum, and the
  leader cannot leave without a successor.
* **A borrower belongs to one active group at a time**, and a group with a
  live loan cannot be disbanded.
* **Affordability is measured on the group's combined income.** One instalment
  is serviced by the whole group, so assessing it against the leader's income
  alone would refuse loans a solidarity group can comfortably service.

The application for a group loan names the group and carries the leader as its
borrower. Group lending is flag-gated (`lending.group.joint_liability`), off by
default.

## Money, dates and the engine

* **Decimal arithmetic everywhere.** The engine uses `decimal.js` at 40
  significant digits; its public boundary takes and returns decimal *strings*.
  Money columns are `Decimal(24,4)`, rates `Decimal(18,10)` (decimal fractions:
  `0.12` = 12%).
* **Currencies are explicit.** `CURRENCY_DEFINITIONS` records ISO minor units
  (JPY/VND 0, USD/KHR 2, KWD/BHD/OMR/JOD 3) separately from the business
  rounding increment (KHR settles in 100 riel). Amounts finer than a currency's
  minor units are rejected.
* **Business dates are `YYYY-MM-DD`**, never instants, converted with epoch-day
  arithmetic. Each tenant has a business date that only moves forward; value
  dates may be backdated only within the product's `maxBackdateDays`.
* **Day counts** are explicit (`ACT_365_FIXED`, `ACT_360`, `ACT_ACT_ISDA`,
  `THIRTY_360_ISDA`, `THIRTY_E_360`); anything else is rejected, never approximated.
* **Equal-period formulas are refused for irregular periods**: an irregular
  first period, explicit dates or adjusted accrual dates require `DAILY`
  accrual, which uses the closed form `A = (B·Π(1+iₖ) − F) / Σₖ Π_{j>k}(1+iⱼ)`
  over the actual per-period factors.
* Every calculation records its inputs, product version, engine version
  (`LENDING_ENGINE_VERSION`), rate sources, rounding rule, schedule and an
  operator-readable explanation. Simulation endpoints never write.

Reference cases (independently computed with `bc`) are in
[`REFERENCE_CASES.md`](REFERENCE_CASES.md).

## Product lifecycle

`DRAFT → SUBMITTED → APPROVED → ACTIVE → RETIRED` (or `SUBMITTED → REJECTED`).

* The maker cannot approve or activate their own version (ABAC maker-checker).
* Approved versions are immutable — enforced in the service **and** by the
  `ProductVersion_guard` database trigger. Changes create a new version; the
  approval screen shows a leaf-level diff against the active version.
* Activation requires every required capability to be `IMPLEMENTED`
  (`requiredCapabilitiesFor(config)` ∪ the template's `extraCapabilities`) and
  valid accounting mappings. Activating a new version retires the previous one
  for new business only.
* Booked loans keep their `AgreementVersion` snapshot; nothing about a product
  edit reaches an existing agreement.

## Accounting

* Every money movement is one immutable `FinancialEvent` with balanced
  `LendingJournalEntry` lines posted in the **same transaction** as the balance
  change. Principal, interest, fees, penalties and taxes post to separate
  accounts through the product's accounting mapping.
* Database invariants (migration): append-only triggers on journals,
  allocations, accrual events, agreement versions, credit decisions, approvals,
  acceptances, assessments and audit events; `FinancialEvent` may only move
  `POSTED → REVERSED`; a deferred constraint trigger rejects any unbalanced
  journal at commit; CHECK constraints on amounts. The only permitted deletion
  is the tenant GDPR purge, which must `SET LOCAL lending.purge = 'on'`.
* Corrections are reversal events (mirrored journal), never edits or deletes.
* Accrual reconciles to the contract: on a period end the accrued amount equals
  the scheduled interest exactly. Interest frozen on lines closed by a
  restructure (`accruedAtClose`) keeps accrual continuous across amendments.
* Reconciliation compares every loan's principal, accrued interest, fees and
  penalties with the GL net of its journal lines, checks scheduled principal
  against the principal balance, and checks the trial balance per currency.
* Idempotency: money endpoints require an `Idempotency-Key`; the
  `(tenantId, idempotencyKey)` unique index settles concurrent first attempts;
  a key reused with a different payload is refused (409).
* Concurrency: money operations take a `SELECT … FOR UPDATE` lock on the loan
  row and finish with a compare-and-set on `LoanAccount.version`; status
  transitions (applications, approvals, disbursement tasks, restructure cases)
  are compare-and-set on `(status, version)`.
* A transactional outbox (`OutboxMessage`) records external notifications; a
  worker delivers them through the adapters.

## Tenant isolation

1. The request-level tenant guards and the Prisma tenant guard (existing) —
   every lending model is registered with the guard.
2. Every child row references its parent by `(tenantId, id)`, so the database
   rejects cross-tenant references.
3. Row-level security on the financial tables: inside a lending transaction the
   tenant is declared (`set_config('app.tenant_id', …)`), and rows of other
   tenants become invisible and unwritable, including to raw SQL.
4. Lists, searches, dashboards, exports and the end-of-day batch are filtered to
   the actor's branch/portfolio/legal-entity scope (`PolicyService.scopeFilter`).

## Material assumptions

* **Single tenant chart of accounts** for all currencies; trial balances are per
  currency by journal currency.
* **Legacy admins bootstrap access.** Users whose legacy role is `TENANT_ADMIN`
  or `ADMIN` implicitly hold the lending `TENANT_ADMIN` role (governance only —
  it cannot approve credit or move money). Everyone else needs an explicit
  role assignment; sensitive roles need a second administrator's approval.
* **MFA for approvals.** Credit approval, disbursement approval, reversals,
  write-off approval, restructure approval/execution require a token whose
  `amr` claim is `mfa` (set only after a verified TOTP challenge).
* **Fees "separately collected"** are due on the disbursement date as
  instalment 0.
* **Prepayment** reduces principal after all dues are paid; flat-rate products
  support early settlement but not partial prepayment. Excess beyond the payoff
  is refused (use settlement); there is no unapplied-cash suspense account.
* **Reversals** are latest-first; reversing a repayment that triggered a
  prepayment reschedule is not supported in Phase 1.
* **Booking requires the pinned product version to still be ACTIVE**; if a newer
  version was activated meanwhile, the application must be recreated.
* **FX for approval limits** uses the tenant's existing `ExchangeRate` table
  (maintained with `FX_MANAGE`) and refuses rates older than 3 days.
* **Customer principal**: a borrower-portal session acts on the borrower's own
  loans and restructure cases only.
