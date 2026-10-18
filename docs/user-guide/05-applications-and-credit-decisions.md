# Applications and credit decisions

Who this is for: relationship (loan) officers who create applications, credit analysts who assess and recommend, credit approvers who approve or reject, and loan operations makers who book approved applications and satisfy conditions.

This chapter follows a loan application from draft to a booked loan account. Paying the money out is in [Disbursement](06-disbursement.md).

---

## The application pipeline

**Origination › Applications** shows every application you are allowed to see (your branch or portfolio). An application moves through these statuses:

| Status | Meaning | Who acts next |
|---|---|---|
| **DRAFT** | Created; terms can still be changed. | Relationship officer: upload documents, add collateral and guarantees, **Submit**. |
| **SUBMITTED** | Sent for credit review; terms are frozen. | Credit analyst: **Recommend** (or **Reject**). |
| **RECOMMENDED** | The analyst has made a recommendation. | Credit approver(s): **Approve** or **Reject**. |
| **APPROVED** | Credit approved (all required approvals recorded). | Loan operations maker: **Book agreement**. |
| **BOOKED** | A loan account has been opened (no money has moved yet). | Loan operations: conditions and disbursement. |
| **REJECTED** | Declined. Final. | — |
| **WITHDRAWN** | Listed as a filter value; there is no button to withdraw an application today. | — |

Your **Home** page shows the matching work queues: **Applications in progress**, **Applications to assess**, **Waiting for your credit decision** and **Approved applications to book**. The number on the **Applications** menu item counts them.

### Who does what (standard roles)

| Step | Role | Notes |
|---|---|---|
| Create, edit, upload documents, submit | Relationship officer | In your branch / portfolio only. |
| Add collateral and guarantees | Relationship officer, credit analyst | While DRAFT, SUBMITTED or RECOMMENDED. |
| Recommend | Credit analyst | Must not be the person who created the application. |
| Approve | Credit approver | Different person from the creator and the recommender; within your approval limit; authenticator (MFA) sign-in required. |
| Reject | Credit approver (and analysts if granted) | Not the creator. |
| Book agreement | Loan operations maker | Only when APPROVED. |
| Satisfy a condition | Loan operations maker | After approval. |
| Waive a condition | Credit approver | Not the creator. |

Maker-checker (four-eyes) means a second, different person must make each credit decision, so no one person can push a loan through alone — a control against error and fraud. See [Roles, permissions and approvals](02-roles-and-approvals.md).

---

## Before you start

Check these, or the application will be refused later:

- The borrower is registered and belongs to a **branch** (see [Customers and documents](03-customers-and-documents.md)).
- The borrower's **KYC is Verified**, if the product's workflow has a KYC check.
- The borrower's **Monthly Income** is filled in, if the product limits the debt-service ratio or sets a minimum income.
- The product has an **active version** (see [Products and policies](04-products-and-policies.md)).
- New origination is switched on for your organisation (feature flag `lending.origination`, and the flag for the product family). If it is off, buttons are greyed out with "… is currently unavailable".

---

## Create an application

1. Go to **Origination › Applications** and click **New application**.
2. Find the borrower: type in **Find borrower** (name, or the full phone or ID number) and click **Search**, then choose from **Borrower**. You can instead paste the borrower's ID in **…or paste borrower UUID**.
3. Choose the **Product**. Only products with an active version are listed.
4. Optional: **Purpose**.
5. Optional: **Refinances loan** — the loan account ID of an existing active loan of the same borrower that this new loan will pay off at disbursement. The product must allow refinancing. See [Servicing changes](08-servicing-changes.md). (The **Start refinance application →** link on a loan fills this in for you.)
6. Enter the terms:
   - **Principal** (required)
   - **Number of instalments** (blank = product default)
   - **Annual rate (%)** (blank = product default; e.g. 12.5)
   - **Disbursement date** (required — the planned date)
   - **First due date** (optional)
   - **Down payment** (optional — what the borrower pays before disbursement; see [Disbursement](06-disbursement.md))
   - **Promotion code** (optional — the product's campaign code)
   - **Annual net operating income** (optional — business loans, for the debt-service coverage ratio)
   - **Declared annual income** (income-contingent education loans only — see [Specialised products](12-specialised-products.md))
7. Click **Create draft application**.

What happens next: the application opens in **DRAFT** with a reference such as APP-…. Any conditions precedent configured on the product (things that must be done before money is paid out) are added automatically.

If it is blocked:

| Message | What to do |
|---|---|
| "Requested terms are outside the product limits." (with a list) | Change the amount, term or rate to fit the product. |
| "This product has no active version for new business." | Ask the product team to activate a version. |
| "This product is not offered at the borrower's branch." | Choose another product. |
| "The borrower must belong to a branch before an application can be created." | Open the borrower, click **Modify Profile** and choose a **Branch** (see [Customers and documents](03-customers-and-documents.md)). |
| "This product lends to a group; name the group the loan is for." | Choose the **Group** on the form — see [Group applications](#group-applications). |
| "This product does not permit refinancing an existing loan." / "A refinance must replace a loan of the same borrower." / "The loan to refinance is …; only an active loan can be replaced." | Check the loan ID and product. |
| "This is a letter-of-credit product; request the credit from Trade finance, not as a loan application." | Use **Loans › Trade finance** (see [Specialised products](12-specialised-products.md)). |

---

## The application page

Click an application's **Reference** to open it. The page shows:

- **Actions** — the buttons for the current status. A greyed-out button means you cannot use it now; hover over it to see why. **Why can't I…** lists every blocked action with the reasons (permission, branch scope, maker-checker, approval limit, authenticator, feature flag, product, status).
- **Application** — requested amount, principal, instalments, rate, dates, purpose, channel, and when it was created, submitted and decided. **Raw terms** shows all terms.
- **Documents** — files uploaded to this application. If the product lists required documents, they appear as labels at the top (ticked when on file; amber when mandatory and missing).
- **Conditions precedent** — see [Conditions precedent](#conditions-precedent).
- **Collateral** and **Guarantees**.
- **Credit decisions** — every recommendation, approval and rejection, oldest first, with the assessment behind it.
- After booking, a green **Booked** box links to the new loan account.

**Refresh** reloads the page.

### Edit terms (draft only)

1. Click **Edit terms**.
2. Change the fields (same as when creating) and **Purpose** if needed.
3. Click **Save terms**. You see "Terms updated".

Terms can only change while the application is **DRAFT** ("Terms can only change while the application is a draft.").

### Upload documents

1. Click **Upload document**.
2. Choose the **Document type** (the product's list, marked "mandatory" where required; if the product has no list, type a code such as ID_CARD).
3. Choose the **File** (PDF, JPEG, PNG or WebP, up to 3.5 MB) and click **Upload**.

The file goes into the customer's document library, linked to this application, and waits for review by another user. A document awaiting review already counts as present for the checklist; a rejected or expired one does not. To see the full checklist with review statuses, open the customer's library (see [Customers and documents](03-customers-and-documents.md)).

### Add collateral

1. Click **Add collateral**.
2. Fill in **Type** (e.g. LAND_TITLE, VEHICLE — the product may accept only certain types), **Description**, **Market value**, **Valuation date**, **Valuer**, **Method**, and optionally **Loans ranking ahead** (other loans secured on the same asset, e.g. a first mortgage; they count in the combined loan-to-value).
3. Click **Add collateral**.

The pledge appears in **Collateral** with the latest valuation. For managing collateral on running loans see [Covenants and collateral](13-covenants-and-collateral.md).

### Add a guarantee

1. Click **Add guarantee**.
2. Enter **Guarantor name**, **Type** (**PERSONAL** or **CORPORATE**) and **Amount**.
3. Click **Add guarantee**.

### Simulate

Click **Simulate** at any time to see the repayment schedule, fees and effective rate for the current terms. Nothing is saved.

---

## Submit

When the draft is complete:

1. Click **Submit**.
2. Confirm ("Submit … for credit review? Terms can no longer be edited after submission.").

What happens next: the status becomes **SUBMITTED** and the application appears in the credit analysts' queue.

The system checks the application first. If anything is missing you see "The application cannot be submitted yet." with a list of the problems. At submission it checks:

| Check | Message you may see |
|---|---|
| KYC (if the workflow has a KYC step) | "The borrower's KYC must be verified." |
| Required documents for the application stage (if the workflow has a document check) | "Missing document: …" or "Document … is rejected / expired" |
| Age (if the product has age rules) | "Minimum age is …", "Maximum age at maturity is …", "The borrower's date of birth is required for this product." |
| Minimum income (if set) | "Minimum monthly income is …" |

---

## Assessment and the credit score

Each time an application is recommended or approved the system runs an **assessment** and stores it with the decision. It covers:

- **Affordability** — the average monthly repayment and the **debt-service ratio** (repayment ÷ the borrower's monthly income). For a group loan, the combined income of all active members is used.
- **Debt-service coverage** (business loans) — annual net operating income ÷ annual debt service.
- **Loan-to-value** — for secured products: the loan plus loans ranking ahead, divided by the collateral's lending value (market value less the product's haircut).
- **Guarantors** — how many are recorded.
- **Credit score** — see below.
- Any other checks the product needs (for example institutional counterparty limits).

### The origination credit score

The current credit score is a simple, explainable score built only from what your organisation knows. It runs from 300 to 850 (starting at 450) and adds or subtracts points for named factors:

| Factor | Points |
|---|---|
| AFFORDABILITY | +120 if instalments take 30% of income or less; +80 up to 45%; +40 up to 60%; −40 above 60%; 0 if income is unknown |
| AGE | +60 for age 25–55; +30 for other ages; +20 if unknown |
| HISTORY | +25 per loan repaid with you (up to 3); −150 if a previous loan was written off or sold |
| CONDUCT | +60 if no live loan is past due; +10 if up to 30 days past due; −80 if more |
| SECURITY | +50 if loan-to-value is 60% or less; +25 up to 80%; +20 if there is at least one guarantor |
| BUREAU | 0 — no bureau score is used today |

Grades: **A** 700 and above, **B** 620–699, **C** 550–619, **D** below 550.

Where to see it: in **Credit decisions**, open **assessment** in the **Detail** column of a recommendation or approval. The figures appear as `creditScore`, `creditGrade` and `creditScoreFactors` (each factor with its points and reason), next to `debtServiceRatio`, `loanToValue` and the other measures. The score is not shown before the first recommendation.

A product can set a minimum score; below it, approval is refused with "Credit score … (grade …) is below the minimum …".

Note: Configurable scorecards, decision strategies and the use of alternative data are being built now — see [Scorecards and alternative data](scorecards-and-alternative-data.md) (being written).

---

## Recommend

For credit analysts, when an application is **SUBMITTED**.

1. Open the application. Review the documents, collateral, guarantees and **Simulate** the schedule if useful.
2. Click **Recommend**.
3. Choose the **Recommendation** (**APPROVE** or **REJECT**) and write the **Rationale** (at least 3 characters).
4. Click **Recommend**. You see "Decision recorded".

What happens next: the status becomes **RECOMMENDED** whichever way you recommend; the approver makes the final decision. The decision is recorded as type **RECOMMEND**, and the rationale starts with your recommendation (e.g. "APPROVE: …"). The assessment is stored with it.

Note: Recommending does not stop on assessment problems — they are recorded for the approver. Use **Reject** if the application should not go forward.

---

## Approve

For credit approvers, when an application is **RECOMMENDED**.

1. Open the application and read the recommendation and its **assessment** in **Credit decisions**.
2. Click **Approve**.
3. Write the **Rationale** and click **Approve application**.

Requirements:

- You are **not** the person who created or recommended the application, and have not already approved it.
- The amount is **within your approval limit** (approval authority, set by your tenant administrator).
- You signed in with your **authenticator code** (multi-factor sign-in). Otherwise: "This action requires signing in with multi-factor authentication" — sign out and sign in again with your code (see [Getting started](01-getting-started.md)).
- The product is still active.

The system re-runs the assessment. If a rule is not met you see "Approval requirements are not met." with the list, for example:

| Message | Meaning |
|---|---|
| "Debt-service ratio … exceeds …" / "Monthly income is needed to assess affordability." | Instalments too high for the income, or income missing. |
| "Debt-service coverage … is below the minimum …" / "Annual net operating income is needed to assess debt-service coverage." | Business cash flow too weak, or not entered. |
| "Secured products need a pledged, valued collateral." | No collateral with a valuation. |
| "A … valuation is … days old (max …)." | Valuation too old — add a fresh valuation. |
| "Loan-to-value … exceeds …; the most that can be lent is …" | Reduce the amount or add collateral. |
| "At least … guarantor(s) required." | Add guarantees. |
| "Missing document: …" | Required documents for the approval stage are missing. |
| "Credit score … (grade …) is below the minimum …" | Below the product's minimum score. |

### Multi-level approval

The product's workflow can require more than one approval above certain amounts (see [Products and policies](04-products-and-policies.md)). In that case, after the first approval the status stays **RECOMMENDED** and the application waits in the next approver's queue. Each approval must come from a different person. When the required number is reached, the status becomes **APPROVED**. Each approval is listed in **Credit decisions**.

If it is blocked:

| Message | What to do |
|---|---|
| "You cannot approve or complete an action you created or proposed" | Another approver must decide. |
| "The amount exceeds your approval authority" / "You have no approval authority for this action" | Pass it to an approver with a higher limit. |
| "Not allowed while the record is …" | The application is in a different status; refresh. |

---

## Reject

An approver (or anyone with the reject permission, other than the creator) can reject a **SUBMITTED** or **RECOMMENDED** application.

1. Click **Reject**.
2. Write the **Rationale** and click **Reject application**.

The status becomes **REJECTED**. This is final.

---

## Conditions precedent

Conditions precedent are things that must be done before the loan is paid out (for example "Mortgage registered" or "Insurance in place"). They come from the product and are added when the application is created. Disbursement is refused while any is outstanding: "Conditions precedent outstanding: …".

| Status | Meaning |
|---|---|
| **OUTSTANDING** | Not yet done. |
| **SATISFIED** | Done; evidence recorded. |
| **WAIVED** | Not required for this loan — a credit concession. |

To satisfy a condition (loan operations maker, after approval):

1. Open the application (from the loan account, **Application** › **open application**).
2. In **Conditions precedent**, click **Satisfy** on the row.
3. Enter the **Evidence** (required — e.g. registration number, document reference) and click **Mark satisfied**. You see "Condition resolved".

To waive a condition (credit approver; not the application's creator):

1. Click **Waive** on the row.
2. Optionally enter **Evidence / waiver note (optional)** and click **Waive condition**.

---

## Book the agreement

For loan operations makers, when the application is **APPROVED**. Booking creates the loan agreement and a loan account in status **BOOKED**, with the schedule and fees fixed from the approved terms and the product version. No money moves.

1. Click **Book agreement**.
2. Optional: **Planned disbursement date**. It cannot be before today's business date.
3. Click **Book loan account**. You see "Loan account booked".

What happens next: the status becomes **BOOKED** and a green **Booked** box links to the loan account (reference LN-…). For a facility product a credit limit is booked instead (see [Facilities](09-facilities.md)). Any covenants configured on the product start from booking (see [Covenants and collateral](13-covenants-and-collateral.md)). Next: satisfy conditions and disburse — see [Disbursement](06-disbursement.md).

Note: If you leave **Planned disbursement date** empty, the system uses today's **business date**, not the disbursement date entered in the terms. Enter the date you intend to pay out. If money is paid out on a different day, the schedule is recalculated at disbursement.

If it is blocked: "The planned disbursement date cannot precede the business date." — choose today's business date or later.

---

## Group applications

Loans to solidarity groups (joint liability) must name the group, with a group member — usually the leader — signing for it. On the group's page click **Start group application**, or in **New application** choose a group product: a **Group** field appears, and the **Signed for the group by** list proposes the leader. Once created, a group application is assessed, approved and booked on the same application page. See [Group lending](10-group-lending.md).

### Contract policies

When the product offers a menu of policies (prepayment, late charges, allocation, non-accrual), **New application** and **Edit terms** show **Contract policies**: choose a policy other than the product default, or enter a value for a parameter the product lets you adjust (the allowed range is shown under the field). Leave them blank to use the product defaults. The choice is shown on the application as **Policies** and is frozen into the agreement at booking (see [Products and policies](04-products-and-policies.md)).

---

## Credit decision types

| Type shown | Meaning |
|---|---|
| **RECOMMEND** | The analyst's recommendation (the rationale starts with APPROVE or REJECT). |
| **APPROVE** | An approval (one row per approver on multi-level approvals). |
| **REJECT** | The rejection. |
