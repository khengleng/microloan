# Demo walkthrough — Demo Lending Co

Who this is for: trainers, testers and new staff who want to practise in
the demo organisation **Demo Lending Co** before working on real loans.
It takes one loan from customer onboarding to closure, then runs a short
collections scenario. Allow about two hours.

Nothing you do in the demo organisation affects a real organisation. Each
step names the demo account to sign in as and links to the chapter that
explains the screen in full.

## Before you start

### The demo accounts

Your administrator has run the demo set-up for your environment and will
give you **the demo password**. This guide never contains passwords. Every
account's email ends in `@demo-lending.test`.

| Account | Role in the walkthrough | Scope / limit |
|---|---|---|
| `admin`, `admin2` | Tenant administrators (two, because access and flag changes need two people) | — |
| `officer.pnh` | Relationship officer, Phnom Penh branch | Phnom Penh only |
| `officer.rep` | Relationship officer, Siem Reap branch | Siem Reap only |
| `analyst` | Credit analyst (recommends) | All branches |
| `approver` | Credit approver | up to 100,000 USD / 400,000,000 KHR |
| `approver2` | Credit approver (second level, institutional amounts) | up to 100,000,000 USD |
| `ops.maker` | Loan operations maker (books, prepares, posts) | All branches |
| `ops.checker` | Loan operations checker (approves and executes, reverses) | disbursement up to 100,000,000 USD; write-off up to 50,000 USD |
| `collections` | Collections officer | All branches |
| `finance` | Finance officer (business date, end of day, close) | All branches |
| `committee` | Restructure committee | restructure up to 500,000 USD |
| `product.maker`, `product.checker` | Product maker and checker | — |
| `risk` | Risk / compliance reviewer | — |
| `auditor` | Auditor (read only) | — |

There are also four **all-round QA accounts**: `qa.maker`, `qa.checker`,
`qa.approver` and `qa.approver2`. Each holds every staff role across all
branches, with very high approval limits, and already has an authenticator
set up. They let one tester run every step by switching between four
accounts. Maker-checker still applies per person, so the same QA account
can never both prepare and approve the same item. An application needs three
different people (create, recommend, approve). A large or multi-level one
needs a fourth.

If you use the QA accounts, follow the walkthrough and substitute:

| Walkthrough account | QA account |
|---|---|
| `officer.pnh`, `ops.maker`, `collections`, `finance` (makers) | `qa.maker` |
| `analyst`, `ops.checker` (second person) | `qa.checker` |
| `approver`, `committee`, `risk` (approvers) | `qa.approver` |
| a second approver, where needed | `qa.approver2` |

Make sure the same QA account never appears twice on one item. For
example, if `qa.maker` created the application, `qa.checker` recommends
and `qa.approver` approves. Then `qa.maker` books and prepares the
disbursement, and `qa.checker` approves and executes it.

### Set up authenticators (once)

Approvals, disbursement approval and execution, write-off approval and
reversals need you to be signed in **with an authenticator code**
([chapter 01](01-getting-started.md), sections 3 and 4).

- **QA accounts:** the authenticator is already switched on. Your
  administrator gives you each account's authenticator key (or a QR code
  made from it) from the demo set-up output. Add it to your authenticator
  app with "enter a setup key".
- **`approver`, `approver2`, `ops.checker` and `committee`:** sign in as
  each one. Click **Set up an authenticator** in the amber banner, or open
  `/en/settings` in the address bar. Under **Security Verification** click
  **Setup Authenticator**, scan the QR code, type the code and click
  **Complete Security Setup**. Then click **Sign out** and sign in again
  with the code. The chip at the top must show **MFA**, not
  **Password only**.

  Tip: if you type a wrong code during set-up, the portal may send you
  back to **Sign in**. Delete the half-made entry from your authenticator
  app and start again.

### What is already in the demo

- **Products:** the five main products are active: **Personal instalment
  loan** (`PL-STD`), **Microenterprise loan** (`MF-IND`), **SME term loan**
  (`SME-TERM`), **Home mortgage** (`MTG-STD`) and **Seasonal crop loan**
  (`AG-CROP`). One product is also active for every other available loan
  type. In the demo, loan types that are normally switched off (credit
  lines, overdrafts, trade finance, syndication, group lending, floating
  rates, institutional, income-contingent education, Murabaha) are
  switched on. In a real organisation, two administrators switch each one
  on.
- **Borrowers**, already KYC-verified:

  | Borrower | Branch | Monthly income |
  |---|---|---|
  | Sokha Chan | Phnom Penh | 1,200 |
  | Dara Pich | Phnom Penh | 2,500 |
  | Srey Mom | Siem Reap | 900 |
  | Vanna Keo | Phnom Penh | 15,000 |

- **Branches:** Head Office, Phnom Penh, Siem Reap. There is also a
  Cambodia holiday calendar and five institutional counterparties with
  limits.

Note the **business date** chip at the top of the screen. All postings in
the demo are dated by it, and in Part 5 finance moves it forward.

---

## Part 1 — Onboard a borrower

*Sign in as `officer.pnh`.* Chapter: [03 Customers and documents](03-customers-and-documents.md).

1. Click **Customers › Borrowers**, then **New Borrower**.
2. Fill **First Name**, **Last Name**, **Phone Number**,
   **National ID / Passport**, **Address**, **Monthly Income (USD)** and
   **Monthly Expenses (USD)**. Use made-up details.
3. Click **Add Borrower**. The borrower appears in the list. Open them
   with **View**.
4. On the borrower's page, upload a document under **Documents**
   (**Upload**: choose a **Category**, **Title** and **File**). Or use
   **Request from customer** to see how a portal request is sent.

About KYC: a new borrower starts with KYC pending. On screen, the
**Approve** button for KYC appears only when the customer has uploaded
identity documents through the borrower portal. The demo products check
KYC before an application can be submitted. So **for the rest of the
walkthrough use the already-verified borrower Sokha Chan**. To see the
refusal, try submitting an application for your new borrower later. It
stops with **The borrower's KYC must be verified.**

*Optional — document review (sign in as `analyst`):*
**Customers › Documents** › **Review queue**. Open the document you
uploaded. Download it, then **Accept** it, or **Reject** it with a reason.
Uploader and reviewer must be different people.

## Part 2 — Create and submit an application

*Sign in as `officer.pnh`.* Chapter: [05 Applications and credit decisions](05-applications-and-credit-decisions.md).

1. Click **Origination › Applications**, then **New application**.
2. In **Find borrower** type `Sokha` and click **Search**. Choose
   **Sokha Chan** as the **Borrower**.
3. Choose the **Product** **Personal instalment loan**. Enter a
   **Principal** of `3000` and leave the **Disbursement date** at the
   business date. Accept the other defaults.
4. Click **Create draft application**. The application opens with status
   **DRAFT**.
5. Click **Simulate** and look at the instalment, the total cost and the
   effective annual rate.
6. Optionally, add a document with **Upload document**, a guarantee with
   **Add guarantee** (a **Guarantor name**, **Type** and **Amount**), or
   collateral with **Add collateral**.
7. Click **Submit** and confirm. The status changes to **SUBMITTED**.

If submission is refused, the red box lists every reason under
**Blocked by**. See [05](05-applications-and-credit-decisions.md),
"Submit".

## Part 3 — Recommend and approve (maker-checker)

Chapter: [05](05-applications-and-credit-decisions.md),
[02 Roles and approvals](02-roles-and-approvals.md).

*Sign in as `analyst`.*

1. Open **Work › Home**. The tile **Applications to assess** shows the
   application. Click **Open**, or go to **Origination › Applications**.
2. Click **Recommend**. Set **Recommendation** to **APPROVE**, write a
   **Rationale** and click **Recommend**.

*Sign in as `approver`, with your authenticator code.*

3. On **Home**, the tile **Waiting for your credit decision** shows the
   application. Open it.
4. Click **Approve**, write a **Rationale** and click
   **Approve application**. The status becomes **APPROVED**.
5. To see the origination credit score, open **Credit decisions** ›
   **Detail** and look in the assessment.

Try these to see the controls work:

- Sign in as `officer.pnh` and try to approve. The button is not offered,
  or the refusal says **You cannot approve or complete an action you
  created or proposed**.
- Sign in as `approver` with a password only. The **Verify with your
  authenticator to approve** banner appears and approval is refused.
- An application above 100,000 USD is shown to `approver` as
  **Above your limit**. It must go to `approver2`.

## Part 4 — Book and disburse

Chapters: [05](05-applications-and-credit-decisions.md) (booking and
conditions), [06 Disbursement](06-disbursement.md).

*Sign in as `ops.maker`.*

1. Open the approved application. **Home** shows it under **Approved
   applications to book**.
2. Click **Book agreement**. Enter the **Planned disbursement date**
   yourself (use the business date), then click **Book loan account**.
   A loan account is created with status **BOOKED**; no money has moved.
3. If the application lists **Conditions precedent**, click **Satisfy**
   for each one, enter the **Evidence** and click **Mark satisfied**. An
   approver can **Waive** a condition instead.
4. Open the loan from the link on the application, or from
   **Loans › Loan accounts**. Under **Servicing actions** click
   **Disbursement**.
5. Click **Prepare disbursement**. The disbursement now waits for a
   second person.

*Sign in as `ops.checker`, with your authenticator code.*

6. **Home** shows **Disbursements to approve**. Open the loan ›
   **Disbursement** › **Approve** and confirm.
7. Enter the **External reference**, for example a bank transfer number
   such as `TT-0001`. Click **Execute disbursement** and confirm.
8. The loan becomes **ACTIVE**. Look at **Financial events**, the
   **Schedule** and the agreement.

Clicking **Execute disbursement** twice does not pay twice
([06](06-disbursement.md), "Submitting twice will not pay twice").

## Part 5 — Move time forward: end of day

*Sign in as `finance`.* Chapter: [14 Accounting and period close](14-accounting-and-period-close.md).

The first instalment is due about a month after disbursement. To make it
fall due:

1. Click **Finance › End of day & operations**, then the tab
   **Business date & end of day**.
2. In **Advance to** choose a date just after the first instalment's due
   date. Look on the loan's **Schedule**; you can move at most 31 days at
   a time. Keep **Run end of day after advancing** ticked.
3. Click **Advance date**, then **Advance & run end of day**. Read the
   **End-of-day result**: interest has accrued and the instalment is now
   due.
4. Optionally, click **Finance › Ledger & reconciliation** and look at
   **Reconciliation** and **Trial balance**. There should be no breaks.

## Part 6 — Post a repayment, and reverse one

*Sign in as `ops.maker`.* Chapter: [07 Repayments and payments](07-repayments-and-payments.md).

1. Click **Loans › Loan accounts** and open Sokha Chan's loan.
2. Click **Post repayment**. Enter the instalment amount shown on the
   schedule as **Amount**, leave **Value date** blank (the business date)
   and enter an **External reference**. Click **Post repayment**.
3. In **Financial events**, expand the new **REPAYMENT** row to see how
   it was allocated to interest and principal.
4. Post a second, small repayment (for example `10`) to practise a
   reversal.

*Sign in as `ops.checker`, with your authenticator code.* Chapter: [08 Servicing changes](08-servicing-changes.md).

5. Open the loan. In **Financial events**, click **Reverse** on the
   newest repayment, enter a **Reason** and click **Reverse event**.
   Reversals go newest first. Trying to reverse the older repayment
   first is refused with **Reverse later repayments first (latest
   first).**

*Optional — unidentified payment (sign in as `ops.maker`):*
**Collections & relief › Unidentified payments** › **Record receipt**. Enter
an **Amount**, **Currency**, **Channel**, **External reference** and
**Payer name**, then click **Record receipt**. Then **Match** it: find the
loan by reference, **Select** it, and click **Apply to loan**.
See [07](07-repayments-and-payments.md), section 7.

## Part 7 — Pay off and close the loan

*Sign in as `ops.maker`.* Chapter: [07](07-repayments-and-payments.md), section 4.

1. Open the loan and click **Early settlement**.
2. Click **Get quote**. The quote lists principal, interest to date and
   any fee.
3. Click **Settle** (the button shows the amount) and confirm. The loan's
   status becomes **CLOSED**.
4. On the card **Statements and letters**, click **Closure letter** and
   then **Print**. **Statement** gives the full account history.

You could also issue a **Payoff letter** first (for example for another
lender taking the loan over), then settle against it.

## Part 8 — Collections scenario

Chapters: [11 Collections and recovery](11-collections-and-recovery.md),
[05](05-applications-and-credit-decisions.md).

### 8.1 Create a loan that falls behind

1. Repeat Parts 2 to 4 for **Dara Pich**: `officer.pnh` creates and
   submits, `analyst` recommends, `approver` approves, `ops.maker` books
   and prepares, `ops.checker` approves and executes. Before submitting,
   use **Add guarantee** to add a guarantor so that you can call on them
   later.
2. *As `finance`:* advance the business date past the first due date and
   run end of day (Part 5). Then advance it again by about two weeks and
   run end of day. **Post no repayment.** The loan is now past due, and
   the collection stage **Reminder** (from 1 day past due) applies.

### 8.2 Work the collector queue

*Sign in as `collections`.*

1. On **Home**, **Past due in your scope** and **Collection tasks in your
   queues** show the loan.
2. Click **Collections & relief › Collections**. Under
   **Collector work queues**, filter **Status** **Open**, click **Claim**
   on the task, then **Record outcome**. Choose "promise to pay", add a
   note and click **Save**.
3. Under **Borrower notices**, choose the **Overdue** notice and click
   **Copy message**. The portal does not send it; you paste it into your
   usual SMS or messaging channel.

### 8.3 Call the guarantor, or propose a set-off

*Still as `collections`.*

1. Open Dara Pich's loan and click **Guarantor / set-off**.
2. Choose the **Guarantee**, leave **Amount** blank (the arrears) and set
   **Pay within (days)**, for example `14`. Click **Issue demand**.
3. When the guarantor pays, click **Record payment** on the demand row and
   then **Post payment**.

Alternatively, propose a set-off from the borrower's deposit: enter the
**Amount**, **Deposit account** and **Reason**, and click
**Propose set-off**. *Then sign in as `ops.checker`*, open the loan ›
**Guarantor / set-off** › **Approve**. The **Set-offs to approve** queue
on Home links to the Collections page, but the set-off itself is shown
only on the loan.

### 8.4 Bring the loan up to date, or restructure

- *As `ops.maker`:* **Post repayment** for the arrears. After the next end
  of day the loan is current again.
- Or practise a hardship case. *As `officer.pnh`:* on the loan click
  **Request restructure**, fill in the case and click
  **Open restructure case**. Then follow
  [08](08-servicing-changes.md): the analyst assesses and proposes,
  `committee` or `approver` approves, the officer records the customer's
  acceptance and `ops.checker` executes.

### 8.5 Write-off (for reference)

Write-off needs the loan to be well past due. The demo products require
**180 days**, which takes several date advances of 31 days each. When the
loan is far enough behind:

1. *As `ops.maker`:* open the loan, click **Propose write-off**, enter a
   **Reason** and click **Propose write-off**.
2. *As `ops.checker`, with your authenticator code:* **Home** ›
   **Write-offs to approve** › open the loan › **Write-off decision** ›
   **Approve**, then confirm **Approve write-off**. The approval limit is
   50,000 USD.
3. Money received later is posted by `collections` with
   **Record recovery** › **Post recovery**. The loan stays written off.

## Part 9 — Check the books and the audit trail

1. *As `finance`:* click **Finance › Ledger & reconciliation**. The
   **Reconciliation** tab should show no breaks. The **Journal** lists
   every posting you made, each with balanced debits and credits.
2. *As `auditor` or `risk`:* click **Risk & audit › Audit trail**. Every
   step you took is listed, including refused attempts and the reason for
   each ([19](19-audit-trail.md)).
3. *Optional, as `finance` then `risk`:* close the month under
   **Finance › Period close** (**Prepare close**, then
   **Approve and lock** by the second person). Then try to post a
   repayment dated in that month. The refusal says the month is closed
   ([14](14-accounting-and-period-close.md)).

## Where to go next

- Products: create and approve a new product version as `product.maker` /
  `product.checker` ([04](04-products-and-policies.md)).
- Access: assign a role and an approval limit as `admin` and approve it as
  `admin2` ([18](18-tenant-administration.md)).
- Facilities, trade finance and the other specialised loan types are all
  switched on in the demo ([09](09-facilities.md),
  [12](12-specialised-products.md)). Note that the demo role accounts have
  no approval limit for approving drawdowns, facility limit changes or
  issuing letters of credit, so `ops.checker` and `approver` are refused
  with **You have no approval authority for this action** there. Use the QA accounts for those steps,
  or have `admin` request the limit and `admin2` approve it
  ([18](18-tenant-administration.md)).
