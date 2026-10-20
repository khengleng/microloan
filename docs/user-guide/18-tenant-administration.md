# Tenant administration

Who this is for: your organisation's administrators (people with an ADMIN account and the **Tenant administrator** role). Risk / compliance reviewers and auditors can also open the **Access & policy** screen to read it. Finance officers and risk reviewers use the **Lending settings** tab (section 7).

An administrator manages people and access. By design, the Tenant administrator role **cannot approve credit or move money** — it governs who can.

---

## 1. Setting up a new staff member — checklist

A new person needs four things. Do them in this order:

1. **Create their account** — **Administration › Team members** (section 2). This lets them sign in.
2. **Assign their lending role(s) and scope** — **Risk & audit › Access & policy**, tab **Assignments** (section 6.2). Without this, they can sign in but see almost nothing on the lending platform.
3. **Give them an approval limit**, if they approve — tab **Approval authorities** (section 6.4).
4. **Ask them to set up their authenticator**, if they approve, execute or reverse anything — [01-getting-started.md](01-getting-started.md), section 4.

Sensitive roles and all approval limits need a **second administrator** to approve (maker-checker). Plan for two administrators to be available.

## 2. Removing access — checklist

When someone leaves or changes job:

1. **Access & policy › Assignments** — **Revoke** each of their active assignments (section 6.2).
2. **Access & policy › Delegations** — **Revoke** any delegation to or from them (section 6.3).
3. **Administration › Team members** — suspend the account (section 3.4).

Changes take effect on the person's next action; they do not have to sign out.

---

## 3. Team members (Administration › Team members)

The page **Team Members** — "Manage your organization staff and their access roles" — lists everyone in your organisation.

At the top: **Active Seats** (active accounts), **Identity Strength** (the share of people with an authenticator set up, "MFA Adoption Rate") and **Logic Tiers** (how many different account types are in use).

The table shows:

| Column | Meaning |
|---|---|
| **Digital Identity** | Email. **Active Instance** under it means active; **Access Suspended** (and the email struck through) means suspended. |
| **Logic Role** | The account type (ADMIN, FINANCE, SALES, CX, OPERATOR …). This is **not** the lending role — see [02-roles-and-approvals.md](02-roles-and-approvals.md), section 2. |
| **Identity Vault** | A green shield means the person has set up an authenticator; a grey outline means not yet. |
| **Joined Date** | When the account was created. |
| **Governance** | Buttons: key icon = **Reset Password**; person-with-cross icon = **Suspend Access**. |

### 3.1 Adding a team member

1. Click **Onboard Member**. The window **Onboard New Talent** opens.
2. **Email Identifier** — the person's work email. It must not already be used anywhere on the platform.
3. **Temporary Credential** — a starting password. It must be **at least 12 characters** (the box says "Min. 8 characters", but the server refuses fewer than 12 with **Password must be at least 12 characters.**). Give it to the person securely.
4. **Logic Tier Assignment** — the account type: **ADMIN**, **FINANCE**, **SALES**, **CX** or **OPERATOR** ("FINANCE: Logic & Audit · SALES: Origination · CX: Visibility Only"). For lending-platform staff the account type matters only for the original screens; choose **OPERATOR** unless the person also uses the original module or is an administrator.
5. Click **Register and Dispatch**. "… has been invited as …" confirms. (Nothing is emailed — tell the person their email and temporary password yourself.)
6. Now assign their lending role (section 6.2).

If it is blocked: **User already exists** — the email is taken. A message about your plan's limit means your subscription has no free user seats; upgrade the plan under **Settings** (section 4.3) or suspend unused accounts.

Notes:

- New users are placed in **your own branch** (if you have one). There is no field to choose a branch, and there is no screen to create or rename branches — ask your system administrator / IT team.
- Choosing **ADMIN** gives the person full administrator powers, including the Tenant administrator lending role. Use it sparingly.

### 3.2 Changing an account type

Pick a new value in the **Logic Role** drop-down. "Role updated" confirms. ADMIN accounts and suspended accounts cannot be changed here ("Reactivate the account before changing its role").

### 3.3 Resetting a password

1. Click the key icon (**Reset Password**).
2. Type a new password of at least 12 characters in the box and click **OK**.
3. "Password reset for …" confirms. The person is signed out everywhere, any lockout is cleared, and they must use the new password.

Use this when someone is locked out or no reset email arrives. It does not reset their authenticator.

### 3.4 Suspending a member

1. Click the person-with-cross icon (**Suspend Access**).
2. Confirm "Suspend …'s access? They will no longer be able to log in."
3. "… has been suspended" confirms.

You cannot suspend yourself or an ADMIN account from this page. There is no button to reactivate a suspended account — ask your system administrator / IT team.

---

## 4. Settings (Administration › Settings)

The page **Settings** — "Manage your organization configuration and integrations."

### 4.1 Organization and Telegram

- **Organization** › **Organization Name** — your organisation's display name (shown at the top of the sidebar).
- **Telegram Notifications** › **Bot Token** — the token of your organisation's Telegram bot ("Get your token from @BotFather on Telegram."). Once saved it is hidden; type a new one only to replace it.
- Click **Save Changes**. "Settings saved successfully" confirms.

"Changes here apply across all users in your organization. Ensure settings are correct before saving." (**Global Scope** box).

### 4.2 Collection QR

**Collection QR** — static Bakong/bank QR codes shown to borrowers so they can repay. See [07-repayments-and-payments.md](07-repayments-and-payments.md).

### 4.3 Subscription plan

**Subscription Plan** shows your **Current Plan**. To change plan ("Pick a plan and pay with KHQR. Your workspace keeps working while payment is confirmed."):

1. Click **Choose** on the plan you want.
2. Scan the QR code with any Bakong-enabled app and pay the **Amount due**, quoting the **Reference**. Note the **Expires** time.
3. The card shows **Awaiting confirmation. Your new plan applies once the platform team confirms the transfer.** You can **Cancel request** until then.

Only an organisation admin can change the plan. If you see **Plan changes are unavailable — this platform has no payment merchant configured yet. Contact platform support.**, the platform operator has not set up payments yet.

### 4.4 Security Verification

Your own authenticator setup — see [01-getting-started.md](01-getting-started.md), section 4. As an administrator you **must** have one: until it is set up, every page sends you to **My account** ([01-getting-started.md](01-getting-started.md), section 3.1).

### 4.5 What the platform operator did in your organisation

When the platform operator (a platform super-administrator) acts on your organisation — resets a team member's password or authenticator, suspends or reactivates someone, changes your organisation's status or plan, archives it for erasure — the entry appears in your **Audit log** with the badge **Platform operator** as the actor. The operator's own email is not shown; the platform keeps it in its own log.

---

## 5. Who does what in administration

| Task | Where | Who |
|---|---|---|
| Create, suspend, reset accounts | **Administration › Team members** | ADMIN account |
| Organisation name, Telegram, collection QR, plan | **Administration › Settings** | ADMIN account |
| Roles, assignments, delegations, limits, access rules, switches, service accounts | **Risk & audit › Access & policy** | Tenant administrator (two needed for approvals); Risk / compliance and Auditors can read |
| Lending settings | **Finance › End of day & operations**, tab **Lending settings** | Finance officer proposes, Risk / compliance approves |
| Business date | **Finance › End of day & operations** | Finance officer or Tenant administrator ([14-accounting-and-period-close.md](14-accounting-and-period-close.md)) |
| Review what happened | **Risk & audit › Audit trail** and **Audit log** | See [19-audit-trail.md](19-audit-trail.md) |

---

## 6. Access & policy (Risk & audit › Access & policy)

The page **Access & policy** — "Roles, scoped assignments, delegations, approval limits, ABAC policies and feature flags. Every change is maker-checker controlled."

Who can open it: anyone with permission to read access settings (Tenant administrator, Risk / compliance reviewer, Auditor). Only Tenant administrators can make and approve changes. **Refresh** reloads the page.

Tabs: **Role matrix**, **Assignments**, **Delegations**, **Approval authorities**, **ABAC policies**, **Feature flags**, **Service accounts**, **Policy simulator**. An amber number next to a tab name is how many requests are waiting for approval. Your Home page also shows **Access changes to approve** and **Flag changes to approve** queues.

The maker-checker rule on this page: **a request can only be approved by an administrator other than the one who made it** — and, for assignments, authorities and delegations, other than the person receiving the access. Your own pending requests show greyed-out **Approve** / **Reject** buttons with "Awaiting another admin".

Changes take effect on each user's next action. A user's menu updates when they reload the page.

Statuses used on this page:

| Status | Meaning |
|---|---|
| **PENDING** | Requested, waiting for a second administrator. Not in effect. |
| **PENDING APPROVAL** | (Feature-flag rules) proposed, waiting for approval. |
| **SUBMITTED** | (Access policies) new version waiting for approval. |
| **ACTIVE** | In effect. |
| **APPROVED** | (Flag change requests) approved. |
| **REJECTED** | Turned down by the second administrator. Never took effect. |
| **REVOKED** | Withdrawn; no longer in effect. |
| **RETIRED** / **SUPERSEDED** | Replaced by a newer version or rule. |
| **DISABLED** / **EXPIRED** | (Service accounts) switched off / past its expiry date. |

### 6.1 Role matrix

A grid of every permission (rows, grouped by category) against every role (columns). A tick means the role has it. **$** marks a financial permission (moves money or changes a booked record). **SYSTEM** marks a standard role; **SENSITIVE** marks a role whose assignment needs a second administrator. **tenant-only** marks permissions the platform operator can never hold. Hover over a permission for its description.

To create a custom role (for example a branch supervisor):

1. Click **New custom role**.
2. **Code** — capital letters, digits and _ only, starting with a letter, e.g. `BRANCH_SUPERVISOR`. It cannot reuse a standard role's code.
3. **Name** and optional **Description**.
4. Tick the **Permissions** (up to 60). Use **all** / **clear** per category.
5. Click **Create role**. "Role … created" confirms.

Custom roles take effect at once but do nothing until assigned. **A role cannot be edited after it is created** (this stops anyone widening a role that is already assigned without a new approval). To change one, create a new role and move people to it.

### 6.2 Assignments

**Role assignments** lists who holds which role, in what scope (**All branches**, **N branch(es)**, **Own branch**, plus portfolios), with **Status**, **Requested by**, **Approved by** and **Valid to**.

To give someone a role:

1. In **Request role assignment**, choose the **User** and the **Role**. Sensitive roles are marked "(sensitive)" with the hint "Sensitive role — grants financial or administrative powers."
2. Set the scope:
   - Tick **All branches**, or
   - enter **Branch IDs (comma-separated UUIDs)**, and/or **Portfolio IDs (comma-separated UUIDs)**, or
   - leave both empty for the user's own branch.
3. Optionally set **Valid to** (the assignment ends automatically) and a **Reason**.
4. Click **Request assignment**.

What happens next:

- A **non-sensitive** role (one with no money and no approval permissions, e.g. Relationship officer, Credit analyst, Auditor) becomes **ACTIVE** at once.
- A **sensitive** role (any money, any approval permission, or managing access) is **PENDING**: "Assignment requested — awaiting approval by another admin". A second administrator opens **Assignments** and clicks **Approve** or **Reject**.

To remove a role: click **Revoke** on an active assignment, type a **Reason** (at least 3 characters) and click **Revoke assignment**.

Notes:

- Branch and portfolio IDs are long codes (UUIDs). There is no picker and no screen that lists branch IDs; ask your system administrator / IT team for them. Messages: **Unknown branch in scope.**, **Unknown portfolio in scope.**
- A user with no branch whose assignment has no branches can act on nothing that needs scope (they see **Outside your branch or portfolio scope**). Give them **All branches** or explicit branches.
- Holding one role twice in different scopes is allowed.

### 6.3 Delegations

**Delegations** — "Temporary grants of permissions from one user to another (max 30 days)." The list shows **From**, **To**, **Permissions**, **Window**, **Limit**, **Status** and **Reason**. How delegations work is explained in [02-roles-and-approvals.md](02-roles-and-approvals.md), section 7.

To request a delegation of **your own** permissions:

1. In **Request delegation**, choose **Delegate to**.
2. Set **Valid from** and **Valid to** (at most 30 days apart by default — "Delegations may last at most 30 days").
3. If approvals are being delegated, enter **Max amount (optional)** and **Currency (optional)**. Without them the delegate receives no approval limit.
4. Enter a **Reason** (at least 3 characters).
5. Tick the **Permissions (max 20)**.
6. Click **Request delegation**. It is **PENDING**.
7. A different administrator (not you, not the delegate) clicks **Approve** or **Reject**.

**Revoke** (on pending or active rows) stops it at once after you confirm "Revoke the delegation to …? The delegated permissions stop immediately." The delegator can always revoke their own; others need administrator rights.

Messages: **You can only delegate permissions you hold through a role: …** (you tried to delegate a permission you do not hold through an assigned role — note that the automatic administrator permissions of an ADMIN account do not count); **You cannot delegate to yourself.**; **A delegated amount needs a currency.**; **A delegation must end after it starts and last at most 30 days.**

### 6.4 Approval authorities

**Approval authorities** — "Monetary limits up to which a role or user may approve an action." Columns: **Holder** (ROLE or USER), **Permission**, **Max amount**, **Family** (**All** or one family) and **Status**.

To set a limit:

1. In **Request approval authority**, choose **Grant to a role** or **Grant to a user**, then the **Role** or **User**.
2. Choose the **Permission** (financial permissions are listed first).
3. Optionally enter a **Family code (optional)** to restrict the limit to one loan family (for example `MICROFINANCE`).
4. Enter **Currency** (three letters, e.g. `USD`, `KHR`) and **Max amount** (e.g. `50000.00`).
5. Click **Request authority**. It is **PENDING** ("Authority requested — awaiting approval").
6. A second administrator — not the requester and not the user receiving it — clicks **Approve** or **Reject**.

Notes:

- Only permissions that use a limit are accepted; otherwise **That permission does not use approval authority.** See the list in [02-roles-and-approvals.md](02-roles-and-approvals.md), section 5.
- Give a limit in each currency the person approves in. Cross-currency approval works only when finance has recorded an exchange rate in the last 3 days.
- A role limit applies to everyone who holds that role through an assignment.
- There is no button to change or remove an active limit on this screen. To lower a limit, ask your system administrator / IT team.

### 6.5 ABAC policies (your organisation's own access rules)

**ABAC policies** — "Attribute-based rules evaluated on every lending action. New versions require approval by a second admin." These rules can only **restrict** further — they can never grant access. Typical uses: block large disbursements outside office hours, or require something for a product family.

Each policy has versions. A version shows its rules, for example `[large-disbursement-mfa] … — "Requires step-up authentication"`.

To create a policy, or a new version of one:

1. In **Policy editor**, enter **Policy code** (the same code creates a new version of an existing policy), **Name** and optional **Description**. To start from an existing version, click **Load into editor** on it.
2. Click **+ Add rule**. For each rule:
   - **Rule id** — short lower-case name, e.g. `large-disbursement-mfa`.
   - **Effect** — **DENY** ("Block the action when the condition matches") or **REQUIRE** ("Action is only allowed when the condition matches").
   - **Message shown when blocked** — what users will see.
   - **Actions** — pick actions from the list, or type a prefix such as `loan.disbursement.*` and click **Add**.
   - **Condition** — **Match ALL of (AND)** or **ANY of (OR)** the comparisons. Each comparison picks an attribute (for example the record's amount, currency, product, branch, risk category, the user's roles, the sign-in strength, the hour or day of week), an operator (**equals**, **not equals**, **in list**, **not in list**, **>**, **≥**, **<**, **≤**, **exists**, **contains**) and a value. **+ Add comparison** adds more.
3. Check the **Generated rules JSON (read-only)** preview and fix anything listed under **Fix before submitting**.
4. Click **Submit for approval**. The version is **SUBMITTED**.
5. A second administrator reviews it, optionally types a **Decision note (optional)**, and clicks **Approve** (it becomes **ACTIVE** and the previous version is retired) or **Reject**.

Caution: if information a rule needs is missing, a **DENY** rule blocks and a **REQUIRE** rule fails. Test with the **Policy simulator** before approving.

Note: product loan policies (prepayment, late charges, allocation) are a different thing, managed in **Products › Policy library** — see [04-products-and-policies.md](04-products-and-policies.md).

### 6.6 Feature flags

The meaning of each switch is in [02-roles-and-approvals.md](02-roles-and-approvals.md), section 8.

The tab has these parts:

- **Evaluation context** — enter **Product code**, **Branch ID**, **Channel**, **Segment** or **Cohort** and click **Evaluate** to see the switches as they apply in that situation (channel defaults to STAFF_PORTAL). **Clear** resets.
- **Precedence** — the order in which rules are applied; the first matching source wins: unknown switch = off; platform emergency-off; your emergency-off; your most specific rule (cohort, then segment, channel, branch, product, whole organisation); platform rule; default.
- **Feature flags** — each switch with its **State** (**ON** / **OFF**), **Source** (which rule decided), **Scope** and **Default**. **SENSITIVE** marks switches that affect money or regulation.
- **Flag change approvals** — pending changes. A second administrator clicks **Approve** or **Reject**.
- **Tenant rules** — your organisation's rules, with **Scope**, **Sets** (ON/OFF, **EMERGENCY**), **Effective**, **Status** and **Priority**. **Propose removal** asks to remove one (needs a **Reason** and a second administrator).
- **Platform rules** — set by the platform operator; read-only for you.
- **Propose flag rule** and **Cohort membership** — below.

To switch a function on or off:

1. In **Propose flag rule**, choose the **Flag**.
2. Choose **Scope type**: **TENANT** (whole organisation), **PRODUCT** (product code), **BRANCH** (branch ID), **CHANNEL** (BRANCH, STAFF_PORTAL, BORROWER_PORTAL, AGENT, API), **SEGMENT** or **COHORT**; fill **Scope value** unless TENANT.
3. **Set flag** — **ON** or **OFF**.
4. Optional: **Priority (optional)** (0–1000, lower wins among equal rules), **Effective from (optional)**, **Effective to (optional)**.
5. Tick **Emergency rule (cannot be overridden by narrower tenant rules)** only for an emergency stop.
6. Enter a **Reason** and click **Propose rule**. "Flag rule proposed — awaiting approval".
7. A second administrator approves it under **Flag change approvals**. The rule becomes **ACTIVE** and replaces the previous rule for the same switch and scope.

To add someone to a pilot group: in **Cohort membership** enter **Cohort code** (e.g. `PILOT_2026`), **Subject type** (BRANCH, USER or BORROWER), **Subject ID**, **Membership** (**Member** / **Not a member**) and click **Save membership**. This takes effect immediately, without a second approval, and needs the flag-approval permission.

### 6.7 Service accounts

**Service accounts** — "Machine credentials for integrations. Limited to repayment posting and read scopes." Used when another system (for example a core-banking system) posts repayments automatically. See also [17-webhooks-and-integrations.md](17-webhooks-and-integrations.md).

To create one:

1. In **Create service account**, enter a **Name** (e.g. `core-banking-repayments`).
2. Optionally **Expires in days (optional)** — default 90, maximum 365.
3. Tick the **Scopes**: `loan.repayment.post` and/or `loan.read`.
4. Click **Create service account**.
5. An amber panel shows the key: **This key will never be shown again.** Click **Copy**, hand it to your IT team for their secret store, then click **I have stored the key**.

To stop one: click **Disable** and confirm ("Integrations using its key will stop working immediately."). If a key is lost, disable the account and create a new one.

Notes: creating a service account needs the access-approval permission and does **not** need a second administrator. The list shows **Key prefix**, **Expires**, **Last used** and **Created**.

### 6.8 Policy simulator

Answers "can this person do this action on this record, and why?" without doing anything — "Simulation is side-effect free — nothing is changed or audited as an action."

1. Choose the **User** and the **Action** (permission).
2. Choose **Resource type** (APPLICATION, LOAN_ACCOUNT, PRODUCT_VERSION or TENANT) and paste the **Resource ID (optional)** (the record's ID).
3. Optionally choose **Assurance (optional)** (**MFA** or **SINGLE_FACTOR**) to test with or without the authenticator code, and an **Amount (optional)**.
4. Click **Simulate**.

The **Result** shows a large **YES** or **NO**, the question, and **Decision checks** — every check with **pass** / **fail**, its message and detail. **Feature flags evaluated** and **Subject: roles, grants, authorities, cohorts** show the inputs.

---

## 7. Lending settings (Finance › End of day & operations › Lending settings)

Your organisation's own operating parameters: the regulatory loan classes and provision rates, the bands used in regulatory returns, the ledger accounts used at organisation level (cash, retained earnings, suspense, FX and so on), payment-file limits, how far back unidentified receipts may be dated, the **Longest delegation of authority (days)**, and when an original-module loan is marked defaulted.

- Until a version is approved, **Defaults in force** applies.
- A **Finance officer** proposes a complete new version (**Propose a change**, **Start from what is in force**, edit **Settings (JSON)**, **Why**, **Propose**).
- A different person with the settings-approval permission (normally **Risk / compliance reviewer**) clicks **Approve** or **Reject** under **Versions**.
- The Tenant administrator role does not have these permissions.

Two settings concern access rather than accounting:

- **Administrators must use an authenticator** (`security.requireMfaForAdmins`, default **on**). Turning it off lets organisation administrators work without an authenticator. Leave it on unless a regulator or auditor has agreed otherwise.
- **Customers may apply for loans in the Telegram bot** (`telegramBot.allowLoanApplications`, default **off**). When on, a customer whose chat is linked (by sharing their phone number) can apply through the bot. The application is recorded by **Telegram bot**, never under a staff member's name, and is refused if the amount or term is outside the product's limits for the rate offered. It lands as a pending application in the original loan module for a loan officer to review; while the original loan book is read-only it is refused.

One setting decides who hears about problems: **Operational alerts: e-mail addresses** (`operations.alertEmails`, empty by default). The platform checks your organisation every 10 minutes (end of day, month end, outbox and webhooks, reconciliation, failed scheduled jobs); these addresses are e-mailed when an alert opens, every 6 hours while it stays open, and when it resolves. Use a shared mailbox your operations team reads. See [14 Accounting and period close](14-accounting-and-period-close.md#operational-alerts).

Details are in [14-accounting-and-period-close.md](14-accounting-and-period-close.md).
