# Repayments and payments

Who this is for: loan operations makers and checkers, collections officers, finance officers and branch staff who take money in, settle loans, issue payoff letters and handle money that cannot be matched to a loan.

This chapter covers everything that brings money onto a loan account (or returns it): posting repayments, paying in another currency, settling a loan early, payoff letters, unidentified payments (suspense) and refunds, payment-channel files, auto-debit mandates and repayments by the lender's static KHQR code (section 9) — the main way borrowers repay. Changes to the loan's terms (restructures, payment holidays, prepayment rescheduling, reversals) are in [08-servicing-changes.md](08-servicing-changes.md).

---

## 1. Finding a loan account

**Loans › Loan accounts** lists every booked loan.

To find a loan:

1. Open **Loans › Loan accounts**.
2. Optionally pick a status in the **All statuses** box.
3. Type the loan reference in **Search reference…** and press Enter or click **Search**.
4. Click the reference (for example `LN-260105-ABC123`) to open the loan screen.

The list shows **Reference**, **Status**, **Booked**, **Principal o/s**, **Interest**, **Fees**, **Penalty**, **DPD** (days past due), **Bucket / stage** and **Maturity**. Loans that have been restructured carry an amber **RESTRUCTURED** tag.

| Status | Meaning |
|---|---|
| **BOOKED** | The agreement is booked but the money has not been paid out yet. See [06-disbursement.md](06-disbursement.md). |
| **ACTIVE** | Disbursed and running. Repayments and most servicing actions are available only in this status. |
| **CLOSED** | Fully repaid or settled. |
| **WRITTEN OFF** | Written off; only recoveries can be posted. See [11-collections-and-recovery.md](11-collections-and-recovery.md). |

**Export CSV** (top right) downloads the list. Note: the download works only for users with the loan-data export permission (normally Finance officer and Risk / compliance); other users see the button but the download is refused.

### The loan screen at a glance

The loan screen (title = loan reference and status) has these cards, top to bottom:

- **Account** - balances (**Principal outstanding**, **Interest receivable**, **Fees receivable**, **Penalty receivable**, **Held on advance**), **Interest accrual** (or "Non-accrual since ..."), **Days past due**, **Delinquency bucket**, **Collection stage**, **Maturity**, **Restructured**, **Probation remaining** and more.
- **Servicing actions** - one button per action you can take. The subtitle reminds you: "Buttons reflect your permissions, policies and limits. The server re-checks every action." A greyed-out button shows the reason when you hover over it. Open **Why can't I… (n actions blocked)** for a full list of what is blocked and by which control (role, approval limit, maker-checker, feature flag, loan status).
- **Refinance**, **Auto-debit**, collateral, documents and covenant cards (depending on the loan).
- **Open tasks** - approvals waiting on this loan (for example a fee waiver or refund awaiting a checker).
- **Schedule** - the instalments, grouped by agreement version. Older versions are kept and collapsed.
- **Agreement versions** - every change to the contract (booking, prepayment reschedule, restructure, holiday, rate reset).
- **Financial events** - every posting, newest first. Click the arrow on a row to see the journal lines, how the payment was allocated, and its components.

Click **Refresh** (top right) to reload after another user has acted.

---

## 2. Posting a repayment

Use this when the borrower pays at the branch, by bank transfer or any other way that you record by hand.

Who: anyone with the repayment-posting permission (Loan operations maker, Collections officer). The loan must be **ACTIVE**.

To post a repayment:

1. Open the loan (see section 1) and click **Post repayment** in **Servicing actions**.
2. Enter the **Amount**. The currency box next to it defaults to the loan currency (see section 3 to take another currency).
3. **Value date** (optional) - the date the money was actually received. Leave blank to use the business date.
4. **External reference** (optional) - the receipt, bank or teller reference.
5. **Money beyond what is due** - what to do if the payment is more than is currently due:
   - **Product default** - use the product's setting.
   - **Hold as advance** - keep the extra and use it automatically for the next instalments.
   - **Prepay principal** - reduce the principal now (a partial prepayment).
6. **Prepayment strategy** (only matters when prepaying):
   - **RECAST — lower instalment** - same maturity, smaller instalments.
   - **SHORTEN — earlier maturity** - same instalment, the loan ends sooner.
7. **Paid by (if not the borrower)** and **Payer's relationship** (GUARANTOR, FAMILY, EMPLOYER, GROUP_MEMBER, OTHER) - optional, recorded with the payment.
8. Click **Post repayment**.

What happens next:

- You see "Repayment posted". The payment appears in **Financial events** as **REPAYMENT** with status **POSTED**.
- The money is allocated to what is due in the order the product defines (for example penalties, fees, interest, then principal). Expand the event row to see the **Allocation** by instalment and component.
- Money held on advance is always used first, before new money.
- **Back-dated payments and late penalties.** If you enter a **Value date** before the date late penalties were charged up to, the penalty for the days from the value date on is first undone (a **PENALTY_REVERSAL** event), then the payment is applied, and any instalment still overdue is charged again only on what is left. The borrower is not charged for days the payment covered. The repayment event shows what was undone and re-charged.
- On a loan on **non-accrual**, collected late penalties move from penalty suspense to income, like suspended interest.
- A prepayment creates a new agreement version and a new schedule (see [08-servicing-changes.md](08-servicing-changes.md#2-prepayment-and-rescheduling)).
- When everything is paid the loan closes automatically.

If you click **Post repayment** twice or the network drops, the system recognises the same payment and does not post it twice.

For a group loan, use **Group repayment by member** instead (see [10-group-lending.md](10-group-lending.md)).

If it is blocked:

| Message you see | What it means / what to do |
|---|---|
| "Enter a positive decimal amount (up to 4 decimals)." | Correct the amount. |
| "Value date ... is after the business date ...." | You cannot date a payment in the future. Use today's business date or earlier. |
| "Value date ... is N day(s) before the business date; this product allows M." | The product limits back-dating. Ask a supervisor; finance may need to handle it another way. |
| "This payment would leave X ... more on advance than the loan owes. Request a settlement quote and use early settlement to repay in full." | The borrower is paying off the whole loan. Use **Early settlement** (section 4). |
| "The payment exceeds the X ... currently due, and this product does not take partial prepayments. Use early settlement to repay in full." | The product does not allow prepayments. Post only what is due, or settle in full. |
| "This payment would repay the whole principal. Request a settlement quote and use early settlement instead." | Use **Early settlement**. |
| "The minimum prepayment is X ...." | The extra amount is below the product's minimum prepayment. |
| "The amount beyond what is due does not cover the X ... early repayment charge." | The extra is too small to pay the prepayment fee. |
| "Prepayment strategy X is not allowed for this product." | Choose the other strategy or leave **Product default**. |
| An error with code **PREPAYMENT_LOCKED_IN** | The loan is still in its lock-in period; prepayments are refused. The message explains until when. |
| "... is closed; nothing can be posted on .... Ask finance to reopen it." (code **PERIOD_CLOSED**) | The accounting month is locked. Use a value date in an open month or ask finance to reopen it (see [14-accounting-and-period-close.md](14-accounting-and-period-close.md)). |
| "lending.servicing is currently unavailable" or "lending.accounting.posting is currently unavailable" | Servicing or ledger posting has been switched off by a feature flag. Ask your tenant administrator. |
| "Your roles do not include loan.repayment.post" | You do not have the permission. Ask your administrator. |

Note: the **Post repayment** button only appears for **ACTIVE** loans.

---

## 3. Payment in another currency (FX)

Use this when the borrower pays in a currency other than the loan currency (for example KHR or THB on a USD loan).

To post a cross-currency repayment:

1. Click **Post repayment** on the loan.
2. In the small currency box next to **Amount**, choose the currency actually paid (USD, KHR or THB).
3. Enter the amount paid in that currency.
4. Read the preview that appears: "Credits ... to the loan", the bank rate (mid rate less the spread), the rate date, the value at mid rate and the FX gain or loss.
5. Click **Post repayment**. You see "Payment in KHR converted and posted" (or the currency you chose).

The preview is only a preview; the system converts again when it posts.

The loan is credited in its own rounding step (for example KHR loans in 100 riel): the amount converted is rounded to that step and what is left over is booked to rounding differences, so the loan never carries odd riel it cannot bill.

If it is blocked:

- **No rate for this date** - "No KHR/USD rate is published for <date> ...; the payment cannot be converted." Finance must publish the exchange rate first (see [14-accounting-and-period-close.md](14-accounting-and-period-close.md)), or the setting **Rate may be up to (days old)** must allow an older rate (section 8.5).

Note: rates come from your organisation's own published exchange-rate table. The FX spread and the rate age limit are set on **Collections & relief › Payment channels**, **Settings** tab.

---

## 4. Early settlement (paying off the loan in full)

Use this when the borrower wants to repay everything and close the loan. An ordinary repayment of the same amount would not close the loan correctly; always use **Early settlement**.

Who: users with the repayment-posting permission. The loan must be **ACTIVE** and the product must allow early settlement.

To settle a loan:

1. Open the loan and click **Early settlement**.
2. Leave **Quote as of** blank (today's business date). See the note below before choosing another date.
3. Click **Get quote**. The quote shows **Principal**, **Interest**, **Fees**, **Penalties**, **Settlement fee**, any **Less: held on advance**, **Total**, **Rounding difference** and **Payable**. Explanations appear above the table for an interest rebate, Murabaha profit rebate (ibra') or the settlement fee.
4. Tell the borrower the **Payable** amount and take the money.
5. Click **Settle <currency> <amount>** and confirm in the **Settle loan** dialog.

What happens next: "Loan settled". A **SETTLEMENT** event is posted and the loan status becomes **CLOSED**.

To give the borrower a closure letter once the loan is **CLOSED** (by settlement or final repayment): on the loan screen, in the **Statements and letters** card, click **Closure letter**, then **Print**. The same card has **Statement** for any period (see [15-reports-and-regulatory-returns.md](15-reports-and-regulatory-returns.md)). Nothing is posted when you generate these.

Note: settlement is always posted on the business date. If you got a quote for another date and then click **Settle**, you will see "The settlement amount on <business date> is X ...". Get the quote again with **Quote as of** blank. To promise an amount for a future date, issue a payoff letter instead (section 5).

To remove the settlement fee, a fee waiver must be approved first (see [08-servicing-changes.md](08-servicing-changes.md#6-fee-waivers)).

If it is blocked:

| Message | What to do |
|---|---|
| "This product does not allow early settlement." | The product forbids it. |
| Code **SETTLEMENT_LOCKED_IN** with an explanation | The loan is still in its lock-in period. |
| "Loan is CLOSED." (or another status) | Only active loans can be settled. |

## 4a. Cooling-off cancellation

If your organisation offers a cooling-off period (by default **7 days** after the money is paid out; the key facts statement tells the customer), the customer may change their mind and cancel the loan inside it. They repay the cash they received, plus interest for the days they had it if your settings charge it. There is **no settlement fee, lock-in charge or penalty**, and your organisation's upfront fees are **refunded** (credit-insurance premiums collected for an insurer are not).

It takes two people. On the loan screen, while the period is open, click **Cooling-off cancellation**:

1. A loan operations maker (anyone who can post repayments) records the request: the **Customer's reason** and the **Customer's request reference** (the letter, form or call), then clicks **Record cancellation request**. The panel shows the amount to cancel today: principal, interest, fees, less the fees refunded.
2. A different person (a loan operations checker) opens the same panel and clicks **Approve** (or **Reject**).
3. When the customer pays, the maker enters the **Receipt reference** and clicks **Take repayment and cancel**, then confirms. The amount must be exactly the one shown for today.

What happens next: "Loan cancelled". A **SETTLEMENT** event is posted in its cooling-off form (fees refunded, penalties waived), the loan becomes **CLOSED** and a closure letter is filed.

The request must be recorded inside the period; once approved it can be completed later, but interest keeps running until the money comes in.

If it is blocked:

| Message | What to do |
|---|---|
| "The cooling-off period ended on …" (code **COOLING_OFF_EXPIRED**) | Too late; the loan can only be settled early on its own terms (section 4). |
| "This lender offers no cooling-off period." | The period is switched off in **Lending settings** (`consumerProtection.coolingOffDays` = 0). |
| "A cooling-off cancellation is already pending or approved for this loan." | Approve or reject the open request first. |
| "The cancellation request is pending; it must be approved first." | Ask a checker to approve it. |

### Legacy loans

Loans still in the retired original module cannot be settled there any more. Move them to the lending platform with the loan-book migration and settle them on the loan account. See [21-legacy-archive-and-migration.md](21-legacy-archive-and-migration.md).

---

## 5. Payoff letters (good-through quotes)

Use a payoff letter when the borrower, or another bank taking over the loan, needs a written statement of how much will close the loan on each day up to a date.

Who: users with the repayment-posting permission. The loan must be **ACTIVE**.

To issue a payoff letter:

1. Open the loan and click **Payoff letters**.
2. **For** - **The borrower** or **Another lender (takeover)**.
3. **Valid for (days)** - 1 to 30.
4. **Acquiring lender** (required for a takeover, at least 2 characters) or **Addressee (optional)** for the borrower.
5. **Their reference** - optional, the other bank's reference.
6. Click **Issue letter**. The letter text opens below the table.
7. Click **Print** to print it or **Hide** to close it.

The table lists each letter: **Letter** reference, **For**, **Good through** (dates, starting payable amount and the extra per day), **Status** and **View**.

| Letter status | Meaning |
|---|---|
| **ISSUED** | Valid and unused; can be settled against. |
| **USED** | The loan was settled under this letter. |
| **EXPIRED** | Past its last good-through date. |

To settle against a payoff letter (when the money arrives):

1. Open **Payoff letters** on the loan.
2. Optionally enter **Payment reference when settling** (for example the acquiring bank's transfer reference).
3. Click **Settle** on the letter row and confirm in **Settle against payoff letter**.

What happens next: "Loan settled under <letter reference>". The letter becomes **USED** and the loan **CLOSED**.

If it is blocked:

- "Valid for 1 to 30 days." / "Name the lender taking the loan over." - correct the form.
- "Letter X is not good on <date>." or "Payoff letter X is not good on <date>; it runs to <date>." (code **PAYOFF_QUOTE_EXPIRED**) - the letter has run out. Issue a new one.
- "The balance has changed since letter X was issued: ... is now owed on <date>, not ...." (code **PAYOFF_QUOTE_STALE**) - something was posted after the letter was issued (for example a repayment or penalty). Issue a new letter.
- "This payoff letter cannot be used." (code **PAYOFF_QUOTE_INVALID**) - it was already used or does not belong to this loan.

---

## 6. Money held on advance, and refunding it

When a borrower pays more than is due and the extra is kept as an advance, the amount shows on the loan as **Held on advance**. It is applied automatically as instalments fall due (these appear as **ADVANCE_APPLIED** events).

If the borrower wants the advance back, it is refunded under maker-checker: one person proposes, a different person approves and pays it out. Why: four-eyes control, so no single person can send money out of a loan.

To propose a refund (maker - for example Loan operations maker):

1. Open the loan. The **Refund advance** button appears only while money is held on advance.
2. Check the **Amount** (pre-filled with the full amount held) and enter a **Reason**.
3. Click **Propose refund**. You see "Refund proposed — a different user must approve it".

To approve or reject (checker - for example Loan operations checker):

1. Open the loan. The button now reads **Advance refund decision**.
2. Read the notice "Refund of ... awaiting approval" and click **Approve and pay** or **Reject**.

If it is blocked: "Record why the advance is refunded." (reason missing), "A refund is already awaiting approval." (decide the existing one first), "You cannot approve or complete an action you created or proposed" (you are the proposer; ask a colleague).

Note: while money is held on advance, a negotiated settlement, write-off or refinance of the loan is refused with "This loan holds X ... paid in advance. Refund the advance before you ...".

---

## 7. Unidentified payments (suspense)

Money that arrives without an identifiable loan (no reference, wrong reference, unknown payer) is held in the unidentified-payments suspense account until it is matched to a loan or refunded to the payer. Payment-channel file lines that cannot be applied also land here.

Menu: **Collections & relief › Unidentified payments**. The menu badge counts open receipts and refunds waiting for approval.

### The screen

- Summary tiles: **Open receipts**, **Total held**, **Oldest**, and three age buckets **0–7 days**, **8–30 days**, **31+ days**. Click an age tile to filter the list; **Clear age filter** removes it. Ages are counted from the value date to the business date.
- **Receipts** list with tabs **Open**, **Matched**, **Refunded**, **All**. Columns: **Reference**, **Value date**, **Age**, **Channel / ext. ref**, **Payer**, **Received**, **Still held**, **Status**. Rows aged 8–30 days are shaded amber, 31+ days red.
- Click a reference to see who recorded it and every match or refund made from it.

| Status | Meaning |
|---|---|
| **OPEN** | Some or all of the money is still held. |
| **MATCHED** | Fully applied to one or more loans. |
| **REFUNDED** | Fully returned (or the last part returned) to the payer. |
| **PENDING APPROVAL** (extra tag) | A refund is waiting for a checker. |

### 7.1 Record an unidentified receipt

Who: users with the repayment-posting permission.

1. Click **Record receipt** (top right).
2. Enter **Amount**, **Currency** (three letters, for example USD), and optionally **Value date** (defaults to the business date; up to 30 days back).
3. Choose the **Channel**: **Branch cash**, **Bank transfer**, **Mobile money**, **Agent**, **Payroll deduction** or **Other**.
4. Enter the **External reference** (bank or channel transaction reference, at least 2 characters).
5. Optionally add **Payer name** and a **Narrative** (anything that may help identify the loan).
6. Click **Record receipt**. You see "Receipt <reference> recorded in suspense".

### 7.2 Match a receipt to a loan

1. On an **OPEN** row click **Match**.
2. In **Find loan by reference** type the loan reference and click **Search**.
3. Click **Select** on the right loan. Loans in another currency cannot be selected ("The receipt is in USD; this loan is in KHR.").
4. Check the **Amount** (up to what is still held). You can match part of a receipt and the rest to another loan.
5. Optionally choose **Apply excess as** (**ADVANCE — hold for next due dates** or **PREPAY — reduce principal now**) and **Prepayment strategy** (**RECAST** / **SHORTEN**).
6. Click **Apply to loan**.

What happens next: the amount is posted to the loan as an ordinary repayment at the receipt's value date, with the loan's normal allocation rules. The receipt stays **OPEN** while money remains, then becomes **MATCHED**. All the repayment rules and messages in section 2 apply.

### 7.3 Refund a receipt to the payer (maker-checker)

1. Maker: on an **OPEN** row click **Refund**. Enter the **Amount** (up to what is held) and a **Reason** (at least 3 characters), then click **Propose refund**. You see "Refund proposed — awaiting approval by a different user".
2. Checker (a different user, for example Loan operations checker): open **Unidentified payments**, find the row tagged **PENDING APPROVAL** and click **Refund decision**. Optionally add a **Comment**, then click **Approve & pay out** or **Reject**.

What happens next: on approval the money leaves suspense and the receipt becomes **REFUNDED** (or stays **OPEN** if only part was refunded). The actual payment to the payer is made outside the system by your usual process.

If it is blocked:

- "You cannot approve or complete an action you created or proposed" - you proposed it; a colleague must decide.
- "A refund of this receipt is already awaiting approval." - decide the pending one first.
- "Less is now held than this refund; it was matched in the meantime." - someone matched part of the money after the refund was proposed. Reject it and propose a new refund.
- "This receipt is already matched." / "already refunded." - nothing is left to act on.

---

## 8. Payment channels

Menu: **Collections & relief › Payment channels**. The page brings together settlement files from wallets, QR, agents and mobile banking, employer payroll remittances, auto-debit and the daily reconciliation. Tabs: **Import file**, **Files**, **Daily reconciliation**, **Payroll by employer**, **Auto-debit**, **Settings**.

### 8.1 Import a settlement or payroll file

Who: users with the repayment-posting permission (Loan operations maker, Collections officer). Files can also be pushed automatically by an integration (see [17-webhooks-and-integrations.md](17-webhooks-and-integrations.md)).

To import a channel settlement file:

1. Open the **Import file** tab.
2. **File type**: **Channel settlement**.
3. **Channel**: **Mobile banking**, **QR (KHQR)**, **Wallet** or **Agent network**.
4. Choose the **CSV file**, or paste the content into **Content**.
5. Open **File format** if you need a reminder of the columns: `reference, loan_ref, amount, currency, value_date, channel_txn_id` and optionally `payer_name`. Lines starting with `#` are ignored. Value dates must be within the last 30 days.
6. Click **Import file**.

To import an employer payroll remittance:

1. **File type**: **Payroll remittance**.
2. Enter **Employer**, **Payroll period** (month), **Currency / value date**.
3. Choose or paste the file: columns `employee_ref, amount` and at least one of `national_id` / `loan_ref` per line. A line by national ID is applied when the borrower has exactly one live loan in that currency. The national ID itself is not stored.
4. Click **Import file**.

What happens next: a result card shows "Imported" with the counts of posted, to-suspense and duplicate lines, and each line:

| Line outcome | Meaning |
|---|---|
| **POSTED** | Applied to the named loan as a repayment (click the loan reference). |
| **SUSPENSE** | Could not be applied; held in unidentified payments with the reason. Click its reference to match or refund it (section 7). |
| **DUPLICATE** | This channel transaction ID was imported before; nothing applied. "differs from original" means the repeat does not match the first one; check with the channel. |
| **REVERSED** | Posted, then the repayment was reversed. |

If the same file is imported again you see "Already imported" and "This file was imported before — Nothing was applied again; this is the original import."

If it is blocked: "The file has N error(s); nothing was imported. Correct them and send the whole file again." (code **FILE_INVALID**). The list under **Validation issues** shows each bad line. Fix the file and import the whole file again.

### 8.2 Files

The **Files** tab lists every imported file (**File**, **Channel**, **Imported**, **Lines**, **Posted**, **Suspense**, **Dup.**, **Total**). Filter by channel, and click **Lines** to see what happened to each line.

### 8.3 Daily reconciliation

Use this each day to prove that every amount a channel reported is accounted for.

1. Open **Daily reconciliation**.
2. Choose the **Value date** and optionally a **Channel**.
3. For each channel, check the totals: **File total** = **Posted** + **Reversed** + **Matched from suspense** + **Refunded** + **Still in suspense**. **Difference** should be zero.
4. The card shows **BALANCED** when there are no breaks, or **OPEN** with a list of breaks:

| Break | What to do |
|---|---|
| **Unmatched in suspense** | Match or refund the receipt in **Unidentified payments**. |
| **Posted, then reversed** | Confirm the reversal was correct (for example a bounced payment) and follow up with the channel. |
| **Repeated id, different payment** | The channel sent the same transaction ID with different details. Confirm with the channel. |

The **What to do** column gives the specific instruction for each line.

The **Payroll by employer** tab shows the same totals and breaks per employer and payroll period. Type the exact **Employer** name to filter.

### 8.4 Auto-debit (direct-debit mandates)

A mandate lets the system collect instalments from the borrower's bank account on each due date during the end-of-day run.

Note: **auto-debit is not available**: only a mock bank connection exists, and no bank debit integration is planned (borrowers repay by KHQR, section 9). On the **Settings** tab, **Integrations** shows **Bank auto-debit** as **SIMULATION ONLY** with the warning "Auto-debit uses a mock bank — No money moves". In production the mock is refused, so no debit is attempted. Ask your IT team before relying on auto-debit.

To set up a mandate (on the loan screen, users with the repayment-posting permission):

1. Open the loan. Find the **Auto-debit** card ("No active mandate: instalments are paid by the borrower.").
2. Click **Set up mandate**.
3. Enter **Mandate reference**, **Bank** (for example ABA), **Account number**, **Account holder** and **Consent date** (when the borrower signed; it cannot be in the future).
4. Click **Record mandate**. You see "Mandate recorded — instalments will be collected on their due dates".

A loan can have only one **ACTIVE** mandate. To stop collecting, click **Revoke** on the mandate row, type a **Reason** and click **Confirm**. The mandate becomes **REVOKED**.

What happens next: at the start of each end-of-day run, every active mandate whose loan has an instalment due that day is collected. The attempts show on the loan's **Auto-debit** card and on the **Auto-debit** tab of **Payment channels** (**Collection attempts**).

| Attempt outcome | Meaning |
|---|---|
| **SUCCEEDED** | Collected and posted as a repayment. |
| **FAILED** | The bank refused (the failure code is shown). It is retried per the settings; **Next retry** shows when. |
| **SUSPENSE** | Collected but could not be applied to the loan; held in unidentified payments. |
| **PENDING** | Not finished yet. |

If it is blocked: "Mandate X is already active on this loan; revoke it first.", "Mandate reference X is already in use.", "A mandate can only be set up on a live loan; this one is closed.", "The borrower cannot have consented after today."

### 8.5 Settings

Who can save: Finance officer (the rate-management permission). Others can view.

On the **Settings** tab:

- **Integrations** - the status of **Bank auto-debit** and **Exchange rates** (**ENABLED**, **SIMULATION ONLY** or **DISABLED**).
- **FX spread (basis points)** - taken off the mid rate when the bank buys the payment currency (0–1000).
- **Rate may be up to (days old)** - 0 means only a rate published for the value date itself.
- **Auto-debit attempts per due date** - including the first (1–10).
- **Days between attempts** - 1–31.

Click **Save settings**. Changes apply from the next payment or end-of-day run.

---

## 9. Repayment by KHQR

Borrowers repay by scanning your organisation's **static KHQR code** — one fixed code per currency (USD and/or KHR), optionally one per branch. The code carries **no amount**: the borrower types the amount and writes the **loan reference** (for example `LN-260105-ABC123`) in the payment remark.

Important: the platform has **no connection to Bakong or to a bank**. It never learns of a payment by itself, and nothing is credited automatically when a borrower pays. A KHQR payment counts only when:

- a **second person verifies** it (a borrower's claim or a receipt staff recorded), or
- the **bank statement** you import confirms it.

Menu: **Collections & relief › KHQR repayments**. Tabs: **Payments to check**, **Statement import**, **Held in suspense**, **KHQR codes**. The Home page shows a **KHQR payments to verify** tile with the payments waiting for you.

### 9.1 Set up the code (maker-checker)

Who: someone with **khqr.manage** (Tenant administrator, Finance officer) proposes; a **different** person with **tenant_settings.approve** (Risk / compliance) approves.

1. Open **KHQR repayments › KHQR codes** and click **Propose a code**.
2. Under **How**, choose:
   - **Generate from the Bakong account** — enter the **Bakong account ID** (`name@bank`), **Merchant name** (what the payer sees, at most 25 Latin characters) and **City**. The platform builds the static code (point of initiation 11, no amount); or
   - **Upload the QR the bank gave** — pick the PNG or JPEG. The platform reads it and shows the Bakong account and merchant. A code with an amount, a dynamic (single-payment) code, or a code for the other currency is refused. If the image cannot be read, it is kept as it is and you type the account details shown with it.
3. Choose the **Currency** and, under **For**, the whole lender or one branch. A branch's code is shown for that branch's loans; other loans use the lender's code.
4. Optionally enter **Bank** and **Account number**, give a **Reason for the change**, and click **Submit for approval**.
5. The approver opens the same tab, checks the code under **Waiting for approval** and clicks **Approve** (or **Reject**). The proposer cannot approve their own code. Approving replaces the code in force for that currency and branch.

Every proposal and decision is in the audit trail. Until a code is approved, borrowers are told to ask how to pay, and the key facts statement carries a warning for staff.

### 9.2 What borrowers see

- **Borrower portal** — on each active loan, **How to pay**: the code, the loan reference in large print, the four steps (scan, type the amount, write the reference in the remark, press **I have paid**), and downloadable cards in Khmer and English. Their claims are listed with **Being checked**, **Received** or **Not accepted** (with the reason).
- **How-to-pay card** — a printable PDF per loan, in English and Khmer, with the code, the loan reference and the steps. Staff download it from the loan screen (**KHQR repayments** card › **How-to-pay card (EN/KM)**) and hand it out at disbursement.
- **Key facts statement** — a **How to repay** section with the code and the account details.
- **Statement PDF**, **settlement quote letter** and **borrower notices** (Collections › Borrower notices) — a "How to pay" paragraph with the merchant, the Bakong account and the reference to write.
- **Telegram bot** — the due-tomorrow reminder and the late-payment notice are followed by the code as a picture; the balance answer tells the customer where to pay and what to write in the remark.

### 9.3 "I have paid" (borrower claims)

In the portal the borrower presses **I have paid** and enters the **amount**, **when they paid**, the **transaction reference** (the hash or reference number on their receipt) and, optionally, a screenshot (filed in their documents). The claim is **pending**: no money is posted and the loan balance does not change.

A claim is checked in one of two ways:

- the imported bank statement has a line with the **same transaction reference** and amount — it is confirmed and posted automatically (section 9.5); or
- a member of staff with the repayment-reversal permission (Loan operations checker) checks it in the bank app and clicks **Verify** on **Payments to check** — it is posted as a repayment with channel **KHQR**. **Reject** records why (the borrower sees the reason).

A borrower may have at most five claims waiting (lending settings, `payments.khqr.maxPendingClaimsPerBorrower`).

### 9.4 Record a payment seen in the bank app (maker-checker)

When a payment shows in the lender's bank app or merchant notification:

1. Open the loan and, on the **KHQR repayments** card, click **Record KHQR payment**.
2. Enter the **Amount**, **Paid at**, the **Bank transaction reference**, and if known the payer, their account or phone, the remark and a screenshot. Click **Record payment**.
3. Nothing is posted yet. A **different** person verifies it on **Payments to check** (or on the same card) with **Verify** — this posts the repayment — or rejects it.

The person who recorded a payment cannot verify or reject it.

### 9.5 Import the bank statement

Who: users with the repayment-posting permission.

1. Download the transaction export from your bank or Bakong merchant account (CSV or Excel `.xlsx`).
2. Open **KHQR repayments › Statement import**. Choose the **Column layout** (**Generic** reads the usual header names: date, amount or credit, currency, reference, sender name, from account, description/remark) and, for files without a currency column, the **Currency**.
3. Pick the file and click **Check first**. The table shows what each line would do — **Post to loan**, **Hold for a second person**, **Hold in suspense** or **Ignore (already received)** — and why. Nothing is saved.
4. Click **Import statement**. Lines are posted, held or ignored as shown; the result and the earlier imports are listed below, and the KHQR channel appears on **Payment channels › Daily reconciliation**.

A file with any malformed line (a date or amount that cannot be read, a reference used twice for different payments) is refused whole; correct it and import it again. Importing the same file again returns the first import and applies nothing. Debits and rows without an amount received are skipped and listed.

Note: the bank layouts other than **Generic** have not been checked against real exports. Use **Check first** on a sample before relying on one, or ask your administrator to add your bank's exact column names to the lending settings (`payments.khqr.statementMappings`).

### 9.6 How a statement line is matched

In this order (only exact matches; anything doubtful is held):

1. **Same transaction reference** as a payment already recorded (a claim or a staff receipt), for the same amount and currency — it confirms that payment.
2. **The loan reference in the remark** — exactly one of your loans, active and in the line's currency.
3. **A pending claim of the same payer** (identified by phone or name) for the same amount and currency, paid within three days (`payments.khqr.claimMatchWindowDays`).
4. **The payer's only live loan** — the payer is identified by phone (or by a full name only one borrower has), has exactly one active loan in that currency, and the amount equals what is due on it (the next instalment, what is overdue, or both).

Everything else — no reference, two possible loans, a different amount, a closed loan, a different currency, or a loan that refuses the payment — is held in **unidentified payments (suspense)** with the reason and the possible loans. Allocate it there (section 7.2) or, if you know the loan, record the payment on the loan with the same bank reference (section 9.4): it is linked to the held money, and verifying it applies the money from suspense.

**Auto-posting.** By default an exact match is posted at import. When your lending settings turn `payments.khqr.statementAutoPost` off, matched lines are held in suspense as **Bank statement** payments on **Payments to check**, and a second person verifies each one. The importer cannot verify their own import's payments.

A payment is applied with the day it was paid as its value date, but never further back than the product allows back-dating: a payment confirmed late is applied on the earliest day allowed, and the day it was paid is kept on the repayment.

### 9.7 One transfer, applied once

The bank transaction reference (letters and digits, upper case — `ft-2602 1512` and `FT26021512` are the same) is applied once across claims, staff receipts and statement lines:

- recording or claiming a reference that is already recorded or posted is refused ("This bank transaction is already recorded" / "already applied to loan …");
- a statement line with a reference already posted is shown as **Ignore (already received)**;
- a rejected claim frees its reference, so the right payment can be recorded again.

### 9.8 Auto-debit is not available

There is no bank connection for direct debits: auto-debit (section 8.4) uses a mock bank that production refuses. Do not promise borrowers automatic debits.

---

## 10. Related tasks on the loan screen

- **Negotiated settlement**, **Fee waiver**, **Payment holiday**, **Rate resets**, **Request restructure**, **Refinance** and reversing a payment - see [08-servicing-changes.md](08-servicing-changes.md).
- **Guarantor / set-off** (appears when the loan is overdue), **Propose write-off**, **Record recovery** - see [11-collections-and-recovery.md](11-collections-and-recovery.md).
- **Borrower notices** (reminders before a due date and overdue notices) are on **Collections & relief › Collections** - see [15-reports-and-regulatory-returns.md](15-reports-and-regulatory-returns.md).
- Money received over a period, with CSV export: **Finance › Reports › Money received** - see [15-reports-and-regulatory-returns.md](15-reports-and-regulatory-returns.md).
