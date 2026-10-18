# Scorecards and alternative data

Who this is for: credit analysts who build and test scorecards, risk /
compliance reviewers who approve them and watch how they perform, product
makers and checkers who decide how a product uses the score, relationship
officers who record customer consent and capture alternative data, and
credit approvers who read the score on an application.

Every application is given a **credit score**: a number, a **grade** (for
example A to D) and a suggested **outcome**. The score comes from a
**scorecard**, a set of plain rules that give or take away points for things
such as affordability, age and repayment history. Your organisation can
change these rules itself, under maker-checker, and can score customers who
have little or no credit history with **alternative data** (utility bills,
rent, mobile top-ups, business cash flow) — but only with the customer's
consent.

The score helps the credit decision. It never makes it: approvals still go
to your approvers, within their approval limits (see
[Applications and credit decisions](05-applications-and-credit-decisions.md)).

---

## 1. Where to find things

| Screen | Where | What you do there |
|---|---|---|
| **Scorecards** | **Products › Scorecards** | See scorecards and built-in templates, install a template, edit, test, submit, approve, activate and retire versions. Tabs: **Scorecards**, **Test score**, **Data providers**. |
| **Scorecard monitoring** | **Products › Scorecard monitoring** | See how each scorecard version scores and how its loans perform. |
| **Credit score** card | On each application (**Origination › Applications** › open the application) | Read the score, grade, outcome, reasons and the data used; re-run the score. |
| **Scoring** step | Product editor (**Products › Products & versions**, see [chapter 04](04-products-and-policies.md)) | Choose the scorecard a product uses, a challenger, thin-file scoring and the decision strategy. |
| **Alternative data & consent** | Customer profile › **Alternative data** button, or the customer's documents page › **Alternative data & consent** link | Record and withdraw consent, capture and verify alternative data. |

Note: The scoring screens are currently shown in English only, also when
the portal is set to Khmer.

---

## 2. Who can do what

| Permission (as shown in Access & policy) | What it allows | Standard roles that hold it |
|---|---|---|
| `scorecard.read` | Open **Scorecards** and **Scorecard monitoring**, test scores. | Credit analyst, credit approver, risk / compliance reviewer, auditor, product maker, product checker |
| `scorecard.manage` | Create scorecards and new versions, edit drafts, submit them. | Credit analyst |
| `scorecard.approve` | Approve, reject, activate and retire versions made by **someone else**. | Risk / compliance reviewer |
| `credit_score.run` | **Re-run score** on an application that is not yet decided. | Credit analyst, credit approver |
| `alt_data.read` | Open a customer's **Alternative data & consent** page. | Relationship officer, credit analyst, credit approver, risk / compliance reviewer, auditor |
| `alt_data.consent.manage` | Record and withdraw consent. | Relationship officer, credit analyst |
| `alt_data.record` | Capture alternative data. | Relationship officer, credit analyst |
| `alt_data.verify` | Verify or reject data captured by **someone else**. | Credit analyst, risk / compliance reviewer |
| Access-policy permissions | Configure external data providers (one administrator proposes, a second approves). | Tenant administrator |

Everyone who can open an application can read its **Credit score** card.
Alternative-data work follows the customer's branch, like customer
documents: a branch officer works only on customers of their own branch.

The product's **Scoring** step is edited like every other part of a
product: the product maker drafts the version, the product checker approves
and activates it ([chapter 04](04-products-and-policies.md)).

Two controls are always enforced, even if a button is visible:

- The person who made a scorecard version can never approve, reject,
  activate or retire it.
- The person who captured an alternative-data record can never verify or
  reject it.

---

## 3. How scoring works, in plain words

### When an application is scored

The system scores an application automatically:

- when it is **submitted**,
- when it is **recommended**,
- at **each approval**,
- and whenever a credit analyst or approver clicks **Re-run score** (only
  while the application is **DRAFT**, **SUBMITTED** or **RECOMMENDED**).

Every score is kept, with the exact data it used. Nothing is overwritten,
so you can always see what the approver saw at the time.

### What a scorecard is made of

| Part | Meaning |
|---|---|
| **Base score** | The points everyone starts with (for example 450). |
| **Minimum score / Maximum score** | The score is kept between these (for example 300 to 850). |
| **Characteristic** | One thing the scorecard looks at, such as affordability or age. Each reads one **variable** (a piece of data, see below) and gives points. |
| **Bins / categories** | The bands of a characteristic. Example: "instalments take 30% of income or less: +120 points; up to 45%: +80; up to 60%: +40; more: −40". |
| **When missing** | The points given when the data is not available (not recorded, or no consent). |
| **Reason** | The sentence staff see for each band, such as "Instalments take 28% of income (≤ 30%)." |
| **Adverse reason** | A plain sentence that may be given to the customer when a characteristic pulls the score down, such as "The repayments are high compared with the income declared." |
| **Grade bands** | Score ranges turned into grades, for example **A** 700 and above, **B** 620–699, **C** 550–619, **D** below 550. |

Variables are always ratios, counts, months, days or scores — never money
amounts — so one scorecard works the same for USD and KHR loans. The full
list is on **Products › Scorecards**, card **Variables** (click
**… variables** to open it). It shows each variable's source and whether it
needs the customer's consent.

### The built-in scorecards (templates)

Two scorecards come with the platform. Until your organisation activates its
own version of one of these codes, the built-in template is used.

**`STANDARD_RETAIL` — Standard retail scorecard.** The original
origination score (base 450, range 300–850):

| Characteristic | Points |
|---|---|
| Affordability (debt-service ratio) | +120 if instalments take 30% of income or less; +80 up to 45%; +40 up to 60%; −40 above 60%; 0 if income is unknown |
| Age | +60 for age 25–55; +30 for other ages; +20 if unknown |
| Previous write-off | −150 if a previous loan was written off or sold |
| Loans repaid with us | +25, +50 or +75 for 1, 2, 3 or more loans repaid (not counted after a write-off) |
| Conduct of live loans | +60 if no live loan is past due; +10 up to 30 days past due; −80 if more |
| Loan-to-value of security | +50 if 60% or less; +25 up to 80% |
| Guarantors | +20 if there is at least one guarantor |
| Bureau score | 0 today — no credit bureau is connected (see section 8) |

Grades: **A** Low risk (700+), **B** Moderate risk (620+), **C** Elevated
risk (550+), **D** High risk.

**`THIN_FILE` — Thin-file scorecard (alternative data).** For customers
with little or no credit history (base 480, same grades). It keeps
affordability, age, conduct and write-off, and adds: utility bills paid on
time (EDC, water), months of utility bills verified, rent paid on time,
months with mobile top-ups, business cash flow compared with the
instalment, repayments with us so far, repayments through KHQR / wallet /
mobile, and contributions to a solidarity group. **Each alternative
characteristic gives 0 points when the data is missing or not consented**,
so a customer is never rewarded for having no data — and never punished
for refusing consent beyond losing those points.

### Champion, challenger and thin-file

Each product names, in its **Scoring** step:

- a **champion** scorecard — the one that drives the decision (by default
  `STANDARD_RETAIL`);
- optionally a **challenger** scorecard — scored silently on the same data
  at the same moment and stored, but it **never affects the decision**. Use
  it to compare a new scorecard with the current one before switching;
- optionally **thin-file scoring** — a separate scorecard (by default
  `THIN_FILE`) for thin-file customers.

**Thin-file** means a customer the lender knows little about: by default,
fewer than **6** whole months since their first loan with you was paid
out, and no credit bureau score. (Because no bureau is connected yet, today
every new customer without 6 months of history with you is thin-file.) When
thin-file scoring is switched on and a customer is thin-file, the thin-file
scorecard drives the decision instead of the champion, and the score shows
a **THIN FILE** badge.

### From score to outcome: the decision strategy

The product's strategy turns the grade into one of three outcomes. The
screen shows them as:

| Outcome (product setting) | Shown on screen | Meaning |
|---|---|---|
| `AUTO_APPROVE` | **Recommend approve** | The score supports approval. |
| `REFER` | **Refer** | A person must judge it — the normal credit process. |
| `DECLINE` | **Recommend decline** | The score does not support the loan. Approval is blocked. |

**`AUTO_APPROVE` is only a recommendation.** There is no automatic
approval. The application still needs the analyst's recommendation and the
workflow's approvers, each within their approval limit and signed in with
their authenticator. The defaults refer every grade, so a product without
a strategy behaves exactly as before.

The strategy can also set, per grade, a **maximum amount** and a **rate
add-on** (extra interest for riskier grades), plus **knock-outs** — rules
that decline whatever the score (see section 6).

---

## 4. Reading the Credit score card on an application

Open the application (**Origination › Applications** › click the
**Reference**). The **Credit score** card is under the **Application** card.
Its subtitle reminds you: "A recommendation only — the credit decision
still goes through the normal approvals."

Before the application is submitted, the card says "This application has
not been scored yet."

### The top line

| Field | Meaning |
|---|---|
| **Score** | The score of the scorecard that drives the decision. |
| **Grade** | The grade letter and its label (for example **B** Moderate risk). |
| **Outcome** | **Recommend approve**, **Refer** or **Recommend decline**. |
| **Scorecard** | The code and version used, for example `STANDARD_RETAIL v1`. "template" means the built-in template was used. |
| **Stage** | When it was scored — **application** (at submission), **approval** (at recommendation or approval) or **rescore** (re-run by staff) — and the date and time. |
| **THIN FILE** | Shown when the customer was scored as thin-file. |

When the outcome is **Recommend approve**, a green note repeats that
recommendation and approval by authorised staff are still required.

### Strategy details

When they apply, the card shows:

- **Knock-outs** (in red) — rules that declined the application whatever
  the score, for example "A live loan is 45 days past due (more than 30)."
- **Strategy reasons** — how the outcome was reached, for example
  "Grade B: REFER." or "Score 512 is below the cut-off 520."
- "Declines below score …" — the product's cut-off.
- **Grade limit** — the largest amount this grade may borrow on this
  product. If the request is larger, "— requested amount is above it"
  appears, and the outcome is never **Recommend approve**.
- "Rate add-on … bps for this grade." — the extra interest recommended for
  this grade (100 bps = 1 percentage point per year).

### Factors

Each characteristic is a bar showing the points earned out of the most it
could earn (for example **80 / 120**): green when it earned most of its
points, amber in the middle, red when it earned few. Under the bar is the
reason ("Instalments take 38% of income (≤ 45%).") and the value used.
Labels next to a factor:

- **missing** — the data was not available (or there is no consent); the
  "when missing" points were given.
- **skipped** / **omitted** — not counted for this customer (for example
  "Loans repaid with us" after a write-off). Tick
  **Show … skipped or omitted** to see them.

### Adverse reasons and what the customer is told

**Adverse reasons** lists the main reasons the score is lower than it could
be, biggest first (by default at most four). **What the customer is told**
shows the outcome and the plain reasons you may give the customer. It never
shows points, weights or cut-offs. When the outcome is **Recommend
approve**, no adverse reasons are given to the customer.

### Input snapshot

Click **Input snapshot (… variables, as of …)** to see every piece of data
the score used:

| Column | Meaning |
|---|---|
| **Variable** | The variable's code, for example `debtServiceRatio`. |
| **Value** | The value used ("—" if missing). |
| **Source** | Where it came from: application, internal (your own loan records), bureau, officer verified (alternative data checked by staff) or provider. Underneath, the evidence (for example which record). |
| **Consent** | The first characters of the consent it was used under, for alternative data. |
| **Note** | Why a value is missing, for example "No consent in force for internal behavioural data.", "No verified utility bills record within 365 days." or "No credit bureau is integrated yet." |

The snapshot is frozen: if consent is later withdrawn or a record is
replaced, this evaluation still shows what it used.

### Challenger

If the product has a challenger, a dashed box headed **Challenger — shadow,
does not affect the decision** shows the challenger's score, grade and
outcome. Open **Challenger factors** to see its bars. Use it to learn how
the other scorecard would have judged the same customer; do not use it to
decide the application.

### History

**History (… evaluations)** lists every score of this application, newest
first: **When**, **Role** (champion or challenger (shadow)), **Stage**,
**Scorecard**, **Score**, **Grade**, **Outcome** and **By** (the first
characters of the staff member's ID, or "system" for automatic scoring).
Challenger rows are greyed.

### Re-run the score

For credit analysts and approvers, while the application is **DRAFT**,
**SUBMITTED** or **RECOMMENDED**:

1. Click **Re-run score** on the card.
2. You see "Score re-run". The new evaluation appears with stage
   **rescore**.

Re-run after something that affects the score has changed — for example
new collateral or a guarantee was added, the customer's consent was
recorded, or alternative data was verified. A re-run does not change the
application's status or record a credit decision.

### When the score blocks approval

At approval the system checks the score again. If one of these applies,
approval is refused with "Approval requirements are not met." and the
message:

| Message | Meaning | What to do |
|---|---|---|
| "Credit score … (grade …) is below the minimum …" | Below the product's **Minimum credit score**. | Reject, or change the terms if that is allowed. |
| "The … scorecard strategy declines: …" | A knock-out, the cut-off or the grade rule says **DECLINE**. | Reject the application. |
| "Grade … allows at most … on this product." | The amount is above the grade's maximum. | Reduce the amount (create a new application) or reject. |
| "Grade … is priced at least … (default rate plus … bp); the terms say …" | The product requires the risk add-on and the rate is too low. Only when the product enforces add-ons. | Raise the **Annual rate** (on a new draft) or reject. |

**Recommend approve** never skips any step: the recommendation, every
approval level, approval limits and authenticator sign-in still apply.

---

## 5. Managing scorecards (Products › Scorecards)

### 5.1 The Scorecards tab

At the top, a blue box **Scoring from built-in templates** lists the codes
that are still scored by the built-in template, because your organisation
has no active version of its own.

The **Scorecards** list shows: **Code**, **Name**, **Template** (the
template it was installed from), **Active** (the version in force, or
"template"), **Latest** (the newest version and its status). Click **Open**
to see a scorecard's versions and definition; **Close** to fold it away.

Under it, **Templates** lists the built-in scorecards with the number of
characteristics and the grades. **Variables** lists everything a
characteristic can read.

### 5.2 The version lifecycle

| Status | Meaning | Who acts next |
|---|---|---|
| **DRAFT** | Being written. Only its maker can edit or submit it. | Maker: **Save draft**, **Submit**. |
| **SUBMITTED** | Frozen; waiting for review. | A different person with `scorecard.approve`: **Approve** or **Reject**. |
| **APPROVED** | Approved but not yet in use. | A different person from the maker: **Activate**. |
| **ACTIVE** | In use for new scores. Only one version of a scorecard is active. | **Retire** when no longer wanted. |
| **RETIRED** | No longer used. Kept for the record. | — |
| **REJECTED** | Sent back. The reason appears in red under the status. Final. | Maker: create a **New version** with the corrections. |

Activating a version automatically retires the version that was active
before. A version can never be edited after it is submitted — any change is
a new version.

### 5.3 Install a template (credit analyst)

Do this when you want to adjust `STANDARD_RETAIL` or `THIN_FILE`.

1. Go to **Products › Scorecards**, tab **Scorecards**.
2. In **Templates**, click **Install template** on the row. (It is greyed
   out with "Already installed" if your organisation already has it.)
3. Check **Code** (keep the template's code, so that products naming it
   pick up your version), **Name**, **Description** and **Change summary**.
4. Click **Install as draft**. You see "Scorecard created as a draft".

What happens next: the scorecard opens with version **v1** in **DRAFT**.
Until it is approved and activated, the built-in template still scores.

### 5.4 Create a scorecard from scratch (credit analyst)

1. Click **New scorecard**.
2. Enter a **Code** (capital letters, digits and `_`, for example
   `SME_RETAIL`), a **Name**, optionally a **Description**, and a **Change
   summary**.
3. Click **Create draft**. The draft starts with an empty definition; edit
   it as below.

A new code is used only when a product names it in its **Scoring** step
(section 6).

### 5.5 Edit a draft (the structured editor)

Only the maker of a draft can edit it. Open the scorecard, click the
**DRAFT** version in the **Version** column, and change the definition in
the card below:

- **Base score**, **Minimum score**, **Maximum score**, and **Adverse
  reasons given** (how many adverse reasons to list, 0–10).
- **Grade bands** — highest first: **Grade**, **Label**, **From score**.
  The last band must start at or below the minimum score. **+ Band** adds
  one.
- **Characteristics** — **+ Characteristic** adds one; the arrows move it
  up or down; **Remove** deletes it. For each:
  - **Code**, **Label**, and optionally **Group** (for example CAPACITY).
  - **Variable** — what it reads. The hint underneath says the type, the
    source and whether consent is needed.
  - **Type**:
    - **Bins (value ≤ upper bound)** — fill **Up to (≤)**, **Points** and
      **Reason** for each band, lowest first. The value falls in the first
      band it is less than or equal to. The last band ("and above") has no
      bound. **+ Bin** adds one. Reasons may use `{value}` and
      `{percent}`.
    - **Categories** — tick the values each rule matches (or type them,
      separated by commas), with **Points** and **Reason**.
    - **Linear (weight × (value − centre))** — **Centre**, **Weight**,
      optional **Min points** / **Max points**, and **Reason**.
  - **Omit** (on a band) — the band gives no points and is not listed as a
    factor.
  - **When missing — points** and **When missing — reason** (required).
    Tick **Omit when missing** to leave the characteristic out when there
    is no data.
  - **Skip when** — skip this characteristic when a yes/no variable has a
    given value (for example skip "Loans repaid with us" when there was a
    write-off).
  - **Adverse reason** — tick it, then give a **Reason code** and the
    **Text shown to the customer**. Write it in plain, polite words; it
    may be read out to the customer.
- **Change summary** — say what you changed and why.

Click **Save draft**. The system checks the whole definition when you save.
If something is wrong, the red box lists each problem with where it is (for
example a band out of order). "Unsaved changes. Save the draft before
submitting it." reminds you to save. **Definition JSON** shows the whole
definition as text, for reference.

### 5.6 Test a scorecard (Test score tab)

Testing records nothing.

1. On the version card, click **Test this definition** (or **Test** next to
   a template). The **Test score** tab opens.
2. Choose the **Scorecard**: "Editor: …" (what is in the editor now, even
   unsaved), a template, or any saved version.
3. Type a value for each variable shown. Decimals are typed as `0.25` (not
   25%). Leave a field blank — "(missing)" — to test the missing-value
   outcome.
4. Click **Score**.

The **Result** shows the **Score**, **Grade**, the **Factors** bars and the
**Adverse reasons**. Try typical customers, extreme values and missing data
before you submit.

### 5.7 Submit (maker)

1. On the versions table, click **Submit** on the **DRAFT** row.
2. Confirm ("Submit … for approval? It can no longer be edited.").

You see "Version submitted". It waits for a risk / compliance reviewer.

### 5.8 Approve or reject (risk / compliance reviewer)

1. Open the scorecard and click the **SUBMITTED** version to read it. Use
   **Test this definition** to try it.
2. Click **Approve** and confirm ("… It still needs activating before it
   scores applications."). You see "Version approved".
3. Or click **Reject**, write a **Reason (sent back to the maker)** (at
   least 3 characters) and click **Reject**. You see "Version rejected".

If you made the version, the buttons are greyed out: "You made this
version; a different user must approve it."

### 5.9 Activate (risk / compliance reviewer)

1. Click **Activate** on the **APPROVED** row.
2. Confirm ("… It replaces the current active version for new scores.").

You see "Version activated". From now on new scores use it. Scores already
recorded keep the version they used. The maker of the version cannot
activate it.

### 5.10 Retire (risk / compliance reviewer)

1. Click **Retire** on the **ACTIVE** row and confirm.

With no active version, the built-in template of the same code scores
instead. **Do not retire the only active version of a scorecard you created
yourself** (a code that is not a template) while a product uses it: every
submission, recommendation and approval on that product is then refused
with "Scorecard … named by this product is neither a template nor one of
this organisation's scorecards." Activate a replacement first, or change
the product.

### 5.11 Change an active scorecard

1. Open the scorecard and click **New version** (greyed out while another
   draft or submission is open: "Finish the open draft or submission
   first").
2. Enter a **Change summary** and click **Create draft**. The new draft
   copies the latest definition. You see "New draft version created".
3. Edit, test, save, submit; the reviewer approves and activates it.

### If it is blocked

| Message | What to do |
|---|---|
| "The scorecard definition is not valid." (with a list) | Fix each item listed and save again. |
| "Scorecard … already exists; add a version to it instead." | Open that scorecard and use **New version**. |
| "Only the maker of a draft may change it; add your own version instead." / "Only the maker submits a draft." | Ask the maker, or create your own version once theirs is finished. |
| "This version is … and can no longer be changed; add a new version." | Submitted versions are frozen. Use **New version**. |
| "A … version cannot be …" | The version is in another status; click **Refresh**. |
| "You cannot approve or complete an action you created or proposed" | Another reviewer must approve, activate or retire it. |

---

## 6. Setting the decision strategy on a product (Scoring step)

For product makers. The **Scoring** step is in the product editor, after
**Policies** (see [chapter 04](04-products-and-policies.md), section 5).
Changes create a new product version that the product checker must approve
and activate, like any other product change.

| Field | Meaning |
|---|---|
| **Champion scorecard code** | The scorecard that drives the decision: `STANDARD_RETAIL`, `THIN_FILE` or one of your own codes from **Products › Scorecards**. |
| **Challenger scorecard code (shadow, never decides)** | Optional. Scored silently alongside. Must differ from the champion. |
| **Score thin-file borrowers on a separate scorecard** | Tick to switch on thin-file scoring. |
| **Thin-file scorecard code** | Usually `THIN_FILE`. |
| **Thin file: fewer months of history with us than** | Default 6. Customers with fewer whole months since their first disbursement with you are thin-file. |
| **Thin file: only when there is no bureau score** | Default ticked. |
| **Decline below score (with the eligibility minimum, the stricter applies)** | The cut-off: below this score the outcome is **DECLINE**. Leave blank for none. |
| **Outcome for grades without a rule** | `AUTO_APPROVE`, `REFER` (default) or `DECLINE`. |
| **Grade rules** | One rule per grade (see below). |
| **Knock-out: earlier write-off** | Decline if the customer had a loan written off or sold. |
| **Knock-out: current days past due above** | Decline if a live loan is more days past due than this. |
| **Knock-out: age below** / **Knock-out: age above** | Decline outside these ages. |
| **Knock-out: debt-service ratio above** | Decline if instalments take more than this share of income (entered as a fraction: `0.6` means 60%). |
| **Require the grade's rate add-on at approval** | If ticked, approval is refused when the rate is below the default rate plus the grade's add-on. If not ticked, the add-on is only shown as advice. |

**Grade rules** are typed in a small text box in a structured text format
(JSON), like the fee and document lists. Each rule names a **grade**, an
**outcome**, an optional **maxAmount** (in the product's currency; `null`
for no limit) and a **rateAddOnBps** (extra interest in basis points; 100 =
1 percentage point). Example:

```
[
  { "grade": "A", "outcome": "AUTO_APPROVE", "maxAmount": "5000", "rateAddOnBps": 0 },
  { "grade": "B", "outcome": "REFER", "maxAmount": "3000", "rateAddOnBps": 100 },
  { "grade": "C", "outcome": "REFER", "maxAmount": "1500", "rateAddOnBps": 250 },
  { "grade": "D", "outcome": "DECLINE", "maxAmount": null, "rateAddOnBps": 0 }
]
```

The grades must match the grade letters of the scorecards the product uses.

How the outcome is decided, in order:

1. Any **knock-out** → **DECLINE**.
2. A score below the cut-off (the stricter of **Decline below score** and the
   **Minimum credit score** on the **Eligibility** step) → **DECLINE**.
3. Otherwise the grade's rule, or **Outcome for grades without a rule**.
4. If the amount is above the grade's **maxAmount**, a **Recommend
   approve** becomes **Refer**, and approval is blocked until the amount is
   within the limit.

Note: If the product names a scorecard code that is neither a template nor
one of your scorecards with an active version, applications on the product
cannot be submitted or decided. Check the codes on **Products ›
Scorecards** before you submit the product version.

---

## 7. Consent and alternative data (customer page)

### 7.1 The rule: consent first

Nothing beyond the lender's standard checks is used without the customer's
consent **for that source**, **in force at the moment it is used**. The
standard checks — the customer's own loans with you: loans repaid, current
arrears, write-offs and months of history — need no extra consent. Deeper
use of your own records and all alternative data do:

| Source (as shown) | What it allows |
|---|---|
| **Internal repayment behaviour** | Deeper use of the customer's history with you: on-time repayment ratio, average and worst lateness, instalments observed, the share of repayments through KHQR / wallet / mobile, months of solidarity-group contributions. |
| **Utility bills** | EDC electricity and water bills captured by staff. |
| **Telco statement** | Mobile top-up statement captured by staff. |
| **Rent history** | Rent receipts captured by staff. |
| **Business cash flow** | Cash flow observed by staff (site visit, bank statement, sales records). |
| **Smartphone data**, **Telco data (provider)**, **E-wallet data (provider)** | Data from outside providers. Not connected yet — see section 8. |

Consent must be in force when data is **captured**, when it is
**verified**, and **every time** it is used in a score. If the customer
withdraws consent, the source is not used again from that moment. Scores
already recorded keep what they used.

Note: The rules on which sources need written rather than verbal consent,
and the wording of your consent form, are for your organisation's legal and
compliance team. Follow your internal procedure.

### 7.2 Open the page

1. Open the customer (**Customers › Borrowers** › **View**).
2. Click **Alternative data**. (From the customer's documents page, click
   **Alternative data & consent**.)

The page **Alternative data & consent** has three cards: **Consent in
force**, **Consent history** and **Captured data**.

### 7.3 Record consent (relationship officer or credit analyst)

If the customer signed a consent form, first upload the signed form to the
customer's documents ([chapter 03](03-customers-and-documents.md)).

1. Click **Record consent** (top right), or **Record consent** / **Renew**
   on a row of **Consent in force** to pre-select that source.
2. Choose the **Source**.
3. Choose **How consent was given**: **Signed consent form**, **Recorded
   verbal consent** or **Borrower portal**.
4. Check the **Purpose** (at least 5 characters; it starts as "Credit
   assessment of loan applications") and, optionally, the **Scope** (what
   exactly may be used, for example "Statements of the last 12 months").
5. For a signed form, choose the **Signed form** from the customer's
   documents (required). For other methods you may choose a **Supporting
   document (optional)**. If the list says "No documents — upload one
   first", use **Open the document library**.
6. **Effective from** — leave blank for now; it cannot be in the future.
7. **Expires** — starts one year ahead. It must be in the future and no
   longer than your organisation's maximum (default 730 days).
8. Click **Record consent**. You see "Consent recorded".

Record one consent per source. To extend a consent before it expires,
record a new one (**Renew**).

### 7.4 Withdraw consent

When the customer withdraws consent:

1. In **Consent history**, click **Withdraw** on the grant.
2. Write the **Reason** (at least 3 characters).
3. Click **Withdraw consent**. You see "Consent withdrawn".

The grant stays in the history, marked as withdrawn, and a withdrawal entry
is added. Nothing is deleted.

### 7.5 Read the consent cards

- **Consent in force** — one row per source: **Source**, **Status**,
  **Expires**.
- **Consent history** — every grant and withdrawal, newest first: **When**,
  **Action**, **Source**, **Purpose / reason**, **Method** (with the
  document, if any), **Effective**, **Expires**, **By**. Entries are never
  edited.

Note: To confirm that a source really has consent, check that the
**Expires** column of **Consent in force** shows a date (not "—"), and find
the grant in **Consent history** without a withdrawal. A source with no
consent shows no expiry date.

### 7.6 Capture alternative data (relationship officer or credit analyst)

You need: consent in force for the source, and the bill, statement or
visit report uploaded to the customer's documents.

1. Click **Capture data**.
2. Choose the **Kind**: **Utility bills**, **Telco statement**, **Rent
   history** or **Business cash flow**.
3. Enter **Period from** and **Period to** — the months the document
   covers. The period cannot end after today.
4. Fill in the fields for the kind:

   | Kind | Fields |
   |---|---|
   | **Utility bills** | **Utility** (Electricity or Water), **Issuer** (e.g. EDC), **Account reference**, **Months observed (1–60)**, **Months paid on time** |
   | **Telco statement** | **Operator**, **Months observed (1–60)**, **Months with a top-up** |
   | **Rent history** | **Landlord**, **Months observed (1–60)**, **Months paid on time** |
   | **Business cash flow** | **Method** (Site visit, Bank statement, Sales records, Other), **Months observed (1–60)**, **Currency** (USD or KHR), **Average monthly inflow**, **Average monthly outflow** |

5. Choose the **Evidence document** (required — the bill, statement or
   visit report the data was taken from).
6. Optionally add a **Note**.
7. Click **Save record**. You see "Record saved — awaiting verification".

The record appears in **Captured data** as **PENDING**.

### 7.7 Verify or reject a record (a different person)

For credit analysts and risk / compliance reviewers. You cannot verify a
record you captured ("You captured this record; another officer must verify
it.").

1. In **Captured data**, open the evidence document from the customer's
   documents and compare it with the figures in **Data**.
2. If they match, click **Verify**. You see "Record verified".
3. If not, click **Reject**, write the **Reason** and click **Reject**.

A decided record is frozen. To correct one, capture a new record.

### 7.8 When captured data counts in a score

A record is used only when **all** of these are true:

- it is **VERIFIED** (by someone other than the person who captured it);
- the customer's consent for that source is in force when the score runs;
- its period ended no more than **365 days** ago (your organisation can
  change this in **Lending settings**). Older records are ignored, so
  capture fresh bills for each new application;
- it is the newest record of its kind (a newer record replaces an older
  one).

A **business cash flow** in riel is converted to the loan's currency at
your organisation's own published exchange rate (**Finance › FX rates**)
before it is compared with the instalment. If no rate is published, the
cash flow is left out and the input snapshot says why.

After verifying data or recording consent for an application already in
progress, ask the analyst to **Re-run score** (section 4).

### If it is blocked

| Message | What to do |
|---|---|
| "A signed consent form must be filed in the customer's documents first; give its documentId." | Upload the signed form, then choose it under **Signed form**. |
| "Consent may run at most … days; ask the customer to renew it after that." | Choose an earlier **Expires** date. |
| "Consent can only be recorded once it has been given (effectiveAt not in the future)." / "expiresAt must be in the future." | Correct the dates. |
| "This consent was already withdrawn." | Nothing to do; record a new consent if the customer agrees again. |
| "The customer has not consented to the use of … data (or the consent was withdrawn or has expired)." | Record the consent first. |
| "The customer's consent for this data is no longer in force; it cannot be verified." | Ask the customer to renew consent, record it, then verify. |
| "The supporting document must be one of this customer's documents." / "The supporting document is deleted or was rejected." | Upload or choose a valid document of this customer. |
| "The observed period cannot end after today." / "periodFrom must not be after periodTo." | Correct the period. |
| "This record is already …" | Someone else decided it; refresh the page. |

---

## 8. External data providers and the credit bureau

**Products › Scorecards**, tab **Data providers**, shows the outside data
sources: **Smartphone data**, **Telco data (provider)** and **E-wallet data
(provider)**.

Note: **No outside provider is connected yet.** The yellow box "These
sources require an integration" explains that no provider adapter ships
with the system. An administrator can store a provider's endpoint and
credentials (**Configure** → **Configure a provider**: **Source**,
**Provider code**, **Endpoint** (https only), **Credentials** — stored
encrypted and never shown again → **Submit for approval**), and a second
administrator can **Approve** it. Even then, the source stays unusable
until your IT team installs a connector for that provider. Until then,
these inputs are always missing in the input snapshot, and scorecards give
them their "when missing" points. Staff-captured data and internal
behaviour work without any provider.

The tab needs administrator (access-policy) permissions. Other users may
see an error on it.

Note: **The Credit Bureau Cambodia (CBC) is not connected to scoring yet.**
The **Bureau score** input is always empty ("No credit bureau is integrated
yet."), so `STANDARD_RETAIL` gives it 0 points and every customer counts as
having no bureau score for the thin-file rule. See
[chapter 03](03-customers-and-documents.md) for the CBC check screen.

---

## 9. Scorecard monitoring (Products › Scorecard monitoring)

For risk / compliance reviewers and credit analysts. The report is worked
out from your own applications and loans every time you open it. It shows
one card per scorecard version and role (**CHAMPION**, or **CHALLENGER ·
shadow**).

### Filters

- **Scorecard** — one code, or **All**.
- **Bad at DPD ≥** — when a loan counts as bad (default 30 days past due).
- **Performance months** — how long after disbursement a loan is watched
  (default 12).
- **Baseline from / to** and **Recent from / to** — the two periods compared
  for stability (default: the 180 days before the recent window, and the
  last 90 days).

Click **Apply**, or **Reset** to go back to your organisation's defaults
(set in **Lending settings**, [chapter 18](18-tenant-administration.md)).

### What the figures mean

| Figure | Plain meaning | Rule of thumb |
|---|---|---|
| **Applications** | Applications scored by this version (latest score of each). | — |
| **Average score** | The average score. | Watch for sudden moves. |
| **Approval rate** | Approved or booked ÷ (approved + rejected). | Should fall from grade A to grade D. |
| **Mature loans** | Booked loans watched for the full performance period, split into good and bad. Only these count for bad rate, Gini, AUC and KS. | Below a few hundred mature loans, or about 30 bad ones, treat the figures as rough. |
| **Bad rate** (per grade) | Share of mature loans that went bad: an instalment reached the bad days-past-due, or the loan was written off or sold, within the performance months. | Should rise steadily from A to D. If a better grade has more bad loans than a worse one, the bands need attention. |
| **Gini** (and **AUC**) | How well the score separates good loans from bad ones. 0 = no better than chance; 1 = perfect. Gini = 2 × AUC − 1. | Below 0.20 weak; 0.20–0.40 fair; 0.40–0.60 good; above 0.60 very strong (check the sample is large enough). |
| **KS** | The largest gap between the share of bad loans and the share of good loans at or below one score; shown with the score where it happens. | Below 0.20 weak; 0.20–0.40 acceptable; above 0.40 good. The "at score" is a useful hint for a cut-off. |
| **PSI** | Population stability index: how much the grade mix of recent applicants differs from the baseline. | Below 0.10 **stable**; 0.10–0.25 **watch**; above 0.25 **shifted** — find out why (new product, new branch, a change in the market or in data capture) before trusting the score. |

Below the figures: **Distribution by grade** (bars), a table per grade
(**Count**, **Share**, **Scores**, **Outcomes**, **Approved**, **Rejected**,
**Approval rate**, **Mature**, **Bad**, **Bad rate**), and **Stability
(baseline → recent share)** with each grade's **PSI contribution**.

Challenger rows are shadow scores: their approval figures reflect the
champion's decisions, not the challenger's. Compare a challenger with the
champion on Gini, KS and the bad rate by grade over the same loans.

Note: A new scorecard has no mature loans for at least the performance
period (12 months by default). Until then, bad rate, Gini, AUC and KS show
"—". Approval rates and PSI are available at once.

---

## 10. Tuning your scorecard — a short workflow

1. **Look** (risk / compliance, monthly): on **Scorecard monitoring**,
   check PSI first, then bad rate by grade, Gini and KS. Write down what
   looks wrong (for example "grade C bad rate is close to grade D").
2. **Decide** (credit risk committee or your usual forum): which
   characteristic, band or cut-off to change. Change one thing at a time.
3. **Draft** (credit analyst): open the scorecard, **New version**, change
   it, **Save draft** with a clear **Change summary**.
4. **Test** (credit analyst): on **Test score**, try typical customers of
   each grade and the cases that worried you. Check the reasons and adverse
   reasons read well.
5. **Shadow** (optional, safest): put the new scorecard in as the product's
   **challenger** under a different code (product maker / checker), and
   compare it with the champion on monitoring for a few months.
6. **Submit and approve** (analyst, then risk / compliance): the reviewer
   tests again, approves and activates.
7. **Adjust the strategy** if needed (product maker / checker): grade rules,
   maximum amounts, add-ons or cut-off on the **Scoring** step.
8. **Watch** monitoring after the change, and record the reasons in your
   model-change log.

Note: The built-in weights are a starting point, not a model fitted on your
data. Once monitoring shows enough mature loans, your credit risk team can
re-weight the scorecard on your own experience.

---

## 11. In the demo organisation (Demo Lending Co)

The demo is set up so you can see every part of scoring
([demo walkthrough](demo-walkthrough.md)):

- **Scorecards:** both `STANDARD_RETAIL` and `THIN_FILE` are installed as
  the organisation's own scorecards, version **v1**, **ACTIVE** — made by
  `analyst`, approved and activated by `risk`.
- **Personal instalment loan (`PL-STD`):** champion `STANDARD_RETAIL`, with
  `THIN_FILE` as a silent **challenger**. Every application shows the
  champion score and a challenger box.
- **Microenterprise loan (`MF-IND`):** thin-file scoring is switched on
  (`THIN_FILE`, fewer than 6 months of history). New customers are scored
  on `THIN_FILE` and show the **THIN FILE** badge.
- **Srey Mom** (Siem Reap): recorded verbal consent for internal repayment
  behaviour, utility bills, telco statement and business cash flow, and
  three verified records — EDC electricity bills (11 of 12 months on
  time), a mobile top-up statement (top-ups in 12 of 12 months) and a rice
  trading cash book (site visit, 6 months, inflow 6,000,000 and outflow
  4,200,000 KHR a month), all covering last year.
- **Sokha Chan** (Phnom Penh): recorded verbal consent for utility bills and
  rent history, and two verified records — water bills (12 of 12 months on
  time) and rent receipts (10 of 12 months on time).

The demo consents last one year from the demo set-up.

Things to try:

1. *As `officer.rep`:* open **Srey Mom** › **Alternative data** and look at
   the consents and verified records.
2. Create and submit an application for Srey Mom on **Microenterprise
   loan** (`MF-IND`). The **Credit score** card shows `THIN_FILE` with the
   **THIN FILE** badge, and the factors for utility bills, mobile top-ups
   and cash flow. Open **Input snapshot** to see each value, its source and
   consent. If no USD/KHR rate has been published under **Finance › FX
   rates**, the cash-flow input is missing for a USD loan and its note says
   so.
3. *As `analyst`:* on a **PL-STD** application for Sokha Chan, compare the
   champion score with the challenger box below it.
4. *As `officer.pnh`:* capture a new record for Sokha Chan; *as
   `analyst`:* verify it, then **Re-run score**.
5. *As `analyst`:* on **Products › Scorecards**, open `STANDARD_RETAIL`,
   create a **New version**, change a band, test it; *as `risk`:* approve
   and activate it.
6. *As `risk`:* open **Products › Scorecard monitoring**. With a fresh demo
   there are few or no mature loans, so bad rate, Gini and KS show "—".

---

## 12. Common questions

| Question | Answer |
|---|---|
| The score says **Recommend approve**. Can I book the loan? | No. It still needs the recommendation and all approvals (see [chapter 05](05-applications-and-credit-decisions.md)). |
| Why is a factor marked **missing**? | Open **Input snapshot** and read the **Note**: no consent, no verified record, record too old, no exchange rate, or no provider / bureau connected. |
| I verified a utility bill but the score did not change. | Scores are recorded at submission, recommendation and approval. Click **Re-run score**. Also check consent is in force and the bill period ended within 365 days. |
| Can I delete a consent or a record entered by mistake? | No. Withdraw the consent with a reason, or reject the record (another person) and capture a correct one. |
| Why does the customer have no bureau score? | The credit bureau is not connected to scoring yet. |
| Why do I not see **Products › Scorecards**? | You need `scorecard.read` (see section 2). |
