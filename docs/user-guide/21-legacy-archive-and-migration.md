# Legacy loan archive and migration

Who this is for: finance officers and risk / compliance reviewers who look up loans made in the first version of the portal (the "original" loan module) and move the running ones to the lending platform, auditors who need those records, and staff who support borrowers in the borrower portal.

Related chapters: [16 Loan-book migration](16-loan-book-migration.md), [14 Accounting and period close](14-accounting-and-period-close.md), [15 Reports and regulatory returns](15-reports-and-regulatory-returns.md), [03 Customers and documents](03-customers-and-documents.md).

---

## 1. One lending system

The portal used to have two loan books: the **original loan module** (menu items marked "(original)") and the **lending platform**. The original module has now been retired. All lending work happens on the lending platform:

| You used to use | Use now |
|---|---|
| **Origination › Loans (original)** (new loans, approval, disbursement) | **Origination › Applications** ([05](05-applications-and-credit-decisions.md)) and **Loans › Loan accounts** ([06](06-disbursement.md)) |
| **Loans › Repayments**, early settlement, receipts | The loan account page: repayments, payoff quotes and settlement ([07](07-repayments-and-payments.md)) |
| **Collections & relief › Collections (original)**, promises to pay | **Collections & relief › Collections** ([11](11-collections-and-recovery.md)) |
| **Finance › Accounting (original)** | **Finance › Ledger & reconciliation**; the old journal's balances are on **Finance › Combined ledger** ([14](14-accounting-and-period-close.md)) |
| **Finance › Provisioning** | Impairment in **Finance › End of day & operations** ([14](14-accounting-and-period-close.md)) |
| **Products › Products (original)** | **Products › Products & versions** ([04](04-products-and-policies.md)) |
| **Finance › Reports**, **Finance › Performance**, **Work › KPI dashboard** | The same menu items, now showing the lending platform's loans ([15](15-reports-and-regulatory-returns.md)) |
| Loans of the original module | **Finance › Legacy loan archive** (this chapter) |

Nothing can be changed in the original module any more and no money moves there. Its loans are kept, read-only, in the **Legacy loan archive** until they have all been moved to the lending platform.

---

## 2. The legacy loan archive

Menu: **Finance › Legacy loan archive**. The page is titled **Legacy loan archive**.

You see it if your role includes **View and export the legacy loan archive** — the **Finance officer**, **Risk / compliance reviewer** and **Auditor** roles have it — and only while your organisation still has loans in the original module. You see the loans of your own branches.

At the top:
- **Read-only archive** — a reminder that nothing can be changed here, with links **Open the loan-book migration** and **Download the migration file of running loans** if you can run migrations.
- Tiles: **All loans**, **Running** (disbursed or defaulted), **Never paid out** (pending or approved applications), **Moved to lending**, and **Principal still owed** per currency.

To find a loan:
1. Pick a **Status** (for example **Running (disbursed or defaulted)**), or leave **All statuses**.
2. Type a borrower name, or the first characters of the loan id, in **Search**.
3. Click **Apply**.

Each row shows the borrower, branch, product, status, **Principal**, **Outstanding**, **Overdue** and **Days past due** (counted to the business date), and a **Migration** column:
- **Can be migrated** — the loan is running and has an instalment after the business date, so it is in the migration file.
- **Moved to LN-…** — the loan was moved by a loan-book migration; click it to open the lending loan.
- **Past maturity: not in the migration file** — see section 4.

Click **View** to open the loan: its rate, term and start date, the full schedule (due date, principal, interest, penalty, total, paid) and every repayment, including reversed ones with the reason.

**Export CSV** (top right) downloads the archive — every loan you can see, or only the ones matching your filters. Keep a copy: it is the record of these loans once the archive is closed.

From a borrower's page (**Customers › Borrowers** › borrower) the line "… of this customer are in the legacy loan archive" links to the archive filtered to that customer.

Global search (top bar) also finds original-module loans for archive users; the result opens the archive.

---

## 3. Moving running loans to the lending platform

Running loans are moved with a loan-book migration; see [16 Loan-book migration](16-loan-book-migration.md) for every step. In short:

1. A finance officer downloads the migration file of running loans (**Download the migration file of running loans** in the archive, or on **Finance › Loan-book migration**), checks it, adds the lending product code, and loads it.
2. Another person approves it.
3. Each loan is booked on the lending platform with its balance, arrears and remaining schedule. In the archive it now shows **Moved to …** and its status is **Closed**; its balance is cleared from the old journal.

After the move, service the loan in **Loans › Loan accounts** like any other.

---

## 4. Loans that cannot be moved by file

- **Past maturity** — a running loan whose last instalment is already due has nothing left to schedule, so the migration file leaves it out. It stays in the archive and in the monthly regulatory return. Ask your finance lead: your organisation decides how to close these loans (for example by booking a replacement loan or writing them off).
- **Never paid out** — applications that were pending or approved in the original module can no longer be paid out or rejected. If the customer still wants the loan, create a new application in **Origination › Applications**. When the platform operator closes them (after telling you), they show as **REJECTED** with the reason "Original loan module retired"; each closure is in the audit log.

---

## 5. Borrower checks that stay

These were on the original screens and still work, on the borrower's page:

- **Credit Check** (on **Customers › Borrowers**): enter an **ID Number** or **Phone Number** and click **Verify Borrower Reliability** to see any loans this person has with your organisation.
- **Credit Bureau (CBC)** card: **Run Credit Check**. CBC needs member credentials that your IT team must configure; until then the card shows "CBC integration is not ready." The lending platform's own bureau checks are described in [17](17-webhooks-and-integrations.md).

---

## 6. Collection QR (KHQR)

You can show a static KHQR or bank QR in the borrower portal, so borrowers can pay from any Bakong or bank app.

To set it up (Tenant administrator): go to **Administration › Settings**, card **Collection QR**:

1. Click **Add QR**.
2. Enter **Label**, **Bank**, **Currency**, **Account name** and **Account number**.
3. Paste the **KHQR / QR payload**, or **…or upload a QR image** (at most 1 MB).
4. Tick **Use as the default collection QR** if this is the main one.
5. Click **Save**.

Note: the QR has no amount in it, and payments are not matched automatically. Post each payment on the loan account ([07](07-repayments-and-payments.md)) or through a payment channel.

---

## 7. Borrower portal

Borrowers sign in at `/<language>/portal/login` (for example `/en/portal/login`). The page is titled **Borrower Portal**.

Signing in:
1. The borrower enters their registered **Phone number** and taps **Send code**.
2. They enter the 6-digit code in **Verification code** and tap **Verify & sign in**. A wrong or expired code shows "Invalid or expired code."

Note: the code is sent by SMS, so an SMS provider must be configured. If none is, borrowers cannot sign in.

What the borrower can do:
- **My loans**: their loans on the lending platform, each with its reference, **Principal**, **Outstanding**, **Next due** and **Download statement (PDF)**. Loans still in the original module are not shown; move them with the migration.
- The **key facts statement** of an approved loan, to read and accept before the contract ([05](05-applications-and-credit-decisions.md)).
- **Pay via QR**: the default collection QR.
- **Verify your identity**: upload **National ID (front)**, **National ID (back)**, **Selfie** and **Proof of address**. Staff review the uploads on the borrower's page ([03](03-customers-and-documents.md)).
- **Documents requested from you** and **My documents**: documents the lending platform asked for (PDF, JPEG, PNG or WebP, up to 3.5 MB).
- **Request a lower payment / payment relief**: the borrower taps **Start a request**, picks the loan and describes what happened. This opens a restructure case for staff ([08](08-servicing-changes.md)). When staff approve an offer, the request shows **Offer ready**; the borrower compares **Now** and **With this offer**, ticks the box and taps **Accept this offer**.
