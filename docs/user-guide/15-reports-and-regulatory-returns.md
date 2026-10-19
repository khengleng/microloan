# Reports and regulatory returns

Who this is for: finance officers who prepare NBC returns and exports, risk / compliance reviewers who submit them, loan officers and collectors who print statements and send notices, and managers who read portfolio reports and dashboards.

This chapter covers loan statements and closure letters, borrower notices, the monthly NBC regulatory return, the general-ledger and credit bureau files, the loan-book CSV, and the original **Reports**, **Performance** and **KPI dashboard** screens.

Related chapters: [14 Accounting and period close](14-accounting-and-period-close.md), [07 Repayments and payments](07-repayments-and-payments.md), [09 Facilities](09-facilities.md), [11 Collections and recovery](11-collections-and-recovery.md), [21 Original loan module](21-original-loan-module.md).

## Which report covers which loans

The platform has two loan books (see [chapter 14](14-accounting-and-period-close.md#key-ideas-in-plain-words)). Not every report covers both.

| Report or file | Where | Covers |
|---|---|---|
| Loan statement, closure letter | Loan account page | Lending platform |
| Borrower notices | **Collections & relief › Collections** | Lending platform |
| NBC regulatory return | **Finance › Regulatory returns** | **Both** books |
| GL export | **Finance › Ledger & reconciliation › Exports** | Lending platform |
| Credit bureau file | **Finance › Ledger & reconciliation › Exports** | Lending platform |
| Loan-book CSV | **Loans › Loan accounts** | Lending platform |
| Month-end snapshot (PAR, allowance) | **Finance › Period close** | Lending platform |
| Combined trial balance | **Finance › Combined ledger** | Both books |
| **Reports**, **Performance**, **KPI dashboard** | **Finance** and **Work** sections | Original module only |

Note: the **Reports**, **Performance** and **KPI dashboard** screens read only the original loan module. Loans booked on the lending platform do not appear in them. For lending-platform portfolio figures (PAR, classification, provision, breakdowns) use the regulatory return (its **Preview** works for any month) or the month-end snapshot on **Period close**.

---

## Loan statements and closure letters

A statement lists everything that happened on a loan in a period. It is generated from the books when you ask for it; nothing is posted.

To print a statement:
1. Open **Loans › Loan accounts** and click the loan.
2. Scroll to the card **Statements and letters**.
3. Optionally set **From** (blank: from disbursement) and **To** (blank: the business date).
4. Click **Statement**. The statement appears below.
5. Click **Print** to open it in a print window, or **Hide** to close it.

To print a closure letter (confirmation that a loan is fully repaid): on a loan with status **CLOSED**, click **Closure letter** in the same card, then **Print**.

The card is not shown on a loan that is booked but not yet disbursed. Anyone who can view the loan can generate these.

Facility statements, card statements and payoff letters are described in [09 Facilities](09-facilities.md), [12 Specialised products](12-specialised-products.md) and [07 Repayments and payments](07-repayments-and-payments.md). Borrowers can also download their own statement from the borrower portal.

---

## Borrower notices (reminders and overdue notices)

The **Borrower notices** card lists reminders before a due date and notices once it has passed, with a ready-made message for each borrower.

To prepare notices:
1. Open **Collections & relief › Collections**. Scroll to **Borrower notices**.
2. In **Notice**, choose **Falling due (reminder)** or **Overdue**.
3. For reminders, set **Within (days)** (1 to 60; default 7).
4. Read the list: **Loan**, **Borrower**, **Phone**, **Instalment**, **Due**, **Amount**, **Message**.
5. Click **Copy message** under a message to copy it ("Copied"), then paste it into your SMS, Telegram or other channel.
6. Click **Refresh** after posting payments.

The subtitle shows "As of *business date* — *N* notices". You only see loans in your branch or portfolio scope.

Note: the platform does not send these messages itself from this card; you copy and send them. Automatic sending depends on the notifications integration (see the **Integrations** tab in [chapter 14](14-accounting-and-period-close.md#integrations) and [17 Webhooks and integrations](17-webhooks-and-integrations.md)).

---

## NBC regulatory returns

Menu: **Finance › Regulatory returns**. The page title is **Regulatory returns**: "Monthly NBC returns covering the lending platform and the legacy loans: classification and provisioning, PAR, portfolio breakdowns, write-offs, largest borrowers and rates, reconciled to the ledger."

One return per month covers both loan books, per currency. Amounts are never added across currencies.

### How it works

1. The month is **closed** on **Finance › Period close** (see [chapter 14](14-accounting-and-period-close.md#period-close-month-end-and-year-end)). Any month can be **previewed** before that.
2. Finance (**regulatory.prepare**, Finance officer) **generates** the return. It is then frozen: later activity never changes it, and its content is sealed with a fingerprint (hash).
3. Finance **sends it for submission**. This is refused if anything fails to tie.
4. A different person (**regulatory.submit**, Risk / compliance reviewer) files it with NBC, then **submits** it in the system with the regulator's reference, or sends it back.

Anyone who can view lending journals (including auditors) can open and download returns.

Return statuses:

| Status | Meaning |
|---|---|
| **DRAFT** | Generated; can be sent for submission or replaced by a new version |
| **PENDING SUBMISSION** | Sent for submission; waiting for the second person |
| **SUBMITTED** | Filed and recorded with the filing reference |
| **SUPERSEDED** | A draft replaced by a newer version |

The **Month close** column shows the month's close status (**OPEN**, **PENDING**, **CLOSED**, **REOPEN PENDING**).

### Preview a month

To preview a month that is not closed yet:
1. Open **Finance › Regulatory returns**. Use the arrows beside the year to change year.
2. In **Months of *year***, click **Preview** on the month.
3. The **Preview** card shows the return "Computed now and not stored."

### Generate a return (Finance officer)

To generate a return:
1. On a month whose **Month close** is **CLOSED**, click **Generate** (or **New version** if one exists).
2. Message: "Version *N* generated". The return opens below.

If it is blocked:
- Month not closed: "*Month Year* is not closed. Close the month (Lending › Period close) before generating its return; use the preview meanwhile."
- A version is already waiting: the button is greyed out ("A version is waiting for submission."); the message is "The *Month Year* return is waiting to be submitted; decide it before generating another version."

### Read a return

A return shows:
- A **Currency** selector ("Amounts are never added across currencies.").
- Four tiles: **Principal outstanding** (with loan count), **NBC provision required** (with allowance held), **PAR 30**, and **Ledger** ("Ties to the ledger" or "*N* break(s)").
- **Reconciliation to the ledger**: for each book (**Lending platform**, **Legacy loans**, **Total**) and measure (**Principal outstanding**, **Loss allowance**): **Ledger accounts**, **Loans in the return**, **Ledger at month end**, **Frozen at close** (lending book), **Less: moved to lending** (legacy loans already migrated), **Difference** and **Status** (**Ties** or **Break**).
- **Return tables**, one tab each: **Portfolio**, **Loan classification and provisioning**, **Portfolio at risk** (PAR 1 / 30 / 90), **By product**, **By branch**, **By purpose**, **By borrower type**, **By loan size**, **Restructured loans**, **Disbursed, written off and recovered in the month**, **Largest borrowers** (top 20), **Interest rates against the cap** (rows above the cap are highlighted red), and **Regulatory provision and reserve**.
- Self-checks: "All *N* self-checks passed" or "*N* of *M* self-checks failed" (expand to see each one). One of them is **An impairment policy is approved**: it fails while lending loans are outstanding and no impairment policy is approved, and a return with a failed check cannot be sent for submission.
- Warnings above the tables, including "*N* USD loan(s) graded Loss have reached the write-off floor and are not written off: review them for write-off." Those loans are also in the Home queue **Loss loans due for write-off** for the people who propose write-offs.

**Loan classification and provisioning** has a **Term** column: each class appears once for **Short-term** loans (original term up to 366 days by default: 0–14, 15–30, 31–60, 61–90, 91+ days past due) and once for **Long-term** loans (0–29, 30–89, 90–179, 180–359, 360+), with rates 1%, 3%, 20%, 50% and 100%. A restructured loan still on probation is graded on the days past due it had when restructured (if more) and at least Substandard, as the table's notes explain. A loan is never graded better than the class its impairment policy recorded.

**Regulatory provision and reserve** shows, per currency for the lending platform: **Allowance basis** (CIFRS 9 expected credit loss, NBC provision, or no impairment policy), **NBC provision required**, **Allowance held**, **NBC provision above allowance**, **Reserve required**, **Reserve on the ledger (3200)** and **Difference**. Under an ECL policy the reserve is set at each month-end close (see [chapter 14](14-accounting-and-period-close.md#regulatory-reserve-ecl-policies)); a difference means the books moved after the close was prepared. Under a REGULATORY policy the notes state that the books are **not CIFRS 9 compliant**.

Loan size bands, rate bands and both sets of classes come from **Lending settings** ([chapter 14](14-accounting-and-period-close.md#lending-settings)). The rate cap is your organisation's maximum annual rate.

### Download a return

On an opened (stored) return:
- **CSV**: the whole return as one file (UTF-8, opens correctly in Excel).
- **Excel**: a workbook with one sheet per table.
- **This table as CSV**: only the table on screen.
- **CSV** on the reconciliation card: only the reconciliation.

Previews cannot be downloaded.

### Send for submission (Finance officer)

To send a return for submission:
1. Open the **DRAFT** return.
2. Click **Send for submission** and confirm ("A second person reviews it and submits it to the regulator. The figures cannot change from here on.").
3. Message: "Sent for submission". Status becomes **PENDING SUBMISSION**. Home shows the queue **Regulatory returns to submit** to the reviewers.

If it is blocked: the button is greyed out with "The return does not tie to the ledger; it cannot be submitted." The server message is: "The return does not tie to the ledger or its tables do not add up; it cannot be submitted. Correct the books, reopen and close the month, then generate a new version."

### Submit (Risk / compliance reviewer)

To submit a return:
1. Open the return marked **PENDING SUBMISSION** and click **Review and submit**.
2. Check the reconciliation and tables.
3. File the return with NBC through your usual channel (the platform does not send it to NBC).
4. Enter the **Filing reference** (the regulator's acknowledgement number, e.g. NBC-2026-01-0001) and an optional **Comment**.
5. Click **Submit** ("Return submitted"), or **Send back** to return it to draft ("Return sent back to draft"; give the reason in **Comment**).

The person who sent it for submission cannot submit it: "You cannot approve or complete an action you created or proposed".

A submitted return shows **Submitted by**, **Submitted at**, **Filing reference** and **Content hash** (with a tick if the stored content still matches its hash). If you ever see the red **Integrity** notice "The stored content does not match its hash. Do not file this return; report it.", stop and report it to IT and compliance.

### Correct a return

A return never changes. To correct one:
- **Draft**: fix the books (reopen the month if needed, correct, close again), then click **New version**. The old draft becomes **SUPERSEDED**.
- **Submitted**: generate a new version the same way. It is marked **Amendment** ("This version amends submitted version *N*; file it as an amendment."), and the old one shows **Amended**.

---

## General-ledger export

On **Finance › Ledger & reconciliation**, tab **Exports**, card **General-ledger export**. See [chapter 14](14-accounting-and-period-close.md#export-the-general-ledger-lines-gl-export) for steps. Needs the "view lending journals" permission.

---

## Credit bureau file

Use this to report your lending-platform loans to the credit bureau (for example CBC).

To download the bureau file:
1. Open **Finance › Ledger & reconciliation**, tab **Exports**.
2. In **Credit bureau file**, click **Download bureau file (CSV)**.

The file has one record per loan you may see (active, closed or written off) as at the business date: borrower ID number, names and date of birth, loan reference, product family, currency, dates, original amount, instalment, balance, days past due, classification, a status (**ACTIVE_CURRENT**, **ACTIVE_ARREARS**, **CLOSED_PAID**, **WRITTEN_OFF**) and whether it was restructured. The download is recorded in the audit trail.

You need the "Export loan data" permission (Finance officer, Risk / compliance reviewer).

Note: the platform does not send the file to the bureau. Upload it through the bureau's own channel. Loans in the original module are not included.

---

## Loan-book CSV

To download the lending loan book:
1. Open **Loans › Loan accounts**.
2. Click **Export CSV** (top right).

You need the "Export loan data" permission. Without it the browser shows an error page instead of a file.

For the original module's loans and repayments, use **Export** on **Origination › Loans (original)** and on **Loans › Repayments** (Excel files). See [21 Original loan module](21-original-loan-module.md).

---

## Reports (original module)

Menu: **Finance › Reports**. Page title **Reports & Analytics**. Covers the original loan module only.

Tabs: **Overview**, **Loan Portfolio**, **Collections**, **Borrowers**, **Risk**.

To run a report:
1. Pick a tab.
2. Set filters: the two unlabelled date boxes (first = from, second = to), search ("Search borrower, loan ID..."), **All branches**, **All loan officers**, **All products**, **All statuses**, **All borrowers**, **All risk grades**, **All currencies** (only the filters relevant to the tab appear).
3. Click **Apply Filters** (or **Reset Filters**).
4. Click a column heading to sort; use the pager to move between pages.
5. On every tab except **Overview**, click **Export CSV** or **Export Excel** to download what you filtered.

What each tab shows:
- **Overview**: **Portfolio Outstanding**, **Active Loans**, **Total Borrowers**, **Monthly Collection**, **PAR 30**, **NPL Ratio**; disbursement and collection trends, risk breakdown, recent overdue loans.
- **Loan Portfolio**: outstanding principal, disbursed amount, average rate, **PAR 1**, **PAR 7**, **PAR 30**, NPL amount; by product, branch and status; loan list.
- **Collections**: total, principal, interest, penalty and overdue collected, collection rate, missed repayments; by branch, officer and payment method; repayment list.
- **Borrowers**: totals, new this month, KYC completion, high-risk borrowers; by branch and occupation.
- **Risk**: total exposure, overdue amount, write-off amount, **PAR 1/7/30**, NPL ratio, ageing distribution, top 10 high-risk loans, risk details with a recommended action.

Notes:
- The **Risk** tab needs the original audit-view permission; other finance users see an error on that tab.
- The **All currencies** filter offers USD only.

---

## Performance (original module)

Menu: **Finance › Performance**. Page title **Portfolio Performance**. Read-only. Covers the original loan module only.

It shows **Gross portfolio** (with active loans), **Borrowers**, **Total disbursed**, **Total collected**, **PAR30** and **PAR90** (shown red above 5% and 3%), an ageing bar (**Current**, **1–30 days**, **31–60 days**, **61–90 days**, **90+ days**), and an income statement (**Interest income**, **Penalty income**, **Fee income**, **Provision expense**, **Write-off expense**, **Total income**, **Total expense**, **Net operating income**). "Ledger figures are organisation-wide and are not shown to branch users."

---

## KPI dashboard (original module)

Menu: **Work › KPI dashboard**. Heading **Financial Dashboard**. Covers the original loan module only.

It shows **Outstanding Principal**, **Active Borrowers**, **Active Loans**, **Due Next 7 Days**, a **Cash Flow** chart (**Collections** vs **Disbursements**), **Quick Actions** (**Create New Loan**, **Add Borrower**, **Record Repayment**, **View Reports**) and a **Monthly Summary** for the last 30 days.

Note: some figures on this screen are placeholders, not your data. The "vs last month" changes on the top tiles (+12.5%, +3, +2) and the **Attention Required** count ("4 accounts are overdue…") are fixed text. Do not rely on them; use **Reports** or **Performance** instead.

---

## NBC provisioning for the original module

The original module's loans are graded on the same short- and long-term classes (by start date plus term months). See **Finance › Provisioning** in [chapter 14](14-accounting-and-period-close.md#provisioning-nbc-loan-loss-provisioning-original-module).
