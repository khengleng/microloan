# Glossary

Who this is for: everyone. Plain-language meanings of the terms used in the
portal and in this guide, in alphabetical order.

| Term | Meaning |
|---|---|
| **Adapter** | The connector between the platform and an outside service (a bank, the credit bureau, an SMS provider). See *Mock*. |
| **Advance (held on advance)** | Money the borrower paid beyond what was due, kept on the loan and applied automatically to the next instalments. |
| **Affordability assessment** | A calculation of what the borrower can afford: income minus living expenses and other debts. Used at application and in hardship cases. |
| **Agreement / agreement version** | The frozen copy of the loan's terms and schedule. A change (for example a restructure or a prepayment that shortens the loan) creates a new version; old versions are kept. Product changes never alter an existing agreement. |
| **Allocation** | How a payment is split across penalties, fees, interest and principal. The order is set by the product. |
| **AML status** | The anti-money-laundering screening result for a customer (not screened, clear or flagged). |
| **Approval authority (approval limit)** | The largest amount a person may approve for a given action and currency. Above it, a person with a higher limit must approve. |
| **Approval level** | In a workflow, the number of independent approvers required from a given amount upwards. |
| **Arrears** | Amounts that were due and are still unpaid. |
| **Benchmark rate** | A published reference rate that floating-rate loans re-price from. The loan's rate is benchmark plus margin, kept between a floor and a cap. |
| **BNPL** | Buy now, pay later: a purchase paid in instalments, usually arranged through a merchant. |
| **Booking** | Turning an approved application into a loan agreement and a loan account (status **BOOKED**). No money moves at booking. |
| **Borrowing base** | For some facilities, the amount that may be drawn is limited by the value of eligible assets (for example stock or receivables), reported in a certificate. |
| **Business date** | Your organisation's operating date. Every posting is dated by it. It is shown at the top of the screen and only moves forward when finance advances it. |
| **Capability** | Something the lending engine can do. A product cannot be activated while it needs a capability that is not implemented or needs an outside connection. |
| **Capitalize** | Add unpaid interest or charges to the principal, so they bear interest from then on. |
| **Collection stage / collections ladder** | The escalation steps a product defines for overdue loans (reminder, call, visit, notice, legal review) according to days past due. Each step can create a task for a collector. |
| **Combined ledger** | Both loan books (the original module and the lending platform) shown side by side. |
| **Conditions precedent** | Things that must be done before a loan can be paid out or a restructure executed (for example a signed mortgage). Each is satisfied with evidence or waived by someone with authority. |
| **Control totals** | The count of loans and total principal per currency from the old system, used to prove a migration file is complete. |
| **Counterparty** | An institution the organisation lends to or is exposed to (a bank, a ministry, a municipality), with a rating and an exposure limit. |
| **Covenant** | A promise in the loan agreement that the borrower must keep (for example a minimum debt-service coverage ratio), tested on a schedule. |
| **Cut-over date** | In a migration, the date at which balances are taken over from the old system. |
| **Delinquency bucket** | The days-past-due band a loan falls in (for example 31 to 60 days). |
| **Delegation** | Temporary transfer of a person's approval authority to someone else, with an end date and possibly a cap. |
| **Disbursement** | Paying out the loan money. It is prepared by one person, approved by another, and then executed with the bank or cash reference of the real payment. |
| **Down payment** | The borrower's own contribution, recorded before the loan is paid out. |
| **DPD (days past due)** | The number of days since the oldest unpaid instalment fell due. |
| **DSCR (debt-service coverage ratio)** | Cash available for debt payments divided by the debt payments. Below 1 means the business cannot cover its payments. |
| **DSR (debt-service ratio)** | Monthly loan payments divided by monthly income. |
| **Early settlement** | Paying the whole loan off before maturity, using a settlement quote. |
| **ECL / PD / LGD** | Expected credit loss = probability of default × loss given default × exposure. Used for impairment. |
| **EIR (effective interest rate) / effective annual rate** | The true yearly cost of the loan including fees, shown on the key facts and in the simulator. |
| **End of day (batch)** | The daily run that accrues interest, charges penalties, updates days past due, delinquency buckets and collection stages, applies rate resets and refreshes the loss allowance. |
| **Evergreening** | Hiding a problem loan by refinancing it into a new one that pays off the old one's arrears. The platform records it on every refinance. |
| **External reference** | The bank transfer, cheque or cash receipt number of a real payment, recorded so it can be traced. |
| **Facility** | A limit the borrower can draw on (credit line, overdraft, staged drawdown), rather than a single lump-sum loan. |
| **Feature flag** | An on/off switch for a function. Some functions are off by default; switching one on is a change two administrators must agree to. A flag never gives anyone permission. |
| **FX rate** | The exchange rate between USD and KHR used for cross-currency payments and approval limits. |
| **GL export** | A file of journal lines for the general ledger system. |
| **Guarantor demand** | A written call on a guarantor to pay under their guarantee when the borrower is in arrears. |
| **Haircut** | The percentage taken off collateral's market value to get the value the lender relies on. |
| **Idempotency** | A safety rule: if the same payment or payout is sent twice (for example after a double click or a lost connection), it is recorded only once. |
| **Ijarah** | An Islamic lease: the lender owns the asset and rents it to the customer. |
| **Impairment / loss allowance** | The amount set aside for expected losses on loans. |
| **Interest in suspense / non-accrual** | Interest that is owed but not counted as income because the loan is seriously overdue. |
| **Joint liability** | In group lending, every member can be pursued for the whole group loan, not only their own share. |
| **Journal** | The list of accounting entries. Every money movement creates balanced debit and credit lines. |
| **KHQR** | Cambodia's standard payment QR code (Bakong). |
| **KYC (know your customer)** | Checking a customer's identity documents. In the portal it is a manual review with the statuses pending, verified and rejected. |
| **LTV (loan-to-value)** | The loan amount divided by the value of the collateral (after haircut). Combined LTV adds loans that rank ahead. |
| **Maker-checker (four-eyes)** | One person prepares an action (the maker) and a different person approves or completes it (the checker). It protects against mistakes and fraud: no single person can move money or change a control alone. |
| **Mandate** | A borrower's signed permission to collect instalments from a bank account (auto-debit). |
| **MFA / two-factor authentication** | Signing in with your password and a 6-digit code from an authenticator app on your phone. Required for approvals, executions and reversals. |
| **Migration clearing** | The temporary account that opening balances of migrated loans are posted against. It should be zero when migration is complete. |
| **Mock** | A stand-in for an outside system, used for testing. Mocks are refused on the live system. |
| **Murabaha** | An Islamic sale: the lender buys the goods and sells them to the customer at a disclosed mark-up, paid in instalments. |
| **NBC** | National Bank of Cambodia, the regulator. |
| **NBC loan classes** | The regulator's classification of loans by days past due: Standard, Special mention, Substandard, Doubtful, Loss. Each class carries a provisioning rate. |
| **Negotiated settlement** | Closing a loan for less than it owes. The amount given up (the concession) is recorded as an expense. |
| **Net disbursement** | The cash actually paid out: principal less fees deducted from the proceeds. |
| **PAR (portfolio at risk) 1 / 30 / 90** | The share of the outstanding portfolio on loans with a payment more than 1, 30 or 90 days late. |
| **Payee** | A person or business that receives disbursed money (the borrower, a seller, a dealer). |
| **Payment holiday** | Permission to skip one or more instalments under a published programme. The programme states what happens to the interest and to the term. |
| **Payoff letter (payoff quote)** | A written amount that will close the loan on each day up to a "good through" date. |
| **Period close / period lock** | Freezing a month in the accounts so nothing more can be posted into it. Closing and reopening each need two people. |
| **Policy (policy library)** | A reusable, versioned set of loan terms (for example a prepayment rule) that products can offer. |
| **Prepayment: recast or shorten** | After an extra payment of principal, *recast* lowers the instalment and keeps the maturity date; *shorten* keeps the instalment and ends the loan earlier. |
| **Probation** | After a restructure, the loan's delinquency status cannot improve until enough on-time payments have been made. |
| **Product version** | One numbered, frozen set of a product's terms. Changing a product creates a new version that must be approved again. |
| **Reconciliation break** | A difference between a loan's own balances and the accounting ledger, or between what a payment channel reported and what was posted. |
| **Recovery** | Money collected on a loan after it was written off. It is income; the loan stays written off. Also the recovery desk's steps: repossession, pawn forfeiture, insurance claim, debt sale. |
| **Refinance** | A new loan whose proceeds pay off an existing loan in the same step. |
| **Regulatory return** | The monthly report to NBC, generated from the closed month. |
| **Rescheduling / restructuring** | Changing a loan's terms because the borrower is in difficulty (longer term, deferral, interest-only period, rate reduction and so on), through a case with assessment, approval and customer acceptance. |
| **Retained earnings** | The equity account that receives the year's profit or loss at year-end close. |
| **Reversal** | A compensating entry that undoes an earlier posting. Nothing is deleted. Reversals are done newest first. |
| **Service account** | A login for another computer system (not a person), with a limited scope such as posting repayments. |
| **Set-off** | Applying the borrower's own deposit to their overdue loan. |
| **Sub-ledger** | Each loan's own balances (principal, interest, fees), which must agree with the general ledger. |
| **Suspense (unidentified payment)** | Money received that cannot yet be linked to a loan. It is held until someone matches it or refunds it. |
| **Syndication** | A loan shared between several lenders, with one acting as agent. |
| **Template** | A ready-made starting configuration for a kind of loan, from which product makers create products. |
| **Tenant** | One lending organisation on the platform. Each tenant sees only its own data. |
| **Trial balance** | The list of ledger accounts with debit and credit totals, which must be equal. |
| **Value date** | The date the money actually moved. It may differ from the business date within limits set by the product. |
| **Webhook** | An automatic message the platform sends to your organisation's own systems when something happens (for example a loan is disbursed). |
| **Workflow** | The checks and approval levels an application goes through before it can be approved. |
| **Write-off** | Removing a loan the organisation does not expect to collect from the active book, against the loss allowance. Proposed by one person, approved by another. |
