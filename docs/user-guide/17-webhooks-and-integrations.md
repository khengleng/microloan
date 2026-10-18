# Webhooks and integrations

Who this is for: tenant administrators who connect the lending platform to the organisation's other systems (core banking, accounting, messaging), and IT staff who support them. Risk, compliance and audit staff can use it to see what is connected and what is not.

This chapter explains:

1. **Webhooks**: how the platform sends lending events (disbursements, repayments, closures and so on) to your own systems.
2. **Service accounts**: how an outside system can post repayments and payment files into the platform.
3. **External integrations**: which outside services (payment rails, KYC, credit bureau, notifications, document storage, external accounting) are really connected today, and what that means for your products.

---

## 1. Webhooks

### What a webhook is

A webhook is an automatic message. Each time something important happens in the lending platform (for example, a loan is paid out), the platform sends a short message to a web address that your IT team provides. That address is called an **endpoint**. Your core banking system, accounting system or messaging tool can then react, for example by updating a customer's balance or sending an SMS.

Each message is signed with a secret code so that the receiving system can be sure the message really came from the platform and was not changed on the way.

### Who can do what

| Task | Who | Why |
|---|---|---|
| See the **Webhooks** page | Anyone allowed to read access policy (tenant administrators, risk and compliance reviewers, auditors) | Oversight. |
| Register an endpoint, send a test, rotate the secret, switch an endpoint off or back on, retry a failed delivery | Tenant administrator (permission to manage access policy) | Day-to-day administration. |
| **Activate** or **Reject** a new endpoint | A **different** tenant administrator (permission to approve access policy) | Maker-checker: an endpoint sends customer and loan data outside the platform, so a second person must agree. |

If you are not allowed to do something, the button is greyed out; hover over it to see why. The person who registered an endpoint cannot activate it. The message is:

> You cannot approve or complete an action you created or proposed

### Open the Webhooks page

Go to **Finance › Webhooks**. The page is titled **Webhooks** ("Send this organisation's lending events to its own systems — signed, retried, and activated by a second administrator."). It has two cards: **Endpoints** and **Receiving events**.

### Endpoint statuses

| Status | Meaning |
|---|---|
| **PENDING APPROVAL** | Registered, waiting for a second administrator to **Activate** or **Reject** it. Nothing is sent yet. |
| **ACTIVE** | Events are being sent. |
| **DISABLED** | Nothing is sent. The reason is shown under the address, for example "Not approved", "Switched off by ..." or "Switched off after 50 failed deliveries in a row". |

### Register an endpoint (first administrator)

Before you start, get from your IT team: the endpoint web address, and the list of events their system needs.

1. On **Finance › Webhooks**, in the **Endpoints** card, click **Add endpoint**.
2. Enter the **Endpoint URL**. It must start with `https://` and be reachable on the public internet (for example `https://core.example.com/hooks/lending`).
3. Enter a **Description** (for example "Core banking" or "Accounting").
4. Under **Events**, tick the events to send (see the table below), or tick **All events**, including ones added later.
5. Click **Register endpoint**.
6. A yellow box appears: **Copy the signing secret now — it will not be shown again.** Click **Copy**, give the secret to your IT team through a secure channel (never by ordinary email or chat), then click **I have stored it**.

What happens next: the endpoint appears with status **PENDING APPROVAL**. Ask a second administrator to activate it.

Only the first few characters of the secret are shown afterwards ("secret whsec_...") so that you can tell secrets apart. If the secret is lost, use **Rotate secret** (below).

If it is blocked:

| Message | What it means |
|---|---|
| "Webhook endpoints must use HTTPS." | The address must start with `https://`. |
| "The endpoint is not a valid URL." | Check the address for typing errors. |
| "Webhook endpoints must be on the public internet." | The address points to a private or internal network. See "Why internal addresses are refused" below. |
| "*host* does not resolve." | The web address name does not exist. Check it with your IT team. |
| "Put credentials in the signing secret, not the URL." | The address contains a user name or password. Remove it; the signing secret is the security. |
| "Choose at least one event." | Tick at least one event. |

### Events you can send

| Event | Sent when |
|---|---|
| `lending.disbursed` | A loan was paid out. |
| `lending.repayment` | A repayment was posted. |
| `lending.settled` | A loan was settled early. |
| `lending.loan_closed` | A loan was repaid in full and closed. |
| `lending.payment_returned` | A repayment bounced or was returned. |
| `lending.restructured` | A loan was restructured. |
| `lending.collection.notice` | An arrears SMS or notice was raised by the collections ladder. |
| `lending.auto_debit.failed` | A direct debit was refused by the bank. |
| `lending.guarantor.demand` | A guarantor was called to pay. |
| `lending.covenant.breached` | A covenant test failed. |
| `lending.period.ready_for_approval` | A month-end close is waiting for approval. |
| `lending.loan_sold` | A loan was sold. |
| `lending.repossession_sold` | Repossessed collateral was sold. |
| `lending.trade.lc_issued` | A letter of credit was issued. |

A separate test event (`webhook.ping`) is used by **Send test**.

Note: Only events that happen while the endpoint is **ACTIVE** are sent. Events from before activation are not sent later.

### Activate or reject an endpoint (second administrator)

1. On **Finance › Webhooks**, find the endpoint with status **PENDING APPROVAL**.
2. Check the address, description and events with the person who registered it.
3. Click **Activate** to start sending, or **Reject** to refuse it.

What happens next: an activated endpoint becomes **ACTIVE**. A rejected one becomes **DISABLED** with the reason "Not approved". The address is checked again at activation.

If it is blocked: "This endpoint is not waiting for approval." means someone else has already acted. Reload the page.

### Send a test event

Use this after activation to confirm the receiving system works.

1. On an **ACTIVE** endpoint, click **Send test**.
2. You see "Test event delivered", or "Test event failed — see deliveries".

Only an active endpoint can be tested ("Only an active endpoint can be tested.").

### Read the endpoint summary

Under each endpoint you see:

- the description, number of events (or "All events"), secret prefix and when it last delivered successfully;
- "*N* sent this week", and if relevant "*N* retrying", "*N* failed" and "*N* failures in a row".

### Delivery log and retries

1. Click **Deliveries** on an endpoint (click **Hide deliveries** to close it).
2. Each row shows the **Event**, **Status**, **Attempts**, **Response** (the code the receiving system answered, any error, and how long it took) and **When**.

| Delivery status | Meaning |
|---|---|
| **PENDING** | Waiting to be sent, or waiting to retry. Under **When** you see "next try ..." |
| **SENT** | The receiving system accepted it. |
| **FAILED** | All automatic retries were used up. |

How retries work, in simple terms:

- The receiving system must answer "OK" within 10 seconds.
- If it does not, the platform tries again, waiting a little longer each time, for about a day (up to 15 attempts by default). Then the delivery is marked **FAILED**.
- If an endpoint fails 50 times in a row, the platform switches it off automatically ("Switched off after 50 failed deliveries in a row").

To resend a failed delivery: click **Retry** on the **FAILED** row. It goes back to **PENDING** and is sent again. Only a failed delivery can be retried.

Note: The number of attempts, the time limit and the switch-off threshold are platform settings; your IT team may have changed them from the defaults above.

### Rotate the signing secret

Do this if the secret may have been seen by someone who should not have it, or on a regular schedule.

1. Agree a time with your IT team; they must update their system at the same moment.
2. On an **ACTIVE** endpoint, click **Rotate secret**.
3. Confirm **Rotate the signing secret** ("Deliveries are signed with the new secret immediately; update your receiver first or deliveries will be rejected.").
4. Copy the new secret from the yellow box and pass it on securely, then click **I have stored it**.

### Switch an endpoint off, and back on

1. To stop sending, click **Switch off** on an **ACTIVE** endpoint and confirm **Switch off this endpoint** ("No events are sent to it. Turning it back on needs another administrator."). The status becomes **DISABLED**.
2. To restart, click **Turn back on** on a **DISABLED** endpoint. It returns to **PENDING APPROVAL**, and you become its maker, so **a different administrator** must click **Activate** again.

### Why internal addresses are refused (the "SSRF guard")

The platform only sends webhooks to addresses on the public internet. Addresses inside a private network (for example office networks, the server itself, or cloud internal addresses) are refused, both when an endpoint is registered and again before every single delivery.

Why: if the platform could be told to send messages to internal addresses, someone could misuse the webhook feature to reach systems that should never be reachable from outside. This kind of attack is called server-side request forgery (SSRF). Blocking internal addresses closes that door.

If your receiving system is inside your private network, your IT team must publish it at a public HTTPS address (for example through a secure gateway).

### Information for your IT team

The **Receiving events** card on the page summarises what the receiving system must do, and includes a **Verification example (Node.js)**:

- Each delivery is a web request containing the event's identifier, type, time and details.
- `X-Webhook-Signature` proves the message came from the platform; the receiver must reject anything whose signature does not match.
- `X-Webhook-Id` is the same on every retry of one event, so the receiver can ignore repeats.
- The receiver should answer quickly and do its processing afterwards.

---

## 2. Service accounts (letting another system post into the platform)

Webhooks send information *out*. A **service account** lets an outside system send information *in*: it is a machine login, used by your core banking or payment system rather than by a person.

Service accounts are created under **Risk & audit › Access & policy**, on the **Service accounts** tab ("Machine credentials for integrations. Limited to repayment posting and read scopes."). The full screen is described in [18-tenant-administration.md](18-tenant-administration.md). In brief:

- Only an administrator with approval-level access permission can create one.
- Each account has a **Name**, an expiry (**Expires in days (optional)**, default 90, maximum 365) and **Scopes**. Only two scopes exist: `loan.repayment.post` (post repayments) and `loan.read` (read loan information).
- The key is shown once ("This key will never be shown again."). Store it in your integration's secret store. If it is lost, disable the account and create a new one.

What a service account with `loan.repayment.post` can do, through the platform's integration interface:

- **Post a repayment to a loan.** This is the same as a cashier posting a repayment in **Loans › Loan accounts**, with the same allocation rules and the same protection against posting the same payment twice. See [07-repayments-and-payments.md](07-repayments-and-payments.md).
- **Send settlement files and payroll-deduction files**, which then appear for reconciliation under **Collections & relief › Payment channels**.

There is no screen for configuring the integration itself; your IT team connects the outside system using the key. Every posting made by a service account is recorded in the audit trail under that account's name (see [19-audit-trail.md](19-audit-trail.md)).

---

## 3. External integrations: what is connected today

The lending platform is designed to connect to outside services, but most of these connections are **not yet live**. Where no real connection exists, the platform uses a clearly labelled stand-in called a **mock**. A mock pretends to be the outside service so that the system can be tested: no money moves, no identity is checked and no bureau is queried. Mocks are **refused on the live (production) system**, so they can never silently stand in for a real payment or bureau check.

### See the status for your organisation

1. Go to **Finance › End of day & operations**.
2. Open the **Integrations** tab.
3. The **Integration adapters** card ("Which external system each capability is wired to.") lists each **Capability**, the **Adapter** name, the **Kind** (**REAL** or **MOCK**) and **Usable here** (**YES** or **NO**).

If any adapter is a mock you see "*N* of *M* adapters are mocks". On the live system it adds: "In production mocks are refused, so messages through them stay pending rather than being marked sent."

### Status of each integration

| Integration | Status today | What it means for you |
|---|---|---|
| **Payment rails** (automated payouts and collections) | Mock only. | Disbursements are recorded by Operations with an external bank or cash reference (fully supported; see [06-disbursement.md](06-disbursement.md)). A product with **Payments** set to **ADAPTER** cannot be activated. |
| **Bank auto-debit** (shown as `bankDebit`) | Mock only. | Direct-debit mandates and attempts are recorded, but on the live system no debit is actually attempted. |
| **KYC / identity** | Manual only. | Staff record each customer's KYC status by hand (see [03-customers-and-documents.md](03-customers-and-documents.md)). A product with **KYC** set to **EXTERNAL_REQUIRED** cannot be activated. |
| **Credit bureau** | Not connected to the lending platform. The original loan module's CBC connection is not wired in. Live bureau enquiries are also switched off by the feature flag `lending.integration.credit_bureau` (off by default). | A product with **Credit bureau** set to **REQUIRED** cannot be activated. Use **NONE** or **OPTIONAL**. |
| **Notifications** (borrower SMS / Telegram from the lending platform) | Mock only. | Messages are recorded when events happen, but on the live system they are left pending rather than sent. Use webhooks (section 1) to pass events to your own messaging system. |
| **Document storage** | Real when the organisation's cloud file storage is configured (shown as **S3**); otherwise a local-disk mock that is refused on the live system. | If uploads fail on the live system, ask IT to confirm storage is configured. |
| **External accounting** | Not connected. | The lending ledger and its reconciliation are internal. Use the GL export (see [15-reports-and-regulatory-returns.md](15-reports-and-regulatory-returns.md)) or webhooks to feed your accounting system. |
| **Exchange rates** (shown as `fxRates`) | Real: your organisation's own published rate table. | Rates are maintained by your staff (see [07-repayments-and-payments.md](07-repayments-and-payments.md)). |

The same information appears in **Products › Catalogue**, on the **Capability matrix** tab, where these capabilities show the status **REQUIRES INTEGRATION** (see [04-products-and-policies.md](04-products-and-policies.md)).

If a mock is used on the live system, the action fails with a message like:

> MOCK_PAYMENTS is a mock adapter and is blocked in production. Configure a real integration.

Ask your IT team; there is nothing a user can do to get past it.

### The Telegram bot (original loan module)

Separately from the lending platform, the **original** loan module has a Telegram bot. An administrator connects it in **Administration › Settings**, under **Telegram Notifications** ("Receive alerts via your Telegram bot."), by pasting the **Bot Token**. A bot can be connected to only one organisation; otherwise you see "This Telegram bot is already connected to another organisation."

Borrowers link their Telegram chat by tapping **Share my phone number** in the bot; only their own number is accepted. Once linked, they receive disbursement alerts and late-payment notices for loans in the original module. This bot does **not** send notifications for loans in the lending platform. See [21-original-loan-module.md](21-original-loan-module.md).

---

## 4. Checklist: connecting a new outside system

1. Agree with IT which events the system needs (webhooks) and whether it must post repayments (service account).
2. Administrator A registers the webhook endpoint and passes the signing secret securely.
3. Administrator B checks and clicks **Activate**.
4. Administrator A clicks **Send test** and confirms "Test event delivered".
5. If needed, an administrator creates a service account with only the scopes required, and passes the key securely.
6. Check **Deliveries** daily for the first week; investigate any **FAILED** rows and use **Retry** once the receiver is fixed.
7. Rotate secrets and renew service-account keys before they expire.
