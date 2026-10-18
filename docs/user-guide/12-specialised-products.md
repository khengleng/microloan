# Specialised products

Who this is for: loan operations makers and checkers, credit analysts and approvers, and relationship managers who work with credit cards, buy-now-pay-later, leases and Ijarah, trade finance, syndicated loans, project finance, Murabaha, income-contingent education loans and institutional (interbank, municipal, sovereign, development) lending.

These products are originated, approved and booked like any other loan (see [05-applications-and-credit-decisions.md](05-applications-and-credit-decisions.md)) under a product created from the matching template (see [04-products-and-policies.md](04-products-and-policies.md)). This chapter covers what is different once they are booked. Facility mechanics they share - drawdowns, limits, statements, term-out - are in [09-facilities.md](09-facilities.md).

## Before you start: is the product switched on?

Many of these products are behind a feature flag that is **off by default**. A tenant administrator proposes the change under **Risk & audit › Access & policy**, **Feature flags** tab, and a second administrator approves it (see [18-tenant-administration.md](18-tenant-administration.md)). The demo organisation has all of them switched on.

| Product | Template(s) | Flag(s) needed (off by default) |
|---|---|---|
| Credit card | `CREDIT_CARD` | none beyond the product family |
| Buy now, pay later | `BNPL` | none beyond the product family |
| Lease / Ijarah | `IJARAH` (the catalogue's lease template) | none beyond the product family (its balloon repayment uses `lending.repayment.balloon`, on by default) |
| Import letter of credit | `LETTER_OF_CREDIT` | `lending.trade.letters_of_credit` |
| Invoice finance | `INVOICE_BACKED` | `lending.trade.invoice_finance` and `lending.revolving.drawdown` |
| Factoring, supply-chain finance, forfaiting | `FACTORING`, `SUPPLY_CHAIN_FINANCE`, `FORFAITING` | `lending.trade.receivables_purchase` and `lending.revolving.drawdown` |
| Import loan, export working capital | `IMPORT_LOAN`, `EXPORT_WORKING_CAPITAL` | `lending.trade.documentary` |
| Syndicated loan | `SYNDICATED` | `lending.syndication` |
| Project / infrastructure finance | `PROJECT_FINANCE`, `INFRASTRUCTURE` | `lending.facility.staged_drawdown` and `lending.project_finance` |
| Murabaha | `MURABAHA` | `lending.islamic.murabaha` |
| Income-contingent education loan | `INCOME_CONTINGENT_EDUCATION` | `lending.education.income_contingent` |
| Interbank, municipal, sovereign, development loans | `INTERBANK`, `MUNICIPAL`, `SOVEREIGN`, `DEVELOPMENT_CONCESSIONAL` | `lending.institutional` |

When a flag is off, the actions it governs are refused with a message such as "lending.syndication is currently unavailable". Each product family also has its own flag (on by default).

> **Note.** In the demo organisation, besides the five main products, one active product is set up for every available loan type (named after its template, for example **Credit card**). In your own organisation a product maker must first create the product from its template, and a product checker approve and activate it (see [04-products-and-policies.md](04-products-and-policies.md)).

Several products in this chapter are recognised by the loan screen, which shows an extra card for them between **Servicing actions** and the schedule.

---

## 1. Credit cards

A credit card is a revolving line with a card attached. Purchases, cash advances and instalment plans are kept as separate balances; each monthly statement sets a due date and a minimum payment. Purchase interest is waived when the previous statement was paid in full by its due date (the grace period); cash advances pay a fee and interest from day one.

> **Note.** The card is issued automatically when an application under a credit-card product is booked. There is no connection to a card network or card processor: purchases, cash advances and payments are keyed in by staff, and the masked card number is a placeholder.

### 1.1 Finding a card

**Loans › Cards** lists the cards (who sees it: anyone with facility read access). Filter with **All statuses** (**ACTIVE**, **BLOCKED**, **CLOSED**). Columns: **Card**, **Number**, **Line**, **Status**, **Limit**, **Purchases**, **Cash advances**, **Plans**, **Stated to**. Click a card to open it.

The card screen shows tiles for **Limit**, **Available** (cash available in the hint), **Purchases**, **Cash advances**, **Instalment plans** and **Total owed**, a notice for the last statement (what to pay to keep the grace period), and a red notice when a minimum payment is overdue. **Credit line →** opens the underlying facility; **Ledger account →** opens its loan account.

### 1.2 Card actions

| Button | When | Who |
|---|---|---|
| **Purchase** | card and line ACTIVE | Loan operations maker (repayment-posting permission) |
| **Cash advance** | card and line ACTIVE | Loan operations maker |
| **Payment** | card not CLOSED and something is owed | Loan operations maker |
| **Generate statement** | card not CLOSED | Loan operations maker |
| **Instalment plan** | card ACTIVE and the product offers plans | Loan operations maker |
| **Close card** | nothing owed | Loan operations checker |

To post a purchase or cash advance:

1. Click **Purchase** (or **Cash advance**).
2. Enter the **Amount** (the hint shows what is available) and the **Merchant** (or **ATM / teller reference**).
3. Click **Post purchase** (or **Post cash advance**). A cash advance shows the fee charged.

To post a payment:

1. Click **Payment**.
2. Click a shortcut - **Minimum …**, **Statement balance …** or **Everything owed …** - or type the **Amount**.
3. Optionally enter the **External reference**, then click **Post payment**.

To generate the monthly statement:

1. Click **Generate statement**.
2. Choose the **Statement date** (the hint shows when the cycle started).
3. Click **Generate statement** and confirm. Interest is posted, plan instalments are billed and a minimum payment falls due. The **Statements** card shows the **Grace** column as **APPLIED** or **LOST**.

To convert a purchase into instalments: click **Instalment plan**, choose the **Purchase** (only purchases of the current cycle above the product's minimum) and the **Term**, then click **Convert**.

To close a card: once everything is repaid, click **Close card**, enter the **Reason** and click **Close card**.

If it is blocked: "The … purchase exceeds the … available on the card." / "Cash advances are limited to … outstanding; … is available."; "This card is …; it cannot be used."; "The card line is available from … until …; renew it to use the card." (there is no renewal screen yet - ask your IT team); "The previous statement is due on …; the next one can close only after that."; "… is still owed on this card; it can be closed once repaid."; "Money is held for the cardholder; refund it before closing." A drawdown requested on the card's facility is refused with "This facility is a credit card: post … through the card, not the facility."

> **Note.** **BLOCKED** appears as a filter but there is no action to block a card yet.

---

## 2. Buy now, pay later (BNPL)

A BNPL plan pays a merchant for the customer's purchase. The merchant receives the price less its discount (the discount is the lender's income); the customer repays in instalments.

### 2.1 Paying the merchant

While the loan is **BOOKED**, the loan screen shows a **Buy now, pay later** card reminding you to name the merchant. When preparing the disbursement (see [06-disbursement.md](06-disbursement.md)), add exactly one payee of type **Merchant (BNPL — paid net of the discount)** for the full purchase price. The discount is deducted automatically.

If it is blocked: "A BNPL disbursement pays exactly one MERCHANT payee the … purchase price; the merchant discount is deducted from it here."

### 2.2 Recording a merchant refund

When the merchant refunds all or part of the purchase, the refund reduces the remaining instalments (latest first), returns to the customer what they have already paid if needed, and claws the merchant's share back.

Who: anyone with the repayment-posting permission (Loan operations maker, Collections officer). The loan must be ACTIVE or CLOSED.

1. Open the loan. The **Buy now, pay later** card shows **Merchant**, **Purchase financed**, **Merchant discount**, **Paid to merchant**, **Refunded so far** and **Still refundable**.
2. Click **Record merchant refund**.
3. Enter **Refund amount** (up to what is still refundable), **Merchant refund reference** and **Reason**.
4. **Customer payout reference** - required when part of the refund goes back to the customer.
5. Click **Record refund**.

The refunds table shows, per refund, **Off instalments**, **To customer**, **Discount reversed**, **Merchant owes** and the **Clawback** status. When the merchant pays back what it owes, type the **Settlement ref** on that row and click **Collect**; the status changes from **CLAWBACK DUE** to **COLLECTED**.

If it is blocked: "… goes back to the customer: record the payout reference."; "This clawback is already collected."

---

## 3. Leases and Ijarah

Under a lease (and an Ijarah) the lender buys and owns the asset; the customer pays rentals; at the end the customer either buys the asset for the residual (purchase option) or returns it.

> **Note.** Ijarah uses the same screens. Its lessor accounting is the finance-lease (net-investment) method; an operating Ijarah with depreciation is not modelled. Rental income and late charges go to their own accounts (late charges to charity).

### 3.1 Register the leased asset (before payout)

Who: Loan operations maker (disbursement preparer). The loan must be **BOOKED**.

1. Open the loan. The **Lease** (or **Ijarah lease**) card shows **Register the leased asset**.
2. Enter **Asset type** (the hint lists the types the product covers), **Description**, **Serial / VIN** (optional), **Supplier** and **Cost**.
3. Click **Register asset**.
4. Prepare the disbursement to the supplier - payee type **Asset supplier (lease)**, **Dealer** or **Seller** - never the lessee.

If it is blocked: "Register the leased asset before paying for it."; "The lender buys the asset: pay its supplier, dealer, seller (…), not the lessee."; "The lease finances …; the asset cannot cost less."; "This lease product covers …".

### 3.2 End of the lease

The card shows **Ownership**: **LESSOR** (the lender owns it), **RETURNED** or **TRANSFERRED**.

- **Return the asset** - available on an ACTIVE lease whose product allows returns, once only the residual is left (until then the card explains what remains). Enter **Condition on return** and **Return / yard reference**, then click **Record return**. The residual is settled by the asset and the lease closes.
- **Transfer title to the lessee** - available when the loan is **CLOSED** (every rental and the residual paid). Click it to record that the purchase option was exercised.

Who: anyone with the repayment-posting permission. If it is blocked: "This lease does not allow the asset to be returned."; "The residual has not been paid."

---

## 4. Trade finance

**Loans › Trade finance** has three tabs: **Letters of credit**, **Receivables** and **Import & export loans**. Who sees it: Credit approvers and Loan operations makers and checkers. The **Home** queues **Invoices to approve**, **Letters of credit to issue** and **Payouts to approve** bring trade work to you.

> **Note.** There is no SWIFT messaging, no examination of documents against a letter of credit, no LC confirmation, no credit insurance, and no supplier or buyer self-service portal. Payments to beneficiaries are recorded, not sent.

### 4.1 Import letters of credit

An issued letter of credit is an off-balance-sheet commitment. When the bank pays a presentation under it, the payment becomes a term loan for the importer.

| LC status | Meaning |
|---|---|
| **REQUESTED** | Waiting for a credit approver to issue or reject it. |
| **ISSUED** | Live; nothing drawn yet. |
| **PARTIALLY DRAWN** / **FULLY DRAWN** | Presentations paid. |
| **EXPIRED** / **CANCELLED** | Closed. |
| **REJECTED** | Not issued. |

To request a letter of credit (Loan operations maker):

1. On the **Letters of credit** tab, click **New letter of credit**.
2. Fill **Importer (borrower)**, **Letter-of-credit product**, **Amount**, **Beneficiary (exporter)**, **Beneficiary bank** and **Beneficiary account** (optional), **Expiry date** and **Instalments if converted to a loan**.
3. Click **Request**.

To issue or reject (Credit approver, a different person, within approval authority, signed in with an authenticator code): open the LC and click **Issue…** and confirm (the fee is charged), or **Reject** with a reason, then **Confirm**.

To record and pay a presentation:

1. Loan operations maker: on a live LC click **Record presentation**, enter **Amount** (up to the undrawn amount) and **Documents reference**, then **Confirm**.
2. Loan operations checker (not the person who recorded it, within authority, with an authenticator code): click **Approve** on the drawing.
3. Loan operations checker: click **Pay…**, enter the **Payment reference** and **Confirm**. The payment is booked as the importer's loan over the stated instalments; the **Loan** column links to it.

A drawing can be refused with **Refuse** (reason required). To close an LC, a credit approver clicks **Expire / cancel**, chooses **Cancel (beneficiary agreed)** or **Expire (past expiry date)**, gives a **Reason** and clicks **Confirm**.

### 4.2 Receivables programmes: invoice finance, factoring, supply-chain finance, forfaiting

A programme is a revolving limit drawn only by the receivables it finances or buys. It is booked like any facility; for supply-chain finance the borrower is the **anchor buyer**.

| Kind | What the lender does | Funding is called | Acknowledgement before funding |
|---|---|---|---|
| **Invoice finance** | Advances against the borrower's invoices; fee per period; full recourse. | advance | none |
| **Factoring** | Buys the seller's invoices at an advance rate less a service fee; recourse FULL, LIMITED or NONE. | purchase | **Record notice to debtor** |
| **Supply-chain finance** | Pays the anchor buyer's approved supplier invoices early at a discount; the buyer pays the face at maturity. | early payment | **Record buyer approval** |
| **Forfaiting** | Buys avalised bills and promissory notes without recourse at a discount. | purchase | **Record aval** |

On the **Receivables** tab, filter with **All kinds** and click the register link (**Invoice register →**, **Factoring ledger →**, **Supply-chain programme →** or **Forfaiting portfolio →**).

| Invoice status | Meaning |
|---|---|
| **SUBMITTED** | Registered; waiting to be approved as eligible. |
| **APPROVED** | Eligible; funding can be requested. |
| **ADVANCE REQUESTED** / **ADVANCE APPROVED** | Funding requested / approved, waiting for release. |
| **FUNDED** | Paid out; waiting for the debtor, buyer or obligor. |
| **SETTLED** | Paid. |
| **RECOURSE** | Unpaid after due date + grace: the holder owes it (full or up to the cap). |
| **DEFAULTED** | Unpaid without recourse: the lender bears the loss. |
| **REJECTED** / **WRITTEN OFF** | Closed. |

The steps, and who does each:

1. **Register** (Loan operations maker): in **Register an invoice** (or **Register an instrument**) fill **Debtor (the seller's customer)** / **Supplier** (supply chain: approved suppliers only) / **Obligor (drawee / maker)**, **Instrument** and **Avalising bank** (forfaiting), **Invoice number** / **Instrument number**, **Debtor reference** (optional), **Amount** or **Face value**, **Issue date** and **Due date** / **Maturity date**, then click **Register**.
2. **Acknowledge** (Loan operations maker), where required: click **Record notice to debtor…**, **Record buyer approval…** or **Record aval…**, choose **How**, give the **Reference** (and **Avalising bank** for an aval), and click **Record**. Funding is refused until this is done.
3. **Approve as eligible** (Credit approver, not the maker): click **Approve** and confirm. **Reject** (with a reason) is available until funding is approved.
4. **Request funding** (Loan operations maker): click **Request advance** / **Request purchase** / **Request early payment**. The price is fixed when the money is released.
5. **Approve funding** (Loan operations checker, within approval authority, with an authenticator code): click **Approve funding**. The limit is re-checked at release.
6. **Release** (Loan operations checker, not the requester): click **Release…**, check the preview, enter the **External reference** and click **Release funds**. For supply-chain finance the supplier is paid.
7. **Collect** (anyone with the repayment-posting permission): click **Payment…**, choose **Paid by** (the debtor / buyer / obligor, or the holder under recourse), enter **Amount** and optional **External reference**, then **Apply payment**. Money clears the fee, then the advance or face; any surplus is held for the holder.
8. **Pay out a surplus** (maker proposes, checker approves): click the invoice number to open its detail, click **Propose payout of …**; a Loan operations checker clicks **Approve and pay** (or **Reject**).
9. **Write off** what the lender bears (RECOURSE or DEFAULTED, bought receivables only): a write-off maker clicks **Write off…**, gives a **Reason** and clicks **Propose write-off**; a write-off checker with authority and an authenticator code opens the invoice detail and clicks **Approve write-off** (or **Reject**). Under limited recourse it is refused until the holder has paid its cap.
10. **Close programme** (Loan operations checker): once everything is settled, written off or rejected and nothing is owed, click **Close programme**.

**Suppliers (supply-chain finance).** On the **Suppliers** card a Loan operations maker fills **Supplier name**, **Bank**, **Account number** and **Sublimit** and clicks **Onboard supplier**; a Credit approver (a different person) clicks **Approve**, or **Reject…** / **Suspend…** with a reason. Only approved suppliers' invoices are paid.

Limits: factoring refuses funding that would put more than the product's concentration share of the limit on one debtor (see the **By debtor** card); a supplier's sublimit caps what may be outstanding on its invoices. The end-of-day batch moves unpaid receivables to **RECOURSE** or **DEFAULTED** and earns the discount daily.

> **Note.** Not covered: recoveries on a written-off receivable, late charges on a defaulted debtor, secondary-market sale of bought paper.

### 4.3 Import loans and export working capital

Each loan finances one trade. It is paid out only once the trade is recorded and every required document is verified, and the trade's proceeds repay it (interest-only instalments, principal at maturity).

1. Originate and book the loan as usual. It appears on the **Import & export loans** tab under **Booked, awaiting the trade**; the loan screen shows **Open the trade →**.
2. **Record the trade** (Loan operations maker): **Supplier (exporter)** or **Buyer (importer)**, **Country**, **Transaction value**, **Goods**, **Shipment date** (import) or **Contract / order date** (export), **Expected sale proceeds** / **Expected export proceeds**; click **Record trade**. It is refused if the loan is above the product's financing ratio of the value, the cycle is too long, or the loan matures after the expected proceeds plus grace.
3. **Documents**: the product's checklist is created. A Loan operations maker clicks **Receive…**, enters the **Document number or reference** and clicks **Record receipt**; a Loan operations checker (not the receiver) clicks **Verify**, or **Reject…** with **Why it is rejected**. A rejected document can be presented again. **Add another document** records extra documents.
4. When the trade card shows **Ready to pay out**, prepare, approve and execute the disbursement from the loan (see [06-disbursement.md](06-disbursement.md)). Until then it shows **Not yet payable** with what is missing.
5. **Proceeds** (repayment poster): enter **Amount**, **Paid by**, optional **Receipt reference** and click **Apply proceeds**. Proceeds at or above the payoff settle the loan; the rest is recorded as passed to the customer and **Credit to customer — reference** is required.

| Trade status | Meaning |
|---|---|
| **OPEN** | Trade recorded; documents and payout pending. |
| **FINANCED** | Loan paid out. |
| **SETTLED** | Repaid from the proceeds. |

| Document status | Meaning |
|---|---|
| **PENDING** | Not received. |
| **RECEIVED** | Received; waiting for verification by another officer. |
| **VERIFIED** | Checked. |
| **REJECTED** | Refused; can be presented again. |

---

## 5. Syndicated loans

In a syndicated loan your organisation acts as **agent**: other lenders take a share, fund it before payout, and receive their share of every collection.

Who sees **Loans › Syndication**: Loan operations makers (manage) and Credit approvers (approve). The **Home** queue **Syndicates to approve** lists drafts waiting for a checker.

| Syndicate status | Meaning |
|---|---|
| **DRAFT** | Participants entered; waiting for approval. Can still be changed. |
| **APPROVED** | Approved; waiting for the participants' funding. |
| **FUNDED** | Participants have paid; the loan can be disbursed. |

To set up a syndicate:

1. Book the loan under a syndicated product. Open **Loans › Syndication**, search the reference, and click **Syndicate →**. (The list shows all loans; a loan not under a syndicated product shows "Not a syndicated product".)
2. Loan operations maker, while the loan is **BOOKED**: for each lender fill **Lender**, **Share (0.35 = 35%)** (or tick **Enter amounts instead of shares** and give **Amount**), optional **Fee share**, and tick **Agent (us)** for exactly one row - your organisation. Use **Add participant** / **Remove**. Shares must sum to 100% (or amounts to the loan). Click **Save draft**.
3. Credit approver (not the maker, signed in with an authenticator code): click **Approve (checker)** and confirm.
4. Loan operations maker: when the other lenders have paid, enter the **Payment reference** and click **Record funding**.
5. Disburse the loan as usual. Before funding is recorded, disbursement is refused: "This is a syndicated loan: set up its participants, have the syndicate approved and record their funding before disbursing."

After payout every collection is split by share (fees by fee share) into a participant sub-ledger at end of day; **Share new collections** does it immediately. The **Participants** card shows **Commitment**, **Funded**, **Principal back**, **Interest**, **Fees**, **Paid out** and **Due to them**.

To pay a participant: a Loan operations maker clicks **Propose payout**; a Loan operations checker (not the proposer, with an authenticator code) clicks **Approve …** or **Reject**.

> **Note.** Losses on write-off or negotiated settlement are not shared with participants automatically.

---

## 6. Project and infrastructure finance

A project loan has two phases: a **construction** facility drawn in tranches (with construction interest added to principal), then an **operations** term loan whose repayments are sculpted to the project's cash flow, with receipts applied through a cash waterfall.

> **Note.** One senior tranche only. Cash flow available for debt service (CFADS) and receipts are entered by operations; there is no hedging, subordinated debt or multi-account cash management.

**Construction.** Run the facility as a staged drawdown (see [09-facilities.md](09-facilities.md)): satisfy tranche conditions, request, approve and release drawdowns, and generate statements. If the product capitalises construction interest, each statement adds the period's interest to principal instead of billing it; a balance above the limit made of capitalised interest is not over-limit.

**Term-out.** When availability ends, generate a statement to the business date and use **Sculpted term-out** on the facility ([09-facilities.md](09-facilities.md), section 10). The project moves from **CONSTRUCTION** to **OPERATIONS**.

**Waterfall.** On the loan screen the **Project finance** card shows the status (**CONSTRUCTION**, **OPERATIONS**, **CLOSED**, plus **LOCKED UP** when distributions are blocked), **Debt service reserve**, **Held in lock-up**, **Principal outstanding** and **Sculpted DSCR**.

To apply a period's receipts (Loan operations maker, repayment-posting permission; project in OPERATIONS):

1. Click **Apply receipts**.
2. Enter **Revenue**, **Operating costs**, **Taxes** and **Reference** (the proceeds account statement).
3. Click **Preview waterfall**. Check **CFADS**, **Period DSCR**, **Reserve after** and the step list; a **Lock-up** notice explains why distributions would be held.
4. Click **Apply receipts**.

In one step the cash pays senior debt service (drawing on the reserve if cash is short), tops up the debt service reserve, prepays principal with the cash sweep, and distributes the rest - or holds it in lock-up when the period DSCR is below the lock-up level, the reserve is short or debt service went unpaid. Locked-up cash is released with the first distribution after the project passes again. The **Waterfall runs** table records each run; runs cannot be edited, and a waterfall's repayment cannot be reversed on its own.

If it is blocked: "The project is still in construction; term its facility out on a sculpted profile before applying receipts."; "Receipts were last applied on …; a run cannot be dated before it."

---

## 7. Murabaha

Murabaha is a sale, not a loan: the financier buys the asset from its supplier and sells it to the customer at cost plus a disclosed, fixed profit. No interest is charged.

> **Note.** Requires `lending.islamic.murabaha` (off by default). The design is flagged for Sharia board and finance sign-off in your organisation before use. Profit is recognised as the contract schedule accrues it (no separate Sharia profit-recognition method).

**Register the asset (before payout).** Who: Loan operations maker; the loan must be **BOOKED**.

1. Open the loan. The **Murabaha contract** card shows **Register the asset before the payout**. Click **Register the asset**.
2. Choose **Asset type**; enter **Description**, **Serial / VIN** (optional), **Supplier** and **Cost**. The cost must equal what is financed plus any down payment (the hint shows the figure).
3. Click **Register asset**.
4. Disburse to the supplier, dealer or seller - never the customer.

The Murabaha template also carries two disbursement conditions to satisfy before payout: "Customer’s promise to purchase (wa’d) signed" and "Murabaha sale agreement signed after the financier owns the asset" (see [06-disbursement.md](06-disbursement.md)).

If it is blocked: "Register the asset being sold before paying its supplier: a Murabaha sells an asset the financier owns."; "The financier buys the asset: pay its supplier, dealer, seller (…), not the customer."; "… the asset's cost must be …".

The card then shows **Cost of the asset**, **Profit (fixed)** (with the mark-up), **Sale price**, the asset, contract status (**REGISTERED**, **SOLD**, **ENDED**), **Early settlement** (the ibra' - rebate of unearned profit - per the product, or "No rebate (full price)"), **Profit recognised** and **Deferred profit (ledger)**. **How the profit is recognised** lists each instalment's profit and the amount still deferred.

Late charges are a flat amount per late instalment and go to charity, not income. Early settlement uses **Early settlement** on the loan ([07-repayments-and-payments.md](07-repayments-and-payments.md)); the quote applies the ibra'. Partial prepayment, restructuring and refinancing are not available for Murabaha.

---

## 8. Income-contingent education loans

The instalment is a share of the borrower's income above a threshold: repayment rate × (annual income − threshold) ÷ 12. Below the threshold nothing is due and nothing falls into arrears. Interest the instalment does not cover is capitalised (up to a cap) or, if the product subsidises it, not charged. What is left at the end of the term is forgiven.

> **Note.** Requires `lending.education.income_contingent` (off by default).

**At origination**, enter the borrower's current income in **Declared annual income** on the application terms ("Income-contingent loans only — sets the first instalment; leave blank (nil) while studying").

**On the loan screen** (once disbursed), the **Income-contingent repayment** card shows **Current instalment**, **Assessed income**, **Repayment rule**, **Interest**, **Next review**, **Interest capitalised**, **Term ends** and **Forgiven at term end (at this income)**. An **Annual reassessment due** notice appears when the review date has passed; until a new assessment is approved the last instalment continues.

### 8.1 Record a new income assessment (maker)

Who: Loan operations maker. Reassess every 12 months (per the product) or on a change of circumstances.

1. Click **Record a new income assessment**.
2. Enter **Declared annual income**, choose **Reason** (**Annual reassessment** or **Change of circumstances**), optional **Income period**, **Evidence** (Payslip, Tax return, Employer letter, Benefits statement, Signed no-income declaration, Other) and **Evidence reference**.
3. Check the preview: "Resulting instalment: … a month from the period starting …" and whether anything would be forgiven.
4. Click **Submit for approval**.

### 8.2 Approve or reject (checker)

Who: Loan operations checker, not the person who recorded it. Open the loan (or **Loans › Income assessments**, card **Waiting for approval**), check the evidence, optionally add a **Comment**, and click **Approve** or **Reject**. Approval rebuilds the schedule from the start of the next period that has not begun; instalments already due, and arrears on them, stay.

**Loans › Income assessments** (page title **Income assessments**) also lists **Annual reassessment due** with **Days overdue**.

If it is blocked: "An assessment is already awaiting approval; decide it first."; "This product needs documentary evidence of income: …"; "An instalment after the effective date has already been paid; reassess from a later period."; "The contract term has ended: there is no period left to reassess."

At end of day on the last due date the balance carried on the final line is forgiven and the loan closes if nothing else is owed; instalments in arrears are not forgiven. Extra payments are held as an advance (no partial prepayment); early settlement repays everything; restructuring does not apply.

---

## 9. Institutional lending: counterparties and exposure limits

Interbank, municipal, sovereign and development loans are made to registered **counterparties** and checked against approved **counterparty** and **country** exposure limits at submission, approval and payout.

> **Note.** Requires `lending.institutional` (off by default). The demo organisation has five counterparties (two banks, a municipality, a sovereign and a development bank, all in KH) with approved USD limits and a KH country limit. Limits are per currency (no conversion between currencies) and connected groups are not aggregated.

**Loans › Counterparties & limits** opens the page titled **Counterparties & exposure**. Who: Credit analysts (manage) and Credit approvers (approve).

The **Exposure** tab shows **By counterparty** (**Limit**, **Used**, **Headroom**, **Utilisation**, **Status**), **By country** and **By counterparty type**. Utilisation = principal outstanding + loans booked but not paid out + approvals not yet booked.

| Exposure status | Meaning |
|---|---|
| **WITHIN LIMIT** | Below 90% of the limit. |
| **NEAR LIMIT** | 90% or more used. |
| **BREACHED** | Over the limit. |
| **LAPSED** | Past its review date; it no longer counts until renewed. |

To register a counterparty (Credit analyst):

1. Click **Register a counterparty**.
2. Enter **Name**, **Type** (Bank, Municipality, Sovereign, Development institution) and **Country (risk country)**.
3. Under **Find borrower record** search for the institution's borrower record and pick it in **Borrower record** (an institution borrows through an ordinary borrower record - create it first under **Customers › Borrowers**).
4. Optionally enter **LEI / SWIFT / registration no.**, **Long-term rating** (S&P/Fitch scale - enter a Moody's rating at its equivalent), **Rating agency** and **Rated on**.
5. Click **Register**.

To propose a limit (Credit analyst): on the counterparty page click **Propose a limit**, or on the main page **Propose a country limit** (with **Country**). Enter **Limit**, **Currency**, **Review by** (the limit lapses after this date until renewed) and an optional **Note**, then click **Propose**.

To approve (Credit approver, not the proposer, within approval authority for credit decisions, signed in with an authenticator code): open the **Limits awaiting approval** tab, optionally add a **Comment**, and click **Approve** or **Reject**. An approved limit replaces the one in force.

On a counterparty's page you can also **Record a rating** (**Rating**, **Agency**, **Rated on**, **Reason**, then **Record**) and **Suspend** / **Reinstate** it (with a **Reason**). A suspended counterparty gets no approvals and no payouts.

**What the checks refuse.** An application or payout is refused with the figures when it would breach a limit, for example "Counterparty …: … would take exposure to … against a limit of … (… available).", "… has no approved exposure limit.", "… the exposure limit was due for review on … and has not been renewed.", or "… the exposure limit is in …, the loan is in …; approve a … limit." A counterparty below the product's minimum rating is refused ("The counterparty is rated …; this product lends only to counterparties rated … or better."). On the loan screen an **Institutional counterparty** card shows the limits checked.

**Product conventions.** Interbank: one bullet of principal and interest on the agreed maturity (up to 366 days), interest ACT/360, no prepayment. Municipal: semi-annual level instalments. Sovereign: semi-annual equal principal after up to 6 grace instalments. Development (concessional): rates of 0-3% and up to 10 years' principal grace, approved only when the grant element (debt service discounted at 5%) is at least 35% - the figure is shown on the credit decision's assessment.
