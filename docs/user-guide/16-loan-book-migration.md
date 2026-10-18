# Loan-book migration

Who this is for: finance officers who load and check a loan book taken over from another system (or from the original loan module), and the risk / compliance reviewers who approve posting it.

Migration moves **running loans** onto the lending platform as at a **cut-over date**. You load a CSV file with one row per loan; the platform checks every row, rebuilds each remaining schedule, and compares the totals with the old system's own closing report. Nothing is posted until a second person approves. Once posted, the loans are serviced on the platform like any other loan: repayments, end of day, collections, statements.

Related chapters: [14 Accounting and period close](14-accounting-and-period-close.md), [21 Original loan module](21-original-loan-module.md), [04 Products and policies](04-products-and-policies.md), [02 Roles and approvals](02-roles-and-approvals.md).

## Before you start

- **Permissions.** Loading and checking a file needs "Load and check a loan book taken over from another system" (Finance officer). Approving the posting needs "Approve posting a migration file loaded by someone else" (Risk / compliance reviewer). The approver must be a different person from the one who loaded the file (maker-checker).
- **Products.** Each loan must name a product with an **active** version that is a fixed-rate term loan for individuals. Create and activate it first ([chapter 04](04-products-and-policies.md)).
- **Branches.** If your organisation has several branches, each row needs a branch code that exists.
- **Business date.** Opening balances are posted on the cut-over date, and approval is only possible when the business date **equals** the cut-over date. Plan the cut-over with whoever runs end of day ([chapter 14](14-accounting-and-period-close.md#end-of-day-and-the-business-date)).
- **Control totals.** Get the old system's closing report: number of loans and total principal outstanding per currency.
- **Period lock.** The cut-over date must not be in a closed month.

What cannot be migrated by file: facilities (credit lines, overdrafts), cards, group (solidarity) loans, floating-rate loans, balloon loans and loans with explicitly dated schedules. Book those directly on the platform, or migrate them as ordinary instalment loans with a fixed-rate product.

## The page

Menu: **Finance › Loan-book migration**. Page title **Loan-book migration**: "Take over running loans from another system: load, check against control totals, approve by a second person, post opening balances."

The page has three parts:
- **Load a migration file** — three steps: **1 · File**, **2 · Cut-over date**, **3 · Control totals**.
- **Files** — every file loaded, with **File**, **Cut-over**, **Loans**, **Errors**, **Posted**, **Status**. Click a row to open it.
- The selected file's detail, with its readiness checks, totals per currency, the rows and the approval buttons.

## Prepare the CSV file

To get the template:
1. In **1 · File**, click **Download the template**. You get `loan-migration-template.csv` with the header row and one example loan.

The file has a header row naming the columns (any order), then one row per loan. Up to 10,000 loans per file; split larger books.

| Column | Required | Meaning |
|---|---|---|
| `external_loan_id` | Yes | The loan's number in the old system. Must be unique; a loan already migrated is refused. |
| `customer_id` | Yes | The customer's number in the old system. Several loans of one customer share it. |
| `first_name`, `last_name` | Yes | Customer name |
| `id_number` | No | National ID. If it matches an existing customer, the loan is linked to that customer (with a warning). |
| `phone`, `date_of_birth` | No | Customer details (date as YYYY-MM-DD) |
| `branch_code` | When you have several branches | Branch code on the platform |
| `product_code` | Yes | Platform product code to service the loan under |
| `currency` | Yes | 3-letter code, e.g. USD or KHR; must match the product |
| `original_principal` | Yes | Amount first lent |
| `disbursement_date` | Yes | Not after the cut-over date |
| `annual_rate_pct` | No | Contract rate in % a year (e.g. 18). Blank: the product's rate. |
| `principal_outstanding` | Yes | Principal still owed at cut-over; above 0 and not above the original principal |
| `next_due_date` | Yes | First due date **after** the cut-over date |
| `remaining_instalments` | Yes | Instalments left (at least 1) |
| `current_period_start` | For non-monthly loans | Start of the current repayment period (the previous due date) |
| `interest_accrued` | No | Interest the old system had accrued in the current period; compared with the contract (see below) |
| `overdue_principal`, `overdue_interest`, `overdue_fees`, `overdue_penalties` | No | Amounts overdue at cut-over. Overdue principal must be less than principal outstanding. |
| `oldest_overdue_date` | When anything is overdue | Due date of the oldest unpaid amount, so days past due carry on |
| `non_accrual` | No | Y if the loan is on non-accrual; its interest goes to suspense |
| `allowance` | No | Loss allowance held by the old system |
| `monthly_income` | No | Customer's monthly income |

Amounts: digits with up to 4 decimals, no thousands separators. Dates: YYYY-MM-DD.

### Moving loans from the original module

If the loans are in the platform's own original module (**Origination › Loans (original)**), you do not need to build the file by hand.

To export the original module's loans as a migration file:
1. In **1 · File**, find the box **Moving loans from the legacy module?**
2. Type the platform product code the loans should be serviced under in **Product code to use**.
3. Click **Export as a file**. You get `legacy-loans-migration.csv`.

The file contains every original-module loan with status DISBURSED or DEFAULTED that still has instalments after the business date, as at the business date. Their external IDs start with `LEGACY-`. Defaulted loans are marked non-accrual. Loans with nothing left to fall due are left out: settle or restructure them in the original module first.

Review the file, then load it like any other (below). When such a loan is posted, it is **closed in the original module** and its principal there (account 1200) is moved to migration clearing (3900) in the original ledger, so the combined books hold it once.

To stop new business in the original module after migration, an administrator can turn on the feature flag `lending.legacy_loans.readonly` (proposed by one administrator, approved by another, in **Risk & audit › Access & policy**). The original module then refuses new loans and disbursements while repayments and other servicing of existing loans continue. See [21 Original loan module](21-original-loan-module.md).

## Load and check a file (Finance officer)

To load a file:
1. **1 · File**: drop the CSV on the box, or click **Drop the CSV here or click to choose**. The box shows the file name and the number of loans.
2. **2 · Cut-over date**: set **Balances as at** (defaults to today's business date).
3. **3 · Control totals**: click **Add a currency** for each currency and enter the currency, **Loans** and **Principal** from the old system's closing report.
4. Click **Check the file**.

"Every row is checked against products, branches and customers, and each schedule is rebuilt. Nothing is posted." The new file opens below with status **VALIDATED**.

What is checked:
- the header (missing or repeated columns, duplicate loan IDs, a file with no loans);
- every field's format and the rules in the table above;
- the product (exists, has an active version, is a fixed-rate term loan for individuals, its holiday calendar exists);
- the branch and the customer;
- loans already migrated in an earlier file;
- the remaining schedule, rebuilt by the platform from the current period to maturity;
- the control totals per currency against the valid rows;
- the cut-over date is not before the business date.

## Read the result

**Readiness checks** (all must be green before posting):

| Check | What it means |
|---|---|
| **Every row is valid** | No row has errors. Otherwise "*N* row(s) have errors; fix them in the source and load the file again." |
| **File and control totals agree** | No file problems, and the totals match where given. Otherwise, e.g. "Control totals for USD do not match: the old system reports … the valid rows give …" |
| **Business date is the cut-over date** | Otherwise "Business date *date*, cut-over *date*. Opening balances are posted on the cut-over date." |

**Totals per currency**: loans, **Principal**, **Interest**, **Fees + penalties**, **Loss allowance**, **Accrual difference** (contract accrual less the old system's accrued interest), and how many are in arrears.

**Rows**: filter with **All**, **Errors**, **Warnings**, **Posted**, **Failed**. Columns: **Line**, **Loan** (old ID; after posting, a link to the new loan), **Customer**, **Product**, **Outstanding**, **DPD**, **Status**, **Notes**. Notes show errors in red, warnings in amber, or the rebuilt schedule ("*N* instalments of *amount* to *date*"). Click **Issues as CSV** to download all errors and warnings.

Row statuses:

| Status | Meaning |
|---|---|
| **VALID** | Ready to post |
| **WARNING** | Ready to post, but read the warning |
| **ERROR** | Cannot post; fix in the source and load a new file |
| **POSTED** | Opened on the platform |
| **FAILED** | Posting this row failed; approving again retries it |

Common warnings (they do not block posting):
- "Accrued interest per the old system is *X*; the contract gives *Y* for *start* to *cut-over* (difference *Z*). The contract figure is booked." — differences are reported, never silently absorbed.
- "ID number matches existing customer *name*; the loan will be linked to them."
- "Outside today's product limits (…); migrated as it stands."
- "The schedule has *N* instalments, not *M*."

Common errors: "is required", "is not an amount (digits, up to 4 decimals, no thousands separators)", "is not a date (YYYY-MM-DD)", "must be after the cut-over date *date*; anything due by then is overdue", "is required when anything is overdue", "was already migrated in an earlier file", "No product with code *X*.", "Product *X* has no active version.", "Product *X* is floating-rate; migrate it with a fixed-rate product."

If a file has errors, correct the source data and load a new file. Click **Cancel file** to set the old one aside (only before anything is posted).

## Approve and post (Risk / compliance reviewer)

Home shows the queue **Migration files to approve**.

To approve a file:
1. Open **Finance › Loan-book migration** and click the file.
2. Check the readiness checks, totals, warnings and accrual differences against the old system's report.
3. Click **Approve and post**. It is greyed out until every readiness check passes ("Every readiness check must pass").
4. Read the confirmation ("This opens *N* loan(s) (…) with their balances as at *cut-over*, against migration clearing (3900). It cannot be undone from here.") and click **Approve and post**.
5. Message: "*N* loan(s) posted".

To reject a file instead, click **Reject** and confirm ("The file is set aside; load a corrected one.").

What posting does, for each loan, in its own transaction:
- creates (or links) the customer, an application and an agreement marked as migrated, and the loan account;
- creates the remaining schedule, plus one arrears line holding everything overdue, due on the oldest overdue date, so days past due carry on from the old system;
- posts an opening journal on the cut-over date: principal, interest (contract accrual plus overdue interest), fees, penalties and allowance, against **migration clearing (3900)**; non-accrual loans put their interest in suspense;
- records the accrual already earned, so end of day only accrues what follows.

If it is blocked:
- The loader tries to approve: "You cannot approve or complete an action you created or proposed".
- Readiness fails: "This file is not ready to post."
- Two people approve at once: "This file is already being posted."

File statuses:

| Status | Meaning |
|---|---|
| **VALIDATED** | Loaded and checked; waiting for approval (may still have errors) |
| **POSTING** | Being posted now |
| **POSTED** | Every valid loan posted |
| **PARTIALLY POSTED** | Some rows failed. "Look at the failed rows; approving again posts only those." |
| **REJECTED** | Turned down by the approver |
| **CANCELLED** | Set aside by the loader before posting |

## After posting: verify and cut over

1. Open **Finance › Ledger & reconciliation**. The **Reconciliation** tab should show **Reconciled** (no breaks). The posted-file notice links there.
2. Check that the balance of migration clearing (3900) on the **Trial balance** tab equals the old system's net loan balances.
3. In your general ledger, clear 3900 against the balances transferred out of the old system. For original-module loans, the platform does this in the original ledger automatically; check **Finance › Combined ledger**.
4. Open a few migrated loans from the **Loan** links and compare the schedule, days past due and balances with the old system.

From then on, servicing continues on the platform: post repayments, run end of day, collect, restructure and report as for any other loan. The migrated loans appear in the regulatory return under the lending platform; original-module loans already moved appear once, as a reconciling item on the legacy line ("Less: moved to lending") until cleared against 3900.

## Quick troubleshooting

| You see | Why | What to do |
|---|---|---|
| **Approve and post** greyed out | A readiness check is red | Fix errors and reload, correct the control totals, or wait until the business date equals the cut-over date |
| "The cut-over date *X* is before the business date *Y*; postings are dated on the cut-over date, which has passed." | Cut-over date already passed | Load the file again with a cut-over date on or after the business date |
| "A file holds at most 10000 loans; split it." | File too large | Split into several files |
| "Control totals for USD do not match …" | The file and the old system's report disagree | Find the missing or extra loans; correct and reload |
| "is used for a different name or ID number elsewhere in the file" (customer_id) | One customer number used for two different people | Correct the customer numbers |
| "*Month Year* is closed; nothing can be posted on *date*. …" | Cut-over date is in a closed month | Use a date in an open month |
