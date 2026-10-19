# Servicing changes

Who this is for: relationship officers, credit analysts and approvers, the restructure committee, loan operations makers and checkers and collections officers who change a running loan's terms, grant relief, waive fees, settle for less, refinance or reverse postings.

Changes covered here: restructuring (hardship cases), prepayment rescheduling, floating-rate resets, payment holidays, refinancing, fee waivers, negotiated settlement and reversing events. Taking money in (repayments, settlement, suspense, channels) is in [07-repayments-and-payments.md](07-repayments-and-payments.md).

Every change that alters the schedule creates a new **agreement version** on the loan. Older versions and schedules are never deleted; you can see them under **Schedule** (collapsed older versions) and **Agreement versions** on the loan screen.

---

## 1. Restructuring and hardship cases

A restructure changes a loan's terms because the borrower is in financial difficulty: a longer term, a lower instalment, a payment break, interest-only months, a rate reduction, capitalising or waiving arrears, and (if switched on) principal forgiveness.

**Opening a case never changes the loan.** Nothing changes until a proposal has been approved by credit, accepted by the customer and executed by operations.

Menu: **Collections & relief › Restructure cases** (the page is titled **Restructuring & hardship**). The menu badge counts cases waiting for you to assess, propose, approve, record acceptance, execute or monitor.

### 1.1 Who does what

| Step | Typical role | Notes |
|---|---|---|
| Open a case | Relationship officer, Collections officer | The borrower can also request relief in the borrower portal. |
| Add evidence, request more info, record affordability | Credit analyst | |
| Simulate options | Most lending roles | Simulations never change the loan. |
| Create a proposal | Credit analyst | Needs an affordability assessment first. |
| Approve a proposal / reject a case | Credit approver, Restructure committee | Maker-checker, approval limits, authenticator (MFA) sign-in required. |
| Record customer acceptance | Relationship officer | Or the borrower accepts in the portal. |
| Mark conditions satisfied, execute, reverse | Loan operations checker | Maker-checker, MFA required. |
| Monitor | Loan operations checker, Collections officer, Restructure committee | |

### 1.2 Case statuses

The case page shows a progress bar (stepper): **Requested**, **Affordability assessed**, **Options proposed**, **Approved**, **Customer accepted**, **Conditions satisfied**, **Monitoring**, **Completed**.

| Status (as shown) | Meaning |
|---|---|
| **REQUESTED** | Case opened; assessment not yet recorded. |
| **MORE INFO REQUIRED** | Waiting for the customer to provide more information. |
| **AFFORDABILITY ASSESSED** | An affordability assessment has been recorded. |
| **SPECIALIST REVIEW** | The affordability result is outside what front-line staff may decide; a specialist must review before any option is proposed or approved. A loud red banner **Specialist review required** appears. |
| **OPTIONS PROPOSED** | At least one proposal is waiting for credit approval. |
| **APPROVED** | A proposal has all the approvals it needs; waiting for the customer. |
| **CUSTOMER ACCEPTED** | The customer accepted the exact approved version. |
| **CONDITIONS SATISFIED** | All mandatory conditions are met; ready to execute. |
| **MONITORING** | Executed. The loan follows the new schedule and is on probation. |
| **COMPLETED** | Probation passed. |
| **REJECTED** | Rejected by an approver. No change to the loan. |
| **WITHDRAWN** | Withdrawn. No change to the loan. |
| **EXPIRED** | Expired before completion. No change to the loan. |
| **REVERSED** | The executed change was reversed; the loan is back on its previous terms. |

A loan can have only one open case at a time.

### 1.3 Open a case

From the loan (recommended):

1. Open the loan (**Loans › Loan accounts** › reference). The loan must be **ACTIVE**.
2. In **Servicing actions** click **Request restructure**.
3. Fill in the form (below) and click **Open restructure case**. You are taken to the new case.

From the restructures list: click **Request restructure** at the top of **Restructure cases**, then enter the **Loan account id**. Note: this field needs the loan's internal ID (a long code like `xxxxxxxx-xxxx-...`), not the reference; it is easier to start from the loan screen.

The form:

- **Trigger** - **Customer asked (staff recording)**, **Collections referral** or **Credit review**.
- **Hardship category** - for example **Illness or injury**, **Job loss**, **Reduced income**, **Business downturn**, **Delayed or failed harvest**, **Natural disaster**, **Family event (death, birth, wedding…)**, **Payments already overdue**, **Other**.
- **Difficulty type** - **Temporary — expected to recover** or **Persistent — long-term change**.
- **Customer statement** - in the customer's words.
- **Relief requested by the customer (optional)** - **Lower instalment of**, **Longer term (months)**, **Payment break (months)** (1–24), **Note**.
- **Expected recovery date**.
- For **Customer asked (staff recording)** you must tick **The customer has consented to this restructure request** and give a **Consent reference** (signed form number, call recording ID). Without it the button stays disabled with "Record that the customer consented to this request."

If it is blocked: "Restructure case X is already open for this loan." (work the existing case), "This product does not allow restructuring.", "lending.restructure.request is currently unavailable" (feature flag off - ask your tenant administrator).

### 1.4 The case page

The case page has the stepper at the top, warning banners (specialist review, more information required, **Repeat restructure (n previous)**), and five tabs:

- **Overview & evidence** - the request, the **Evidence** list and the **Case actions** card.
- **Affordability (n)** - assessments.
- **Options simulator** - simulate and compare scenarios, and create proposals.
- **Proposals (n)** - each proposal version with approvals and acceptance.
- **Conditions & monitoring** - conditions, monitoring tasks and executed loan amendments.

### 1.5 Evidence and requesting more information

To record evidence (Credit analyst):

1. On **Overview & evidence**, click **Add evidence** in the **Evidence** card.
2. Choose **Type** (INCOME, EXPENSES, DEBTS, BUSINESS_CASHFLOW, HARVEST_FORECAST, MEDICAL, EMPLOYMENT, OTHER), **Quality** (**VERIFIED**, **PARTIALLY VERIFIED**, **SELF DECLARED**), an optional **Document reference** and a **Description**.
3. Click **Save evidence**.

To ask the customer for more information: click **Request more info**, describe **What is needed?** and click **Request information**. The case moves to **MORE INFO REQUIRED**.

### 1.6 Affordability assessment

1. Open the **Affordability** tab and click **Start assessment**.
2. Choose the template tab: **Individual**, **Household**, **Business** or **Seasonal (agri)**.
   - Individual: **Verified net monthly income**, **Essential monthly living expenses**.
   - Household: each member's **Name** and **Verified net monthly income** (**Add member**), and household expenses.
   - Business: **Operating cash inflows (monthly)**, **Operating cash outflows (monthly)**, **Taxes (monthly)**, **Essential capital expenditure**, **Required working-capital increase** (use 0 when none).
   - Seasonal: a month-by-month forecast (**Month**, **Inflows**, **Outflows**, up to 24 months).
3. Under **Monthly debt payments**, list every debt, including this loan. Tick **This loan** on this loan's row; it is excluded from the calculation so it is not counted twice.
4. Choose **Evidence quality**, the **Verification date**, describe the **Assumptions** and add optional **Comments**.
5. Click **Record assessment**.

The result shows either **Sustainable** or **Not sustainable**, the **Available for this loan / month** amount (or **DSCR** for businesses) and, for seasonal cases, capacity month by month. Assessments cannot be edited; record a new one when figures change.

If it is blocked: "The verification date cannot be in the future.", "Evidence verified N days ago is older than the policy limit of M days.", "Record the assumptions behind the assessment."

### 1.7 Simulate options

Open **Options simulator**. Simulations never change the loan; you can keep up to three scenarios side by side.

1. Give the **Scenario name**.
2. Set the options you want to try:
   - **Effective date**, **Number of instalments** (remaining term), **Target instalment** (the system works out the term), **New annual rate (%)**, **Method** (EQUAL_INSTALMENT, EQUAL_PRINCIPAL, BALLOON) and **Frequency** (blank = keep current), **First due date**.
   - **Payment relief**: **Payment break (instalments)** (1–24, nothing due), **Interest-only instalments**, **Temporary rate (%)** **…for instalments**, and **Interest during the break**: **Pay separately**, **Defer without capitalizing**, **Capitalize into principal**, **Waive (concession)**.
   - **Arrears & charges**: **Arrears treatment** (**Customer pays arrears on the effective date** or **Spread arrears over the new term**), **Capitalize into principal** (**Overdue interest**, **Accrued interest**, **Fees**, **Penalties**), **Waive interest**, **Waive fees**, **Waive penalties**, **Principal forgiveness** ("Requires senior approval"), **Principal paid at restructure**.
   - **Explicit principal schedule** (optional, for dated principal such as harvest-aligned payments).
3. Click **Simulate & keep scenario**.

The **Scenario comparison** shows, against **Current terms**, the **Instalment**, **Maturity**, **Total payments**, **Total interest & charges**, **Due at effective date**, **Affordability** (**Fits**, **Does not fit**, **Not assessed**) and **Warnings** (for example when a lower instalment means more interest overall). Use **Edit**, **Remove** or **Reset form** as needed.

If an option is refused: "This product does not allow: ...", "Deferred interest treatment X is not allowed for this product.", "At most N instalments may be deferred.", "The proposed payment does not amortize this balance at the selected rate." Principal forgiveness is switched off by default (feature flag); ask your administrator if your policy allows it.

### 1.8 Create a proposal

Who: Credit analyst. The case must have an affordability assessment ("Record an affordability assessment before proposing options.").

1. On the scenario card click **Propose…**.
2. Optionally add up to 10 conditions the customer must meet before execution: **Code** (capital letters, digits and `_`, for example `ARREARS_PAID`) and **Label** (for example "Customer pays overdue amount"). Use **Add condition**.
3. Click **Create proposal**.

The proposal is recalculated on the live balances and frozen with a fingerprint (hash). It appears on the **Proposals** tab as **Proposal v1** (v2, v3 for later versions) with status **PROPOSED**. A new proposal supersedes earlier ones (**SUPERSEDED**) together with their approvals and acceptances. Each proposal has an expiry date; after it, the proposal cannot be approved or accepted ("This proposal has expired; propose again.").

| Proposal status | Meaning |
|---|---|
| **PROPOSED** | Waiting for credit approval. |
| **APPROVED** | Approved; waiting for the customer. |
| **ACCEPTED** | The customer accepted this exact version. |
| **EXECUTED** | Applied to the loan. |
| **SUPERSEDED** | Replaced by a newer version. |
| **EXPIRED** (extra tag) | Past its expiry date. |

### 1.9 Approve a proposal (credit decision)

Who: Credit approver or Restructure committee member - not the person who proposed it, not the staff member who opened the case, and not someone who has already approved it. You must be signed in with your authenticator code (MFA).

1. Open the **Proposals** tab and the latest proposal.
2. Review the comparison and open **Full terms: snapshot, warnings, calculation and schedule**. Check **Policy exceptions** and **Approvals** ("n of m required").
3. Click **Approve…**, write an **Approval comment** (at least 3 characters) and click **Approve**.

Approval limits apply separately:

- your approval authority must cover the **new principal**;
- if the proposal waives charges, you also need the charge-waiver authority for the waived amount;
- if it forgives principal, you need the principal-forgiveness authority (Restructure committee) for that amount.

Repeat restructures and policy exceptions raise the number of independent approvals needed. When enough approvals are recorded the proposal and case become **APPROVED**; the timeline shows each approver under **Credit approvals**.

If it is blocked: "You cannot approve or complete an action you created or proposed" (maker-checker), "The amount exceeds your approval authority", "You have no approval authority for this action", "This action requires signing in with multi-factor authentication" (sign out and sign in again with your authenticator code), "This proposal is not awaiting approval."

There is no separate "reject proposal" button. To decline, either have a new proposal created, or reject the whole case (section 1.12).

### 1.10 Customer acceptance

Approval and acceptance are separate. The customer must accept the exact approved version.

- **In the borrower portal**: the borrower sees "Offer ready", reviews the comparison and accepts. The **Customer acceptance** timeline shows "Customer confirmed in portal".
- **At the branch** (Relationship officer):
  1. On the **APPROVED** proposal click **Record customer acceptance…**.
  2. Confirm the customer was shown the comparison, total cost and new schedule (a warning appears if the lower instalment costs more overall).
  3. Choose the **Method**: **Signed form** or **Witnessed verbal acceptance**.
  4. Enter the **Evidence** (form number, witness name, recording ID).
  5. Click **Record acceptance**.

Each acceptance shows "hash ... matches proposal" in green. If it says "does not match current proposal", the proposal changed after the customer accepted; the customer must accept the new version.

If it is blocked: "Only an approved proposal can be accepted.", "This proposal has expired.", "The proposal changed since it was shown; review the current version.", "Record how the customer accepted and the evidence (form reference or witness)."

### 1.11 Conditions and execution

To mark a condition satisfied (Loan operations checker):

1. Open **Conditions & monitoring**.
2. On an **OUTSTANDING** condition click **Mark satisfied…**, enter the **Evidence / note** and click **Mark satisfied**.

To execute (Loan operations checker - not the proposer; MFA required):

1. On **Overview & evidence** or **Proposals**, in **Case actions**, click **Execute…**. The button stays disabled with "No accepted proposal" or "n condition(s) outstanding" until ready.
2. Optionally enter an **External reference** (needed when the customer pays principal at restructure: "Record the payment reference for the principal paid at restructure.").
3. Click **Execute restructure**.

What happens next: "Restructure executed — the loan now follows the new schedule". The loan gets a new agreement version, old unpaid lines become **RESTRUCTURED** (kept for history), the loan shows the **RESTRUCTURED** tag and the case moves to **MONITORING**. Waivers and forgiveness are posted as expenses. Delinquency is not reset: the bucket at execution becomes a floor (**Delinquency floor**) until the borrower completes the probation (**Probation remaining** on the loan).

If balances changed since the customer accepted (for example a repayment or penalty was posted), execution stops with a red box **Balances changed since the proposal was accepted — execution stopped.** listing the differences (code **PROPOSAL_STALE**). Nothing is changed. A new proposal is needed, with new approval and new acceptance. Other messages: "Money moved after the proposed effective date; propose again with a current date.", "Conditions are outstanding.", "Mandatory approval and acceptance records are missing.", "lending.restructure.execution is currently unavailable" (flag off).

### 1.12 Reject, withdraw or reverse

All three need a **Reason** of at least 3 characters.

- **Reject case…** (Credit approver / Restructure committee, not the case opener or proposer) - available while the case is being assessed or proposed. The case becomes **REJECTED**.
- **Withdraw…** (the requesting side, for example Relationship officer) - for example when the customer no longer wants relief. The case becomes **WITHDRAWN**.
- **Reverse…** (Loan operations checker, not the person who executed it; MFA) - undoes an executed restructure. Confirm in **Reverse restructure?**. Only possible if no financial activity has been posted since execution ("Financial activity followed this amendment; it can no longer be reversed automatically."). The loan returns to its previous terms with a new agreement version and the case becomes **REVERSED**.

Note: the **Reject case…** and **Withdraw…** buttons stay enabled until execution, but the system only allows rejection before approval and withdrawal up to **APPROVED**; later you will see "Not allowed while the record is ...".

### 1.13 Monitoring and probation

After execution the end-of-day batch watches the revised payments. It raises follow-up tasks such as **MISSED REVISED PAYMENT**, temporary-relief expiry, probation review, balloon maturity and affordability refresh, counts probation, lifts the delinquency floor only after on-time payments, and completes the case.

- Case level: **Conditions & monitoring** shows **Monitoring tasks** and **Loan amendments** (agreement version change, effective date, financial event and any reversal event).
- Across all cases: the **Open monitoring tasks** panel on **Restructure cases**. Click **Close…**, enter an **Outcome note** and click **Close task**. Closing a task never changes the loan.

---

## 2. Prepayment and rescheduling

A partial prepayment is money paid on top of what is due and used to reduce principal. It is taken through **Post repayment** (see [07-repayments-and-payments.md](07-repayments-and-payments.md#2-posting-a-repayment)) with **Money beyond what is due** = **Prepay principal**, or when matching a suspense receipt with **PREPAY**.

Choose the **Prepayment strategy**:

| Strategy | Effect |
|---|---|
| **RECAST — lower instalment** | Maturity stays the same; future instalments go down. |
| **SHORTEN — earlier maturity** | Instalment stays the same; the loan ends earlier. |
| **Product default** | Uses the product setting. The product decides which strategies are allowed. |

What happens next: the future instalments are replaced by a new schedule under a new agreement version. A prepayment fee may be charged (partial prepayment fee), unless a fee waiver has been approved (section 6). Prepayments are available only on products that allow them and on reducing-balance loans.

To change the schedule for any other reason (a different due date, a longer term), use a restructure case (section 1) or a payment holiday (section 4). There is no stand-alone "reschedule" screen.

---

## 3. Floating-rate resets

Loans priced as benchmark plus margin are re-priced on their reset dates.

Note: floating-rate pricing is behind the feature flag **lending.pricing.floating_rate**, off by default. On a fixed-rate loan the panel says "This loan is priced at a fixed rate; there is nothing to reset."

The end-of-day batch applies due resets automatically. To view or apply them now (Loan operations maker):

1. Open the loan and click **Rate resets** in **Servicing actions**.
2. Review the terms: **Benchmark**, **Margin**, **Reset frequency**, **Floor / cap**.
3. If a notice "n reset(s) have fallen due" appears, click **Apply n due reset(s)** and confirm **Apply resets**.

What happens next: the loan is re-priced at each due reset date, oldest first, from the latest benchmark observation on or before each date; the remaining instalments are re-issued under a new agreement version. **Applied resets** lists each reset (**Reset date**, **Observation**, **Benchmark**, **Margin**, **Indicated**, **Bound** = BENCHMARK, FLOOR or CAP, **Previous**, **New rate**, **Instalment**). **Reset calendar** shows all reset dates: green applied, amber due, grey upcoming.

If it is blocked: "No <benchmark> observation on or before <date>; record the benchmark before re-pricing." (code **BENCHMARK_MISSING**). A finance officer records it under **Finance › End of day & operations**, **Benchmark rates** tab; then apply again.

---

## 4. Payment holidays

A payment holiday lets a borrower skip one or more instalments under a published programme (for example after a flood). It is relief, not forgiveness: interest keeps arising, and the programme decides who pays it.

### 4.1 Programmes (maker-checker)

Menu: **Collections & relief › Payment holidays** (page **Payment-holiday programmes**). The menu badge counts drafts waiting to be published.

Who: creating and publishing both need the programme permissions (Restructure committee). The person who publishes must be different from the person who created the draft. Why: a programme is an offer to the whole loan book, so it gets four-eyes control like a product version.

To create a programme (maker):

1. Click **New programme**.
2. Enter **Code** (capital letters, digits, `_ . -`, for example `FLOOD_RELIEF_2026`), **Name**, **Longest holiday (instalments)** (1–24), **Opens on** and **Closes on** (the enrolment window).
3. Choose **Interest arising during the holiday — who pays it?**:

| Treatment | Badge | Effect |
|---|---|---|
| **Waive** | Free to borrower | Interest during the holiday is waived; the lender bears the cost. |
| **Defer, no capitalization** | Costs borrower | Interest becomes payable later without bearing further interest. |
| **Pay separately** | Costs borrower | Interest stays payable during the holiday; only principal is deferred. |
| **Capitalize** | Grows the debt | Interest is added to principal and bears interest, so the borrower owes more afterwards. |

   For any treatment other than **Waive**, tick "I understand only WAIVE is free to the borrower, and this programme will be published as relief that costs them."
4. Choose **What the deferred payments do to the term**: **Extend term** (skipped payments added at the end) or **Keep maturity** (skipped payments absorbed into higher instalments afterwards).
5. Set the eligibility rules: **Min. instalments paid**, **Max. days past due**, **Min. instalments left after**, **Max. holidays per loan**, and **Already-restructured loans qualify**.
6. Click **Save draft**. You see "Programme X saved as draft — another user must publish it".

To publish (checker, a different user): on the **DRAFT** row click **Publish** and confirm. To drop a draft click **Discard**. To stop an open programme click **Withdraw** and confirm **Close programme**.

| Programme status | Meaning |
|---|---|
| **DRAFT** | Saved, not yet offered. |
| **OPEN** | Published; qualifying loans may enrol during the window. |
| **CLOSED** | Discarded or withdrawn. Cannot be reopened; publish a new one. Holidays already granted are unaffected. |

If it is blocked: "You cannot approve or complete an action you created or proposed" (the creator also cannot publish, discard or withdraw their own programme - ask a colleague), "This programme is already open.", "A closed programme cannot be reopened; publish a new one.", "The programme closes on ..., before it opens on ....".

### 4.2 Grant a holiday on a loan

Who: Collections officer (the holiday-grant permission). The loan must be **ACTIVE**.

1. Open the loan and click **Payment holiday** in **Servicing actions**. The panel shows **Holidays granted on this loan** and **Open programmes**.
2. On a programme click **Check eligibility**.
3. If **Eligible for up to n instalment(s)**: enter **Instalments to defer** and optionally an **Effective date** (default: the start of the next unpaid period). Read the cost notice.
4. Click **Grant payment holiday** and confirm.

What happens next: "Payment holiday granted: n instalment(s), resumes <date>." with the cost summary. The schedule is re-issued under a new agreement version and the holiday appears in **Holidays granted on this loan** with the **Deferred interest** amount.

If **Not eligible**, each reason is listed with a code, for example:

| Code | Message |
|---|---|
| NOT_OPEN / CLOSED | "The X programme opens on ..." / "closed on ...". |
| STATUS | "A payment holiday applies to an active loan; this one is ...". |
| IN_PROGRESS | "This loan is already on a payment holiday." |
| SEASONING | "n instalment(s) have been paid; the programme requires m." |
| DPD | "The loan is n day(s) past due; the programme allows at most m." |
| LIMIT | "This loan has taken n holiday(s); the programme allows m." |
| RESTRUCTURED | "This loan has been restructured, which the programme excludes." |
| TOO_LATE | "n instalment(s) remain; a holiday must leave m behind, so there is no room for one." |

Other messages: "This product does not allow restructuring, so a payment holiday cannot be granted on it." (code **HOLIDAY_NOT_AVAILABLE**), "This loan qualifies for at most n instalment(s)."

Note: the **Payment holiday** button is shown to everyone who can open an active loan; only users with the grant permission can complete the grant.

---

## 5. Refinancing

Refinancing replaces an active loan with a new loan for the same borrower: the new loan's proceeds pay the old loan off at disbursement, in one transaction.

To start a refinance (Relationship officer):

1. Open the loan to be replaced. In the **Refinance** card click **Start refinance application →**.
2. The new-application form opens with **Refinances loan** already filled in. Complete the application as usual (see [05-applications-and-credit-decisions.md](05-applications-and-credit-decisions.md)).
3. The application goes through the normal recommendation, approval and booking, then disbursement (see [06-disbursement.md](06-disbursement.md)).

What happens next: at disbursement, the old loan is settled from the new loan's proceeds and closed; the borrower receives the rest. If arrears are rolled into the new loan, or the old loan was delinquent, this is recorded and limited by the product (evergreening control).

If it is blocked (at disbursement, code **REFINANCE_REFUSED** or):

- "A refinance must replace a loan of the same borrower."
- "The loan being refinanced is CLOSED; only an active loan can be replaced."
- "This loan holds X ... paid in advance. Refund the advance before you refinance it."
- Product limits on days past due, instalments paid, number of refinances, arrears roll-in or shortfall (set by the product: **Allow refinancing**, **Refinance: maximum DPD**, and so on - see [04-products-and-policies.md](04-products-and-policies.md)).

---

## 6. Fee waivers

A fee waiver removes the early settlement fee or the partial prepayment fee for the next payment of that kind. It is maker-checker.

To propose (maker - Loan operations maker / Collections officer):

1. Open the loan and click **Fee waiver**.
2. Choose the **Fee**: **Early settlement fee** or **Partial prepayment fee**.
3. Optionally set **Expires on**; enter a **Reason** (at least 3 characters).
4. Click **Propose waiver**. You see "Waiver proposed — a different user must approve it".

To decide (checker - Loan operations checker, a different user): open the loan, click **Fee waiver**, and on the notice "... — awaiting approval" click **Approve** or **Reject**.

What happens next: an approved waiver shows "approved, not yet used" and is applied automatically to the next settlement quote or prepayment of that kind (the fee shows as zero).

If it is blocked: "A waiver needs a reason.", "A waiver cannot expire before today.", "You cannot approve or complete an action you created or proposed".

---

## 7. Negotiated settlement (settling for less than owed)

Use this when the lender agrees to close the loan for less than the full amount owed. The difference (the concession) is posted as an expense.

Who: Restructure committee. It needs approval authority for the concession amount and MFA sign-in. There is no second approver; the authority limit is the control. Forgiving principal needs a separate, higher permission.

1. Open the loan and click **Negotiated settlement**.
2. Enter the **Agreed amount** and click **Price it**.
3. Review **Paid from the agreed amount** and **Forgiven** by component, and the **Concession** (with percentage). A **Forgives principal** warning appears if the concession reaches principal.
4. Enter the **Reason (recorded with the settlement)**.
5. Click **Settle for <currency> <amount>** and confirm **Settle for less than owed**.

What happens next: "Negotiated settlement posted" and the loan closes.

If it is blocked: "This product does not permit negotiated settlement.", "This loan holds X ... paid in advance. Refund the advance before you settle it for less than it owes.", "The amount exceeds your approval authority", "This action requires signing in with multi-factor authentication".

---

## 8. Reversing a payment

Use this to undo a repayment that was posted in error or that bounced. A reversal never deletes anything: the original stays in the history, marked **REVERSED**, and a compensating **REVERSAL** event is posted.

Who: Loan operations checker - not the person who posted the original payment - signed in with MFA. The loan must be **ACTIVE** or **CLOSED**.

Only **REPAYMENT** and **ADVANCE_APPLIED** events with status **POSTED** have a **Reverse** button. Settlements, disbursements, write-offs and restructures cannot be reversed here (a restructure has its own **Reverse…**, section 1.12).

To reverse:

1. Open the loan and scroll to **Financial events** (newest first).
2. Start with the newest payment. Click **Reverse** on its row.
3. Enter a **Reason** (at least 3 characters).
4. If the payment bounced or was returned by the bank, tick **The payment bounced or was returned — charge the product's returned-payment fee**.
5. Click **Reverse event** and confirm.

What happens next: "Event reversed". The allocations are undone, the balances go back, and a note "Reversed events stay in the history; each reversal is posted as its own compensating event." appears.

Rules (latest first):

- You must reverse the most recent payments first. Otherwise: "Reverse later repayments first (latest first)."
- If part of an advance from the payment has already been applied to instalments: "Part of the advance from this repayment has already been applied to instalments; reverse those advance applications first (latest first)."
- Reversing a prepayment that rescheduled the loan also restores the previous schedule (new agreement version "PREPAYMENT_REVERSED"). This is refused if the loan was rescheduled or restructured since ("The loan has been rescheduled or restructured since this prepayment; it cannot be reversed automatically.") or if charges or payments have hit the new instalments ("Charges or payments have been applied to the rescheduled instalments; reverse those first.").
- Repayments applied by a project-finance cash waterfall cannot be reversed alone.
- A closed accounting month refuses the posting ("... is closed; nothing can be posted on .... Ask finance to reopen it.").
- "You cannot approve or complete an action you created or proposed" - the person who posted the payment cannot reverse it.
