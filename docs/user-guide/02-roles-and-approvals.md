# Roles, permissions and approvals

Who this is for: every staff user who wants to understand why they can or cannot do something — especially approvers, operations makers and checkers, and anyone who meets a refused action. Administrators who grant access should also read [18-tenant-administration.md](18-tenant-administration.md).

---

## 1. How the portal decides whether you may do something

Every action on the lending platform (approving a loan, posting a repayment, changing a product and so on) passes the same checks, in this order. If **any** check fails, the action is refused — there is no override. The portal's explanations name each check by a short code, shown in brackets.

| Order | Check (code shown on screen) | Question asked |
|---|---|---|
| 1 | Identity (**IDENTITY**) | Are you signed in with an active account? |
| 2 | Organisation (**TENANT**) | Does the record belong to your organisation? |
| 3 | Permission (**RBAC**) | Does one of your roles include this permission? |
| 4 | Conditions (**ABAC**) | Is the record in your branch/portfolio scope? Are you independent of the maker (maker-checker)? Is the amount within your approval limit? Did you sign in with your authenticator code (if required)? Do your organisation's own access rules allow it? |
| 5 | Feature switch (**FLAG**) | Is this function switched on for your organisation, product, branch or channel? |
| 6 | Product (**PRODUCT**) | Is the product active for new business? |
| 7 | Workflow state (**WORKFLOW**) | Is the record in a state where this step is allowed (for example, you cannot approve an application that is still a draft)? |

Hiding a button is only a convenience: even if a button is visible, the server repeats all the checks when you click it. Every refusal is written to the audit trail ([19-audit-trail.md](19-audit-trail.md)).

---

## 2. Two kinds of role

You may notice two different role names for yourself:

1. **Account type** — set on **Administration › Team members** (ADMIN, FINANCE, SALES, CX, OPERATOR and similar). It controls the original screens and administration pages (Team members, Settings, Audit log). An ADMIN account also automatically has the **Tenant administrator** lending permissions.
2. **Lending roles** — assigned on **Risk & audit › Access & policy** (the **Assignments** tab). These control everything on the lending platform. The names appear at the bottom of the sidebar.

A new user needs both: an account (so they can sign in) and at least one lending role (so they can work). See [18-tenant-administration.md](18-tenant-administration.md).

---

## 3. The standard lending roles

Every organisation starts with these roles. Administrators can also create custom roles. The **Role matrix** tab of **Access & policy** shows exactly which permissions each role holds.

| Role | What it is for | Can it approve or move money? |
|---|---|---|
| **Tenant administrator** | Manages access (roles, assignments, delegations, approval limits, access rules), feature switches, the policy simulator and the business date; reads the audit trail. | No credit decisions, no money. |
| **Product maker** | Creates products, draft versions and workflows and submits them for approval. | No. |
| **Product checker** | Approves, activates and retires product and workflow versions created by someone else. | Approves configuration only. |
| **Relationship officer** | Creates and edits applications, uploads documents, records collateral, runs solidarity groups, opens restructure requests and records customer acceptances in branch. | No. |
| **Credit analyst** | Assesses applications and records recommendations; reviews documents; assesses and proposes restructures. | No. |
| **Credit approver** | Approves or rejects credit within approval authority; approves restructures, facility limits, tranche-condition waivers, invoices, letters of credit and syndicates. | Yes, within limits. |
| **Loan operations maker** | Books approved applications, prepares disbursements, posts repayments, proposes write-offs, runs end of day, requests drawdowns and limit changes, registers invoices and letters of credit, sets up syndicates. | Prepares money movements. |
| **Loan operations checker** | Approves and executes disbursements, reverses repayments, approves write-offs, executes restructures, approves and releases drawdowns. | Yes. |
| **Collections officer** | Works overdue accounts, posts repayments and recoveries, grants payment holidays under an open programme, opens restructure requests. | Posts money in. |
| **Restructure committee** | Approves restructures with concessions (waivers, rate reductions, principal forgiveness) and negotiated settlements; drafts and opens payment-holiday programmes. | Yes, within limits. |
| **Finance officer** | Accounting and reconciliation, business date, benchmark rates, impairment proposals, lending settings proposals, period close preparation, loan-book migration, regulatory returns, data exports. | Runs end of day. |
| **Risk / compliance reviewer** | Read access across lending, audit trail, simulator; approves impairment policies, lending settings, period closes, migrations and regulatory return submissions; document retention. | Approves finance controls. |
| **Auditor** | Read-only access including the audit trail. | No. |
| **Integration service account** | A template for machine access by other systems (see [18-tenant-administration.md](18-tenant-administration.md), section 6.7). | Repayment posting only. |

### Your scope

A role is given to you for a **scope**: **All branches**, certain branches, certain portfolios, or your own branch. You can only work on borrowers, applications and loans inside that scope. Your scope is shown in the top-bar chip (see [01-getting-started.md](01-getting-started.md), section 9). Outside it you see **Outside your branch or portfolio scope**.

---

## 4. Maker-checker (four-eyes control)

**What it is:** for important steps, the person who prepares something (the **maker**) cannot also approve or complete it. A second, different person (the **checker**) must do that.

**Why:** two people must agree before money moves or controls change. This catches mistakes and makes fraud by one person much harder. Regulators expect it.

Where it applies (examples — the rule is enforced on many more actions):

- Credit approval or rejection — the approver must not be the person who created or recommended the application. A normal application therefore needs at least three people: the officer who creates it, the analyst who recommends, and the approver.
- Disbursements — the person who prepared it cannot approve it.
- Repayment reversals, write-offs, refunds, set-offs, fee waivers, collateral releases.
- Restructure approval and execution.
- Product and policy versions — the maker cannot approve or activate their own version.
- Period close, impairment policy, lending settings, migration posting, regulatory submissions.
- Access changes — role assignments for sensitive roles, delegations, approval limits, access rules and feature switches need a second administrator, and the person receiving the access cannot approve it either.

What you see:

- Your Home queues never show work you made yourself, so you will not be offered it.
- On some screens the **Approve** button is greyed out; hover over it to see the reason, for example "You requested this — a second admin must approve".
- If you try anyway: **You cannot approve or complete an action you created or proposed** (check **ABAC**).

What to do: pass the item to a colleague who holds the checker role.

---

## 5. Approval limits (approval authority)

**What it is:** an approval limit is the largest amount you may approve for one type of action, in one currency. For example: approve credit up to 100,000 USD and up to 400,000,000 KHR.

- Limits are set per **permission** (credit approval, disbursement approval, write-off approval, restructure approval and so on) and per **currency**.
- A limit can apply to all loan families or to one family only (for example only Microfinance).
- A limit can be given to a person or to a role.
- If the amount is in a different currency from your limit, the portal converts it using an approved exchange rate **no older than 3 days**. If there is no such rate, the action is refused — ask finance to record a current rate.
- Your highest limit per currency is shown in the **Limit** chip in the top bar.

Actions that check your approval limit:

| Action | Permission |
|---|---|
| Approve credit (applications, counterparty limits) | credit approval |
| Approve a disbursement; approve a letter-of-credit drawing | disbursement approval |
| Approve a write-off; approve an insurance claim or a debt sale | write-off approval |
| Approve a restructure; approve waivers and rate concessions; approve principal forgiveness | restructure approval / waive charges / forgive principal |
| Negotiated settlement (with or without principal forgiven) | negotiated settlement |
| Approve a drawdown or an invoice advance; approve a facility limit change; issue a letter of credit | drawdown / limit / letter-of-credit approval |

Messages you may see (check **ABAC**):

| Message | What to do |
|---|---|
| **The amount exceeds your approval authority** | Send the item to an approver with a higher limit, or ask for a delegation (section 7). |
| **You have no approval authority for this action** | You hold the role but no limit was set. Ask your administrator to request one for you. |
| **No approval authority** | You do not hold the permission at all. |
| **The amount to approve is unknown** / **The amount to approve is invalid** | The record has no usable amount. Check the record; contact IT if it persists. |

On Home, items above your limit carry **Above your limit**.

Limits are managed on **Access & policy › Approval authorities** ([18-tenant-administration.md](18-tenant-administration.md)); every new limit needs a second administrator's approval.

---

## 6. When you need your authenticator code (MFA step-up)

Some actions need an authenticator code from the **last 15 minutes** (a deployment setting, `AUTH_MFA_STEP_UP_MINUTES`). A password-only session, or one whose last code is older than that, can view everything but cannot do these without a fresh code:

- Approve credit; approve counterparty limits.
- Approve a disbursement or a letter-of-credit drawing.
- Reverse a repayment.
- Approve a write-off, repossession, pawn forfeiture, insurance claim or debt sale.
- Approve a restructure, waivers or principal forgiveness; execute or reverse a restructure.
- Negotiated settlements.
- Approve drawdowns, invoice advances and facility limit changes; waive a tranche condition.
- Issue a letter of credit; approve a syndicate or a syndicate payout.

How you can tell:

- The top-bar chip shows **Password only** (amber) instead of **MFA** (green).
- An amber banner says **Verify with your authenticator to approve.**
- Home tiles and items show **Needs MFA**.
- If you try: a box **Confirm it is you** asks for the six-digit code from your authenticator app. Enter it and the action is retried for you. (The policy check shows **This action requires a recent multi-factor authentication code** under **ABAC**.)

What to do:

1. If you have not set up an authenticator yet, follow [01-getting-started.md](01-getting-started.md), section 4.
2. Enter the current code when asked. Each code works once; if it was just used, wait for the next one.
3. Staying signed in does not keep the code fresh: the session lasts for weeks, the code's freshness only 15 minutes.

---

## 7. Delegations (temporary authority)

**What it is:** a delegation lets one person (the delegator) lend some of their permissions to a colleague for a limited time — for example while on leave. The delegate acts under the delegator's authority.

How it works:

- The delegator chooses the colleague, which permissions (up to 20), the start and end (at most **30 days** by default — your organisation can change this in lending settings), an optional **maximum amount and currency**, and a reason.
- You can only delegate permissions you hold through a role. You cannot delegate to yourself.
- A different administrator must approve it (not the delegator, not the delegate, not the person who entered it). Until then it is **PENDING**.
- The delegate receives the permissions **with the delegator's scope**, and only while the delegator still holds them and is active.
- **Approval limits travel only if a maximum amount and currency are set.** The delegate's limit is then the lower of the delegator's own limit and the cap. A delegation with no amount gives the permission but no approval limit, so approvals will be refused with **You have no approval authority for this action**.
- The delegator or an administrator can **Revoke** it at any time; it stops immediately.
- Maker-checker still applies to the delegate personally.

While a delegation to you is active, a blue banner shows **Acting with authority delegated by … until …** (and **Capped at …** if there is a cap).

To request a delegation: open **Risk & audit › Access & policy**, tab **Delegations**, and fill in **Request delegation** — step by step in [18-tenant-administration.md](18-tenant-administration.md), section 6.3.

Note: the **Access & policy** screen is only available to people who can view access settings (administrators, risk/compliance, auditors). An approver who cannot open it should ask an administrator; however the request is always recorded as coming **from the person who enters it**, so in practice the delegator must be able to open that screen. If this is a problem in your organisation, raise it with your system administrator.

---

## 8. Feature switches (feature flags)

**What they are:** on/off switches that make a function available or not — for the whole organisation, or only for one product, branch, channel, customer segment or pilot group (cohort). They are availability controls, not permissions: a switch can stop something you are allowed to do, but can never let you do something you are not allowed to do.

When a switch is off you see **lending.origination is currently unavailable** (or the name of another switch), check **FLAG**. Ask your administrator or the product team whether the switch should be on.

The main switches:

| Switch | What it controls | Default |
|---|---|---|
| `lending.origination` | New applications, approvals, bookings and disbursements | On |
| `lending.family.<family>.enabled` | New lending in one loan family (Personal, Microfinance, SME, …) | On |
| `lending.servicing` | Repayments, accruals, statements and servicing of existing loans | On |
| `lending.accounting.posting` | Every posting to the ledger. When off, every money operation is refused (never left unposted). | On |
| `lending.restructure.request` / `.simulation` / `.execution` | Restructure requests, simulations and proposals, execution | On |
| `lending.restructure.term_extension`, `.payment_deferral`, `.interest_only`, `.rate_reduction`, `.capitalization`, `.charge_waiver` | Individual restructure options | On |
| `lending.restructure.principal_forgiveness` | Partial principal forgiveness | **Off** |
| `lending.repayment.balloon` | Balloon schedules | On |
| `lending.revolving.drawdown`, `lending.facility.overdraft`, `lending.facility.staged_drawdown`, `lending.collateral.borrowing_base` | Facility types and drawdowns | **Off** |
| `lending.trade.*`, `lending.syndication`, `lending.project_finance`, `lending.institutional`, `lending.islamic.murabaha`, `lending.education.income_contingent` | Specialised products | **Off** |
| `lending.group.joint_liability` | Group lending | **Off** |
| `lending.pricing.floating_rate` | Floating rates and rate resets | **Off** |
| `lending.integration.credit_bureau` | Live credit-bureau enquiries | **Off** |
| `lending.legacy_loans.readonly` | No longer has an effect: the original loan module is retired and read-only whatever the flag says ([21](21-legacy-archive-and-migration.md)) | **On** |

Good to know:

- Switching off new lending (origination) or retiring a product never stops repayments, accruals, statements or servicing of loans already booked.
- Switching off restructure execution never undoes restructures already executed.
- An **emergency-off** set by the platform operator cannot be overridden by your organisation.

Every switch change needs a second administrator. See [18-tenant-administration.md](18-tenant-administration.md), section 6.6.

---

## 9. Other reasons an action is refused

| Message (check) | Meaning | What to do |
|---|---|---|
| **Your roles do not include …** (RBAC) | None of your roles has this permission. | Ask your administrator for the right role, or pass the work to a colleague. |
| **Outside your branch or portfolio scope** (ABAC) | The record belongs to a branch you do not cover. | Pass it to a colleague in that branch, or ask for a wider scope. |
| **The record has no branch scope** (ABAC) | The record has no branch, so nobody with branch-limited scope can act on it. | Someone with **All branches** scope must act, or IT must fix the record. |
| **This record belongs to another organisation** (TENANT) | Wrong organisation. | Check the link you followed. |
| **Your account is not active** (IDENTITY) | Your account is suspended. | Contact your administrator. |
| **The product is not active for new business** (PRODUCT) | The product version is not active. | Ask the product team ([04-products-and-policies.md](04-products-and-policies.md)). |
| **The agreement snapshot is invalid** (PRODUCT) | The loan's stored terms cannot be read. | Contact IT. |
| **Not allowed while the record is DRAFT** (WORKFLOW; the state varies) | This step is not possible in the record's current state. | Complete the earlier step first. |
| A message written by your organisation (ABAC) | One of your organisation's own access rules blocked it (for example "Requires step-up authentication"). | Follow the message, or ask your administrator. |
| **October 2026 is closed; nothing can be posted on 2026-10-15. Ask finance to reopen it.** | The accounting period is locked. | Ask finance; see [14-accounting-and-period-close.md](14-accounting-and-period-close.md). |
| **Platform administrators have no access to tenant lending data or transactions** (TENANT) | You are signed in as the platform operator. | Use a staff account of the organisation. |

**Business date:** postings are dated by your organisation's business date (top-bar chip), not today's calendar date. If the date looks wrong, finance must advance it — see [14-accounting-and-period-close.md](14-accounting-and-period-close.md).

---

## 10. Seeing why you are blocked

The portal shows the reasons in three places:

1. **Greyed-out buttons.** Hover over a disabled button to see the reason (for example "ABAC: The amount exceeds your approval authority").
2. **"Why can't I…" panel.** On an application or a loan account, a panel **Why can't I… (N actions blocked)** lists each blocked action (for example **Approve**, **Book agreement**, **Approve disbursement**, **Reverse repayment**) with the check that blocked it. Click it to open.
3. **Red error box.** If an action is refused after you click, a red box shows the main message and a **Blocked by** list — every check that failed, each with its code (IDENTITY, TENANT, RBAC, ABAC, FLAG, PRODUCT, WORKFLOW). Fix them all, not only the first.

Administrators can test "can this person do this?" without doing it, using the **Policy simulator** ([18-tenant-administration.md](18-tenant-administration.md), section 6.8).
