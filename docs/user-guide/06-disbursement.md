# Disbursement

Who this is for: loan operations makers (who record down payments and prepare disbursements) and loan operations checkers (who approve and pay out).

Disbursement pays the loan out and makes the loan account **ACTIVE**. It follows booking (see [Applications and credit decisions](05-applications-and-credit-decisions.md)) and always takes three steps by at least two people:

1. **Prepare** — a loan operations maker asks for the payout.
2. **Approve** — a different person (loan operations checker) approves it, within their approval limit and signed in with their authenticator code.
3. **Execute** — a checker (not the person who prepared it) records the payout with the bank or cash reference and, where needed, who receives the money.

Why: four-eyes control. No one person can both request and release money.

Note: The system does not send money to the bank itself. Automated payout through a payment provider requires an integration that is not in place (only a test adapter exists, and it is blocked in production). Pay the money through your usual bank or cash process and record its reference when you execute.

---

## Where to find it

1. Go to **Loans › Loan accounts** and open the loan (status **BOOKED**). Or open it from the **Booked** box on the application.
2. In **Servicing actions**, click **Disbursement**. The **Disbursement** panel opens.

Your **Home** page shows **Disbursements to prepare**, **Disbursements to approve** and **Approved disbursements to pay out**; the number on **Loan accounts** counts them.

If the **Disbursement** button is greyed out, hover over it, or open **Why can't I…** below the buttons, to see the reason.

---

## Before you start

- The loan was booked, which needs the customer's acceptance of the **key facts statement** for the approved terms (see [Key facts statement](05-applications-and-credit-decisions.md#key-facts-statement)). The accepted statement, in English and Khmer, is in the customer's document library and linked to the loan.
- Tell the customer about their **cooling-off right**: if your organisation offers one, they may cancel within that many days after the money is paid out by repaying what they received (see [Cooling-off cancellation](07-repayments-and-payments.md#4a-cooling-off-cancellation)).
- All **conditions precedent** on the application are **SATISFIED** or **WAIVED** (see [Conditions precedent](05-applications-and-credit-decisions.md#conditions-precedent)). Otherwise execution is refused with "Conditions precedent outstanding: …".
- If the terms include a **down payment**, it has been recorded (see below).
- The value date is not after today's business date and not further back than the product allows.
- The accounting month of the value date is open (not closed in [period close](14-accounting-and-period-close.md)).
- New origination and ledger posting are switched on (feature flags `lending.origination` and `lending.accounting.posting`).

---

## Record a down payment

Use this when the borrower pays part of the price themselves before the loan is paid out (for example for a motorbike or equipment). The panel shows a **Down payment** box while the loan is **BOOKED**, with what has been **Received** and what is **held by us**.

To record a down payment (loan operations maker):

1. In the **Disbursement** panel, under **Down payment**, enter the **Amount**.
2. Choose **Collected by**:
   - **Us (held until payout)** — your organisation received the money; it is held and paid out to the seller together with the loan proceeds.
   - **Seller directly** — the borrower paid the seller; you record the evidence only.
3. Enter the **Receipt reference** (at least 2 characters).
4. Click **Record down payment**. You see "Down payment recorded".

The disbursement is refused until the agreed down payment has been received: "The … down payment has not been received (recorded: …)."

Note: If the amount or receipt reference is invalid, the warning message currently only appears once a disbursement has been approved (it is shown under the **External reference** field). If nothing seems to happen when you click **Record down payment**, check that the amount is a plain number (e.g. 250.00) and the reference has at least 2 characters.

---

## Step 1 — Prepare the disbursement

For loan operations makers.

1. In the **Disbursement** panel, optionally set the **Value date** (blank = today's business date). This is the date the money is actually paid.
2. Click **Prepare disbursement**. You see "Disbursement prepared — awaiting approval".

What happens next: a disbursement task for the net amount (principal less any fees deducted from the proceeds) is created with status **PENDING** and appears in the checkers' **Disbursements to approve** queue. The task is listed under **Open tasks** on the loan page.

If it is blocked: "A disbursement is already in progress for this loan." — a pending or approved disbursement already exists; approve, reject or execute it first.

---

## Step 2 — Approve or reject

For loan operations checkers. You must not be the person who prepared it.

1. Open the loan and click **Disbursement**.
2. The pending task shows its amount and the maker. Click **Approve** (or **Reject**).
3. Confirm in the dialog.

You see "Disbursement approved" or "Disbursement rejected".

Requirements:

- You signed in with your **authenticator code** (multi-factor sign-in); otherwise "This action requires signing in with multi-factor authentication".
- The amount is **within your approval limit**; otherwise "The amount exceeds your approval authority".
- You did not prepare it; otherwise "You cannot approve or complete an action you created or proposed".

What happens next: an approved task waits for execution (**Approved disbursements to pay out**). After a rejection the maker can prepare a new one.

---

## Step 3 — Execute (pay out)

For loan operations checkers. The person who prepared the disbursement cannot execute it; the person who approved it can.

1. Pay the money through your bank or cash process and note its reference.
2. Open the loan and click **Disbursement**.
3. Under **Pay to**, leave the list empty to pay everything to the borrower, or click **Add payee** for each recipient and fill in:
   - **Type** — **Borrower**, **Seller**, **Dealer**, **School**, **Previous lender**, **Our loan (consolidate)**, **Merchant (BNPL — paid net of the discount)**, **Asset supplier (lease)** or **Other**
   - **Name**
   - **Account** (or **Loan id** for **Our loan (consolidate)** — another active loan of the same borrower, which is paid off from the proceeds)
   - **Reference** (optional)
   - **Amount**
   The running **Total** is shown; the amounts must add up exactly to the payout (the net proceeds plus any down payment we hold). **Remove** deletes a line.
4. Enter the **External reference** — the bank transfer or cash reference (at least 2 characters).
5. Click **Execute disbursement** and confirm ("This posts the disbursement to the ledger and activates the loan. Continue?"). You see "Disbursement executed".

What happens next:

- The loan account becomes **ACTIVE** with the principal outstanding, disbursement date and maturity date set.
- The disbursement is posted to the ledger (loan receivable, cash, fee income and tax as applicable).
- If the value date differs from the planned date used at booking, the schedule is recalculated and saved as a new agreement version (reason **DISBURSEMENT_DATE**). Earlier versions are kept on the **Schedule** card.
- Fees collected separately (not deducted from the proceeds) become due on the disbursement date as instalment 0.
- Any **Our loan (consolidate)** payee loans are settled from the proceeds.

### Submitting twice will not pay twice

If your connection drops, or you click **Execute disbursement** again for the same details, the system recognises the repeat and does not post a second payout. The same protection applies to **Record down payment**. If the first attempt already succeeded, a repeat attempt just shows the loan as already paid out (or "There is no approved disbursement to execute.").

---

## Refinancing at disbursement

If the application was created to refinance an existing loan (the **Refinances loan** field), executing the disbursement pays off the old loan from the new loan's proceeds in the same step, and the old loan closes. You cannot name payees on a refinancing disbursement ("A refinancing disbursement pays the replaced loan itself; payees cannot be named."). If the new loan does not cover the payoff and the product does not allow a shortfall, nothing is posted. See [Servicing changes](08-servicing-changes.md).

---

## Disbursement task statuses

| Status | Meaning |
|---|---|
| **PENDING** | Prepared; waiting for approval. |
| **APPROVED** | Approved; waiting to be executed. |
| **REJECTED** | Rejected by the checker; prepare again if needed. |
| **EXECUTED** | Paid out; the loan is active. |

Loan account statuses relevant here: **BOOKED** (agreement in place, not yet paid out) and **ACTIVE** (paid out, being serviced).

---

## If it is blocked

| Message | Cause | What to do |
|---|---|---|
| "Conditions precedent outstanding: …" | A condition is not satisfied or waived. | Satisfy or waive it on the application (see [chapter 05](05-applications-and-credit-decisions.md#conditions-precedent)). |
| "The … down payment has not been received (recorded: …)." | Down payment missing or short. | Record the down payment. |
| "A down payment is held for the seller: name the payees of this disbursement." | We hold a down payment, so the seller must be named. | Add payees (for example the **Seller**) adding up to the full payout. |
| "The payees add up to …; the disbursement pays out …" | Payee amounts do not match. | Correct the amounts. |
| "Name the loan for an INTERNAL_LOAN payee, and only for one." / "An internal payee must be another active loan of the same borrower." | Wrong consolidation details. | Enter the other loan's ID, or change the payee type. |
| "Record the bank or cash reference of the payout." / "External reference must be at least 2 characters." | No reference. | Enter the bank or cash reference. |
| "There is no approved disbursement to execute." | Not approved yet, or already executed. | Refresh; approve first if needed. |
| "Value date … is after the business date …" / "Value date … is … day(s) before the business date; this product allows …" | Value date out of range. | Prepare again with a valid value date (reject the old task first). |
| "… is closed; nothing can be posted on …. Ask finance to reopen it." | The accounting month is closed. | Ask finance (see [Accounting and period close](14-accounting-and-period-close.md)). |
| "This action requires signing in with multi-factor authentication" | Signed in without your authenticator code. | Sign out and sign in again with your code. |
| "lending.origination is currently unavailable" (or another flag) | A feature flag is off. | Ask your tenant administrator (see [Tenant administration](18-tenant-administration.md)). |
