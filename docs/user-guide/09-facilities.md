# Facilities: credit lines, overdrafts and staged drawdowns

Who this is for: loan operations makers and checkers who run drawdowns, statements and repayments on credit lines; credit approvers who approve limit changes and waive conditions; relationship managers and analysts who need to read a facility's position.

A **facility** is a committed limit the borrower can draw on, rather than a single lump-sum loan. The portal supports three kinds:

| Type (as shown) | What it is | Typical product templates |
|---|---|---|
| **Revolving** | A credit line: draw, repay, draw again up to the limit until availability ends. | Revolving credit facility, home-equity line, inventory-backed line, invoice finance, credit cards |
| **Overdraft** | A debit balance against a limit, repayable on demand, with a monthly minimum payment. | Overdraft |
| **Staged drawdown** | A construction-style facility released in fixed tranches, each gated by a date and conditions precedent. Repaying does not make the money available again. | Construction, project finance, infrastructure |

The drawn balance of every facility is carried on its own **loan account**, so repayments, interest, arrears and the ledger work exactly as for an ordinary loan (see [07-repayments-and-payments.md](07-repayments-and-payments.md)).

Specialised products built on facilities are covered elsewhere: credit cards, trade receivables programmes and project finance in [12-specialised-products.md](12-specialised-products.md); covenants in [13-covenants-and-collateral.md](13-covenants-and-collateral.md).

> **Note - feature flags.** Each facility type has its own feature flag, and all three are **off by default**: `lending.revolving.drawdown` (revolving lines), `lending.facility.overdraft` (overdrafts) and `lending.facility.staged_drawdown` (staged drawdowns). Borrowing-base lines also need `lending.collateral.borrowing_base`. A tenant administrator proposes the change under **Risk & audit › Access & policy**, **Feature flags** tab, and a second administrator approves it (see [18-tenant-administration.md](18-tenant-administration.md)). The demo organisation has them switched on. When a flag is off, an action it governs is refused with a message such as "lending.facility.staged_drawdown is currently unavailable".

---

## 1. How a facility is created

You do not create a facility on this screen. It is created when an approved application under a facility product is **booked** (see [05-applications-and-credit-decisions.md](05-applications-and-credit-decisions.md)):

- the approved principal becomes the committed **Limit**;
- the availability period and maturity come from the product and the application;
- for staged drawdowns, the tranches and their conditions precedent are created from the product configuration;
- the facility starts in status **ACTIVE**.

Pay money out through drawdowns on the facility screen (section 4), not through the loan account's **Disbursement** button. The facility's loan account shows **BOOKED** until the first drawdown is released, then **ACTIVE**.

---

## 2. Finding a facility

**Loans › Facilities** lists every facility in your scope. Who sees it: anyone with facility read access (Loan operations maker and checker, Credit approver).

To find a facility:

1. Open **Loans › Facilities**.
2. Optionally narrow the list with **All types** (REVOLVING, OVERDRAFT, STAGED DRAWDOWN) and **All statuses**.
3. Type the reference in **Search reference…** and press Enter or click **Search**.
4. Click the reference to open the facility.

The list shows **Reference**, **Type**, **Borrower**, **Status**, **Limit**, **Total drawn**, **Charges**, **Available to** and **Maturity**. **Total drawn** is everything ever advanced, not the current balance. Open the facility to see the outstanding balance and headroom.

| Status | Meaning |
|---|---|
| **PENDING** | Recorded but not yet in use. |
| **ACTIVE** | Open. Drawdowns can be requested (within the availability period). |
| **SUSPENDED** | No drawdowns can be requested, approved or released. Repayments, statements and other servicing continue. |
| **EXPIRED** | Availability has been ended. No new drawdowns; the balance is still serviced and can be termed out. |
| **TERMED OUT** | The drawn balance has been converted into an instalment loan on the same loan account. Repay through the loan, not the facility. |
| **CLOSED** | Finished. No actions are available. |
| **CANCELLED** | Cancelled. No actions are available. |

The work queues on **Home** also bring facility work to you: **Drawdowns to approve**, **Approved drawdowns to release** and **Facility limit changes to approve**. Each item opens the facility.

---

## 3. Reading the facility screen

The top of the screen shows the reference, the status, the type, currency, rate and creation date. Two buttons sit at the top right: **Loan account →** (opens the drawn-balance loan account) and **Refresh**.

The tiles along the top are:

- **Limit** - the committed limit.
- **Drawn balance** - principal outstanding now (the hint shows the total ever drawn).
- **Available** - what can still be drawn today. For a revolving line or overdraft the hint says "Reinstates on repayment"; for a staged facility, "Staged: repayments do not reinstate". On a borrowing-base line it is the lower of the limit and the certified base, less what is drawn (section 11).
- **Utilization** - drawn balance as a share of the limit, with a bar that turns amber at 85% and red above 100%.
- **Status**, and **Availability ends** (with the maturity date in the hint).

Below the tiles you may see:

- **Over limit** (red) - the drawn balance is above the limit. It states by how much and, if the product prices it, the over-limit interest rate.
- **Credit card …** - this line carries a credit card; purchases, payments and statements are handled on the card (see [12-specialised-products.md](12-specialised-products.md)). Use **Open the card →**.
- **Project finance — …** - this facility is the construction phase of a project loan.
- **Suspended** (amber) - "No drawdowns can be requested, approved or released while the facility is suspended."

The **Facility** card lists the terms: **Available from**, **Available to**, **Maturity**, **Annual rate**, **Day count**, **Total repaid**, **Charges raised**, **Minimum drawdown** ("No floor" if none), **Maximum drawdown** ("Up to available" if none), **Commitment fee** (rate per year on the undrawn amount, or "None"), **Over-limit** ("Priced at …" or "Refused"), **Minimum payment** (overdrafts only) and **Last statement to**.

Further down are the cards **Tranches** (staged facilities only), **Borrowing base** (borrowing-base lines only), **Drawdowns**, **Conditions precedent**, **Limit changes** and **Statements**.

The **Facility actions** card holds the buttons. Which buttons appear depends on the facility's status:

| Button | Shown when the facility is | Who can complete it |
|---|---|---|
| **Request drawdown** | ACTIVE | Loan operations maker |
| **Post repayment** | not CLOSED or CANCELLED | Anyone who can post repayments (Loan operations maker) |
| **Generate statement** | ACTIVE, SUSPENDED or EXPIRED | Loan operations maker |
| **Request limit change** | PENDING, ACTIVE or SUSPENDED | Loan operations maker |
| **Change status** | PENDING, ACTIVE or SUSPENDED | Loan operations checker |
| **Term out** / **Sculpted term-out** | ACTIVE or EXPIRED (project facilities: until termed out) | Loan operations checker |

The card's subtitle reminds you that "The server re-checks every action against policy, limits and maker-checker; refusals show the reason." A button may appear even when you are not allowed to complete the action; you then see the refusal message.

---

## 4. Drawdowns (maker-checker)

A drawdown moves money out against the limit. It always involves two people: one requests it, a different person approves and releases it. This four-eyes control protects against error and fraud. Only one drawdown can be in progress (requested or approved) on a facility at a time.

| Drawdown status | Meaning |
|---|---|
| **REQUESTED** | Waiting for a second officer to approve, reject or for the requester to cancel. |
| **APPROVED** | Approved; waiting to be released (paid out). |
| **RELEASED** | Paid out and posted as a disbursement on the facility's loan account. Cannot be edited; a correction is a reversal of that disbursement. |
| **REJECTED** | Refused by the checker, with a reason. |
| **CANCELLED** | Withdrawn before approval. |

### 4.1 Request a drawdown (maker)

Who: Loan operations maker.

To request a drawdown:

1. Open the facility and click **Request drawdown** (or **New request** on the **Drawdowns** card).
2. Enter the **Amount**. The hint shows the product's minimum and maximum drawdown, if any.
3. **Value date** - optional; leave blank to use the business date.
4. **Tranche** (staged facilities only) - choose the tranche this drawdown releases. A staged tranche is released in full: the amount must equal the tranche amount.
5. **Purpose** - optional, up to 200 characters.
6. Pause typing. The portal checks the request against the facility and shows either **This drawdown is permitted today** (with **Outstanding after**, **Available after**, **Utilization after** and **Over limit**) or **The server would refuse this drawdown** with each reason.
7. Click **Request drawdown**.

What happens next: the drawdown appears as **REQUESTED** and the message "Drawdown requested — awaiting approval by a second officer" is shown. It appears in the checker's **Drawdowns to approve** queue.

To withdraw your own request before it is approved, click **Cancel** on its row and confirm with **Cancel request**.

### 4.2 Approve or reject a drawdown (checker)

Who: Loan operations checker, a different person from the requester, with an approval authority covering the amount and signed in with an authenticator code (MFA).

To approve:

1. Open the facility (or click the item in **Drawdowns to approve** on **Home**).
2. On the **Drawdowns** card, find the **REQUESTED** row and click **Approve**.
3. Confirm with **Approve**. The limit is re-checked now and again at release.

To reject: click **Reject**, enter a **Reason**, and click **Reject drawdown**.

### 4.3 Release the funds (checker)

Who: Loan operations checker, not the person who requested the drawdown (the approver may release it).

To release an approved drawdown:

1. On the **Drawdowns** card, click **Release…** on the **APPROVED** row.
2. Enter the **External reference** - the bank transfer or cash voucher reference of the payout.
3. Click **Release funds** and confirm with **Release funds**.

What happens next: the drawdown becomes **RELEASED**, a disbursement is posted on the facility's loan account and the available amount falls. The **Ledger event →** link opens the loan account. If the network fails and you click again, the portal reuses the same request so the money is not paid twice.

### If a drawdown is blocked

| Message (examples) | Why | What to do |
|---|---|---|
| "Drawing … would exceed the available limit of …" | Not enough headroom (plus any over-limit allowance the product grants). | Reduce the amount, take a repayment first, or request a limit increase (section 7). |
| "The availability period ended on …; no further drawdowns are permitted." | Availability has ended. | Term the facility out (section 10) or renew it (see the Note in section 7). |
| "The facility is not available until …" | Availability has not started. | Wait, or use a later value date. |
| "The minimum drawdown is …" / "The maximum single drawdown is …" | Product drawdown limits. | Change the amount. |
| "Tranche … has unsatisfied conditions: …" | Conditions precedent are pending. | Satisfy or waive them (section 5). |
| "Tranche … is not available until …" / "Tranche … releases exactly …" | Staged tranche rules. | Wait for the date; request the exact tranche amount. |
| "A drawdown is already awaiting approval or release on this facility." | One drawdown at a time. | Finish or cancel the open one. |
| "This facility is suspended; no drawdown is possible." | Facility not ACTIVE. | A checker reinstates it (section 8). |
| "You cannot approve or complete an action you created or proposed" | You requested it. | A different officer must approve and release. |
| "The amount exceeds your approval authority" / "No approval authority" | Your authority for drawdown approval is too low or missing. | Ask a colleague with a higher authority, or ask your administrator (approval authorities, [02-roles-and-approvals.md](02-roles-and-approvals.md)). |
| "This action requires signing in with multi-factor authentication" | You signed in without an authenticator code. | Sign out and sign in again with your code. |
| "This facility is a credit card: post … through the card, not the facility." | The line belongs to a card. | Use **Loans › Cards**. |
| "This is a receivables facility (…); it is … through its receivables register." | Invoice finance, factoring, supply-chain finance or forfaiting. | Use the register under **Loans › Trade finance** (see [12-specialised-products.md](12-specialised-products.md)). |

---

## 5. Conditions precedent and tranches (staged facilities)

A staged facility shows a **Tranches** card: **Tranche**, **Amount**, **Available from**, **Conditions** (for example "1 of 2 met") and **State** (**OPEN**, **PENDING** while conditions are outstanding, **RELEASED** once drawn).

The **Conditions precedent** card lists every condition by tranche: "Each tranche can be released only once its conditions are satisfied or waived."

| Condition status | Meaning |
|---|---|
| **PENDING** | Not yet met; the tranche cannot be drawn. |
| **SATISFIED** | Met, with the evidence recorded. |
| **WAIVED** | Waived by a credit approver as a concession, with the reason recorded. |

### 5.1 Satisfy a condition

Who: Loan operations maker.

1. On the **Conditions precedent** card, click **Satisfy…** on the condition.
2. In **Evidence**, record what proves it (for example a document reference or inspection report number).
3. Click **Mark satisfied**.

### 5.2 Waive a condition

Waiving is a credit concession. Who: Credit approver, signed in with an authenticator code.

1. Click **Waive…** on the condition.
2. Enter the **Waiver reason**.
3. Click **Waive condition**.

If it is blocked: "Waiving a condition is a credit concession; give a reason." means the reason is empty. "This condition is already satisfied." (or waived) means someone has already dealt with it - click **Refresh**.

---

## 6. Repayments on a facility

Repaying principal on a revolving line or overdraft makes it available to draw again; on a staged facility it does not.

Who: anyone who can post repayments (normally Loan operations maker).

To post a repayment:

1. Click **Post repayment** in **Facility actions**.
2. Enter the **Amount**. The hint shows the principal outstanding.
3. **Value date** (optional) and **External reference** (optional).
4. Click **Post repayment**.

The payment is applied to penalty, fees, interest, then principal. You see a confirmation listing how it was applied.

If it is blocked: "The payment exceeds the … owed on this facility." - paying more than is owed is refused. After a term-out the facility refuses repayments: "This facility has termed out into an instalment loan; post repayments on loan …" - use the loan account instead (see [07-repayments-and-payments.md](07-repayments-and-payments.md)).

You can also post a repayment from the loan account screen; the facility and its loan account always stay in step.

---

## 7. Limit changes (maker-checker)

Use a limit change to increase or reduce the committed limit. Only one change can wait for a decision at a time.

### 7.1 Request a limit change (maker)

Who: Loan operations maker.

1. Click **Request limit change**.
2. Enter the **New limit**. The hint shows the current limit.
3. Choose the **Change type**: **INCREASE**, **DECREASE**, **EXTENSION**, **SUSPENSION** or **REINSTATEMENT**. The portal suggests INCREASE or DECREASE from the amount you type.
4. **Effective date** - optional; it is recorded on the change, but the new limit applies when approved.
5. Enter the **Reason**.
6. Click **Request change**.

What happens next: the change appears as **REQUESTED** on the **Limit changes** card ("Limit change requested — awaiting approval") and in the approver's **Facility limit changes to approve** queue.

### 7.2 Approve or reject (checker)

Who: Credit approver, not the requester, with approval authority for facility limits covering the new limit, signed in with an authenticator code.

1. On the **Limit changes** card, click **Approve** or **Reject** on the REQUESTED row.
2. Confirm. On approval "The new limit applies immediately."

| Limit change status | Meaning |
|---|---|
| **REQUESTED** | Waiting for a decision. |
| **APPROVED** | Applied. |
| **REJECTED** | Not applied. |

If it is blocked: "The limit cannot be reduced to …: … is already drawn." - a limit cannot be cut below the balance (for staged facilities, below the total ever drawn). "A limit change is already awaiting a decision on this facility." - decide the open one first.

> **Note - change types and renewal.** On this screen the change type is a label: whatever type you pick, approval changes only the limit amount. **EXTENSION** does not move the availability or maturity dates, and **SUSPENSION** / **REINSTATEMENT** do not change the facility status (use **Change status**, section 8). The platform can also **renew** a facility - extend its availability and maturity by a number of months and bring an expired line back into use - but there is no screen for this yet; ask your IT team, who can do it through the API.

---

## 8. Suspend, reinstate or expire a facility

Who: Loan operations checker.

To change the status:

1. Click **Change status**.
2. Choose the **Action**:
   - **Suspend — stop further drawdowns** (from PENDING or ACTIVE). A **Reason** is required.
   - **Reinstate — reopen for drawdowns** (from SUSPENDED).
   - **Expire — end availability now** (from ACTIVE or SUSPENDED).
3. Enter the **Reason** (optional for reinstate and expire).
4. Click **Apply** and confirm.

Suspension blocks new drawdowns only; repayments, statements and arrears handling continue. If it is blocked: "Give a reason for suspending a facility." or "A … facility cannot be …d." (the move is not allowed from the current status).

---

## 9. Statements and charges

Interest on the drawn balance, over-limit interest and the commitment fee on the undrawn amount are charged when a **statement** is generated for a period. Statements are raised on demand by operations; they are not produced by the end-of-day batch.

Who: Loan operations maker.

To generate a statement:

1. Click **Generate statement**.
2. **Period start** is fixed: periods never overlap, so the next one starts where the last ended (or at the start of availability).
3. Choose the **Period end**. It is exclusive and cannot be after the business date.
4. Click **Generate statement** and confirm with **Generate**.

What happens next: the period's charges are posted to the facility's loan account as one accrual and a new row appears on the **Statements** card: **Period**, **Opening**, **Drawdowns**, **Repayments**, **Interest**, **Over-limit int.**, **Commitment fee**, **Closing**, **Charges**, **Minimum due** (overdrafts) and **Generated**. Statements are append-only: "a correction is a later statement, never an edit."

**Overdraft minimum payments.** Each statement sets a minimum payment and due date. The end-of-day batch covers minimum payments oldest first with repayments received since the first statement; the oldest still uncovered after its due date sets the days past due and the collections stage.

If it is blocked: "A statement cannot close on …, which is after the business date …" or "The facility is already stated to …".

> **Note.** Interest on a facility is not added to the drawn balance; it stays as interest receivable until paid (project finance with capitalised construction interest is the exception - see [12-specialised-products.md](12-specialised-products.md)).

---

## 10. Term-out

When availability ends, a revolving or staged facility can be **termed out**: the balance drawn is converted into an amortising monthly schedule on the same loan account, and no further drawdowns are possible. An overdraft is repayable on demand and does not term out.

Who: Loan operations checker.

Before you start:

- availability must have ended (the business date is on or after **Availability ends**);
- any drawdown that is REQUESTED or APPROVED must be released, rejected or cancelled;
- the facility must be stated up to today: generate a statement whose period ends on the business date, so interest to the term-out date is charged.

To term out:

1. Click **Term out**. The panel explains that the balance drawn at the availability end amortises over the whole months remaining to maturity.
2. Click **Term out** and confirm.

What happens next: the facility becomes **TERMED OUT**, the loan account gets an instalment schedule, and the charges already stated fall due with the first instalment. From now on, repay, restructure and collect through the loan account.

If it is blocked:

| Message | What to do |
|---|---|
| "Availability runs to …; the facility cannot term out before then." | Wait until the availability end date has passed. |
| "Generate a statement up to … first, so interest to the term-out date is charged." | Generate a statement ending on the business date. |
| "Settle the outstanding drawdown requests before terming out." | Finish or cancel open drawdowns. |
| "This facility is repayable on demand; it does not term out." | The product does not term out (for example an overdraft). |
| "There is less than a month between today and maturity (…); repay the facility instead." | Collect repayment instead. |

### Sculpted term-out (project finance)

A project-finance facility shows **Sculpted term-out** instead. Repayments are sized to the project's projected cash flow available for debt service (CFADS) so that each period's debt service is covered by the same ratio, at least the product's target.

To preview and term out:

1. Click **Sculpted term-out**.
2. Fill **Every (months)**, **Periods** and **CFADS each**, then click **Lay out periods from …** to create the periods. Edit each period's date and CFADS as needed, or **Remove** a period.
3. Optionally enter a **Balloon (optional)** left to the last date, and **Size a principal (optional)** to test another amount (preview only).
4. Click **Preview profile**. The panel shows **Cover ratio achieved**, **Lowest period DSCR**, **Most the projection supports**, **Starts** and the period-by-period table.
5. When availability has ended and the facility is stated to today, click **Term out on this profile** and confirm.

Anyone who can read the facility can preview; terming out needs the Loan operations checker. If the projection cannot carry the debt, the preview is refused and tells you the most it supports. "The projection runs to …, beyond the facility's maturity …" means the last period is after maturity. The rest of the project-finance cycle (cash waterfall, reserve, lock-up) is in [12-specialised-products.md](12-specialised-products.md).

---

## 11. Borrowing base (inventory and receivables lines)

On a borrowing-base line (for example an inventory-backed revolving line), drawings are limited to the **lower of the limit and the borrowing base** certified by the borrower, less what is already drawn. The base is worked out from a **certificate**: the borrower's stock and/or debtor report, keyed in by operations.

> **Note.** Requires the flags `lending.revolving.drawdown` and `lending.collateral.borrowing_base` (both off by default). Certificates are keyed from the borrower's report; there is no feed from a stock system or ledger.

The **Borrowing base** card shows **Limit**, **Borrowing base** (with its "as of" date), **Drawing cap** (lower of limit and base), **Drawn** and **Available now** (with "certificate valid through …"). A certificate supports drawings only for the product's maximum age; after that **Certificate out of date** is shown and nothing can be drawn. With no accepted certificate, **No accepted certificate** is shown.

| Certificate status | Meaning |
|---|---|
| **SUBMITTED** | Waiting for a second person to accept or reject it. Its figures cannot be edited. |
| **ACCEPTED** | In force; drawings are limited by its base. |
| **SUPERSEDED** | Replaced by a newer accepted certificate. |
| **REJECTED** | Not accepted, with a reason. |

### 11.1 Enter a certificate (maker)

Who: Loan operations maker. Only one certificate can await a decision at a time.

1. On the **Borrowing base** card, click **New certificate**.
2. **As of** - the date of the borrower's report (not in the future). The hint shows how many days it will support drawings.
3. **Notes** - for example "month-end stock count, aged debtors report".
4. For each line: **Class**, **Description**, **Debtor** (receivables) or **Location / supplier** (inventory), **Gross**, **Ineligible** and its **Reason** (for example obsolete, disputed), and **Age (days)** (the hint shows the age above which the line is ineligible). Use **Add line** and **Remove last**.
5. Click **Work out the base**. The portal shows gross − ineligible = eligible → borrowing base, and a breakdown by class: **Gross**, **Ineligible**, **Aged out**, **Over concentration**, **Eligible**, **Advance rate**, **Borrowing base**.
6. Click **Submit for acceptance**.

Eligible value is gross, less stated ineligibles, less lines older than the class's maximum age, less any one counterparty's value above the class's concentration limit; the base is eligible value × the class advance rate.

### 11.2 Accept or reject (checker)

Who: Loan operations checker, not the person who submitted it.

1. The pending certificate is shown on the card: "Certificate #… as of … awaits acceptance".
2. Review the class breakdown.
3. Click **Accept** and confirm, or click **Reject…**, type the reason, and click **Reject**.

What happens next: accepting replaces the previous certificate. If the line is already drawn above the new base, you see "Certificate accepted — the line is … over its base and must be reduced" and a shortfall notice is raised. Past certificates are under **Certificate history**.

If it is blocked: "A certificate as of … is already more than … days old and could not support a drawing."; "A certificate is already awaiting a decision on this facility."; "A certificate as of … is already accepted; an older one cannot replace it."; "Give a reason for rejecting a certificate." A drawdown on a stale line is refused with "The borrowing-base certificate as of … is more than … days old; accept a new certificate before drawing."

---

## 12. Where facility work shows up

- **Home** queues: **Drawdowns to approve**, **Approved drawdowns to release**, **Facility limit changes to approve**.
- The facility's loan account (**Loan account →**) shows every posted drawdown, repayment, charge and reversal in its **Financial events**.
- Arrears on a facility are aged at loan level and appear in **Collections & relief › Collections** like any other loan (see [11-collections-and-recovery.md](11-collections-and-recovery.md)).
