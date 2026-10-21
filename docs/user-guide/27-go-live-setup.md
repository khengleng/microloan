# Go-live setup

Who this is for: the tenant administrators of a lender that is starting on
the portal, and the finance and risk / compliance staff who help them. The
**Go-live setup** page lists everything that must be configured before the
first real loan, in the order you usually do it, and tells you for each
item whether it is **Done**, **To do** or **Blocked** — and why.

Nothing on the page is a tick box. Every time you open it, the portal
checks what is really set up (branches, people, roles, limits, products,
settings, watch lists…) and works the answer out again. When you finish an
item on its own screen, come back and click **Refresh**.

## 1. Opening the page

Click **Administration › Go-live setup** in the menu (Khmer:
**ការរៀបចំដាក់ឱ្យដំណើរការ**), or **Go-live setup** at the top of **Home**.
Tenant administrators, finance officers and risk / compliance reviewers can
open it (permission `tenant_setup.read`); only tenant administrators can mark
an item not applicable (`tenant_setup.manage`).

Until every item is done, tenant administrators also see a blue bar at the
top of every page: "Go-live setup: 41% done (7 of 17 items). Continue
setup". **Later** hides it until you next open the portal in a new browser
tab or window.

The top of the page shows the progress: the percentage of items done (or
marked not applicable), and how many are still to do or blocked. Items that
are only for information (staff training) and items the portal cannot check
yet (static KHQR) are not counted.

## 2. What each status means

| Status | Meaning |
|---|---|
| **Done** | The portal found it set up. |
| **To do** | Not set up yet. The reason says what is missing; **Open** takes you to the screen where you do it. |
| **Blocked** | Waiting for someone else — usually a second person's approval (maker-checker) — or for an earlier item (for example scorecards wait for an active product). |
| **Not applicable** | A tenant administrator marked it so, with a reason (section 4). It counts as done. |
| **Not checked** | The portal cannot check this item yet. |
| **For information** | Shown for your information; not counted. |

## 3. The items

**Organisation**

1. **Organisation details for disclosures** — the legal name, NBC licence
   number, complaint phone, e-mail and address, and the regulator contact
   printed on every key facts statement. Set them in **End of day &
   operations › Lending settings › Consumer protection**; another person
   approves the settings. Until then the statement prints "not configured".

**People and access**

2. **Branches** — at least one active branch (**Access & policy ›
   Branches**, or import a file: section 5).
3. **Staff and roles** — at least two tenant administrators (so one can
   approve the other's access changes), one credit analyst, one credit
   approver, one loan operations maker, one loan operations checker, one
   finance officer and one risk / compliance reviewer, all active. The
   credit analyst and approver, and the loan operations maker and checker,
   must not be the same single person. Create the accounts on **Team
   members** and give the lending roles on **Access & policy ›
   Assignments**; a role that is waiting for a second administrator shows
   as Blocked.
4. **Two-factor sign-in for administrators** — every tenant administrator
   has set up an authenticator (**My account**). The reason lists who has
   not.
5. **Approval limits** — a credit approval limit (`credit_decision.approve`)
   in every currency you lend in (your base currency and the currencies of
   your active products), on **Access & policy › Approval authorities**.

**Business date and exchange rates**

6. **Business date and end of day** — the business date has been set and is
   not behind the calendar date (in the end-of-day time zone shown on the
   item) by more than the allowed lag. If it is behind, run end of day on
   **End of day & operations**.
7. **Exchange rates (KHR / USD)** — only when you lend in more than one
   currency: a published rate between each currency and your base currency
   (**FX rates**). A lender working in one currency is done automatically.

**Accounting**

8. **Chart of accounts and account mapping** — the chart has been opened
   (**Ledger & reconciliation**), and every account the lending settings and
   your active products post to is in it. A missing account shows as
   Blocked with its code.
9. **Opening balances (existing loan book)** — a loan-book migration file
   has been approved and posted (**Loan-book migration**, chapter 16). A new
   lender with no existing loans marks this not applicable.

**Products and credit**

10. **An active product within the rate cap** — at least one product
    version is active, and none of the active ones has a rate above the
    interest-rate cap. Create it from **Catalogue**; a product checker
    approves and activates it (chapter 04).
11. **Impairment policy** — an approved impairment policy (**End of day &
    operations › Impairment**). Without one, no loss allowance is posted and
    month-end close is blocked.
12. **Credit scorecards** — for each product family you lend in, the
    champion scorecard of your active products is one of your own,
    approved and active (**Scorecards**, chapter 24). If you are happy to
    start with the default template, mark this not applicable.

**AML / CFT**

13. **AML watch list** — a sanctions / PEP watch list uploaded and activated
    by a second compliance officer (**AML & compliance**, chapter 26).
14. **AML thresholds and risk weights** — a version of the lending settings
    has been approved (so the cash transaction reporting threshold and the
    customer risk weights have been reviewed), with a threshold for every
    currency you lend in.

**Payments, alerts and switches**

15. **Payment method: static KHQR** — shows **Not checked** for now: the
    portal cannot yet read the lender's static KHQR set-up. Set it up under
    **Payment channels**; you may mark the item not applicable.
16. **Operations alert e-mails** — at least one address in the lending
    settings (operations alert e-mails, **End of day & operations ›
    Lending settings**) to be told when end of day,
    month end or payments need attention.
17. **Feature switches for your products** — new business is switched on
    for every family and capability your active products use (**Access &
    policy › Feature flags**). The reason names any switch that is off.

**Training**

18. **Staff training (Learning centre)** — how many of the lessons on your
    staff's role paths they have completed (chapter 25). For information
    only.

## 4. Marking an item not applicable

Some items do not apply to every lender: exchange rates, opening balances,
scorecards (accepting the default template), static KHQR and alert
e-mails. A tenant administrator clicks **Not applicable…**, writes why (at
least 5 characters) and clicks **Save**. The item then shows **Not
applicable** with the reason and the date, and counts as done. **Count it
again** removes the mark. Both are recorded in the audit trail
(`tenant_setup.not_applicable`, `tenant_setup.applicable`).

The other items cannot be marked not applicable: every lender needs them.

## 5. Importing staff and branches

At the bottom of the page, tenant administrators can import CSV files.

**Branches** — columns `name,code`. Click **Download template**, fill it
in, then **Choose CSV file**. Each line is checked (name 2–80 characters,
code 2–12 of A–Z, 0–9, - or _, not already used) and shown with **OK** or
the problem. **Create branches** creates the lines marked OK, one by one,
exactly as **Access & policy › Branches** would.

**Staff** — columns `email,name,roles,branch`:

- `roles`: lending role codes separated by `;`, for example
  `CREDIT_ANALYST;CREDIT_APPROVER`.
- `branch`: the branch code or name; empty for all branches.

Each line is checked (valid and unused e-mail, a name, known roles, an
active branch). **Create accounts** then, for each line marked OK:

1. creates the account as on **Team members**, with a temporary password
   and the staff role that matches the lending roles (administrator for
   TENANT_ADMIN, finance for FINANCE_OFFICER, otherwise operator);
2. requests each lending role as on **Access & policy › Assignments**,
   scoped to the branch. Sensitive roles wait for a second administrator
   to approve them, as always.

When it finishes, **Download sign-in sheet (CSV)** — the temporary
passwords are not shown again. Give each person theirs privately and ask
them to change it under **My account** and set up their authenticator. The
`name` column only appears on the sign-in sheet: the portal identifies
staff by e-mail.

## 6. For the platform operator

On **Organisations**, each organisation's card shows its go-live setup
percentage and how many items are still open. The platform operator sees
only the counts, not the organisation's data.
