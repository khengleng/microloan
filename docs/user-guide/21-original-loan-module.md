# The original loan module

Who this is for: staff who still service loans created in the first version of the portal (screens marked "(original)" or "Legacy"), tenant administrators who decide when to close that module, and staff who support borrowers in the borrower portal.

---

## 1. Two loan books: which one to use

The portal holds two separate sets of loan records.

| | Original module | Lending platform |
|---|---|---|
| Menu | **Origination › Loans (original)**, **Loans › Repayments**, **Collections & relief › Collections (original)**, **Products › Products (original)**, **Work › KPI dashboard** | **Origination › Applications**, **Loans › Loan accounts**, **Collections & relief › Collections**, **Products › Products & versions** |
| Page marker | A grey **Legacy** tag next to the title | none |
| Products | Simple products: rate tiers and term/amount limits | Versioned products with maker-checker, policies and workflows |
| Controls | Maker-checker on approval and disbursement only | Maker-checker, approval limits, MFA, feature flags, period lock on every money action |
| Ledger | Legacy journal (**Finance › Accounting (original)**) | Lending ledger (**Finance › Ledger & reconciliation**) |

The two do not share loans. A loan created under **Loans (original)** never appears in **Loan accounts**, and a platform loan never appears in **Loans (original)**. Repayments, collections lists, the KPI dashboard and the original reports each see only their own book.

When to use which:
- **New loans:** use the lending platform ([05-applications-and-credit-decisions.md](05-applications-and-credit-decisions.md)) unless your organisation has told you to keep using the original module.
- **Existing original loans:** keep servicing them here (repayments, early settlement, rescheduling, collections) until they are paid off or moved across with a loan-book migration ([16-loan-book-migration.md](16-loan-book-migration.md)). A migrated loan becomes a new platform loan. The old record and its legacy ledger entries stay where they are.
- **Combined figures:** **Finance › Combined ledger** shows both journals side by side ([14-accounting-and-period-close.md](14-accounting-and-period-close.md)).

### The legacy read-only switch

A tenant administrator can close the original module to new business by turning on the feature flag `lending.legacy_loans.readonly` under **Risk & audit › Access & policy** (flags). One administrator proposes the change and a second administrator approves it. The flag is off by default.

While it is on:
- The **New Loan** button and the **Disburse Funds** button are hidden. On the dashboard, **Create New Loan** becomes **New application (lending)**.
- A yellow banner **Legacy loans are read-only** appears on the loan list (and on approved loans), with links **New application** and **Migrate loans**.
- Repayments, early settlement, rejection, rescheduling, write-off and reading of existing loans carry on as before.
- If someone still tries, the server refuses with "New legacy loans are closed: create the loan in the lending platform (Lending › Applications)." or "Legacy disbursements are closed: book and disburse the loan in the lending platform."

A loan that is already **Approved** can no longer be paid out once the switch is on. Reject it and create it again in the lending platform.

---

## 2. Loans (original): list and new loan

Menu: **Origination › Loans (original)**. The page is titled **Loans** with the **Legacy** tag.

- Status tabs: **All Loans**, **Pending**, **Approved**, **Disbursed**, **Closed**, **Defaulted**.
- **Filter by borrower name...** searches by name.
- **Export** downloads an Excel file of the loans.
- **View** opens a loan.

Statuses:

| Status | Meaning |
|---|---|
| **Pending** | Created; waiting for approval or rejection. |
| **Approved** | Approved; waiting for disbursement. |
| **Rejected** | Rejected with a reason. Final. |
| **Disbursed** | Paid out; the repayment schedule is running. |
| **Defaulted** | Disbursed and overdue longer than the tenant's limit (default 30 days). The nightly penalty job sets this. Repayments are still accepted. |
| **Closed** | Fully repaid or settled early. Final. |
| **WRITTEN_OFF** | Written off (only possible through the API; see section 4.6). |

To create a loan (Tenant administrator or Loan officer):

1. Click **New Loan**. The **New Loan** dialog opens.
2. Choose the **Borrower** (the borrower must already exist under **Customers › Borrowers**).
3. Optionally choose a **Loan Product**. This fills in the interest method and the rate of the product's first tier. Choose **Manual / custom parameters** to type your own.
4. Enter **Principal (USD)**, **Annual Interest Rate (%)**, **Term (months)**, **Start Date** and **Interest Method** (**Flat Rate** or **Reducing Balance**).
5. Under **Collaterals**, click **Add** for each item: type (**Land Title**, **Vehicle**, **Gold**, **ID Card**, **Other**) and **Value (USD)**.
6. Under **Guarantors**, click **Add** for each person: **Full name** and **Phone**.
7. Click **Create Loan**. The loan is created as **Pending** and its schedule is calculated.

If it is blocked:
- "Annual interest rate 20% exceeds the NBC regulatory cap of 18%." The rate cap is 18% a year unless your organisation set a lower cap.
- "New legacy loans are closed: …" (read-only switch, see above).

---

## 3. Credit checks before approval

### 3.1 Borrower Credit Check (in-house cross-check)

On **Customers › Borrowers**, click **Credit Check**. The **Borrower Credit Check** dialog opens. Enter an **ID Number** or **Phone Number** and click **Verify Borrower Reliability**. The result lists any loans this borrower has with your organisation, or "No prior activity in your organization." It also shows a line about the Credit Bureau.

### 3.2 Credit Bureau Cambodia (CBC)

On the borrower's page (**Customers › Borrowers** › borrower), the **Credit Bureau (CBC)** card has **Run Credit Check**. The Tenant administrator and Credit officer can use it.

Note: CBC needs member credentials that your IT team must configure. Until then, the card shows "CBC integration is not ready." The system does not show test or made-up scores. Approval of original loans is not blocked while CBC is not configured. Once it is configured, and if your organisation requires it, approving a loan needs a completed CBC check within the validity period (default 90 days). Otherwise approval fails with "A completed credit bureau (CBC) check within the last 90 days is required before approving this loan."

### 3.3 Risk & Decision (scorecard)

On the loan page, the **Risk & Decision** card scores the loan. Click **Run scorecard** (or **Re-score**). The card shows a score out of 100, a **Grade**, a decision (**APPROVE**, **REFER** or **DECLINE**), the debt-service ratio, a **Recommended rate** and the points for each factor. The result is advice only: it does not approve or reject the loan. See [scorecards-and-alternative-data.md](scorecards-and-alternative-data.md).

---

## 4. Working a loan (loan page)

Open a loan from the list (**View**). The page title is **Loan #XXXXXX** with the **Legacy** tag and the status. It shows **Loan Summary**, **Risk & Decision**, **Early settlement** (disbursed or defaulted loans), **Pay via QR** (if a collection QR is set up), **Key Facts & Loan Agreement**, **Security & Collateral**, **Guarantors**, **Repayment Schedule** and **Collection Logs & Activity**.

### 4.1 Approve or reject (maker-checker)

The person who created the loan cannot approve or reject it. Someone else must decide (four-eyes control against error and fraud).

1. Open a **Pending** loan.
2. Click **Approve** and confirm in **Approve Loan Application**, or
3. Click **Reject**, type the **Reason for rejection...**, click **Confirm**, and confirm again.

If it is blocked:
- "Maker-checker violation for action LOAN_APPROVE": you created this loan.
- "Reviewer cannot approve the same loan."
- The CBC message in 3.2.
- "You don't have permission to do that. …": your role cannot approve original loans. With the standard roles, this is in practice the **Tenant administrator**.

### 4.2 Disburse

1. Open an **Approved** loan.
2. Click **Disburse Funds** and confirm (**Disburse Funds**). The status becomes **Disbursed**, the schedule starts and the payout is posted to the legacy ledger.

The person who approved the loan, or who created it, cannot disburse it.

If it is blocked: "Approver cannot disburse the same loan.", "Loan must be approved before disbursement.", or the read-only message.

### 4.3 Post a payment

1. On a **Disbursed** or **Defaulted** loan, click **Post Payment**. (You can also use **Loans › Repayments** or the original collections page.)
2. The **Record Repayment** dialog shows the **Outstanding balance**. Enter **Amount (USD)** and **Payment Date**.
3. Click **Post Repayment**.

A payment pays interest first, then principal, then penalty.

If it is blocked: "Repayment amount cannot exceed the remaining balance of $X", "Can only post repayments for disbursed or defaulted loans".

### 4.4 Early settlement

1. In **Early settlement**, click **Get payoff quote**. It shows **Principal**, **Interest due**, **Penalties**, **Future interest waived** and **Payoff today**.
2. Click **Settle $X and close**, then confirm. The loan becomes **Closed** and future interest is waived.

An ordinary payment of the same amount does not close the loan. Use this panel to settle. If the quote is out of date, you see "The settlement amount today is …"; get a new quote.

### 4.5 Restructure / reschedule

On a **Disbursed** loan, in **Risk & Decision**:

1. Click **Restructure / reschedule…**.
2. Enter **New term (months)**, optionally **New rate % (optional)**, and a **Reason**.
3. Click **Apply**. The unpaid principal is laid out on a new schedule, paid instalments are kept, and the loan is marked restructured.

Note: in the original module this takes effect at once. There is no second approver and no customer acceptance step. A new rate above the cap is lowered to the cap without a warning. Usually only a Tenant administrator or Approver can do this. Restructures with full controls are on the lending platform ([08-servicing-changes.md](08-servicing-changes.md)).

### 4.6 Things with no screen in the original module

These exist only through the API. There is no screen for them; ask your system administrator or IT team.
- **Write-off** of an original loan (only Disbursed or Defaulted loans; a reason is required). There is no maker-checker.
- **Reversing a repayment** (a reason is required).
- **Repayment receipts**.
- **Loan documents** (upload and delete) and **deleting a pending loan**.
- **Promises to pay** (see section 6).

### 4.7 Key Facts and e-signature

The **Key Facts & Loan Agreement** card shows the **Effective Interest Rate (APR)**, **Principal**, **Net amount disbursed**, **Total interest**, **Total fees**, **Total cost of credit**, **Total repayable**, **Installments** and **Late penalty / day**.

To sign with the borrower in the branch:

1. The borrower reads the Key Facts.
2. Type the name in **Type your full name**, or draw in **Or draw your signature**.
3. Tick the acceptance box ("I have read and understood the Key Facts above…").
4. Click **Sign agreement**. The card then shows "Signed on <date>".

The borrower can also sign in the borrower portal (section 9). Each signature is stored as a new agreement version with a fingerprint of the terms.

### 4.8 Notes

Under **Collection Logs & Activity**, type in **Add a follow-up note...** and press Enter or click send. Notes are kept with a date and time.

---

## 5. Repayments

Menu: **Loans › Repayments**. The page is titled **Repayments**.

- Summary tiles: **This Month**, **Average Payment**, **Verified Ledger**.
- Search with **Search by borrower name...** and a date range, or clear the filters with **Clear**.
- Click **Export** to download an Excel file.
- Click **Record Payment** to open the same **Record Repayment** dialog. Choose the **Loan**; the list shows only disbursed and defaulted original loans.

This page shows only original-module loans. Platform repayments are in [07-repayments-and-payments.md](07-repayments-and-payments.md).

---

## 6. Collections (original)

Menu: **Collections & relief › Collections (original)**. The page is titled **Collections**: "Overdue accounts requiring follow-up."

- It lists original loans with an unpaid instalment past its due date (disbursed and defaulted), grouped by **1–30 days**, **31–60 days**, **61–90 days** and **90+ days**.
- Columns: **Borrower**, **Phone**, **Overdue Amount**, **Days Late**.
- Click **Record Payment** to post a payment, or **View** to open the loan.
- If nothing is overdue, the page shows "Portfolio is current".

Days are counted from today's date, not from a business date. A nightly job charges the daily late penalty (set per product or for the tenant) and sends reminders the day before payments are due. Sending reminders needs an SMS provider to be configured.

Note: promises to pay for original loans are tracked by the API (it marks them **KEPT** or **BROKEN** each day), but there is no screen to record or view them. Record what the borrower promised as a note on the loan (section 4.8).

---

## 7. Products (original)

Menu: **Products › Products (original)**. The page is titled **Loan Products**. Only a **Tenant administrator** can change these products.

1. Click **New Product**, or **Edit** on an existing product.
2. Enter **Product Descriptor** (the name), **Strategic Summary** (description) and **Calculation Engine** (flat or reducing balance), and tick **Deployment Status (Active)**.
3. Under **Credit Risk Matrices**, click **Add Policy** for each tier: **Risk Tier**, **Rate %**, **Term (Min-Max)** and **Principal (Min-Max) $**.
4. Click **Deploy Product Engine**. Errors show as "Logic Failure: …". A rate above the cap gives "Annual interest rate X% exceeds the NBC regulatory cap of 18%."
5. **Delete** removes a product that no loan uses ("Failed to delete product (it may be in use by existing loans)").

Changes apply only to new loans. These products have no maker-checker and no versions. They are not the platform's **Products & versions** ([04-products-and-policies.md](04-products-and-policies.md)).

---

## 8. KPI dashboard

Menu: **Work › KPI dashboard**. The page is titled **Financial Dashboard**.

- Tiles: **Outstanding Principal**, **Active Borrowers**, **Active Loans**, **Due Next 7 Days**.
- **Cash Flow** (collections against disbursements).
- **Quick Actions**: **Create New Loan**, **Add Borrower**, **Record Repayment**, **View Reports**.
- **Monthly Summary** (last 30 days).

The figures cover original-module loans only. Note: the "vs last month" changes on the tiles and the **Attention Required** box ("4 accounts are overdue…") are fixed sample text, not real figures. The **Review Overdue Accounts** button does nothing. Use **Collections (original)** for the real overdue list.

---

## 9. Collection QR (KHQR)

You can show a static KHQR or bank QR on original loans and in the borrower portal, so borrowers can pay from any Bakong or bank app.

To set it up (Tenant administrator): go to **Administration › Settings**, card **Collection QR**:

1. Click **Add QR**.
2. Enter **Label**, **Bank**, **Currency**, **Account name** and **Account number**.
3. Paste the **KHQR / QR payload**, or **…or upload a QR image** (at most 1 MB).
4. Tick **Use as the default collection QR** if this is the main one.
5. Click **Save**.

On a loan, the **Pay via QR** card shows the QR for the loan's branch if one exists, otherwise the default QR.

Note: the QR has no amount in it, and payments are not matched automatically. Staff must still post each payment by hand (section 4.3). Setting up a QR for one branch is only possible through the API; the form has no branch field.

---

## 10. Borrower portal

Borrowers sign in at `/<language>/portal/login` (for example `/en/portal/login`). The page is titled **Borrower Portal**.

Signing in:
1. The borrower enters their registered **Phone number** and taps **Send code**.
2. They enter the 6-digit code in **Verification code** and tap **Verify & sign in**. A wrong or expired code shows "Invalid or expired code."

Note: the code is sent by SMS, so an SMS provider must be configured. If none is, borrowers cannot sign in.

What the borrower can do:
- **My loans**: their original-module loans, with **Principal**, **Outstanding**, **Next due** and **Download statement (PDF)**, and the **Key Facts & Loan Agreement** card where they can **Sign agreement**.
- **Pay via QR**: the default collection QR.
- **Verify your identity**: upload **National ID (front)**, **National ID (back)**, **Selfie** and **Proof of address**. The banner shows **Identity verification pending**, **Identity verified** or **Verification was rejected — please re-upload your documents.** Staff review the uploads on the borrower's page ([03-customers-and-documents.md](03-customers-and-documents.md)).
- **Documents requested from you** and **My documents**: documents the lending platform asked for. The borrower uploads PDF, JPEG, PNG or WebP files, up to 3.5 MB.
- **Request a lower payment / payment relief**: this is for lending-platform loans. The borrower taps **Start a request** and enters the **Loan reference id** ("Given to you by your branch"), **What happened?**, **How long do you expect it to last?** and what would help, then taps **Send request**. This opens a restructure case for staff ([08-servicing-changes.md](08-servicing-changes.md)). When staff approve an offer, the request shows **Offer ready**. The borrower compares **Now** and **With this offer**, ticks the box and taps **Accept this offer**.

The portal's **My loans** list shows only original-module loans. Payment relief works only for lending-platform loans. For relief, staff must give the borrower the platform loan's id.
