# Covenants and collateral

Who this is for: loan operations makers and checkers who record covenant tests and sign off collateral releases; relationship officers and credit analysts who pledge and revalue collateral; credit and risk staff who monitor loan-to-value (LTV), margin calls and covenant breaches.

This chapter covers the security and undertakings attached to a loan after it is booked: financial **covenants** (section 1) and **collateral** - its value, LTV, margin calls and release (section 2). Collateral and guarantees taken during origination are summarised in section 3 and described fully in [05-applications-and-credit-decisions.md](05-applications-and-credit-decisions.md). The borrowing base on inventory and receivables lines is in [09-facilities.md](09-facilities.md), section 11. Calling on guarantors is in [11-collections-and-recovery.md](11-collections-and-recovery.md).

---

## 1. Covenants

A covenant is a promise the borrower made in the loan agreement, usually to keep a financial ratio within a limit or to deliver financial statements. Operations record a **test** each period from the borrower's figures; a failed test is a **breach**.

### 1.1 Where covenants come from

- Covenants listed in the product are **set up on the loan automatically at booking**, first due for testing one period after the booking date.
- More can be added to an individual loan from the loan screen (section 1.3).

Covenants are available on any loan, and are standard on the corporate products (project finance, infrastructure, acquisition finance).

The **Covenants** card appears on the loan screen (**Loans › Loan accounts**, open the loan) while the loan is **BOOKED** or **ACTIVE**. Its subtitle: "Tested on schedule; a failed test is a breach until a later test passes or another person waives it."

The card lists each covenant with its threshold and frequency ("every 12 month(s)"), **Next test** (with a red **overdue** tag when the date has passed), **Last result** (**Passed**, **Failed** or **Waived**, with the value and date) and **Status**.

| Covenant type (as shown) | Passes when | Figures you enter at each test |
|---|---|---|
| **Minimum DSCR** | debt-service cover ≥ threshold (for example 1.25) | Annual net operating income; annual debt service (blank = taken from the schedule) |
| **Maximum LTV** | loan-to-value ≤ threshold (for example 0.70) | none - worked out from the loan's valued collateral (section 2) |
| **Maximum net leverage (net debt / EBITDA)** | ≤ threshold (for example 3.50) | EBITDA for the last twelve months; total debt (blank = this loan's balance); cash netted off (blank = 0) |
| **Minimum interest cover (EBITDA / interest)** | ≥ threshold (for example 3.00) | EBITDA; interest expense (blank = the loan's scheduled interest) |
| **Financial statements** | statements received | Received / Not received |

| Covenant status | Meaning |
|---|---|
| **ACTIVE** | In force; the last test passed (or none has been due yet). |
| **BREACHED** | The last test failed. A breach notice has been raised. |
| **WAIVED** | The breach was waived by a second person. The next test is still due. |
| **RELEASED** | No longer in force; cannot be tested. |

### 1.2 Record a covenant test

Who: anyone with the repayment-posting permission (normally Loan operations maker; Collections officers also hold it).

To record a test:

1. Open the loan and find the **Covenants** card.
2. Click **Record test** on the covenant.
3. Enter the end date of the period being tested in the date box (it must be a period already ended).
4. Enter the figures the covenant needs (see the table above). Placeholders tell you what each box is, for example "Annual net operating income" or "EBITDA, last twelve months".
5. In **Evidence**, note the source (for example "FY2025 audited accounts").
6. Click **Save test** (or **Cancel**).

What happens next:

- If the test passes, the status is **ACTIVE** (a passing test also **cures** an earlier breach).
- If it fails, the status becomes **BREACHED** and a breach notice (`lending.covenant.breached`) is sent to any connected systems (see [17-webhooks-and-integrations.md](17-webhooks-and-integrations.md)).
- **Next test** moves forward by one period from the later of the due date and the period you tested.

If it is blocked:

| Message | What to do |
|---|---|
| "A covenant is tested on a period already ended." | Choose a period end on or before the business date. |
| "Give the annual net operating income for the period." / "Give the EBITDA for the period." | Fill the missing figure. |
| "The loan has no valued collateral to test." | A **Maximum LTV** covenant needs collateral with a market value on the loan (section 2). |
| "There is no debt service to cover." / "There is no interest to cover." | The schedule has nothing due in the period; enter the figure yourself. |
| "This covenant has been released." | The covenant is no longer in force. |

> **Note.** A breach raises a notice and appears on the loan; it does **not** reprice or accelerate the loan automatically. Any action (a waiver, a restructure, collections) is a staff decision. Figures are entered from the borrower's accounts; there is no feed from accounting systems.

### 1.3 Add a covenant to a loan

Who: Loan operations maker. The loan must be BOOKED or ACTIVE.

1. At the bottom of the **Covenants** card, choose the **Covenant** type.
2. Enter the **Threshold** (not used for **Financial statements**), **Every (months)** (default 12) and an optional **Description**.
3. Click **Add covenant**.

The first test falls due one period after the business date. If it is blocked: "Give the covenant threshold." or "A financial-statements covenant has no threshold."

### 1.4 Waive a breach

A waiver accepts a breach without requiring the borrower to cure it. It must be decided by someone other than the officer who recorded the failing test.

Who: Loan operations checker (the permission to reverse repayments).

1. On a **BREACHED** covenant, click **Waive**.
2. Type the **Reason for the waiver** (for example "One-off loss from flood; recovery plan agreed").
3. Click **Waive breach**.

The status becomes **WAIVED** and the **Last result** shows **Waived**. The next scheduled test is still due. If it is blocked: "Only a breached covenant can be waived."

### 1.5 Overdue covenant tests

When a covenant's next test date has passed without a test, it appears in the **Home** queue **Covenant tests overdue** (counted on **Loans › Loan accounts** in the menu). Each item names the loan and the covenant and opens the loan screen. Who sees it: anyone who can record covenant tests, within their branch scope. Record the test (section 1.2) to clear it.

---

## 2. Collateral on a running loan

The **Collateral** card on the loan screen appears when the loan has at least one pledge. Its subtitle shows the **loan-to-value**: "Loan-to-value …% (max …%) · owed … against lending value …", and any amount of loans ranking ahead.

- **Owed** is principal, interest, fees and penalty outstanding.
- **Lending value** is the collateral's market value after the product's haircut, less loans ranking ahead (prior liens).
- **Max** is the product's maximum LTV, if it has one.

The table lists each asset: **Asset** (type and description), **Status** (**ACTIVE** or **RELEASED**, with the release reference), **Market value**, **Valued** (date), **Ranking ahead** and an action button.

### 2.1 Revalue collateral

Use this when a new valuation is received (for example an annual property revaluation).

Who: Relationship officer or Credit analyst (collateral permission). The loan must be **ACTIVE**.

1. Click **Revalue** on the asset.
2. Enter the **New market value** and the **Valuer** (at least two characters).
3. Click **Record valuation**.

The valuation is dated today. If both fields are not filled correctly, nothing happens - check them and click again.

What happens next: the LTV is recalculated. If the product has a maximum LTV and the loan is now above it, a **margin call** opens (message "Revalued — the loan is above max LTV: margin call opened").

If it is blocked: "A valuation cannot be dated in the future." - the valuation is dated with your computer's date; if your organisation's business date is behind the calendar date (for example in a test environment), ask finance to advance the business date first. "This collateral has been released." - released collateral cannot be revalued.

### 2.2 Margin calls

A margin call asks the borrower to restore the LTV by a deadline (the product's cure period).

The red notice **Margin call — cure by …** states: "LTV …% is above …%. The borrower must repay … or add collateral worth …."

| Margin call status | Meaning |
|---|---|
| **OPEN** | Waiting for the borrower to repay or add collateral. |
| **CURED** | Back within the maximum LTV, or the required repayment was received. |
| **EXPIRED** | Not cured by the deadline; a notice is raised and collections pick it up. |

Margin calls are reviewed at the end of each day and whenever collateral is revalued or added. To cure one, post the borrower's repayment (see [07-repayments-and-payments.md](07-repayments-and-payments.md)) or pledge more collateral (section 2.3). Past margin calls are listed under the table ("Margin calls: …").

### 2.3 Pledge more collateral

Who: Relationship officer or Credit analyst. The loan must be **ACTIVE** and already show the **Collateral** card.

1. Click **Pledge more collateral**.
2. Fill the collateral form: **Type** (for example LAND_TITLE, VEHICLE), **Description**, **Market value**, **Valuation date**, **Valuer**, **Method** and, if another loan ranks ahead on the same asset, **Loans ranking ahead**.
3. Click **Add collateral**.

If it is blocked: "This product accepts: …" - the type is not accepted by the product.

> **Note.** The **Collateral** card is hidden when a loan has no collateral at all, so there is no screen to pledge the first item of collateral after booking. Take collateral at the application stage (section 3), or ask your IT team.

### 2.4 Release collateral after the loan is closed (maker-checker)

When a loan is fully repaid (**CLOSED**), its collateral is released and the title documents returned to the borrower. Release needs two people: one proposes it, a different person signs it off.

To propose a release (Relationship officer or Credit analyst):

1. Open the closed loan. On the **Collateral** card click **Release** on the asset.
2. Enter the **Returned-document reference** - the title deed or receipt number given back to the borrower.
3. Click **Propose release**.

The card shows **Collateral release awaiting sign-off** ("A different user must sign it off"), and the item appears in the **Home** queue **Collateral releases to approve**.

To sign it off (Loan operations checker, not the proposer):

1. Open the loan from the queue.
2. In **Collateral release awaiting sign-off**, click **Sign off release** (or **Reject**).

The asset's status becomes **RELEASED** with the reference.

If it is blocked: "Collateral is released only once the loan is closed."; "A release of this collateral is already awaiting sign-off."; "This collateral is already released."; "You cannot approve or complete an action you created or proposed" (you proposed it - ask a colleague).

---

## 3. Collateral and guarantees at origination (summary)

While an application is in **DRAFT**, **SUBMITTED** or **RECOMMENDED**, a relationship officer or credit analyst adds security from the application screen with **Add collateral** (type, description, market value, valuation date, valuer, method, loans ranking ahead) and **Add guarantee** (guarantor name, PERSONAL or CORPORATE, amount). At approval, the platform checks the LTV (or combined LTV, when loans rank ahead) against the product's maximum and refuses an amount above it, for example: "Loan-to-value 0.850 exceeds 0.8; the most that can be lent is …". Collateral and guarantees carry over to the loan when it is booked. See [05-applications-and-credit-decisions.md](05-applications-and-credit-decisions.md) for the full steps.

---

## 4. Related controls elsewhere

- **Borrowing base** (drawings limited by certified inventory and receivables): [09-facilities.md](09-facilities.md), section 11.
- **Conditions precedent** on staged facilities: [09-facilities.md](09-facilities.md), section 5.
- **Counterparty and country exposure limits** for institutional lending: [12-specialised-products.md](12-specialised-products.md), section 9.
- **Guarantor demands and set-off**: [11-collections-and-recovery.md](11-collections-and-recovery.md).
- **Repossession and sale of collateral**: [11-collections-and-recovery.md](11-collections-and-recovery.md).
