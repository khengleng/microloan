# Accounting and period close

Who this is for: finance officers, risk / compliance reviewers who approve closes and policies, auditors who read the books, and operations staff who run end of day.

This chapter covers the lending ledger (journal, trial balance and reconciliation), the ledger accounts the platform posts to, end of day and the business date, benchmark rates and holiday calendars, the impairment (loss allowance) policy, the lending settings, month-end and year-end close, the combined ledger, and the original accounting, provisioning and FX screens.

Related chapters: [02 Roles and approvals](02-roles-and-approvals.md), [15 Reports and regulatory returns](15-reports-and-regulatory-returns.md), [16 Loan-book migration](16-loan-book-migration.md), [18 Tenant administration](18-tenant-administration.md), [21 Legacy loan archive and migration](21-legacy-archive-and-migration.md).

## Where things are

All of these screens are in the **Finance** menu section.

| Menu item | What it is for | Who sees it |
|---|---|---|
| **Finance › Ledger & reconciliation** | Lending journal, trial balance, reconciliation, GL and bureau exports | Anyone with the "view lending journals" permission (Finance officer, Risk / compliance, Auditor) |
| **Finance › Period close** | Month-end and year-end close | Finance officer (prepares), Risk / compliance (approves) |
| **Finance › Combined ledger** | One trial balance for both loan books | Anyone who can view lending journals |
| **Finance › End of day & operations** | Business date, end-of-day batch, benchmark rates, holiday calendars, impairment policy, lending settings, integrations | Finance officer, Loan operations maker (batch), Risk / compliance (approvals), Tenant administrator (business date) |
| **Finance › FX rates** | The organisation's exchange rates | Finance / Accountant and administrator account types |
| **Finance › Legacy loan archive** | The retired original loan module's loans, read-only | Finance officer, Risk / compliance, Auditor — while the organisation still has such loans |

You only see a menu item if your role allows it. See [02 Roles and approvals](02-roles-and-approvals.md).

### Key ideas in plain words

- **One loan book, one old journal.** Loans booked on the lending platform (**Loans › Loan accounts**) post to the *lending ledger*. The retired original loan module kept its own *original ledger*; nothing posts to it any more except the clearing entry when a loan is moved by a migration. The **Combined ledger** shows both side by side ([chapter 21](21-legacy-archive-and-migration.md)).
- **Business date.** The platform's accounting date for your organisation. Every posting carries it. It does not follow the wall clock. It moves forward only, either automatically each night or when someone advances it (see [End of day](#end-of-day-and-the-business-date)).
- **Maker-checker (four-eyes).** For close, impairment policy, lending settings, migration and regulatory submission, one person prepares and a *different* person approves. This guards against mistakes and fraud. If you try to approve your own work you see: "You cannot approve or complete an action you created or proposed".
- **Period lock.** Once a month is closed, nothing can be posted with a date in that month (see [What "period locked" means](#what-period-locked-means)).
- None of the actions in this chapter ask for an authenticator (MFA) code. They are controlled by permission and maker-checker.

---

## Ledger & reconciliation

Menu: **Finance › Ledger & reconciliation**. The page title is **Accounting reconciliation**. It has four tabs: **Reconciliation**, **Trial balance**, **Journal**, **Exports**. It opens on **Reconciliation**.

All tabs are read-only. Nothing you do here posts anything.

### Check the reconciliation

Do this every day after end of day, and always before closing a month. The reconciliation compares every loan's balances (principal, interest, fees, penalties and so on) with the matching ledger accounts.

To check the reconciliation:
1. Open **Finance › Ledger & reconciliation**. The **Reconciliation** tab is shown.
2. Read the line at the top: "*N* loan accounts checked" and the time it ran.
3. Click **Re-run** to check again after a correction.

What you see:

| Result | Meaning |
|---|---|
| Green **Reconciled** notice: "Every loan sub-ledger balance matches the general ledger and the trial balance balances." | All good. |
| Red **Reconciliation breaks found** notice | Either "The trial balance does not balance." or "*N* sub-ledger / ledger difference(s) — investigate before closing the day." |

When there are breaks, a **Breaks** table lists each one: **Loan** (click the reference to open the loan), **Check** (which balance differs, for example `principalOutstanding`, `schedulePrincipal`, `facilityDrawn`, `cardBalances`, or `mapping` with "agreement has no accounting mapping"), **Sub-ledger**, **Ledger** (or the unpaid principal per **schedule**), and **Difference**.

If there are breaks: do not close the month. Report each break to your system administrator or IT team with the loan reference. A break means the loan's own balances and the ledger disagree, which should never happen in normal use.

### Read the trial balance

To read the lending trial balance:
1. Open the **Trial balance** tab.
2. One card per currency, titled **Trial balance — USD** (or KHR, and so on). The badge shows **BALANCED** or **UNBALANCED**.
3. Columns: **Code**, **Account**, **Type**, **Debit**, **Credit**, **Balance**, with a **Totals** row.
4. Click **Refresh** to reload.

Amounts are never added across currencies. If there are no postings you see "No lending journal entries yet."

### Look up journal entries

To find journal entries:
1. Open the **Journal** tab.
2. Optionally fill **Loan account id**, **From** and **To**.
3. Click **Apply**.
4. Click a row to expand it and see its lines (**Account**, **Debit**, **Credit**). Click **loan** next to the description to open the loan.

Columns: **Date**, **Description**, **Event** (the event type and its status), **Ccy**, **Total debits**. 100 entries per page.

Note: the **Loan account id** filter needs the loan's internal ID (a long code), not its reference. Open the loan and copy the ID from the browser address bar.

### Export the general-ledger lines (GL export)

Use this to move the lending postings for a period into your core banking or general ledger system.

To download the GL export:
1. Open the **Exports** tab.
2. In **General-ledger export**, choose **From** and **To**.
3. Click **Download GL lines (CSV)**. (Until both dates are valid you see "Choose the period to export.")

The file has one row per journal line: entry date, entry ID, event type, loan reference, account code, currency, debit, credit, description and external reference. The download is recorded in the audit trail.

Note: posting the file into your general ledger is a manual step. An automatic link to an external accounting system is not built yet ("requires integration").

The **Credit bureau file** on the same tab is described in [15 Reports and regulatory returns](15-reports-and-regulatory-returns.md#credit-bureau-file).

---

## Chart of accounts and account mapping

The platform posts to standard ledger account codes (for example 1000 cash, 1200 loans receivable, 1300 loss allowance, 3100 retained earnings, 3200 regulatory reserve, 3900 migration clearing, 4000 interest income, 5000 provision expense). The accounts are created automatically for your organisation.

There are two levels of account mapping:

1. **Per product.** Each product version has an **Accounting** section ("Ledger account codes used when events post journals") listing the accounts its events post to: cash, loans receivable, interest income, write-off expense and so on. This is set by the product maker and approved by the product checker. See [04 Products and policies](04-products-and-policies.md).
2. **Organisation-wide.** Accounts that do not belong to one product (cash, retained earnings, the regulatory reserve, migration clearing, FX position, unidentified receipts suspense, and the accounts the original loan module used) are in the **Lending settings** tab described below.

To see the list of accounts, open **Finance › Ledger & reconciliation** and the **Chart of accounts** tab.

Note: there is no screen to add or rename ledger accounts. Ask your system administrator / IT team. Any code you type in a product or in the lending settings must already exist, otherwise you see "Ledger account *code* is not in the chart of accounts."

---

## End of day and the business date

Menu: **Finance › End of day & operations**. The page title is **Operations**. Tabs: **Business date & end of day**, **Benchmark rates**, **Holiday calendars**, **Impairment policy**, **Lending settings**, **Integrations**.

### What end of day does

The end-of-day batch, for every active loan in your scope, as of the business date:
- collects auto-debits under active mandates (first, so a collected instalment is never late);
- accrues interest and capitalises it where the product says so;
- applies due rate resets on floating-rate loans;
- assesses penalties;
- recomputes days past due, delinquency buckets and collection stages;
- monitors restructured loans and makes system referrals;
- posts each loan's change in loss allowance, once an impairment policy is approved.

Each loan is processed separately, so one failing loan does not stop the others, and running it again only catches up what is left.

### Automatic nightly run

Normally you do not need to do anything. The platform runs end of day automatically every night (by default at 00:15 Phnom Penh time): it moves the business date forward one day at a time up to today and runs the batch after each day. After a downtime it catches up day by day, up to 31 days per run. When end of day finishes the last day of a month with no failures, that month's close is **prepared automatically** and waits for approval (see [Period close](#period-close-month-end-and-year-end)).

Note: your IT team can switch the nightly run off. If the business date shown on Home is behind today, ask them whether it is running.

### Operational alerts

The platform checks your organisation every 10 minutes and shows anything wrong in a box at the top of **Finance › End of day & operations**: **End of day is behind**, **End of day left accounts unprocessed**, **Month end not closed** (10 days into the next month), **Outbox backed up**, **Webhook deliveries backed up**, **Reconciliation breaks** and **Scheduled jobs failed**. Each line says what was found and since when. Red lines are critical: interest, arrears or the books may be wrong until the cause is fixed.

You do not close an alert yourself: it disappears on the next check after the cause is fixed (for example, the next end-of-day run catches up, or the month is closed). The platform operator is e-mailed about every alert; to have your own staff e-mailed as well, add their addresses to the lending setting **operations.alertEmails** (see [Lending settings](#lending-settings)). They get one e-mail when an alert opens, a reminder every 6 hours while it stays open, and one when it is resolved.

### Advance the business date by hand

Use this to catch up when the nightly run is switched off, or in a test or demo environment. You need the "Advance the tenant business date" permission (Finance officer, Tenant administrator).

To advance the business date:
1. Open **Finance › End of day & operations**, tab **Business date & end of day**.
2. Read **Current business date**.
3. In **Advance to**, pick the new date.
4. Leave **Run end of day after advancing** ticked (recommended).
5. Click **Advance date**.
6. Read the confirmation ("Move the business date from … to …? It drives accrual, value-date checks and delinquency for every loan.") and click **Advance & run end of day** (or **Advance date** if you unticked the box).

Rules:
- The date only moves forward. An earlier or equal date is refused: "The business date only moves forward (current *date*)."
- At most 31 days per step: "Advance the business date at most 31 days at a time, running accruals between steps." To move further, advance in steps and run end of day after each.
- If you advance without running the batch, a yellow **End of day not run yet** notice says "Run the servicing batch to accrue interest and assess delinquency for the new date."

Note: the confirmation can say "This is EARLIER than the current date." if you pick an earlier date, but the system will refuse it anyway.

The **Collections** page (**Collections & relief › Collections**) has the same controls in a smaller card, labelled **New business date**, **Set business date** and **Run end-of-day batch**.

### Run the end-of-day batch

You need the "Run accrual and delinquency" permission (Loan operations maker, Finance officer).

To run the batch:
1. On the **Business date & end of day** tab, click **Run end-of-day batch**.
2. Confirm with **Run batch**.
3. Read the **End-of-day result** card: **Business date**, **Loans processed**, **Loans failed**.

If loans failed, a table lists each **Loan** (ID) and the **Error**. Fix the cause (often a data or configuration problem on that loan; ask IT if unclear) and click **Run end-of-day batch** again: only the loans left over are processed. Failed accounts also appear on Home in the queue **End of day: failed accounts**, and a month cannot be closed while the last end of day has failures.

### Benchmark rates

Floating-rate loans re-price from the latest benchmark observation on or before each reset date. You need the "Record benchmark rate observations" permission (Finance officer).

To record a benchmark observation:
1. Open the **Benchmark rates** tab. Use the **All benchmarks** list to filter by benchmark.
2. Click **Add observation**.
3. Fill **Benchmark code** (capital letters, digits and _, 2–20 characters, e.g. SOFR, KHR_REF_3M), **Observation date**, **Rate (%)** (as a percentage, e.g. 5.25; negative allowed) and **Source** (publisher or reference, 2–120 characters).
4. Click **Record observation**.

Observations are history: each benchmark can have one observation per date and it is never edited. A second one for the same date is refused: "An observation for this benchmark and date already exists." The list shows the latest 200 observations, grouped by benchmark.

See [08 Servicing changes](08-servicing-changes.md) for rate resets on a loan.

### Holiday calendars

Holiday calendars mark non-business days. Due dates that fall on them are rolled according to the product. You need the "Advance the tenant business date" permission.

To create or update a calendar:
1. Open the **Holiday calendars** tab and click **New calendar** (or **Edit** on an existing one).
2. Fill **Code** (e.g. KH; cannot be changed later) and **Name**.
3. Tick the **Weekend days** (Sat and Sun by default).
4. Under **Holidays**, enter a **Date** and **Holiday name** and click **Add**. Repeat for each holiday.
5. Click **Create calendar** or **Save calendar**.

Note: saving adds and renames holidays but never removes them. If you delete a row, a warning **Removing holidays is not supported by the API** tells you the date will stay on the calendar. Ask IT to remove a holiday entered by mistake.

### Integrations

The **Integrations** tab shows, for each external capability (**Payments**, **KYC / identity**, **Credit bureau**, **Notifications**, **External accounting**, **Document storage**), the **Adapter**, its **Kind** (**REAL** or **MOCK**) and whether it is **Usable here** (YES / NO). Mock adapters simulate the outside system: no money moves, no identity is checked and no bureau is queried. In production, mocks are refused. See [17 Webhooks and integrations](17-webhooks-and-integrations.md).

---

## Impairment policy (loss allowance)

The impairment policy decides how much loss allowance each lending-platform loan carries. Until a policy is approved, lending loans carry **no** loss allowance, the tab shows **No impairment policy in force**, and **a month with loans outstanding cannot be closed** (the close check **An impairment policy is approved** fails). Once approved, end of day posts each loan's change in allowance (provision expense against the allowance account).

There are two modes:
- **REGULATORY** (the NBC classes): the allowance is the NBC provision — the class rate on outstanding principal, using the classes in **Lending settings**. The classes depend on the loan's **original term** (from disbursement to the maturity first agreed; a restructure does not change it):

  | Class | Short-term loans (up to 1 year) | Long-term loans (over 1 year) | Rate |
  |---|---|---|---|
  | Standard | 0–14 days past due | 0–29 days | 1% |
  | Special mention | 15–30 | 30–89 | 3% |
  | Substandard | 31–60 | 90–179 | 20% |
  | Doubtful | 61–90 | 180–359 | 50% |
  | Loss | 91 or more | 360 or more | 100% |

  These are the defaults (NBC Prakas B7-017-344 as the team recalls it; awaiting compliance sign-off). Books in this mode are **not CIFRS 9 compliant**; the month-end close and the regulatory return say so.
- **ECL** (expected credit loss, CIFRS 9): allowance = PD × LGD × exposure, with the stage set by days past due, non-accrual and restructuring. Class rates are ignored for the allowance, but the NBC provision is still worked out at each month end: where it is higher than the ECL allowance, the difference is held in the **regulatory reserve** (see **Period close** below).

**Restructured loans.** A restructure does not make a loan performing. While the loan is on probation it is classified and provisioned on the days past due it had when it was restructured (if more than today's), and in REGULATORY mode it is at least **Substandard** (the lender's minimum class). Probation ends after the product's number of consecutive on-time revised instalments, but never fewer than the lender's minimum (3 by default); a missed instalment starts the count again. The loan screen shows the class and the explanation on each **Provision** event, e.g. "…held at the minimum class until cured".

Finance proposes, a different person (Risk / compliance) approves.

To propose a policy (Finance officer):
1. Open **Finance › End of day & operations**, tab **Impairment policy**.
2. In **Propose a policy**, click **Start from NBC regulatory** (or **Start from current** when one is in force) or **Start from ECL**.
3. Edit the **Policy (JSON)** box. This is a technical text format; change only the numbers (days and rates) unless you are sure. When a policy is in force, the differences from it are shown under the box.
4. Explain the change in **Why**.
5. Click **Propose**. The message "Policy proposed — a risk reviewer must approve it" appears.

To approve or reject (Risk / compliance reviewer, not the proposer):
1. Open the same tab. Home shows the queue **Impairment policies to approve**.
2. In **Versions**, find the row with status **PENDING**.
3. Click **Approve** or **Reject**. On approval: "Policy in force from the next end of day".

| Status | Meaning |
|---|---|
| PENDING | Proposed, waiting for a second person |
| ACTIVE | In force (shown at the top as **In force: version N**) |
| REJECTED | Turned down; nothing changed |
| RETIRED | Was in force; replaced by a later approved version |

The same statuses apply to **Lending settings** versions.

If it is blocked: an invalid policy is refused with "The impairment policy is not valid." and a list of problems.

Note: this policy covers lending-platform loans. The retired original module has no provisioning any more; its loans are moved to the lending platform with the loan-book migration ([chapter 21](21-legacy-archive-and-migration.md)).

---

## Lending settings

The **Lending settings** tab holds your organisation's own operating parameters:
- regulatory loan classes (days past due and provision rate) for **short-term** and **long-term** loans, and how many days of original term count as short-term (366 by default);
- restructured loans: the lowest class while on probation (Substandard by default) and the fewest consecutive on-time instalments that end probation (3 by default, at least 1);
- the write-off floor: the fewest days past due a loan may be written off at, for short-term and long-term loans (empty = when the loan reaches the Loss class: 91 or 360 days). A product's own minimum can only raise it;
- the regulatory return bands (loan size bands in USD, KHR per USD for those bands, interest-rate bands);
- organisation-wide ledger accounts (cash / bank, retained earnings, the regulatory reserve (3200), migration clearing, FX position, FX gain / loss, unidentified receipts suspense, and the original loan book's accounts);
- payment-file limits (most lines per file, most days back-dated);
- the longest delegation of authority (days);
- after how many days overdue an original-module loan is marked DEFAULTED.
- **Operational alerts: e-mail addresses of the lender’s operations contacts** (`operations.alertEmails`, up to 10, none by default): who in your organisation is e-mailed about your operational alerts, besides the platform operator.

Until a version is approved, the platform defaults apply (**Defaults in force**). The table shows each **Setting**, its **Value** and the **Default**.

To propose a change (Finance officer):
1. Open **Finance › End of day & operations**, tab **Lending settings**.
2. Click **Start from what is in force**.
3. Change the values you need in **Settings (JSON)**. The differences are shown below the box.
4. Explain in **Why**, then click **Propose**. Message: "Settings proposed — a second person must approve them".

To approve (Risk / compliance, not the proposer): in **Versions**, on the **PENDING** row click **Approve** ("Settings in force") or **Reject**.

Rules:
- Account codes must exist in the chart of accounts.
- A changed account applies to new postings only; past postings are not moved.
- The regulatory classes are fixed in number and order (in both sets); their day thresholds must increase.
- A version approved before the long-term classes existed keeps its own classes and rates (including a 25% Substandard rate) until a new version is approved.
- Invalid settings are refused with "The lending settings are not valid." and the list of problems.

See also [18 Tenant administration](18-tenant-administration.md).

---

## Period close (month end and year end)

Menu: **Finance › Period close**. The page title is **Period close**: "Month-end and year-end close of the lending books: checks, a frozen snapshot, and a lock approved by a second person."

Closing a month freezes its figures and locks it so nothing more can be posted into it. Finance prepares the close; a different person (Risk / compliance by default) approves and locks it.

### The page at a glance

- Use the arrows beside the year to move between years.
- Chips show **Business date**, **Last end of day** (red with "*N* failed" if the last run had failures) and **Last closed**.
- A **Next step** banner tells you what needs doing, e.g. "March 2026 has ended and can be closed." Click it to open that month.
- Counters: **Months closed**, **Awaiting approval**, **Ready to close**, **Year end**.
- One tile per month, then a **Year end** tile. Click a tile to open it.

Month statuses:

| Tile label | Status | Meaning |
|---|---|---|
| **No activity** | NO_ACTIVITY | Before your first posting; nothing to close |
| **Not started** | FUTURE | Month not reached yet |
| **In progress** | CURRENT | The business date is in this month |
| **To close** | OPEN | Month has ended and can be prepared |
| **Awaiting approval** | PENDING | Prepared; waiting for a second person |
| **Closed** | CLOSED | Approved and locked |
| **Reopen requested** | REOPEN_PENDING | Still locked; a reopening waits for approval |

### Close checks

Each month shows **Close checks**, each with a green tick (pass), amber warning or red cross (fail). Failed checks have a **Fix** link to the right screen.

| Check | Must pass? | How to fix |
|---|---|---|
| **Business date has reached month end** | Yes | Wait for end of day, or advance the business date |
| **End of day processed every day of the month** | Yes | Run end of day; rerun if accounts failed ("*N* account(s) failed in the last end of day; rerun it.") |
| **Previous month is closed** | Yes | "Months are closed in order; close the previous month first." |
| **Debits equal credits** | Yes | Report to IT |
| **An impairment policy is approved** | Yes, when loans are outstanding | "*N* loan(s) are outstanding but no impairment policy is approved…": approve a policy (**Impairment policy** tab), run end of day, then prepare the close |
| **Regulatory reserve covers the NBC provision** | Warning in REGULATORY mode | ECL mode: shows the NBC provision, the allowance and the reserve per currency, and what the close will appropriate or release. REGULATORY mode: "…the books are not CIFRS 9 compliant." |
| **Sub-ledgers reconcile to the ledger** | Yes | See **Ledger & reconciliation** ("*N* break(s) — see Accounting › Reconciliation.") |
| **No money approvals left waiting** | Warning only | Open disbursement, write-off, refund or set-off approvals will post in a later month |
| **Unidentified payments cleared** | Warning only | Match or refund items in **Collections & relief › Unidentified payments** |

### Regulatory reserve (ECL policies)

When your impairment policy is ECL, preparing a month's close also brings the **regulatory reserve** (account 3200, in equity) to the amount by which the NBC provision exceeds the ECL allowance, per currency. The journal is dated the last day of the month:
- reserve goes up: **Dr 3100 Retained earnings / Cr 3200 Regulatory reserve**;
- reserve goes down: the reverse.

It is not an expense and does not change the loss allowance. Preparing the close again (for example after a rejection) posts nothing more, because the reserve is measured against what the ledger already holds. In REGULATORY mode no reserve is needed and any reserve held is released.

### Month-end snapshot

Below the checks, **Month-end snapshot** shows per currency: **Disbursed**, **Collected**, **Net income**, **Principal outstanding**, **PAR 30**, **Loss allowance**, and an expandable **Trial balance at month end**. Before preparation it says "Live preview — the figures are frozen when the month is prepared." After, it says "Frozen at *time*." The snapshot also keeps each loan's days past due and class, which the regulatory return uses.

### Prepare a month's close (Finance officer)

If the nightly end of day ran, this is already done for you ("Prepared automatically by end of day"; the history shows **End of day (automatic)**). Otherwise:

To prepare a close:
1. Open **Finance › Period close** and click the month tile marked **To close**.
2. Check that every check passes. **Prepare close** is greyed out until they do (hover to see "Fix the failing checks first").
3. Optionally type a **Comment** ("kept in the close history").
4. Click **Prepare close**. If there are warnings you are asked to confirm: "*N* warning(s) will be shown to the approver. Prepare the close anyway?"
5. Message: "*Month* prepared — waiting for approval". The tile becomes **Awaiting approval**.

### Approve and lock (Risk / compliance reviewer)

Home shows the queue **Period closes and reopenings to approve**.

To approve a close:
1. Open the month marked **Awaiting approval**. A note says who prepared it.
2. Review the checks, warnings and snapshot.
3. Optionally type a **Comment**.
4. Click **Approve and lock** and confirm ("Once locked, nothing can be posted on *start* to *end*. The checks are run again before locking.").
5. Message: "*Month* is closed and locked". The tile becomes **Closed**.

To send it back instead, click **Send back** and confirm. The month returns to **To close** so it can be corrected and prepared again.

If it is blocked:
- The person who prepared cannot approve: "You cannot approve or complete an action you created or proposed".
- If something changed since preparation and a check now fails: "*Month Year* no longer passes its close checks."
- Preparing when checks fail: "*Month Year* cannot be closed yet."

### What "period locked" means

A closed month accepts **no posting dated inside it** — repayments, reversals, disbursements, fees, accruals or any journal entry. The system refuses it with:

> *Month Year* is closed; nothing can be posted on *date*. Ask finance to reopen it.

The database refuses it a second time, so there is no way round it. Because postings carry the business date, normal work simply continues in the next month. You only meet this message when you back-date something (for example a repayment value date, or a reversal of an old transaction) into a closed month. A month whose reopening has been requested (**Reopen requested**) is still locked.

The close covers the lending ledger only. The original loan module's ledger is not locked by it (nothing posts to it except migration clearing entries).

### Reopen a closed month

Only the most recent closed month can be reopened, and never once its year is closed.

To request a reopening (Finance officer):
1. Open the **Closed** month and click **Request reopening**.
2. Fill **Why must this month be reopened?** (at least 10 characters).
3. Click **Request reopening**. Message: "Reopening requested — waiting for approval". The month stays locked.

To decide (Risk / compliance, not the requester): open the month marked **Reopen requested** and click **Approve reopening** (confirm with **Reopen**: "Postings dated *start* to *end* will be allowed again until the month is closed again.") or **Keep locked**.

Blocked messages: "Reopen the latest closed month first." · "*Year* is closed; its months cannot be reopened." · "*Month Year* is not closed."

After reopening, make the correction, then prepare and approve the close again. The tile shows "reopened *N*×". If a regulatory return for that month was already generated, generate a new version afterwards (see [chapter 15](15-reports-and-regulatory-returns.md)).

The **History** list at the bottom of a month shows every step: **Prepared for close**, **Approved and locked**, **Sent back**, **Reopening requested**, **Reopened**, **Reopening refused**, with who and when.

### Year-end close and retained earnings

Year end brings every income and expense account to zero and carries the year's result into retained earnings (account 3100 by default; set in **Lending settings**).

To close a year:
1. Click the **Year end** tile. The card **Year-end close *year*** shows **Months closed** (*N* of *M*), the checks and a **Closing journal preview** per currency (**Income**, **Expense**, **Net to retained earnings**, and the accounts brought to zero).
2. Checks: **The year has ended**, **Every month of the year is closed** ("Still open: …"), **Previous year is closed** ("Close *year* first.").
3. Finance officer: click **Prepare year-end close** (greyed out with "Every month must be closed first" until ready). Message: "*year* prepared — waiting for approval".
4. Risk / compliance (a different person): click **Approve and close *year*** and confirm. This posts a balanced closing journal per currency dated 31 December. It cannot be undone. Or click **Send back** ("The year returns to open.").

Once the year is closed, none of its months can be reopened.

---

## Combined ledger

Menu: **Finance › Combined ledger**. It shows one trial balance for both loan books: the original module's journal and the lending journal side by side, on the shared chart of accounts.

To view the combined ledger:
1. Open **Finance › Combined ledger**. It shows balances at the end of the business date.
2. To see another date, pick it in **As of** and click **Show**. Click **Business date** to go back.
3. One card per currency (**USD trial balance**, …) with columns **Legacy loans** (**Debit**, **Credit**), **Lending platform** (**Debit**, **Credit**) and **Combined balance** (shown with Dr or Cr).
4. Badges show whether **Legacy**, **Lending** and **Combined** each balance ("… balances" or "… does not balance").

Loans receivable (1200) and the allowance (1300) are highlighted: these are what the regulatory return reconciles to.

---

## FX rates screen

The original module's **Accounting (original)** and **Provisioning** screens are gone ([chapter 21](21-legacy-archive-and-migration.md)): the original journal's balances are on the **Combined ledger**, and the chart of accounts is a tab of **Ledger & reconciliation**.

### FX rates

Menu: **Finance › FX rates**. Page title **Exchange Rates**.

Rates are history: a new rate never overwrites an old one, and the latest rate effective on or before a date is the one used.

To add a rate (Finance / Accountant or administrator account type; auditors can only view):
1. In **Add Rate**, choose **From** and **To** (USD or KHR; they must differ).
2. Enter **Rate** (units of "To" per one "From", e.g. 4100 for USD to KHR).
3. Optionally set **Effective Date** (today if blank).
4. Click **Add Rate**. Message: "Exchange rate added".

What the rates are used for:
- **Cross-currency approval limits.** When an approver's limit is in one currency and the loan is in another (for example a USD limit and a KHR loan), the amount is converted with this table. The rate must be no more than **3 days old** (by effective date). If no rate exists or it is older, the approval is refused with "The amount exceeds your approval authority". Keep a current USD/KHR rate here every business day if approvers have limits in one currency only. See [02 Roles and approvals](02-roles-and-approvals.md).
- **Converting payments in another currency** into the loan's currency (see [07 Repayments and payments](07-repayments-and-payments.md)). If no rate is found you see "No *X*/*Y* rate is published for *date* … the payment cannot be converted."
- **Reports, Performance and the KPI dashboard** convert other currencies into your organisation's currency for their totals ([chapter 15](15-reports-and-regulatory-returns.md)).

Note: a rate takes effect as soon as it is added. There is no second-person approval for FX rates, although the approval-limit rules call them "approved". Every addition is recorded in the audit log.

---

## Quick troubleshooting

| You see | Why | What to do |
|---|---|---|
| "*Month Year* is closed; nothing can be posted on *date*. Ask finance to reopen it." | The value date is in a closed month | Use a date in the open month, or ask finance to request a reopening |
| "Advance the business date at most 31 days at a time, running accruals between steps." | You tried to jump more than 31 days | Advance in steps of 31 days or less, running end of day each time |
| "The business date only moves forward (current *date*)." | You picked a date that is not later | Pick a later date |
| **Prepare close** greyed out, "Fix the failing checks first" | A required close check failed | Use the **Fix** link on each red check |
| "You cannot approve or complete an action you created or proposed" | Maker-checker | A different person must approve |
| "An observation for this benchmark and date already exists." | Benchmark history cannot be edited | Nothing to do if the rate is right; otherwise ask IT |
| Reconciliation breaks | Loan balances and ledger differ | Do not close; report the loan references to IT |
