# Audit trail

Who this is for: auditors, risk and compliance reviewers and administrators who need to find out who did what, when, and why an action was allowed or refused.

The portal keeps two records:

| Screen | Menu | What it records | Who can open it |
|---|---|---|---|
| **Audit explorer** | **Risk & audit › Audit trail** | Every lending-platform action and every access decision (allowed or refused), with the reasons and the configuration in force at the time. | Tenant administrator, Risk / compliance reviewer, Auditor (anyone with the audit-read permission). |
| **Audit Log** | **Risk & audit › Audit log** | Security and account events (sign-ins, failed sign-ins, lockouts, authenticator setup, user creation and suspension, password resets) and changes made in the original module. | ADMIN accounts and accounts with the original "audit view" permission. |

Neither screen lets anyone change or delete entries.

---

## 1. Audit trail (Risk & audit › Audit trail)

The page is titled **Audit explorer** — "Every lending action and policy decision, with the configuration versions in force at the time."

### 1.1 Finding events

1. Open **Risk & audit › Audit trail**.
2. Use any of the filters:
   - **Resource type** — the kind of record, for example **Application**, **LoanAccount**, **ProductVersion**, **RestructureCase**, **WorkflowVersion**, **PolicyVersion**, **AccessRole**, **RoleAssignment**, **Delegation**, **ApprovalAuthority**, **FlagRule**, **PlatformFlagRule**, **Cohort**, **ServiceAccount**, **HolidayCalendar**, **RateObservation**, **AffordabilityPolicy**, **Tenant**. **Any** = all.
   - **Resource id** — the record's ID, to see the full history of one application or loan.
   - **Action contains** — part of the action name, for example `loan.repayment` (all repayment actions), `credit_decision` (credit decisions) or `access_policy` (access changes).
   - **Outcome** — **SUCCESS**, **FAILURE**, **ALLOW** or **DENY**.
3. Click **Search**. **Reset** clears the filters; **↻** reloads.

The list shows the newest events first, 100 per page; use the page buttons at the bottom to move through it.

| Column | Meaning |
|---|---|
| **Time** | When it happened (date and time). |
| **Action** | What was attempted, for example `loan.disbursement.approve`. |
| **Resource** | The kind of record and the start of its ID. |
| **Actor** | Who did it: **USER** (a staff member), **SERVICE** (an integration key), **CUSTOMER** (a borrower in the portal), or **PLATFORM** (the platform operator), followed by the start of their ID. |
| **Outcome** | See below. |

| Outcome | Meaning |
|---|---|
| **SUCCESS** | The action was carried out. |
| **FAILURE** | The action was attempted but failed. |
| **ALLOW** | An access check allowed the action. |
| **DENY** | An access check refused the action. Refused rows are shaded red. |

### 1.2 Looking at one event

Click a row to open it:

- **Policy decision** — for access decisions, the full table of checks (**Layer**, **Check**, **Result** pass/fail, **Message**, **Detail**). This shows exactly why something was allowed or refused — for example a failed `MAKER_CHECKER` or `APPROVAL_AUTHORITY` check. The layers are explained in [02-roles-and-approvals.md](02-roles-and-approvals.md), section 1.
- **Details** — the specifics of the action (amounts, roles, reasons).
- **Configuration versions in force** — which product version, workflow and access-policy versions applied at that moment.
- A footer line with the event ID, actor type and ID, and the **business date** at the time.

### 1.3 Typical questions

| Question | How to answer it |
|---|---|
| Who approved this loan? | Filter **Resource type** = Application and **Resource id** = the application's ID; look for `credit_decision.approve` with **SUCCESS**. |
| Who tried to do something they were not allowed to? | **Outcome** = **DENY**. Your Home page also shows **Refused actions this week** (for information). |
| Who changed someone's access? | **Action contains** `access_policy` (assignments, delegations, approval authorities, service accounts) or `feature_flag` (switch changes and cohorts). |
| What happened to this loan? | **Resource type** = LoanAccount, **Resource id** = the loan's ID. |

Notes:

- The **Actor** column shows only the start of the person's ID, not their name. To identify the person, compare the ID with **Access & policy** (for example the **Requested by** / **Approved by** columns, which show email addresses) or ask your system administrator / IT team.
- You need the record's ID to filter by **Resource id**. Copy it from the address bar when the record is open (the long code at the end of the address).
- There is no export button on this screen. For a copy, ask your system administrator / IT team (data exports are covered in [15-reports-and-regulatory-returns.md](15-reports-and-regulatory-returns.md)).

---

## 2. Audit log (Risk & audit › Audit log)

The page **Audit Log** — "Immutable activity log for compliance and security."

At the top: **Total Events**, **Today**, **Auth Events** (sign-in related) and **Failed Logins** (red when above zero).

### 2.1 Filtering

- Search box **Search by user, entity, action...**
- **All Actions** — or **LOGIN**, **CREATE**, **UPDATE**, **DELETE**.
- **All Types** — or **User**, **Borrower**, **Loan**, **Repayment**, **Document**, **Tenant**, **LoanProduct**.
- A date range (from … to …).

Each line shows the event (for example `LOGIN_FAILED`, `MFA_ENABLED`, `USER_DISABLE`), the record type, the user's email and account type, the time and the record ID. Lines marked **Alert** (red edge) are failures, suspensions and promotions. Click a line to see its details. The list shows 50 events per page (**Previous** / **Next**).

Notes:

- The search box only searches the 50 events on the current page. To search everything, narrow the list first with the type and date filters.
- The action filter matches the action name exactly. Security events have longer names (for example `LOGIN_FAILED`, `MFA_ENABLED`), so choosing **LOGIN** does not show failed sign-ins. Leave **All Actions** selected and use **All Types** = **User** plus the search box instead.
- The "to" date counts from the start of that day. To include a whole day, set the "to" date to the following day.

### 2.2 Exporting

Click **Export CSV** to download the events matching the action, type and date filters (the search box is not applied to the export).

### 2.3 Useful events

| Event | Meaning |
|---|---|
| `LOGIN_FAILED` | A wrong password. Several in a row lead to a lockout. |
| `MFA_SETUP_INITIATED`, `MFA_ENABLED` | Someone started / finished setting up an authenticator. |
| `USER_CREATE`, `USER_DISABLE` | An account was created / suspended on **Team members**. |
| `GOOGLE_LOGIN_UNKNOWN_EMAIL` | Someone tried Google sign-in with an address that has no account. |
