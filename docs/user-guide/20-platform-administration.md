# Platform administration

Who this is for: the platform operator only — the super-admin account that runs the whole portal for every organisation (bank or MFI) on it. Staff of a lending organisation never see these screens; their administrators use [18-tenant-administration.md](18-tenant-administration.md).

---

## 1. What the platform operator can and cannot do

The platform operator **can**:

- Register organisations, change their plan, suspend, reactivate and erase them.
- Confirm or reject plan payments (new sign-ups on a paid plan and plan changes).
- Configure the merchant KHQR used for plan payments, and maintain the subscription plans.
- See and remove an organisation's user accounts ("operators"), and reset passwords.
- Read the security audit log for all organisations.

The platform operator **cannot**:

- Open any organisation's borrowers, applications, loans, documents or ledger.
- Approve, disburse, post or reverse anything for an organisation. Any such attempt is refused with **Platform administrators have no access to tenant lending data or transactions**.
- Act as a checker in an organisation's maker-checker controls.

This separation is deliberate: the operator runs the platform; each organisation's own staff run their lending.

The lending engine also has platform-level functions — maintaining the platform catalogue of loan families and templates, and platform-wide feature-switch rules (including emergency-off). **There is no screen for these yet; ask your system administrator / IT team** (they are available to the IT team through the API). Organisations see platform rules read-only under **Access & policy › Feature flags › Platform rules**.

---

## 2. Signing in and the platform menu

Sign in as described in [01-getting-started.md](01-getting-started.md). The operator lands on **Organisations**. Set up an authenticator on **Settings** straight away ("As SUPERADMIN your account has global access. Enable MFA to protect your credentials."). Google sign-in is never linked to the operator account automatically ("Sign in with your password; this account cannot be linked to Google automatically.").

The menu has two sections:

| Section | Item | Page |
|---|---|---|
| **Platform** | **Home** | Platform work queues |
| | **Organisations** | Register and manage organisations |
| | **Plan payments** | Merchant QR and payments awaiting confirmation |
| | **Subscription plans** | The plans offered at sign-up |
| **Governance** | **Platform team** | User accounts |
| | **Audit log** | Security log for all organisations |
| | **Settings** | Platform settings and your authenticator |

The top bar shows the chip **Platform · all organisations**. The search box finds organisations and plan payments ("Search organisations, plan payments").

### Home

Platform queues: **Organisations pending activation**, **Plan payments to confirm**, and **Suspended organisations** (for information). Click a tile to open the page.

### Operational alerts

The top of **Organisations** shows every open operational alert — the platform's own (the database) and each organisation's (end of day behind or failing, month end not closed, outbox or webhook backlog, reconciliation breaks, failed scheduled jobs) — with its severity, organisation and since when. The platform checks every 10 minutes and e-mails the addresses in the API setting `ALERT_EMAIL_TO` when an alert opens, every 6 hours while it stays open, and when it resolves. If the box says alerts are **not e-mailed**, ask whoever runs the deployment to set `ALERT_EMAIL_TO` (and `RESEND_API_KEY`); see DEPLOYMENT.md → E-mail alerts.

Alerts close themselves when the cause is gone. If the whole platform is down, this page cannot tell you: a separate uptime check run by GitHub every 10 minutes e-mails the same people and opens an issue labelled `uptime` in the code repository.

---

## 3. How a new organisation joins

There are two ways.

### 3.1 The organisation signs itself up

1. The applicant opens the portal's **Create account** link (on the **Sign in** page: "Don't have an account? **Create account**").
2. On **Create your account** they enter **Organization name**, choose a **Plan**, and enter **Admin email** and **Password** (minimum 12 characters) — or use Google — then click **Create account**.
3. What happens next depends on the plan:
   - **Free plan (price 0):** the organisation is **ACTIVE** at once. "Account created … has been registered. Redirecting to login..." The admin can sign in.
   - **Paid plan:** the organisation is created as **PENDING_PAYMENT**. The applicant sees **Almost there** — "Complete payment to activate it." — with a KHQR code showing the amount and a reference. Status on that panel: **Awaiting payment**, **Payment confirmed**, **Payment rejected** or **QR expired**. Nobody in the organisation can sign in until you confirm the payment.
4. You confirm or reject the payment on **Plan payments** (section 5.2).

If no merchant QR is configured, paid plans show **Unavailable** at sign-up ("Paid plans are unavailable — this platform has no payment merchant configured yet.") and only free plans can be chosen.

### 3.2 You register the organisation

1. Open **Organisations** and click **Register New Org**. The window **Provision Isolated Environment** opens.
2. Enter **Entity Branding Name**.
3. Under **Initial Admin User**, enter **Admin Email** and **Admin Password**. Use a strong password of at least 12 characters (this window does not check the length) and hand it over securely.
4. Click **Deploy environment**. "Organization registered with Admin access" confirms.

The organisation is **ACTIVE** immediately. Note: the **Subscription Matrix** plan chosen in this window is not saved when registering — the organisation starts on the default plan. Afterwards, use **Edit Org Logic** (section 4.2) to set the plan.

The first admin then sets up their team ([18-tenant-administration.md](18-tenant-administration.md)). They automatically hold the Tenant administrator role. Because access changes need two administrators, advise every organisation to create a second administrator early.

---

## 4. Organisations

The page **Platform Governance** — "Global oversight of all tenant organizations and distributed assets".

At the top: **Total Orgs** (with **N Active** / **N Suspended**), **Global Users** (with **Total KYC Clients**), **Active Assets** (with **N Total Issued**) and **Platform Flow** (**Gross Recovery**). These are platform-wide totals only.

Below: a search box ("Search global organizations by name, ID or domain..."), status buttons **ALL**, **ACTIVE**, **SUSPENDED**, and **Show Trash** / **Hide Trash** (organisations marked for erasure).

Each organisation card shows its name, status, plan, **Client Base**, **Gross Volume** and **Joined** date. **Marked for Erasure** appears on organisations in the trash.

| Status | Meaning |
|---|---|
| **ACTIVE** | Working normally. |
| **PENDING_PAYMENT** | Signed up on a paid plan; waiting for you to confirm the payment. Nobody can sign in. |
| **SUSPENDED** | Blocked; nobody can sign in. Data is kept. |
| **Marked for Erasure** | Suspended and in the trash, waiting for a final purge. |

Click the three-dot button on a card for these actions:

### 4.1 Edit Org Logic

Opens **Re-Engineer Organization**: change **Entity Branding Name** and the **Subscription Matrix** plan (**FREE**, **BASIC**, **PROFESSIONAL**, **ENTERPRISE**), then **Update Logic Matrix**. Changing the plan here takes effect immediately without a payment — use it for agreed exceptions. (Only these four plan keys are offered here, even if you created other plans on **Subscription plans**.)

### 4.2 Manage Operators

Opens **… Operators** — the organisation's user accounts with email and account type. The bin icon (**Purge Operator**) permanently deletes the account after you confirm. Use this rarely: an organisation normally manages its own staff.

### 4.3 Suspend Instance / Reactivate Data

- **Suspend Instance** (active organisations) blocks every user of the organisation at once. They see **Organization … has been suspended or is pending data erasure. Please contact platform support.**
- **Reactivate Data** (any organisation that is not active) makes it **ACTIVE** again.

Caution: **Reactivate Data** also appears on **PENDING_PAYMENT** organisations and activates them **without** a payment (on the free plan). To activate after payment, use **Plan payments › Confirm** instead.

### 4.4 Request Data Erasure / Purge Environment Permanently

1. **Request Data Erasure** — confirm **Soft-Delete "…"?** ("The organization will be suspended and marked for erasure. You can still reactivate it later or perform a final purge to destroy the data."). The organisation moves to the trash and its **grace period** starts (30 days by default, `TENANT_ERASURE_GRACE_DAYS`).
2. **Purge Environment Permanently** (from **Show Trash**) opens the purge steps for that organisation. A purge is allowed only when **all** of these hold, and each is checked again at the moment of purging:
   - **Grace period over.** Before then, requests and purges are refused with the date it ends.
   - **Archive written.** Click **Archive** first. The platform writes every record of the organisation to one file in document storage (outside the organisation's own folder, so it survives the purge) and shows its **SHA-256** fingerprint and size. Passwords, authenticator secrets and tokens are left out. The archive must be made after the erasure request.
   - **Nothing held or still within retention.** Refused while any customer document is under **legal hold**, while any customer still has an open application or a live loan, or while any customer, loan or document is inside its retention period (customers: the KYC period after the relationship ended — 5 years by default, for AML; loans: the loan-records period after closure — 7 years by default; documents: their own rule). The organisation's own retention rules apply where it set them. The screen lists what blocks the purge and the last date anything must be kept until.
   - **A second super-administrator approved it.** Click **Request purge** (with a reason). Another super-administrator — not you — opens **Purge requests awaiting approval** and clicks **Approve** (or **Reject** with a reason). Requests lapse after 7 days (`PLATFORM_APPROVAL_TTL_DAYS`). If you are the only super-administrator, a purge cannot be requested.
   - Each of these steps needs a recent authenticator code (you may be asked for one).
3. Once approved, **Purge** (typing the organisation's name to confirm) deletes the organisation's stored files (S3 or disk) first and then all its database records. If the files cannot be deleted, nothing is removed and you can try again. The result shows how many files were deleted and the archive's fingerprint. This cannot be undone; the archive and the approval record remain.

An email address belonging to an organisation in the trash cannot be reused until that organisation is purged ("This email is tied to an existing organization … You must permanently PURGE that organization from the "Show Trash" view before you can reuse this email.").

---

## 5. Plan payments

The page **Platform payments** — "Configure the KHQR that signup payment codes are generated from, and approve transfers to activate new workspaces."

### 5.1 Merchant QR

The platform's own Bakong merchant QR, from which each plan's payment code is generated.

- If it is set, a green box shows the merchant name, Bakong account and city, and the source (**uploaded QR** or **environment variables**).
- If not: "No merchant QR configured. Paid plans are unavailable at signup until you upload one — only the FREE plan can be selected."

To set or replace it:

1. Either use **Upload your KHQR (PNG or JPEG)** to choose a screenshot of your Bakong merchant QR ("Any amount on it is ignored — each plan gets its own code with the correct price."), or paste the code into **…or paste the KHQR payload** and click **Read payload**.
2. Check the box **Read from your image/payload** — **Merchant**, **Bakong account**, **City**.
3. Click **Use this QR** (or **Cancel**).

**Plan payment codes** then shows exactly what a customer scans for each paid plan, with the price per month.

### 5.2 Confirming payments

**Awaiting approval** — "New workspaces stay locked until you confirm the transfer landed. Match the reference against your bank statement before confirming." Each line shows the organisation, plan, amount and **ref**.

To confirm:

1. Find the transfer in the bank or Bakong statement with the same reference and amount.
2. Click **Confirm** and confirm **Confirm payment received?** ("This activates … on the … plan.").
3. "… activated on …" confirms. The organisation becomes **ACTIVE** on the paid plan (or, for an existing organisation's plan change, moves to the new plan).

If the money did not arrive, click **Reject** and confirm **Reject this payment?** ("… will stay locked and unable to sign in."). The reason recorded is "Transfer not received".

**No payments waiting.** means the queue is empty. **Refresh** reloads.

---

## 6. Subscription plans

The page **Subscription plans** — "The tiers offered at signup. Prices here set the amount on each KHQR payment code, and the quotas here are what every organization on that plan is held to."

To create a plan:

1. Click **New plan**.
2. **Plan key** — letters, numbers and underscores, e.g. `PROFESSIONAL`. It **cannot be changed later**.
3. **Display name**, **Price / month**, **Currency** (**USD** or **KHR**), **Description** ("Shown on the signup page").
4. Quotas: **Users**, **Borrowers**, **Loan products**, **Loans**. Leave blank for unlimited.
5. Click **Create plan**.

"A price of 0 activates the workspace immediately; anything above 0 puts it behind the KHQR payment gate."

Other actions on the **Plans** list: **Edit** (then **Save**); the up and down arrows (**Move up** / **Move down**) set the order shown at sign-up; **Retire plan** stops offering it to new sign-ups — organisations already on it keep it and its limits; **Re-enable plan**; **Delete plan** ("This cannot be undone. Retiring keeps the plan valid for existing customers — deleting does not."). Prefer retiring to deleting.

When an organisation reaches a quota (for example its user limit), creating more is refused until it upgrades.

---

### 4.5 Your actions appear in the organisation's audit log

Password resets, authenticator resets, suspensions and reactivations of an organisation's users, status and plan changes, and archive and erasure steps are recorded in **that organisation's** audit log, with you as the actor and the badge **Platform operator**, as well as in the platform log.

---

## 7. Platform team

The page **Platform Team** — "Manage your platform operations staff — FinOps, CX, Sales, Marketing".

Caution: for the operator this list shows **every user account on the platform, in every organisation**, not only platform staff. The buttons work as on **Team members** ([18-tenant-administration.md](18-tenant-administration.md), section 3): **Reset Password**, **Suspend Access** (for the operator this permanently deletes the account), and changing the account type.

**Onboard Member** cannot currently create platform staff: accounts other than a super-admin must belong to an organisation, so the request is refused with **Non-SUPERADMIN users must have a tenantId.**

### 7.1 Adding a super-administrator needs a second super-administrator

A new super-administrator — an account created with the SUPERADMIN role, or an existing user promoted — needs a **second** super-administrator's approval:

1. You create the account (it starts **suspended**) or request the promotion. You may be asked for a fresh authenticator code.
2. Another super-administrator opens **Super-admin requests awaiting approval** and clicks **Approve** (or **Reject** with a reason). You cannot approve your own request. Requests lapse after 7 days.
3. On approval the account becomes an active super-administrator, leaves any organisation it belonged to, and is signed out everywhere. The audit entry names the approver as the actor and records who requested it.

If you are the **only** active super-administrator, nobody could approve, so the grant goes ahead on your authenticator code alone; it is recorded with **SUPERADMIN_SOLE_APPROVER** and a warning in the server log. Add a second super-administrator as soon as possible so later grants and purges have a second pair of eyes.

Changing an existing user's role to SUPERADMIN on this page is refused; use the promotion request.

### 7.2 Your own authenticator

Super-administrators must have an authenticator. Until it is set up, every page sends you to **My account** ([01-getting-started.md](01-getting-started.md), section 3.1). Platform approvals (super-administrator grants, purge requests and purges) also need a code from the last 15 minutes.

---

## 8. Settings

The page **Platform Settings & Billing** — "Configure platform-wide defaults. Tenant billing is managed per-tenant from the Organizations page."

- **Platform Identity** shows **Platform Role** SUPERADMIN and **Access Level** **Full Platform Control**, and reminds you that plans are changed per organisation (**Tenant Billing Management**).
- **Platform Management** links: **Manage Organizations**, **Manage Platform Team**.
- **Security Verification** — set up your authenticator ([01-getting-started.md](01-getting-started.md), section 4).

---

## 9. Audit log

**Governance › Audit log** works as described in [19-audit-trail.md](19-audit-trail.md), section 2, but shows events from **all** organisations plus platform events (your own actions, sign-ins to the operator account). The lending **Audit trail** of an organisation is not available to the operator.
