# Loan restructuring and hardship management

Restructuring is a dedicated capability across all products, with its own
assessment, approval workflow, calculations and access controls. **A request
opens a review; it never changes terms by itself.** Restructuring, refinancing,
payment holidays and settlement are distinct operations: this module implements
restructuring (with payment deferral as one of its options); refinancing into a
new loan, stand-alone payment holidays and negotiated settlement are listed as
**not implemented** in the capability matrix, and early settlement remains the
servicing operation.

## Workflow

```
REQUESTED ─► (MORE_INFO_REQUIRED) ─► AFFORDABILITY_ASSESSED ─► OPTIONS_PROPOSED ─► APPROVED
     │                                  └► SPECIALIST_REVIEW ─┘        ▲                 │
     │                                                                 │ new version     ▼
     │                                                     (stale / changed proposal) CUSTOMER_ACCEPTED
     │                                                                                   ▼
     └──► REJECTED · WITHDRAWN · EXPIRED                         CONDITIONS_SATISFIED ─► (execute)
                                                                                         ▼
                                                     REVERSED ◄── MONITORING ─► COMPLETED (probation passed)
```

* **Initiation**: customer self-service (borrower portal), relationship officer
  on a documented customer request (consent reference required), collections,
  credit/risk review, or a **system referral** opened by the end-of-day batch on
  an approved rule (`referralDpd`). A referral never changes terms.
* Captured: initiator and channel, consent, reason and hardship category,
  temporary vs persistent difficulty, requested relief, expected recovery date,
  previous restructures, and (through evidence and assessment) income,
  expenses, other debts and supporting evidence with quality and verification.
* **Approval and customer acceptance are separate records.** Acceptance binds
  the exact proposal version by hash. Any change to a proposal creates a new
  version that supersedes earlier approvals and acceptances.
* **Execution** requires a mandatory approval, an acceptance of the current
  version, and every mandatory condition satisfied. Balances are revalidated at
  the effective date; if payments or accruals changed them beyond the product's
  `materialityTolerance` the proposal becomes stale (409 `PROPOSAL_STALE`) and
  needs renewed approval and acceptance.

## Affordability (configurable policy — `AffordabilityPolicy`, maker-checker)

* Individual / household:
  `AvailableForThisLoan = VerifiedNetIncome − EssentialLivingExpenses − OtherDebtPayments − SafetyBuffer`,
  buffer = max(`bufferFractionOfIncome` × income, `bufferMinimum[currency]`).
  Debts flagged `isThisLoan` are excluded so the loan is never counted twice.
  `≤ 0` routes the case to **specialist review** instead of a schedule.
* Business: `CFADS = inflows − outflows − taxes − essential capex − working-capital increase`;
  capacity for this loan keeps `DSCR = CFADS / TotalDebtService ≥ minDscr`
  across all debts in matching monthly periods.
* Seasonal: month-by-month forecast; a proposed schedule must keep cumulative
  payments within cumulative capacity at every due date (no annual averaging).
* Evidence quality, assumptions, verification date (≤ `evidenceMaxAgeDays`) and
  assessor comments are recorded. Only staff with `restructure.assess` enter
  verified figures; customers cannot.

## Options

Term extension · instalment reduction · principal grace / temporary interest-only ·
full payment deferral · permanent or temporary rate reduction · seasonal
alignment (dated principal) · due-date change · balloon adjustment · arrears
rescheduling · explicit capitalization of eligible unpaid amounts · fee /
penalty / interest waiver · partial principal forgiveness (separately
controlled; off by default).

Deferred interest is never assumed waived; its treatment is explicit:
`PAY_SEPARATELY`, `DEFER_NO_CAPITALIZATION` (carried interest-free into later
instalments), `CAPITALIZE` (only where `allowInterestCapitalization` permits —
interest on interest is barred by default) or `WAIVE` (a recorded concession
needing waiver authority). Each product configures allowed options and
treatments, maximum extension and deferral, escalation and probation.

## Calculation

`calculateRestructure` takes an immutable balance snapshot at the effective
date (outstanding and overdue principal, overdue interest, accrued interest not
yet due, fees, penalties, taxes, unallocated payments — which must be zero) and:

```
NewPrincipal = OutstandingPrincipal + ApprovedCapitalizedAmounts
               − ApprovedPrincipalForgiveness − PrincipalPaymentAppliedAtRestructure
```

* Fixed-rate equal periods: `A = P·i / [1 − (1+i)^−n]` (`P/n` at zero rate).
* From a sustainable capacity C: `n = −ln(1 − P·i/C) / ln(1+i)`, rounded up and
  regenerated exactly; `C ≤ P·i` → *"The proposed payment does not amortize this
  balance at the selected rate."* Irregular dates, temporary rates, grace and
  deferrals use numerical schedule simulation instead.
* The comparison shows original vs proposed instalment, maturity, total future
  payments, total future interest and charges, capitalized, waived and forgiven
  amounts, balloon, amounts payable at the effective date, affordability fit
  and policy exceptions — and warns when a lower instalment increases total
  interest.

## Integrity and accounting

* The original agreement, all earlier schedule lines and the arrears history are
  kept: unpaid lines become `RESTRUCTURED` with their unpaid amounts intact and
  the interest they had earned frozen (`accruedAtClose`). A linked
  `LoanAmendment` records before/after snapshots, agreement versions, the
  proposal and the accounting event; a new `AgreementVersion` (reason
  `RESTRUCTURE`) holds the new terms and calculation.
* Posting (balanced, through the product mapping): capitalization
  `Dr Loans receivable / Cr Interest|Fees|Penalty receivable`; waivers
  `Dr Restructure concessions (5200) / Cr receivables`; forgiveness
  `Dr Principal forgiven (5110) / Cr Loans receivable`. A pure term extension
  moves no value and posts nothing.
* Amendments can be reversed (contra entries, schedule and balances restored,
  new agreement version `RESTRUCTURE_REVERSAL`) by someone other than the
  executor, only before any later financial activity.
* **Delinquency is not reset.** The bucket at execution becomes a floor held
  through a policy-defined probation (`probationInstalments` consecutive
  on-time revised payments); the loan stays flagged `isRestructured`.
  Modification accounting, impairment and regulatory classification beyond this
  floor require integration review (not automated here).

## Access control

Permissions `restructure.request`, `.assess`, `.simulate`, `.propose`,
`.approve`, `.record_acceptance`, `.execute`, `.monitor`, `.waive_charges`,
`.forgive_principal`. Approval checks exposure authority on the new principal
plus separate authority for charge/rate concessions and for forgiveness, with
maker-checker against the proposer, the staff initiator and earlier approvers.
Repeated restructures (≥ `escalateAfterRestructures`) and policy exceptions
raise the number of independent approvals required. Execution is separated
from the proposer and requires MFA.

## Monitoring

The end-of-day batch tracks payments against the revised schedule, raises
`MISSED_REVISED_PAYMENT` tasks, counts probation, lifts the delinquency floor
only after observed performance, and completes the case. Tasks are also created
for temporary-relief expiry, probation review, balloon maturity, affordability
refresh (expected recovery date) and repeat requests. Tasks ask for review;
they never grant concessions.
