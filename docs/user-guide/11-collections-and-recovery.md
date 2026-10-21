# Collections and recovery

Who this is for: collections officers, loan operations makers and checkers, finance officers who run end of day, and managers who follow up loans in arrears, through write-off and recovery after write-off.

This chapter covers loans on the lending platform (**Loans › Loan accounts**). Loans still in the retired original module are not collected here; move them to the lending platform first (see [21-legacy-archive-and-migration.md](21-legacy-archive-and-migration.md)).

What is covered:

1. How days past due, buckets and collection stages are worked out
2. The **Collections** page: business date, collector work queues, borrower notices, past-due list, promises to pay
3. Calling the guarantor (guarantor demands)
4. Set-off from the borrower's deposit
5. The **Recovery** desk and the recovery card on the loan: repossession, pawn, credit insurance, debt sale, surplus payouts
6. Write-off (propose and approve)
7. Recovery after write-off
8. Negotiated settlement (short; the full steps are in [08-servicing-changes.md](08-servicing-changes.md))
9. Who does what, and what blocks you

---

## 1. Days past due, buckets and collection stages

The system works these figures out during the **end-of-day batch**, not as you type. Until the batch runs for the current business date, the figures on screen are as of the last run.

- **Days past due (DPD)**: the number of days since the oldest instalment that is due and still not fully paid. One overdue instalment is enough to make a loan past due.
- **Delinquency bucket**: the DPD band the loan is in. The bands come from the product. The standard product templates use:

| Bucket (as shown) | DPD |
|---|---|
| **CURRENT** | 0 |
| **DPD 1 30** | 1–30 |
| **DPD 31 60** | 31–60 |
| **DPD 61 90** | 61–90 |
| **DPD 90 PLUS** | 91 or more |

- **Collection stage**: the step on the product's collections ladder that the loan has reached. The standard templates use **REMINDER** (from 1 DPD), **FIELD_FOLLOW_UP** (from 31 DPD) and **RECOVERY** (from 91 DPD). Your products may use other stages.
- **Delinquency floor** (restructured loans only): while a restructured loan is on probation, its bucket cannot improve beyond the bucket it had when the restructure was executed.

You can see all of these on the loan screen, in the **Account** card: **Days past due**, **Delinquency bucket**, **Collection stage**, **Delinquency floor**, **Probation remaining**, **Interest accrual** (accruing or non-accrual) and **Classification**.

Note: the buckets and the collections ladder are set per product version by the product team, under **Operations › Delinquency buckets** and **Collection stages** in the product editor. See [04-products-and-policies.md](04-products-and-policies.md).

### The collections ladder

At each stage, the end-of-day batch creates **one task per stage for each arrears episode** (a run of days in arrears). Each stage has an action:

| Action | What happens |
|---|---|
| SMS, NOTICE | Sent straight away. The task is created already **DONE** with the outcome **notice sent**. |
| CALL, VISIT, LEGAL REVIEW | The task waits in the stage's work queue for a collector to claim and complete. |
| NONE | No task. |

- When a loan moves to a later stage, the open task from the earlier stage is closed automatically (status **CANCELLED**, outcome **ESCALATED**).
- When the borrower catches up (DPD back to 0), every open task on the loan is closed automatically (status **CANCELLED**, outcome **CURED**).

Note: SMS and notice messages are handed to the integration layer. Real SMS delivery needs an SMS provider to be connected; without one nothing reaches the borrower. Use **Borrower notices** (section 2.3) to copy messages and send them yourself.

---

## 2. The Collections page

Menu: **Collections & relief › Collections**. The page is titled **Collections**, with the subtitle "Loans past due, worst first. Run the end-of-day batch to refresh delinquency."

The menu badge counts tasks in your collector queues (**COLLECTION_TASKS**) and set-offs waiting for approval (**SET_OFFS_TO_APPROVE**).

The page has four cards, top to bottom.

### 2.1 Business date & end-of-day

Shows the **Current business date**. Finance users can change it and run the batch from here. The same controls are on **Finance › End of day & operations**; see [14-accounting-and-period-close.md](14-accounting-and-period-close.md).

To refresh delinquency after posting the day's payments:

1. Click **Run end-of-day batch**.
2. Confirm in the **Run end-of-day batch** dialog.
3. A notice shows "Batch for <date>: <n> processed, <n> failed", with each failed loan and its error.

To move the business date:

1. Pick a date in **New business date**.
2. Click **Set business date** and confirm (**Change date**).

Note: only users allowed to manage the business date (usually the **Finance officer**) and to run the batch (**Finance officer**, **Loan operations maker**) can do this. Others see an error when they try. The batch can also run automatically each night, depending on how your system was set up.

### 2.2 Collector work queues

Card title: **Collector work queues**. It lists tasks created by the ladder.

Filters:
- **Queue**: one stage's queue, or **All queues**.
- **Status**: **Open** (default), **Done**, **Cancelled**, **All**.

Columns: **Loan** (click the reference to open the loan), **Borrower** (with phone), **Task** (action, stage and queue), **DPD**, **Overdue**, **Status**.

Task statuses:

| Status | Meaning |
|---|---|
| **OPEN** | Waiting to be worked. "claimed" under the badge means a collector has taken it. |
| **DONE** | Completed by a collector, or sent automatically (SMS/notice). |
| **CANCELLED** | Closed by the system because the loan moved to a later stage (**escalated**) or caught up (**cured**). |

To work a task:

1. Find the task (filter by your queue if you like).
2. Click **Claim**. The task is now yours; other collectors cannot complete it.
3. Make the call or visit.
4. Click **Record outcome**.
5. Pick the outcome: **contacted**, **no answer**, **promise to pay**, **visited**, **not found**, **refused**, **notice sent** or **refer legal**.
6. For **promise to pay**, fill in **Promised amount** (it starts at the amount overdue) and **Pay by** (the date the borrower promised). Both are required.
7. Type a **Note** if you like.
8. Click **Save**. The task moves to **DONE** and shows the outcome and note; a promise is now tracked (section 2.5).

You can record an outcome without claiming first, unless another collector has claimed the task.

If it is blocked:
- "This task is closed or already claimed by someone else." Someone else claimed it first, or it was closed. Click **Refresh**.
- "Another collector holds this task." Only the collector who claimed it can complete it.

If it is blocked:
- "A promise to pay needs the amount and the date the customer promised" — fill in **Promised amount** and **Pay by**.
- "The promised date must be between … and … (at most N days ahead)." Your organisation's lending settings limit how far ahead a promise may run (**Promises to pay: furthest a customer may promise ahead**, default 30 days).

A task with **promise broken** next to the action was raised by the system because a promise was not kept (section 2.5). Its note says what was promised and what was received.

### 2.3 Borrower notices

Card title: **Borrower notices**. It lists the messages that should go to borrowers today. Nothing is sent from this card.

1. Choose **Notice**: **Falling due (reminder)** (set **Within (days)**, default 7) or **Overdue**.
2. For each loan the card shows the borrower, **Phone**, **Instalment**, **Due**, **Amount** and the ready-made **Message**.
3. Click **Copy message**, then paste it into your SMS or messaging tool.

### 2.4 Past-due loans

Card title: **Past-due loans**. Every loan with DPD above 0, worst first. Columns: **Reference**, **DPD**, **Bucket**, **Stage**, **Principal o/s**, **Interest + fees + penalty**, **Total outstanding**, **Status**. A **Restructured** badge marks restructured loans. Click the reference to open the loan and act on it.

Note: the list reads at most 2,000 loans. If there are more, a warning says "Only the first N of M loans were scanned."

### 2.5 Promises to pay

A promise is the borrower's word that they will pay an amount by a date. You record it with the **promise to pay** outcome in the work queue (section 2.2), or on the loan itself: open the loan, click **Guarantor / set-off** (shown while the loan is in arrears), and under **Promises to pay** fill in **Amount**, **Pay by** and an optional **Note**, then click **Record promise**. A new promise on a loan replaces one that is still pending.

Every day, after end of day, the system reviews each pending promise:

| Status | When |
|---|---|
| **Pending** | Waiting: the promised date (plus the grace days) has not passed and the money has not come in. |
| **Kept** | Money received on the loan from the day of the promise (repayments, prepayments, settlements, recoveries) covers the promised amount — as soon as it does. |
| **Broken** | The promised date plus the grace days has passed without enough money. A new task (**promise broken**) goes to the work queue of the **next** collections stage — for example from the phone queue to field visits — for a collector to follow up. If the borrower has caught up by then, no task is raised. |
| **Cancelled** | Withdrawn by a collector, replaced by a newer promise, or the loan closed or was written off first. |

The list on the loan shows the amount, the date the promise was made, **Pay by (counts until)** — the last day a payment still counts, which is the promised date plus your organisation's **grace days** (lending setting **Promises to pay: days after the promised date that payments still count**, default 0) — what was received, and the status. **Withdraw** cancels a pending promise.

Who can do it: recording and withdrawing promises needs the same permission as working collection tasks. Finance can run the review at once (for example after a manual end of day) with the batch permission; normally it runs by itself.

---

## 3. Calling the guarantor (guarantor demands)

Use this when the borrower is in arrears and the loan has a guarantee recorded against it. You issue a written demand to the guarantor, and their payments reduce the borrower's debt.

The **Guarantor / set-off** button appears on the loan only when the loan is **ACTIVE** and either past due or has a set-off waiting for approval.

To issue a demand:

1. Open the loan (**Loans › Loan accounts** › reference, or from the Collections page).
2. In **Servicing actions** click **Guarantor / set-off**. The panel **Guarantor and set-off** opens.
3. Under **Call the guarantor**, choose the **Guarantee**. Each guarantee shows the guarantor and how much it covers.
4. **Amount**: leave it blank to demand everything the guarantee still covers (capped at what the loan owes), or enter a smaller amount.
5. **Pay within (days)**: default 14.
6. Click **Issue demand**.
7. The demand letter appears in the panel. Print or copy it. Click **Letter** on a demand later to see it again.

To record the guarantor's payment:

1. On the demand's row, click **Record payment**.
2. Enter **Paid by guarantor** and, if you have one, a **Reference**.
3. Click **Post payment**. The payment is posted to the loan like a repayment, with the guarantor recorded as payer.

To withdraw a demand, click **Withdraw** on the row and confirm.

Demand statuses:

| Status | Meaning |
|---|---|
| **OPEN** | Issued; payment due by the **Pay by** date. |
| **PAID** | The guarantor has paid the full amount demanded. |
| **WITHDRAWN** | Withdrawn by staff. |

If it is blocked:
- "A guarantor is called only once the borrower is in arrears."
- "That guarantee does not secure this loan."
- "The demand can be at most X USD: what the guarantee still covers (…) and what the loan owes (…)."
- "At most X USD remains due under GD-…" (payment larger than the open demand).
- "This loan has no guarantees." The loan has no guarantee recorded. Guarantees are added on the application or under collateral; see [13-covenants-and-collateral.md](13-covenants-and-collateral.md).

---

## 4. Set-off from the borrower's deposit

Right of set-off: you apply money from the borrower's own deposit account to what is overdue. Because this takes the customer's money, it needs maker-checker: one person proposes it and a different person approves it.

To propose a set-off (maker, for example **Collections officer** or **Loan operations maker**):

1. Open the loan and click **Guarantor / set-off**.
2. Under **Set-off from the borrower's deposit**, enter the **Amount**, the **Deposit account** number and the **Reason**.
3. Click **Propose set-off**. The message "Set-off proposed — awaiting approval" appears.

To approve or reject (checker, for example **Loan operations checker**; must be a different person):

1. The menu badge on **Collections** and the item **Set-offs to approve** on **Home** show waiting set-offs. The queue link opens the Collections page, but the decision is made **on the loan**: open the loan from the **Open tasks** card or from Home.
2. Click **Guarantor / set-off**. The pending set-off shows with **Approve** and **Reject**.
3. Click **Approve** (or **Reject**) and confirm.

What happens next: on approval, the amount is posted to the loan as a repayment funded from the set-off clearing account. Approval statuses: **PENDING**, then **EXECUTED** (approved) or **REJECTED**.

Note: this system does not debit the deposit account. Your core banking or deposit team must debit the customer's deposit and credit the set-off clearing account to match.

If it is blocked:
- "Set-off applies only to a debt in arrears."
- "Set-off is limited to what is overdue: X USD."
- "You cannot approve or complete an action you created or proposed" (you proposed it yourself).

---

## 5. Recovery: repossession, pawn, credit insurance and debt sale

Recovery work is done **on the loan**, in the **Recovery** card further down the loan screen. The **Recovery** desk page gives the overview.

### 5.1 The Recovery desk

Menu: **Collections & relief › Recovery**. The page is titled **Recovery** and shows the business date. The menu badge counts recovery steps waiting for a second user (**RECOVERY_TO_APPROVE**).

| Card | What it lists |
|---|---|
| **Awaiting a second user** | Every recovery proposal waiting for approval: **Loan**, **Decision**, **Amount**, **Proposed by**, **Proposed**. "Open the loan to approve or reject." |
| **Repossessions in progress** | Seized assets not yet sold: status, where held, seizure date, valuation, DPD. |
| **Pawned items in custody or forfeited** | Items held, with redemption deadline. "past deadline" is shown in red. |
| **Insurers** | Claims not yet settled or not fully paid by the insurer, and premiums still to pay to insurers. |
| **Debt sales awaiting approval** | Proposed sales of loans to collection agencies. |
| **Surplus owed to borrowers and estates** | Money left over after a sale or claim that must be paid back. |

Decision names in the **Awaiting a second user** list: **Repossession — seizure**, **Pawn forfeiture**, **Premium remittance to insurer**, **Insurance claim — settle loan**, **Debt sale to collection agency**, **Surplus payout**.

To approve a recovery step:

1. Click the loan reference in **Awaiting a second user**.
2. In the loan's **Recovery** card, each proposal shows as a yellow box with **Approve** and **Reject**, and the text "A different user must decide it."
3. Click **Approve** and confirm. Approving posts the step straight away.

### 5.2 The Recovery card on the loan

The card shows the days past due, what is owed and the product's rules, for example "Repossession from 90 days past due; proceeds pay costs, then interest → principal → fee → penalty."

The buttons at the top depend on the loan:

| Button | Shown when |
|---|---|
| **Repossess** | Loan **ACTIVE** and has collateral that is still pledged |
| **Pawn item** | Loan **BOOKED** or **ACTIVE** |
| **Insurance policy** | Loan **ACTIVE** |
| **Sell loan** | Loan **ACTIVE** or **WRITTEN_OFF** |

### 5.3 Repossession

The seizure needs maker-checker. Valuation and sale do not.

1. **Propose the seizure** (maker, write-off proposer, for example **Loan operations maker**): click **Repossess**, choose the **Asset**, enter **Held at (location)**, **Seized on** and **Reason**, then click **Propose seizure**. Message: "Seizure proposed — a different user must approve it".
2. **Approve the seizure** (checker, write-off approver, for example **Loan operations checker**; MFA sign-in required): **Approve** in the Recovery card. The status becomes **SEIZED**.
3. **Value the asset**: click **Value** on the repossession row, enter **Market value**, **Valuer** and **Valued on**, then click **Record valuation**. The status becomes **VALUED**. Use **Revalue** to record a new valuation.
4. **Sell**: click **Sell**, enter **Sale price**, **Costs paid from proceeds** (seizure, storage and auction fees), **Buyer**, **Sale date** and **Reference**, then click **Record sale and apply proceeds**.

What happens next: the proceeds pay the costs first, then the loan in the product's order.
- If the loan is fully paid, the message is "Sold — the loan is paid off" and the loan closes.
- Otherwise the message is "Sold — a deficiency is still owed". The rest stays owed and normal collections continue.
- Any **surplus** goes to **Surplus owed to the borrower or estate** and is paid out under maker-checker (section 5.7).

Repossession statuses: **PROPOSED**, **SEIZED**, **VALUED**, **SOLD**, **REJECTED**.

If it is blocked:
- "Repossession needs the loan to be at least 90 days past due (currently N)." The number comes from the product.
- "A repossession of this asset is already in progress."
- "The seizure has not been approved yet."
- "Record the repossession valuation before the sale."

### 5.4 Pawn (gold and valuables)

1. **Take an item into custody**: click **Pawn item**, enter **Item**, **Type** (GOLD, JEWELLERY, OTHER), **Weight (g)**, **Karat** or **…or purity (fineness)**, **Price per gram, pure**, **Seal number**, **Custody location**, **Received on** and **Redemption deadline**, then click **Record custody and value**. The value is calculated from weight × purity × price.
2. If the borrower repays and the loan is **CLOSED**, click **Return**, enter the **Return receipt reference**, then click **Record return**. The status becomes **RETURNED**.
3. If the redemption deadline (plus any grace days set in the product) has passed, the row shows "past deadline". Click **Forfeit**, enter a **Reason**, then click **Propose forfeiture**. A different user approves it (MFA sign-in required). The status becomes **FORFEITED**.
4. Click **Auction**, enter the sale details and click **Record sale and apply proceeds**. Proceeds are applied as for a repossession. The status becomes **SOLD**.

Pawn statuses: **IN CUSTODY**, **FORFEITED**, **SOLD**, **RETURNED**.

### 5.5 Credit insurance and claims

1. **Record the policy**: click **Insurance policy**, enter **Insurer**, **Policy number**, **Cover** (Death and disability / Death / Disability), **Premium** (**Financed in the loan** or **Paid by the borrower now**), the premium amount, **Cover starts** and, for a paid premium, a **Receipt reference**. Click **Record policy**.
2. **Pay the premium over to the insurer**: when **To remit** is above zero, click **Remit**, enter the amount and the **Bordereau / payment reference**, then click **Propose remittance**. A different user approves the payment.
3. **File a claim** after a death or disability: click **Claim**, choose the **Event**, enter **Event date**, **Evidence reference** (certificate or medical report number) and, optionally, **Amount claimed** (blank means the balance on the settlement day) and a **Note**. Click **File claim**.
4. **Approve the claim** (checker with write-off approval authority, MFA sign-in required). Approving settles the loan against the insurer. The claim becomes **SETTLED** and the policy **CLAIMED**.
5. **Record the insurer's payment**: on a settled claim with money still owed, click **Insurer paid**, enter the **Amount** and **Bank reference**, then click **Record receipt**.

Claim statuses: **PENDING**, **SETTLED**, **REJECTED**.

If it is blocked: "A claim on this policy is already pending.", "A claim has already been paid on this policy.", "The event happened before the cover started.", "This policy covers death only."

### 5.6 Debt sale to a collection agency

1. Click **Sell loan** (loan **ACTIVE** and delinquent, or **WRITTEN_OFF**).
2. Enter **Buyer**, **Price**, **Sale date**, **Reason** and **Contract reference**, then click **Propose sale**. A preview explains the gain or loss.
3. A different user with write-off approval authority approves it (MFA sign-in required).

What happens next: the loan leaves the book with status **SOLD** and is no longer serviced. The difference between the price and the loan's carrying amount (net of its loss allowance) is booked as a gain or loss.

If it is blocked:
- "Only a delinquent loan (at least 90 days past due) or a written-off loan can be sold; this one is N days past due."
- "Finish the repossession or pawn sale in progress before selling the loan."
- "A sale of this loan is already awaiting approval."

### 5.7 Surplus payouts

When a sale or claim brings in more than the loan owes, the extra is listed under **Surplus owed to the borrower or estate** with status **PAYABLE**.

1. Click **Propose payout**.
2. Enter the **Payee (borrower, estate, or their representative)**.
3. Click **Propose payout**.
4. A different user approves the payout. The status becomes **PAID**.

---

## 6. Write-off

A write-off removes an uncollectable loan from the book. It is maker-checker: one person proposes and a different person approves. Approval also needs enough approval authority for the amount, and an authenticator (MFA) sign-in.

To propose (for example **Loan operations maker**):

Loans graded **Loss** that have reached the write-off floor and are not written off are listed on **Home** under **Loss loans due for write-off**.

1. Open the loan (it must be **ACTIVE**).
2. In **Servicing actions** click **Propose write-off**.
3. Enter the **Reason** (at least 3 characters).
4. Click **Propose write-off**. Message: "Write-off proposed — awaiting approval".

To approve or reject (for example **Loan operations checker**):

1. Open the loan. **Home** lists it under **Write-offs to approve**, and the badge on **Loans › Loan accounts** counts it.
2. Click **Write-off decision**. The proposal shows the amount and the maker.
3. Click **Approve** (the dialog says "Balances move to written-off and the ledger is posted.") or **Reject**.

What happens next: on approval, the loan status becomes **WRITTEN OFF**. Principal, interest, fees and penalties are cleared. The loss is taken first against the loan's loss allowance, and the rest is posted as an expense. Interest held in suspense is released, not treated as a loss. Unpaid instalments are marked written off. Rejected proposals change nothing.

If it is blocked:
- "This product does not allow write-off." The product has no minimum DPD for write-off.
- "Write-off needs at least N days past due (currently M)." The minimum is the higher of the product's minimum (the standard templates use 180 or 360) and your organisation's write-off floor in **Lending settings**, which by default is the day the loan reaches the **Loss** class: 91 days for loans with an original term up to one year, 360 days for longer loans. It is checked again when the write-off is approved.
- "A write-off proposal is already pending."
- "This loan holds X USD paid in advance. Refund the advance before you write it off."
- "You cannot approve or complete an action you created or proposed"
- "The amount exceeds your approval authority". Ask someone with a higher limit, or a delegation; see [02-roles-and-approvals.md](02-roles-and-approvals.md).
- "This action requires signing in with multi-factor authentication". Sign out and sign in again with your authenticator code.

---

## 7. Recovery after write-off

Money received on a written-off loan is booked as **recovery income**. It is counted against what was written off, principal first. The loan stays **WRITTEN OFF**.

1. Open the loan (status **WRITTEN_OFF**).
2. Click **Record recovery**.
3. Enter **Amount**, and optionally **External reference** and **Note**.
4. Click **Post recovery**. Message: "Recovery posted".

If it is blocked:
- "A recovery applies to a written-off loan; this one is ACTIVE."
- "This product does not permit post-write-off recoveries." (product setting **Allow recoveries after write-off**)
- "X exceeds the Y still written off on this loan."

---

## 8. Negotiated settlement (in brief)

To close an **ACTIVE** loan for less than it owes, click **Negotiated settlement**, enter the **Agreed amount (USD)** and click **Price it**. The screen shows what is paid and what is forgiven. Enter the reason, then click **Settle for USD …**. You need approval authority for the concession and an MFA sign-in. Forgiving principal needs a separate, higher authority. The product must allow negotiated settlement. For the full steps see [08-servicing-changes.md](08-servicing-changes.md).

---

## 9. Who does what

With the standard lending roles:

| Task | Typical role |
|---|---|
| Claim and complete collection tasks, issue guarantor demands, post guarantor payments, propose set-off | Collections officer, Loan operations maker |
| Approve set-off, premium remittance, surplus payout | Loan operations checker (not the maker) |
| Propose write-off, repossession, valuation, pawn forfeiture, debt sale | Loan operations maker |
| Approve write-off, seizure, forfeiture, insurance claim, debt sale (MFA) | Loan operations checker (not the maker; within authority for write-off, claim and sale) |
| Record recovery after write-off | Collections officer |
| Run end-of-day batch / set business date | Finance officer (batch also Loan operations maker) |

Buttons are greyed out when you cannot use them. Hover over a button to see why, or open **Why can't I…** under **Servicing actions** on the loan. The server checks every action again.

Other blocks you may see:
- "lending.servicing is currently unavailable" or "lending.accounting.posting is currently unavailable": servicing or posting has been switched off by a feature flag. Ask your administrator.
- A period-lock message when the posting date falls in a closed accounting period; see [14-accounting-and-period-close.md](14-accounting-and-period-close.md).
- "Outside your branch or portfolio scope": the loan belongs to a branch you are not assigned to.
