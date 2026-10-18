# Products, policies, workflows and the simulator

Who this is for: product makers and product checkers who design and approve loan products, risk and compliance staff who review them, and anyone who needs to price a loan before it is booked.

This chapter covers everything under the **Products** menu section:

| Menu item | What it is for |
|---|---|
| **Products › Products & versions** | Create lending products and manage their versions (draft, approval, activation, retirement). |
| **Products › Policy library** | Reusable, versioned pieces of loan terms (prepayment, late charges, payment allocation, non-accrual) that products can offer as a menu. |
| **Products › Catalogue** | The loan families and templates you can build products from, and what the lending engine can do today. |
| **Products › Workflows** | Which origination checks run and how many approvers an amount needs. |
| **Products › Simulator** | Price a loan and see its repayment schedule against any product version, without booking anything. |

The menu item **Products › Products (original)** belongs to the older loan module and is described in [21-original-loan-module.md](21-original-loan-module.md).

---

## 1. Key ideas before you start

**Family and template.** Every product is built from a template (for example a personal instalment loan, a construction loan or an overdraft). Templates are grouped into ten loan families: Personal / consumer, Property, Vehicle / assets, Education, Microfinance, SME / commercial, Agriculture, Corporate / project, Trade / receivables and Institutional / public. The template gives a sensible starting configuration; you then adjust it. A product can never change its family or template later.

**Product and version.** A product (for example `PERSONAL_STD`) has numbered versions: v1, v2, v3 and so on. Each version holds the complete configuration: limits, pricing, repayment rules, fees, documents, accounting codes and more. Only one version of a product can be active at a time. New applications always use the active version.

**Versions are frozen once submitted.** You can edit a version only while it is a draft. Once it is submitted it cannot be changed. To change an approved or active product you create a new version.

**Loans keep their own copy of the terms.** When a loan is booked, the terms are copied into the loan's agreement. Later product changes, including retiring the product, never change the terms of loans that are already booked. You can see which product and policy versions a loan uses on the loan's **Agreement versions** card (see [08-servicing-changes.md](08-servicing-changes.md)).

**Maker-checker (four-eyes control).** The person who creates or edits a version (the *maker*) cannot approve it, reject it or activate it. A second, different person (the *checker*) must do that. This guards against errors and fraud: no single person can put new pricing or rules live alone. If you try to approve your own work, the system refuses with:

> You cannot approve or complete an action you created or proposed

**Roles.** The standard roles are **Product maker** (creates and edits products, policies and workflows, and submits them) and **Product checker** (approves, rejects, activates and retires product versions and policies, and approves workflows). Your tenant administrator can grant these; see [02-roles-and-approvals.md](02-roles-and-approvals.md).

**Your work queues.** On your **Home** page (see [01-getting-started.md](01-getting-started.md)) these queues bring product work to you:

| Queue | Who sees it | What is in it |
|---|---|---|
| **Your product drafts** | Product makers | Your draft product versions. |
| **Product and policy versions to review** | Product checkers | Submitted product versions and submitted policy versions made by someone else. |
| **Approved versions to activate** | Product checkers | Approved product versions made by someone else, waiting to go live. |
| **Workflow versions to approve** | Workflow approvers | Submitted workflow versions. |

---

## 2. Product version statuses

Status names appear as coloured badges. The badge shows the status in capitals with spaces, for example **SUBMITTED**.

| Status | Meaning | What can happen next |
|---|---|---|
| **DRAFT** | Being prepared by its maker. Only the maker can edit it. | Maker edits it, then clicks **Submit for approval**. |
| **SUBMITTED** | Frozen and waiting for a checker. | A different person clicks **Approve** or **Reject**. |
| **APPROVED** | Accepted by the checker but not yet live. | A person other than the maker clicks **Activate**. |
| **ACTIVE** | Live. New applications for this product use this version. | **Retire** it, or create a **New version** to replace it. |
| **RETIRED** | No longer used for new applications. Loans already booked on it are not affected. | You can create a **New version** from it. |
| **REJECTED** | The checker sent it back, with a reason. It cannot be edited. | Create a **New version** and try again. |

On the **Products & versions** list, each product also shows **ACTIVE** (it has a live version) or **INACTIVE** (no live version).

When a new version is activated, the previously active version of the same product is moved to **RETIRED** automatically on the same business date. Its loans keep their terms.

---

## 3. Browse the catalogue

Use the catalogue to see which templates you can build products from, and to check what the lending engine can actually do today.

To open the catalogue:

1. Go to **Products › Catalogue**. The page is titled **Product catalogue**.
2. The **Families & templates** tab lists each loan family with a count such as "3 of 4 templates available".
3. Each template card shows its name, code and description, and either **Available** or **Unavailable**.
   - A template marked **Phase 1 slice** is one of the first templates delivered.
   - Click **Requires N capabilities** to see the engine capabilities the template needs.
   - An **Unavailable** template lists its **Missing capabilities**. You cannot create a product from it until those capabilities are delivered.

### The capability matrix

The **Capability matrix** tab is an honest list of what the engine supports. Each row has a **Capability**, **Status**, **Phase**, **Description** and **Limitation / evidence**. Use the filter buttons at the top to show one status at a time.

| Capability status | Meaning |
|---|---|
| **IMPLEMENTED** | Built and tested. Only this status allows a product to be activated. |
| **SIMULATION ONLY** | Can be priced in the simulator but never booked. |
| **REQUIRES INTEGRATION** | Needs a connection to an outside system (payment provider, KYC service, credit bureau and so on) that this platform does not ship yet. |
| **NOT IMPLEMENTED** | Not built. |

Note: Families and templates are maintained by the platform operator, not by your organisation. If you need a template that is not listed, ask your system administrator.

---

## 4. Create a new product

Do this when you want to offer a new kind of loan. You need the **Product maker** role (permission to create products).

To create a product:

1. Go to **Products › Products & versions** and click **New product**.
2. The panel **New product — choose a template** lists templates by family. Only templates whose required capabilities are implemented can be clicked. Hover over a greyed-out one to see what it is missing.
3. Click a template. The panel changes to **New product from** *template name*.
4. Enter the **Product code**. Use capital letters A–Z, digits 0–9, `_` and `-`, 2 to 32 characters (for example `PERSONAL_STD`). The code must be unique in your organisation.
5. Check the **Product name** (it starts as the template's name).
6. Work through the configuration steps on the left (see section 5). The template has already filled in sensible values; change only what you need. Use **Next →** and **← Back**, or click a step name.
7. Click **Create draft product**.

What happens next: the product is created with version 1 in **DRAFT**, and you are taken to the version page. The change summary is set to "Initial version from template ..." automatically.

If it is blocked:

| Message | What it means and what to do |
|---|---|
| "Product code ... already exists." | Choose a different code. |
| "Product code must be 2–32 characters: A–Z, 0–9, _ or -." | Correct the code. |
| "Template ... is unavailable until its required capabilities are implemented: ..." | Choose another template; see the capability matrix. |
| "Product configuration is invalid. — see the highlighted steps." | Steps with problems show a red number. Open each one, read the issues listed at the top, fix the fields marked in red and try again. |
| **Change template** | Use this button if you picked the wrong template; your edits are discarded. |

---

## 5. The configuration steps

The same editor is used when you create a product and when you edit a draft version. Each step edits one part of the configuration. Rates are entered as decimal fractions: `0.12` means 12%; the hint under the field shows the percentage. Fields marked "(none)" may be left blank.

| Step | What you set there (main fields) |
|---|---|
| **Identity** | **Family** and **Template** (read-only), **Product name**, **Description**, **Currency** (for example USD or KHR), **Legal entity code**, **Liability** (individual or group), **Customer types**, **Channels**, **Segments**, **Countries**, **Eligible branch codes (null = all)**. |
| **Attributes** | **Secured**, **Rate type** (fixed or floating), **Green purpose**, **Digital channel**, **Recourse**, **Structure** (conventional, Murabaha, Ijarah), **Facility type** (term, revolving, overdraft, staged drawdown) and the facility limits, fees and tranches for limit-based products. |
| **Group lending** | Tick **Group terms** for group products: minimum and maximum members, share basis, minimum membership days, leader requirement, exit rules. Only for group liability products. |
| **Card / BNPL / lease** | Tick **Credit card terms (LT-07)**, **BNPL merchant settlement (LT-11)** or **Lease terms (LT-15)** for those specialised products. |
| **Limits** | **Minimum amount**, **Maximum amount**, **Minimum instalments**, **Maximum instalments**. |
| **Eligibility** | **Minimum age (years)**, **Max age at maturity (years)**, **Minimum monthly income**, **Minimum business age (months)**, **Max debt-service ratio**, **Minimum credit score**, **Minimum DSCR**, **Employment types**. |
| **Pricing** | **Fixed-rate pricing** (default, minimum and maximum annual rate), **Floating pricing**, **Rate convention**, **Interest method** (reducing balance or flat), **Accrual basis**, **Day count**, **Regulatory rate cap**, **Rounding increment** and **Rounding mode**, capitalization, late-payment **Penalty** settings and caps, **Returned-payment fee**, **Promotional rate (campaign)**, and **Fees**. |
| **Repayment** | **Method** (equal instalment, equal principal, interest-only, balloon, explicit), **Frequency**, grace limits, **Stepped instalments**, business-day convention and **Holiday calendar code**, **Max back-date days**, prepayment and early-settlement rules, **Lock-in tiers (early repayment charges)**, **Payment allocation order**, **Allocation strategy**, and **Money beyond what is due**. |
| **Security** | **Collateral required**, **Accepted collateral types**, **Max loan-to-value**, **Valuation max age (days)**, **Guarantee required**, **Minimum guarantors**, **Margin call cure period (days)**, **Haircuts by collateral type**. |
| **Operations** | **Workflow code** (see section 10), **Restructure allowed**, **Write-off minimum DPD**, **Minimum down payment**, **Non-accrual** settings, **Credit bureau**, **KYC** and **Payments** integration settings, **Required documents**, **Disbursement conditions**, **Delinquency buckets**, **Collection stages**. |
| **Restructuring** | **Allowed options**, capitalization permissions, maximum extension and deferral, probation, proposal validity, negotiated settlement, post-write-off recovery and refinancing rules. |
| **Policies** | **Policy menus**: which policy library entries this product offers (see section 9). |
| **Scoring** | **Champion scorecard code**, **Challenger scorecard code (shadow, never decides)**, thin-file scoring, **Decline below score**, **Outcome for grades without a rule**, **Grade rules** (outcome, maximum amount and rate add-on per grade), knock-outs and **Require the grade’s rate add-on at approval**. See [chapter 24](24-scorecards-and-alternative-data.md), section 6. |
| **Accounting** | The ledger account code used for each kind of posting (cash, loans receivable, interest income and so on). |
| **Review / JSON** | The complete configuration as text. |

Some lists (fees, documents, tranches, delinquency buckets and similar) are edited in small text boxes using a structured text format called JSON. The hint under each box shows the expected shape. Changes in these boxes are applied when you click out of the box; if the text is not valid you see "Invalid JSON (not applied)". On **Review / JSON** you can edit everything at once and click **Apply JSON**, or **Discard edits**.

Note: The **Operations** step settings decide whether the product depends on outside systems:

- **Credit bureau** set to **REQUIRED**,
- **KYC** set to **EXTERNAL_REQUIRED**,
- **Payments** set to **ADAPTER**.

Each of these needs an integration that the platform does not ship yet (see [17-webhooks-and-integrations.md](17-webhooks-and-integrations.md)). A product with any of them can be drafted and approved but **cannot be activated**. Keep **Credit bureau** at **NONE** or **OPTIONAL**, **KYC** at **MANUAL** and **Payments** at **MANUAL** unless your IT team confirms the integration is live.

Note: The **Minimum credit score** field is a simple eligibility gate: below it, approval is refused. How the product uses the credit score — which scorecard, a challenger, thin-file scoring, and what each grade leads to — is set on the **Scoring** step and described in [Scorecards and alternative data](24-scorecards-and-alternative-data.md), section 6.

---

## 6. The product version page

Open a version by clicking **Open** next to it on **Products & versions**. The page title shows the product name, version number and status badge. It has:

- **Version** card: **Status**, **Effective** dates, **Maker**, **Checker**, **Change summary** and a link to the **Active version**.
- **Validation** card: **Configuration is valid**, or the list of issues.
- **Capabilities** card: how many capabilities this configuration needs, and either **All required capabilities are implemented** or "*N* missing — activation will be refused", with the list.
- **Differences from active version**: a table with **Path**, **Before** and **After** for every setting that differs from the live version.
- **Configuration**: the full configuration (read-only unless this is your draft).
- **Simulate pricing →** link at the top: opens the simulator with this version selected (section 11).

Buttons at the top appear only when they apply to the current status. If you lack the permission or the rules forbid you, the button is greyed out; hover over it to see the reason.

### Edit a draft

Only the maker of a draft can edit it.

1. On the version page of a **DRAFT** version, click **Edit draft**.
2. Change settings in the configuration steps.
3. Enter a **Change summary** ("What changed and why"). The checker sees this.
4. Click **Save draft** (or **Cancel** to discard).

If someone else's draft is open, the server refuses with "Only the maker of a draft can edit it; create your own version instead." In practice, ask the maker to finish or abandon the draft (a checker can reject it once it is submitted).

### Submit for approval (maker)

1. On your **DRAFT** version, click **Submit for approval**.
2. The status becomes **SUBMITTED**. The configuration is now frozen.

### Approve or reject (checker)

1. Open the version from **Product and policy versions to review** on your Home page, or from **Products & versions**.
2. Review the highlighted card **Changes to review before approval**. It shows every difference from the currently active version. For a brand-new product it says "There is no active version — this is the first configuration."
3. Also check the **Validation** and **Capabilities** cards.
4. Click **Approve**, or click **Reject**, enter a **Reason** and click **Confirm rejection**. A reason is required: "A rejection reason is required."

The checker must be a different person from the maker.

### Activate (checker)

1. Open an **APPROVED** version (it appears in **Approved versions to activate**).
2. Click **Activate**. Confirm the dialog **Activate this version?** ("New applications will use this configuration. Any currently active version will be superseded.").
3. The version becomes **ACTIVE**, effective from today's business date. The previously active version becomes **RETIRED**.

The maker cannot activate their own version; the checker who approved it can.

If activation is blocked:

| Message | What to do |
|---|---|
| A red notice **Activation refused: the engine lacks capabilities this configuration needs**, with "Cannot activate: required capabilities are not implemented — integration.credit_bureau (REQUIRES_INTEGRATION)." (the capability names vary) | The configuration uses something the platform cannot do yet, often an outside integration. Create a new version that removes it (for example set **Credit bureau** back to **OPTIONAL** or **NONE**), and have it approved. |
| "Accounting mapping references unknown ledger accounts: ..." | A code on the **Accounting** step does not exist in your chart of accounts. Fix the code in a new version, or ask Finance to create the account (see [14-accounting-and-period-close.md](14-accounting-and-period-close.md)). |
| "Policies on this product's menus have no approved version: ..." | A policy named on the **Policies** step has no approved version yet. Get the policy approved in the **Policy library** first. |
| "This product version was changed by another request. Reload and try again." | Someone else acted at the same moment. Reload the page. |

### Retire a version (checker)

Do this to stop a product being sold, without replacing it.

1. Open the **ACTIVE** version and click **Retire**.
2. Confirm **Retire this version?** ("The product will no longer accept new applications on this version. Existing loans keep their terms.").

### Create a new version

Use this to change a live product, or to try again after a rejection.

1. Open the product's **ACTIVE**, **RETIRED** or **REJECTED** version.
2. Click **New version**. A new draft is created and opened. Its change summary reads "Copied from v*N*".
3. Edit, submit, approve and activate it as above.

Note: The new draft copies the most recent version of the product (the highest version number), which may be a rejected one rather than the active one. Check **Differences from active version** before you submit.

If it is blocked: "Finish or reject the version already in progress first." means the product already has a version in **DRAFT**, **SUBMITTED** or **APPROVED**. Only one version can be in progress at a time.

---

## 7. Feature flags and products

Feature flags are on/off switches managed under **Risk & audit › Access & policy**, on the **Feature flags** tab (see [18-tenant-administration.md](18-tenant-administration.md)). They do not stop you configuring or activating a product, but they can stop new business on it.

- Each loan family has its own flag (for example `lending.family.personal.enabled`). These are on by default.
- Some product features have their own flag, **off by default**: floating rates (`lending.pricing.floating_rate`), group liability (`lending.group.joint_liability`), revolving drawdowns, overdrafts, staged drawdowns, trade finance, syndication, project finance, institutional lending, borrowing base, income-contingent education loans and Murabaha. Live credit bureau enquiries (`lending.integration.credit_bureau`) are also off by default.
- Balloon repayment (`lending.repayment.balloon`) is on by default.

When a flag is off, staff trying to start or approve new applications on an affected product see a message such as "lending.pricing.floating_rate is currently unavailable". Loans already booked continue to be serviced. Ask your tenant administrator to switch the flag on (this needs two administrators).

---

## 8. Policy library: concepts

A policy is a reusable, versioned piece of loan terms. Instead of writing the same prepayment rules into ten products, you define them once in the library, and products offer them as a *menu*. There are four kinds of policy:

| Kind (code) | Label on screen | Replaces this part of the product configuration |
|---|---|---|
| `PREPAYMENT` | **Prepayment & lock-in** | Prepayment, early settlement and early repayment charges (lock-in). |
| `LATE_CHARGES` | **Late charges** | The late-payment penalty. |
| `ALLOCATION` | **Payment allocation** | The order in which payments are applied. |
| `NON_ACCRUAL` | **Non-accrual** | When interest stops being recognised as income. |

A policy can have **parameters**: numbers such as "lock-in months" with a default, a minimum and a maximum. A product can narrow those bounds.

Policy version statuses:

| Status | Meaning |
|---|---|
| **DRAFT** | Being prepared; click **Submit for approval** when ready. |
| **SUBMITTED** | Waiting for a different person to **Approve** or **Reject**. |
| **APPROVED** | Can be used by products and new contracts. Approved versions never change. |
| **REJECTED** | Sent back with a reason (shown on the version). |
| **RETIRED** | No new contracts can use it. Loans already booked keep the terms they were frozen with. |

There is no separate "activate" step for policies: approval makes a version usable. If several versions are approved, new contracts use the highest-numbered approved version. The **Live** column shows that version, or "none approved".

---

## 9. Work with the policy library

### Browse policies

1. Go to **Products › Policy library**.
2. Use the tabs **All kinds**, **Prepayment & lock-in**, **Late charges**, **Payment allocation**, **Non-accrual** to filter.
3. Each kind shows a table with **Code**, **Name**, **Live** and **Versions** (each version with its status badge). Click a code or **Open** to see the policy.

### Create a policy (maker)

1. On **Policy library**, click **New policy**.
2. Choose the **Kind**, enter a **Code** (capital letters, digits, `_` or `-`, for example `P-LOCK12`; unique per kind), a **Name**, and optionally a **Description** and **Change summary**.
3. Define the policy:
   - Pick a **Starter template** and click **Use template** to fill in a ready-made example (for example "Lock-in: charge during the first months"). This replaces the parameters and body.
   - Optionally add **Parameters** with **Add parameter**: give each a **Name**, **Type** (int or decimal), **Default**, **Min**, **Max** and **Label**. Up to 10 parameters.
   - Adjust the **Body (JSON)**. It may contain only the keys shown under the box for that kind. To use a parameter in the body, write `{ "$param": "name" }`; **Copy ref** copies this for you.
   - Below the box you see **Valid JSON.** (click **Format** to tidy it) or **Invalid JSON**.
4. Click **Create policy (v1 draft)**.

If there are problems you see **Fix these before saving** with a list, for example "The body uses undeclared parameter: lockInMonths." or "the default must lie between min and max". The server also tests the policy against a standard product; if it would make any product invalid you see "The policy body is not valid." with the details.

If the code is taken: "A PREPAYMENT policy with code P-LOCK12 already exists; add a version to it instead."

### Submit, approve, reject, retire

1. Open the policy. The **Versions** table lists every version with **Change summary**, **Maker / checker** and **Created**. Click a row to select it.
2. The selected version's card shows **Parameters**, **Body** and **Changes from v***N* (a Path / Before / After table).
3. Use the buttons on that card:
   - **DRAFT**: **Submit for approval** (maker).
   - **SUBMITTED**: **Approve**, or **Reject** with a required **Reason** then **Confirm rejection** (a different person). If you are the maker, a notice says "You made this version. A different user must approve or reject it."
   - **APPROVED**: **Retire**, after confirming "New contracts can no longer be composed from this version. Contracts already booked keep the terms they were frozen with."

Policy approval needs the same permissions as product approval (Product checker).

### Change a policy

1. Open the policy and click **New version**.
2. The form **New version of** *code* **(from v***N***)** starts from the latest version. Enter a **Change summary** ("What changes and why — shown to the checker"), edit the definition, and check **Changes from v***N*.
3. Click **Save draft version**, then submit it for approval as above.

Note: Finish or withdraw an open draft before starting another; the **New version** button warns "A version is already in draft or awaiting approval" when you hover over it.

### Offer policies on a product

On a product version's **Policies** step, the **Policy menus** box lists, for each kind, a **defaultCode**, the **menu** of codes a contract may choose from, and optional **parameterBounds** that narrow a parameter's range. For example, a product could default to `P-LOCK12` and also allow `P-NONE`, with lock-in months between 6 and 18. The step note reads: "Every code must have an approved version before the product can be activated."

When an application is booked, the product's default policy (or the chosen one) is resolved and frozen into the loan's agreement. The loan's **Agreement versions** card shows, for example, "prepayment: **P-LOCK12** v2 (lockInMonths=12)". A loan with no policies shows "product terms".

A loan officer can pick a non-default policy from the menu, or set a parameter within the product's bounds, under **Contract policies** on the application (see [Applications and credit decisions](05-applications-and-credit-decisions.md#contract-policies)). Left blank, the product's default policy applies at its default parameters.

---

## 10. Workflows

A workflow decides which optional origination checks run and how many independent approvers an application needs, depending on the amount. Each product names its workflow in **Operations › Workflow code**.

Note: The origination path itself is fixed (recommend, approve, book, disburse). A workflow only switches optional checks on or off and sets the approval levels. The page says: "Phase 1 executes a fixed origination path (recommend → approve → book → disburse). A workflow chooses the optional checks and the approval levels."

### What the page shows

Go to **Products › Workflows**.

- **Built-in workflows** ("Used when no tenant version is active for a code"):
  - **Standard retail** (`STANDARD_RETAIL`): all checks, one approver for any amount.
  - **Secured, two approvers above threshold** (`SECURED_TWO_LEVEL`): one approver, and two approvers from USD 100,000 or KHR 400,000,000.
- **Tenant workflow versions**: your organisation's own versions, with **Code**, **Definition** and **Status**.
- **Workflow builder**: to create a new version.

### Steps

| Step | Can it be switched off? | Effect |
|---|---|---|
| `DOCUMENT_CHECK` | Yes | Mandatory documents must be present and valid before the application can move on. |
| `KYC_CHECK` | Yes | The borrower's KYC must be verified ("The borrower's KYC must be verified."). |
| `CREDIT_RECOMMENDATION` | No (mandatory) | An analyst recommends. |
| `CREDIT_APPROVAL` | No (mandatory) | An approver decides. |
| `CONDITIONS_PRECEDENT` | Yes | Conditions before disbursement. |
| `AGREEMENT_BOOKING` | No (mandatory) | The loan is booked. |
| `DISBURSEMENT_APPROVAL` | No (mandatory) | The payout is approved. |

### Create a workflow version (maker)

1. In **Workflow builder**, enter a **Code** (A–Z, 0–9 and `_`, 2–40 characters). To replace a workflow, reuse its code; to start a new one, use a new code.
2. Enter a **Name**.
3. Optionally choose **Start from built-in** to copy a built-in workflow.
4. Tick or untick the optional **Steps**. Mandatory ones are locked.
5. Set **Approval levels**: each level has a **Currency** (`*` for any currency, or a code such as `USD`), a **From amount** and **Approvals required** (1, 2 or 3). Click **Add level** for more. One level must start at 0 ("One approval level must start at 0.").
6. Click **Submit workflow version**.

What happens next: the version is created directly as **SUBMITTED** ("Workflow version submitted for approval"). There is no draft stage.

Note: Levels above 0 only take effect when they name a specific currency. A level with currency `*` and a from amount above 0 is ignored by the system. For a higher threshold, add one level per currency (for example `USD` from 100000 and `KHR` from 400000000), as the built-in two-level workflow does.

### Approve or reject (checker)

1. In **Tenant workflow versions**, find a **SUBMITTED** version.
2. Click **Approve** (the maker cannot do this) or **Reject**.

| Workflow status | Meaning |
|---|---|
| **SUBMITTED** | Waiting for a second person. |
| **ACTIVE** | In force for its code. Any previously active version of the same code becomes **RETIRED**. |
| **REJECTED** | Not used. |
| **RETIRED** | Replaced by a newer version. |

If a product names a code that is neither built-in nor active for your organisation, applications fail with "Workflow ... is not defined."

---

## 11. Pricing and repayment simulator

Use the simulator to show a customer, or a checker, exactly what a loan would cost and what the schedule would look like. Nothing is booked or posted. You can simulate any version, including drafts, so it is also the best way to test a new version before approving it. You need permission to view products.

To run a simulation:

1. Go to **Products › Simulator** (or click **Simulate pricing →** on a product version page). The page is titled **Pricing & repayment simulator**.
2. In **Product version**, choose the product and version.
3. Enter the terms:
   - **Principal** (for example 1500.00)
   - **Number of instalments**
   - **Annual rate (%)**: as a percentage, for example 12. Leave blank to use the product default.
   - **Disbursement date** and, optionally, **First due date**
   - **Principal grace instalments**, **Interest grace instalments**
   - **Balloon amount** (balloon products only)
   - **Waived fee codes** (comma-separated)
   - For products with the explicit repayment method, open **Explicit schedule** and add rows (**Due date** and **Principal**) with **Add row**.
4. Click **Simulate**.

The result shows:

- **Simulation only**: "Nothing has been booked or posted."
- **These terms would be rejected by the product rules**, with the reasons, if the terms break the product's limits (amount, number of instalments, rate range and so on). The schedule is still shown so you can see the effect.
- **Contains projected amounts** for floating-rate products: some instalments depend on future rates.
- **Summary**: **Instalment**, **Effective annual rate (EIR)** (including fees), **Total principal**, **Total interest**, **Capitalized interest**, **Total payments**, **Maturity date**, **Final residual (rounding)**.
- **How this was calculated**: a plain-language explanation.
- **Up-front fees**: each fee with **Treatment** (deducted, financed or paid separately), **Amount** and **Tax**, then **Financed (added to principal)**, **Deducted from payout**, **Paid separately**, **Booked principal** and **Net disbursement**.
- **Schedule**: one row per instalment with **#**, **Due date**, **Principal**, **Interest**, **Capitalized**, **Total** and **Closing principal**.
- **Calculation record**: technical detail (inputs, engine version, configuration fingerprint) for audit.

If it is blocked: for a floating-rate product you may see "No *BENCHMARK* observation on or before *date*." A benchmark rate has not been entered yet. Ask Operations to record it (see [14-accounting-and-period-close.md](14-accounting-and-period-close.md)). A missing holiday calendar gives "Holiday calendar ... is not configured for this organisation."

---

## 12. Quick reference: who does what

| Task | Role | Where |
|---|---|---|
| Create product, edit draft, submit | Product maker | **Products › Products & versions** |
| Approve or reject a product version | Product checker (not the maker) | Version page |
| Activate or retire a product version | Product checker (not the maker) | Version page |
| Create a policy or policy version, submit | Product maker | **Products › Policy library** |
| Approve, reject or retire a policy version | Product checker (not the maker) | Policy page |
| Create a workflow version | Product maker | **Products › Workflows** |
| Approve a workflow version | Product checker (not the maker) | **Products › Workflows** |
| Simulate pricing | Anyone who can view products | **Products › Simulator** |
| Switch feature flags | Tenant administrators (two people) | **Risk & audit › Access & policy › Feature flags** |
