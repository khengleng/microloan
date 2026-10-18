# Customers and documents

Who this is for: loan officers and relationship officers who register customers and collect their papers; credit analysts and loan operations staff who review documents; risk and compliance staff who manage retention and legal hold.

This chapter covers the borrower (customer) record, identity verification (KYC), how personal data is protected, credit checks, and the customer document library — including documents you request from customers through the borrower portal.

---

## Where to find it

| What | Menu path |
|---|---|
| The borrower register and each borrower's profile | **Customers › Borrowers** |
| Documents across all customers (review queue, expiries, retention) | **Customers › Documents** |
| One customer's document library | **Customers › Borrowers** › open a borrower › **Documents** button |

Note: **Borrowers** is one of the original screens of the system and uses the original customer permissions (view, create, update). The lending screens (applications, loans, groups) use the same borrower records. If you can see **Applications** but not **Borrowers**, ask your administrator to give you customer access (see [Roles, permissions and approvals](02-roles-and-approvals.md)).

---

## Find a borrower

1. Go to **Customers › Borrowers**.
2. Type in the search box (**Search by name, phone, or ID number...**). The list updates as you type.
   - A **name** matches any part of the first or last name.
   - A **phone number** or **ID number** must be typed **in full and exactly as registered**. These details are stored encrypted, so the system can only match the whole value — part of a phone number finds nothing.
3. Hover over a row and click **View** to open the borrower's profile. The pencil icon edits the borrower; the bin icon deletes them.

The list shows 50 borrowers per page; use **Previous** / **Next** at the bottom.

---

## Register a new borrower

Do this before you create a loan application for a new customer.

To register a borrower:

1. Go to **Customers › Borrowers** and click **New Borrower**.
2. In **Add New Borrower**, fill in:
   - **First Name** and **Last Name** (required)
   - **Phone Number** (required — use the full number, e.g. +855 …; the customer signs in to the borrower portal with it)
   - **National ID / Passport** (required)
   - **Address** (required)
   - **ID document type**, **Date of birth** and **Occupation** (optional, but see the note on age rules below)
   - **Branch** — the branch that serves the customer. It starts as your own branch; a branch officer can only choose their own branch, a head-office user can choose any active branch.
   - **Monthly Income (USD)** and **Monthly Expenses (USD)** (optional, but see the note below)
3. Click **Add Borrower**. You see "Borrower saved". If something is wrong (for example a date of birth in the future) the form lists what to fix.

What happens next:

- The borrower is created with KYC status **Pending review** (see [KYC statuses](#identity-verification-kyc)).
- The borrower is placed in the chosen branch. A borrower without a branch cannot have a loan application — open the profile, click **Modify Profile** and choose a **Branch**.

Note: **Monthly Income** is used to work out the debt-service ratio (how much of the customer's income goes to instalments) when an application is assessed. If a product limits the debt-service ratio and the income is blank, approval is refused with "Monthly income is needed to assess affordability." See [Applications and credit decisions](05-applications-and-credit-decisions.md).

Note: Products with an age rule (minimum age, maximum age at maturity) need the **Date of birth**. Without it, submission of an application for such a product is refused with "The borrower's date of birth is required for this product." — add it with **Modify Profile**.

Note: Your organisation's subscription plan may limit how many borrowers you can register. When the limit is reached you see "Your organization has reached the maximum allowed limit of … borrowers for the … plan. Please upgrade to continue." Ask your tenant administrator.

### Edit a borrower

1. Open the borrower (**View**) and click **Modify Profile**, or click the pencil icon in the list.
2. Change the details in **Edit Borrower** and click **Save Changes**.

Every change is recorded in the audit trail with personal details masked.

### Delete a borrower

Only an administrator can delete a borrower, and only one with no history.

1. Click the bin icon on the borrower's row.
2. Read the warning ("This will permanently delete this borrower and all associated records. This action cannot be undone.") and click **Delete**.

If it is blocked:

| Message | Why | What to do |
|---|---|---|
| "This customer has filed documents under retention and cannot be deleted." | Documents in the customer's library must be kept for their retention period. | Do not delete. Documents can only be removed after retention ends (see [Retention and legal hold](#retention-legal-hold-and-deletion)). |
| An error when the borrower has loans | Borrowers with loans cannot be deleted. | Keep the record. |

---

## The borrower profile

Open a borrower from the list (**View**). The page shows:

- **Documents** — opens the customer's document library (see [Customer document library](#the-customer-document-library)).
- **Modify Profile** — edits the borrower.
- Phone, **National ID / Passport**, **Registered Residence**, **Branch**, **Date of birth**, ID type, occupation, AML screening, and loan counts from the original loan module.
- **Identity Verification (KYC)** — the identity documents (uploaded by the customer in the borrower portal or filed by staff in the document library) and the KYC decision (see below).
- **System Loan Register** — loans made in the **original** loan module only. Loans made through **Origination › Applications** are not listed here; find them in **Loans › Loan accounts**. The **Originate Engagement** button opens the original loan module, not a new application.
- **Credit Bureau (CBC)** — bureau checks (see [Credit checks](#credit-checks)).

The label next to the name shows the customer's KYC status: **Identity verified**, **Identity not verified** or **Identity rejected**, plus a red **Flagged** label when AML screening flagged them.

---

## Identity verification (KYC)

KYC (know your customer) confirms the customer is who they say they are. In this system KYC is a **manual review** by staff: there is no automatic identity check with an outside service.

### KYC statuses

| Status shown | Stored value | Meaning |
|---|---|---|
| **Pending review** | PENDING | New customer, or documents not yet checked. |
| **Verified** | VERIFIED | One staff member recorded the verification and a second confirmed it. The system records who confirmed and when. |
| **Rejected** | REJECTED | The documents were not acceptable. The customer sees "Verification was rejected — please re-upload your documents." in the portal. |

Why it matters: if the product's workflow includes a KYC check, an application cannot be submitted until the borrower is **Verified** — the message is "The borrower's KYC must be verified."

### Verify or reject a customer's identity

The customer uploads their identity documents in the borrower portal (national ID front and back, selfie, proof of address), or staff file the papers the customer brings to the branch in the document library under the **KYC** category. Both appear on the card.

Verification takes **two people**:

1. Open the borrower (**Customers › Borrowers** › **View**).
2. In **Identity Verification (KYC)**, click each document to open it and check it.
3. Click **Record verification**. You see "Verification recorded — a colleague must now confirm it" and the badge shows **Awaiting second check**.
4. A colleague opens the same profile, checks the documents and clicks **Confirm verification**. The badge changes to **Identity verified** and the card shows who verified and when.

To reject, click **Reject**, give a reason and click **Reject verification**. Rejection is one step and withdraws a verification awaiting confirmation.

Note: The person who recorded the verification cannot confirm it, and anyone who filed one of the customer's identity documents can neither record nor confirm it; the card explains why the button is missing. Each portal upload is also filed in the document library, where it is reviewed separately (see [Review a document](#review-a-document-accept-or-reject)). Accepting the document in the library does not by itself change the KYC status.

### AML status

Each borrower also has an anti-money-laundering (AML) status: **Not screened** (default), **Clear** or **Flagged**. There is no automatic screening; record the result of your screening check with **Modify Profile** › **AML screening**. It is shown on the profile. The KYC status (not the AML status) appears in the borrowers report (see [Reports and regulatory returns](15-reports-and-regulatory-returns.md)).

---

## Consent

The customer record does not hold consent fields today. Consent is recorded where it is needed for a specific action:

- consent to a restructuring request — see [Servicing changes](08-servicing-changes.md);
- the consent date on a direct-debit (auto-debit) mandate — see [Repayments and payments](07-repayments-and-payments.md).

Consent for credit bureau and alternative-data checks is part of the scorecard work now being built — see [Scorecards and alternative data](scorecards-and-alternative-data.md) (being written).

---

## How personal data is protected

- The national ID number and phone number are **encrypted** in the database. This is why search only matches a full phone or ID number.
- Each national ID number can be registered only once in your organisation.
- The audit trail records changes with personal details **masked**.
- Every view and download of a document is logged against your user, and download links expire within minutes.
- Staff only see customers in their own branch or portfolio scope.

---

## Credit checks

### Check your own organisation's history (Credit Check)

Use this before registering a customer, to see whether they have borrowed from your organisation before.

1. Go to **Customers › Borrowers** and click **Credit Check**.
2. In **Borrower Credit Check**, enter the **ID Number** and/or **Phone Number** (full values).
3. Click **Verify Borrower Reliability**.

The result shows loans found in your own organisation only. It never shows other lenders' data. For obligations at other lenders a Credit Bureau (CBC) check is needed.

### Credit Bureau (CBC) check

1. Open the borrower's profile.
2. In **Credit Bureau (CBC)**, click **Run Credit Check**.

Results (date, provider, status, score, grade, summary) are listed in the table. Check statuses: **PENDING**, **PROCESSING**, **COMPLETED**, **FAILED**.

Note: The CBC check needs a live connection to the Credit Bureau Cambodia, set up by your IT team. Until it is set up, you see "CBC integration is not ready." No score is invented. The bureau result is not yet used in the origination credit score (see [Applications and credit decisions](05-applications-and-credit-decisions.md)).

---

## The customer document library

Each customer has **one library** for all their documents: identity (KYC), application papers, loan and collateral documents, agreements and letters generated by the system. Every file is kept with its versions, review decision, expiry date and an access log.

To open it: **Customers › Borrowers** › **View** › **Documents**. The page is called **Customer documents**. **Customer profile** (top left) takes you back.

The page shows:

- Four tiles: **Documents**, **Awaiting review**, **Expired**, **Open requests**.
- **Required documents — application …** — one card for each open application of this customer, listing the documents the product requires, with their status (see the table below). For a missing, rejected or expired item, click **Request** to ask the customer for it; **Open** shows the document on file.
- **Requested from the customer** — open requests, with **Withdraw**.
- **Library** — all documents, filtered by the category tabs **All**, **Kyc**, **Application**, **Loan**, **Collateral**, **Agreement**, **Generated**, **Other**. Tick **Show deleted** to include deleted ones.
- A line at the bottom showing the business date.

### Document categories

| Category | Typical contents | Default retention |
|---|---|---|
| KYC | National ID, passport, selfie, proof of address | 5 years |
| APPLICATION | Payslips, business records for an application | 5 years |
| LOAN | Loan papers after booking | 7 years |
| COLLATERAL | Title deeds, vehicle cards, valuations | 7 years |
| AGREEMENT | Signed agreements | 7 years |
| GENERATED | Letters the system produces (you cannot upload into this category) | 7 years |
| OTHER | Anything else | 5 years |

Retention years count from the end of the customer relationship (last loan closed and no open application). Your compliance team can change them — see [Retention, legal hold and deletion](#retention-legal-hold-and-deletion).

### Review statuses

| Status shown | Meaning |
|---|---|
| **PENDING REVIEW** | Uploaded; waiting for a different user to check it. It already counts as "present" for the application checklist. |
| **ACCEPTED** | Checked and accepted. |
| **REJECTED** | Checked and rejected; the reason is shown on the version. Does not count for the checklist. |
| **NOT REQUIRED** | No review needed (for example some system-generated letters). |
| **DELETED** | Removed after its retention period; the record (who, when, why) is kept. |
| **LEGAL HOLD** | Shown in addition to the review status: the document cannot be deleted. |

### Checklist statuses (required documents)

| Status shown | Meaning | Blocks the stage? |
|---|---|---|
| **ACCEPTED** | A valid, accepted document is on file. | No |
| **PENDING REVIEW** | A document is on file, waiting for review. | No |
| **REQUESTED** | Asked from the customer, not yet received. | Yes, if mandatory |
| **MISSING** | Nothing on file. | Yes, if mandatory |
| **REJECTED** | The only document on file was rejected. | Yes, if mandatory |
| **EXPIRED** | The document on file has passed its expiry date. | Yes, if mandatory |

### Upload a document

1. In **Customer documents**, click **Upload**.
2. In **Upload a document**, fill in:
   - **Category**
   - **Type code** — a short code in capitals, e.g. NATIONAL_ID, PASSPORT, TITLE_DEED. Use the code the product's checklist uses so the item is ticked off.
   - **Title** — a readable name, e.g. "National ID card".
   - **For application (optional)** — link it to one of the customer's open applications, or leave **Customer-level**.
   - **Issued on**, **Expires on** — enter the expiry date for identity documents so reminders are raised.
   - **File** — PDF, JPEG, PNG or WebP up to 3.5 MB.
   - **Note** (optional).
3. Click **Upload**. You see "Document uploaded — awaiting review by another user".

You can also upload a document from the application page (see [Applications and credit decisions](05-applications-and-credit-decisions.md)); it lands in the same library.

### Review a document (accept or reject)

Every upload must be reviewed by a **different** user from the one who uploaded it (four-eyes control: a second person checks the document is genuine, legible and the right one). Credit analysts and loan operations makers and checkers can review.

To review:

1. Go to **Customers › Documents**. The **Review queue** tab lists everything **Awaiting review**. Your own uploads show "your upload" and cannot be reviewed by you.
2. Click **Review →** on a row. This opens the customer's library.
3. Click the document title (or **Details**), then **Download current** to look at the file.
4. Click **Review**.
5. To accept, click **Accept**. To reject, type a **Reason (required to reject)** (at least 3 characters, e.g. "Photo is blurred") and click **Reject**.

What happens next:

- The document shows **ACCEPTED** or **REJECTED**.
- If the document answered a request from the customer, an accepted document closes the request; a rejected one re-opens it and the customer sees your reason in the portal ("We could not accept your last upload: …").

If it is blocked: "You cannot approve or complete an action you created or proposed" — you uploaded this version; ask a colleague to review it.

### Replace a document (new version)

When a customer brings an updated or clearer copy:

1. Open the document's **Details** and click **Replace (new version)**.
2. Choose the **File**, optionally a **New expiry (optional)** and a **Note** explaining why.
3. Click **Upload new version**. You see "New version uploaded — earlier versions are kept".

The new version needs review again. All earlier versions stay in the **Versions** table and can still be downloaded.

### Change issue and expiry dates

1. Open **Details** › **Dates**.
2. Set **Issued on** / **Expires on** and click **Save**. A document cannot expire before it is issued.

### Download a document

Open **Details** and click **Download current**, or the download icon next to any version. The link opens in a new tab and expires within minutes. Each download is recorded in the **Access and change log**.

---

## Request a document from the customer

Use this when the customer must send a document themselves through the borrower portal.

1. In **Customer documents**, click **Request from customer** (or **Request** next to a missing checklist item — the details are filled in for you).
2. In **Request a document from the customer**, fill in:
   - **Category** and **Type code**
   - **What the customer sees** — the plain name shown in the portal, e.g. "Proof of address"
   - **For application (optional)**
   - **Due by** (optional)
   - **Message** (optional) — instructions for the customer
3. Click **Send request**. You see "Request sent to the customer".

### Request statuses

| Status (staff screen) | What the customer sees | Meaning |
|---|---|---|
| **OPEN** | **Needed** | Waiting for the customer. |
| **SUBMITTED** | **Received — being checked** | The customer uploaded a file; it is in the review queue. |
| **ACCEPTED** | **Accepted** | Staff accepted the file. The request disappears from the list. |
| **CANCELLED** | **No longer needed** | Staff withdrew the request. |

To withdraw a request, click **Withdraw** in **Requested from the customer**. You see "Request withdrawn".

If it is blocked: "This document has already been requested and is still open." — there is already an open request for the same document.

### What the customer sees in the borrower portal

Customers sign in to the borrower portal with their registered phone number and a 6-digit code. Relevant sections:

- **Documents requested from you** — each request with its label, your message, "Please send by …", status, and an **Upload** button (or **Send a different file** while being checked). If nothing is needed: "Nothing is needed from you right now."
- **My documents** — their documents with **Download**, marked "being checked" or "not accepted: <reason>" where relevant.
- **Verify your identity** — upload of national ID (front and back), selfie and proof of address, until KYC is verified.

---

## Customers › Documents (all customers)

The **Documents** page has three tabs.

### Review queue

Everything **Awaiting review** across the customers you can see. See [Review a document](#review-a-document-accept-or-reject). The number on the menu item is the size of this queue; the same queue appears on **Home** as **Documents to review**.

Note: You need the document review permission to see this tab's contents. Others see an error here.

### Expiring and expired

Identity and other documents that expire within the chosen window (**Next 30 days**, **Next 60 days**, **Next 180 days**), and those already expired. Columns: **Customer**, **Document**, **Expires**, **State** (**REMINDED**, **EXPIRED**), **Reminder sent**.

A nightly job flags expired documents and raises a reminder before a document expires (by default 30 days before). **Run expiry check now** does the same immediately for your organisation; you see "… flagged expired, … reminders raised".

Note: **Run expiry check now** needs the document management permission (risk / compliance). Other users get a refusal.

What to do: request a new copy from the customer (or upload one with **Replace (new version)**). An expired mandatory document blocks the application stage it belongs to.

### Retention and legal

Only risk / compliance users (document management permission) can use this tab; others see "Compliance only".

To change a retention period:

1. In **Retention periods**, choose **Applies to** (**Category** or **Document type**), the **Category** or **Type code**, and **Years**.
2. Click **Save rule**. You see "Retention rule saved".

A type rule overrides its category. **Use default** (category) or **Remove** (type) returns to the default.

**Older document stores** › **Link older documents** brings KYC images, original-module loan documents and older application uploads into each customer's library. Nothing is moved or deleted. (This also happens automatically when a library is opened.)

---

## Retention, legal hold and deletion

These actions are for risk / compliance users.

### Place or release a legal hold

Use legal hold when a document must be preserved, for example for a court case.

1. Open the document's **Details** and click **Legal hold** (or **Release hold**).
2. Enter a **Reason** (at least 3 characters, e.g. a court order reference).
3. Click **Place hold** (or **Release**).

A document under legal hold cannot be deleted, whatever its retention period.

### Delete a document after retention

1. Open **Details** and click **Delete**. The button is greyed out while the document is **Under legal hold** or the **Retention period has not ended** (hover to see why).
2. Enter a **Reason** and click **Delete**.

The stored files are removed; the record of who deleted it, when and why is kept. This cannot be undone.

---

## Who can do what

| Task | Who (standard roles) |
|---|---|
| Register borrowers | Staff with the original customer-create permission (administrators, operators, sales) |
| Edit borrowers | Administrators and operators (customer-update permission) |
| Delete a borrower | Administrator |
| Verify / reject KYC | Administrators, credit officers, branch managers, customer support |
| View and download documents | Relationship officer, credit analyst, credit approver, loan operations, collections, risk / compliance, auditor |
| Upload documents and send requests | Relationship officer, credit analyst, loan operations maker, collections officer |
| Review (accept / reject) documents | Credit analyst, loan operations maker, loan operations checker — never your own upload |
| Retention rules, legal hold, deletion, expiry run | Risk / compliance reviewer |

See [Roles, permissions and approvals](02-roles-and-approvals.md) for how roles are assigned.

---

## If it is blocked

| Message | Cause | What to do |
|---|---|---|
| "The borrower must belong to a branch before an application can be created." | The borrower was registered by a user with no branch. | Ask your administrator to assign the borrower to a branch (or register customers while signed in as a branch user). |
| "Accepted document types: PDF, JPEG, PNG, WebP." / "Documents must be between 1 byte and 3.5 MB." | Wrong file type or file too large. | Convert or compress the file. |
| "The file content is not a valid image/jpeg file." (or similar) | The file's content does not match its type (e.g. a renamed file). | Save the file again in the right format. |
| "Invalid document type code." | The type code has spaces or lower-case letters. | Use 2–40 capital letters, digits or underscores, e.g. PROOF_OF_ADDRESS. |
| "A document cannot expire before it is issued." | Dates in the wrong order. | Correct the dates. |
| "A rejection needs a reason." | Reject clicked with no reason. | Type the reason. |
| "Version … is already accepted." / "This version was reviewed by someone else." | Someone reviewed it first. | Refresh the page. |
| "Document storage is unavailable. Please try again." | The document store is not reachable. | Try again later; tell IT if it persists. |
| "This document is under legal hold and cannot be deleted." | Legal hold is on. | Release the hold first (if appropriate). |
| "CBC integration is not ready." | The Credit Bureau link is not set up. | Ask IT; use the own-organisation **Credit Check** meanwhile. |
