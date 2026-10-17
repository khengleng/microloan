# Lending capability matrix

_Generated from `packages/shared/src/lending/capabilities.ts` and the product catalogue (engine 1.0.0). Do not edit by hand — run `node scripts/lending-capability-matrix.mjs`._

A product version can be activated only when every capability it requires is **Fully implemented**.

✅ Fully implemented: 60 · 🧪 Simulation only: 0 · 🔌 Requires integration: 5 · ⛔ Not implemented: 2

## Capabilities

### Schedule

| Capability | Status | Phase | Description | Evidence / limitation |
|---|---|---|---|---|
| `schedule.equal_instalment` | ✅ Fully implemented | 1 | Equal instalments (annuity), fixed periodic rate, zero-rate case | Tests: `packages/shared/test/*.test.ts` |
| `schedule.equal_principal` | ✅ Fully implemented | 1 | Equal principal with interest on the opening balance | Tests: `packages/shared/test/*.test.ts` |
| `schedule.flat_rate` | ✅ Fully implemented | 1 | Flat interest: P × r × years spread over level instalments | Tests: `packages/shared/test/*.test.ts` |
| `schedule.interest_only_bullet` | ✅ Fully implemented | 1 | Interest-only with bullet principal | Tests: `packages/shared/test/*.test.ts` |
| `schedule.balloon` | ✅ Fully implemented | 1 | Level instalments leaving a balloon residual | Tests: `packages/shared/test/*.test.ts` |
| `schedule.explicit_dated` | ✅ Fully implemented | 1 | Seasonal / explicitly dated principal with actual-interval interest | Tests: `packages/shared/test/*.test.ts` |
| `schedule.irregular_first_period` | ✅ Fully implemented | 1 | Irregular first period with DAILY accrual (periodic formulas refused) | Tests: `packages/shared/test/*.test.ts` |
| `schedule.grace_principal` | ✅ Fully implemented | 1 | Principal grace (interest-only instalments) | Tests: `packages/shared/test/*.test.ts` |
| `schedule.grace_interest_capitalized` | ✅ Fully implemented | 1 | Interest grace with capitalization | Tests: `packages/shared/test/*.test.ts` |
| `schedule.business_day_adjustment` | ✅ Fully implemented | 1 | Holiday calendars; FOLLOWING / MODIFIED_FOLLOWING / PRECEDING | Tests: `packages/shared/test/*.test.ts` |
| `schedule.custom_day_frequency` | ✅ Fully implemented | 1 | Custom day/week/month frequency (day-based requires DAILY accrual) | Tests: `packages/shared/test/*.test.ts` |

### Pricing

| Capability | Status | Phase | Description | Evidence / limitation |
|---|---|---|---|---|
| `pricing.fixed_rate` | ✅ Fully implemented | 1 | Fixed nominal or effective annual rate; ACT/365F, ACT/360, ACT/ACT ISDA, 30/360 ISDA, 30E/360 | Tests: `packages/shared/test/*.test.ts` |
| `pricing.floating_rate` | ✅ Fully implemented | 2 | Floating rate: benchmark + margin with floor/cap, projected schedule, and contractual resets on booked loans applied in the end-of-day batch | Tests: `packages/shared/test/floating.test.ts, apps/api/test/lending/floating.int-spec.ts` |
| `pricing.upfront_fees` | ✅ Fully implemented | 1 | Upfront fees: deducted, financed or separately collected, with tax | Tests: `packages/shared/test/*.test.ts` |
| `pricing.late_penalty` | ✅ Fully implemented | 1 | Late penalties: flat per overdue instalment or penalty rate on overdue amounts | Tests: `apps/api/test/lending/*.int-spec.ts` |
| `pricing.effective_rate_disclosure` | ✅ Fully implemented | 1 | Effective annual rate (XIRR) including fees | Tests: `packages/shared/test/*.test.ts` |

### Origination

| Capability | Status | Phase | Description | Evidence / limitation |
|---|---|---|---|---|
| `origination.individual` | ✅ Fully implemented | 1 | Individual borrower applications, documents, conditions precedent | Tests: `apps/api/test/lending/*.int-spec.ts` |

### Credit

| Capability | Status | Phase | Description | Evidence / limitation |
|---|---|---|---|---|
| `credit.decision` | ✅ Fully implemented | 1 | Recommendation, approval and rejection history with approval authority | Tests: `apps/api/test/lending/*.int-spec.ts` |

### Security

| Capability | Status | Phase | Description | Evidence / limitation |
|---|---|---|---|---|
| `collateral.ltv` | ✅ Fully implemented | 1 | Collateral pledges, valuations, haircuts and LTV threshold at approval | Tests: `apps/api/test/lending/*.int-spec.ts` |
| `guarantee.basic` | ✅ Fully implemented | 1 | Personal / corporate guarantee capture and minimum-count requirement | Tests: `apps/api/test/lending/*.int-spec.ts` |
| `collateral.borrowing_base` | ✅ Fully implemented | 2 | Borrowing base on a revolving line: certificates of inventory and receivables by class, stated and age ineligibles, concentration limits and advance rates; maker-checker acceptance; drawdowns limited to the lower of the limit and the base, and refused on a stale certificate | Tests: `packages/shared/test/borrowing-base.test.ts, apps/api/test/lending/inventory-borrowing-base.int-spec.ts`<br>Certificates are entered by operations from the borrower’s report; there is no stock-system or ledger feed, and field exams are recorded as evidence only (DECISIONS D-062). |

### Liability

| Capability | Status | Phase | Description | Evidence / limitation |
|---|---|---|---|---|
| `liability.individual` | ✅ Fully implemented | 1 | Individual liability | Tests: `apps/api/test/lending/*.int-spec.ts` |
| `liability.group_joint` | ✅ Fully implemented | 2 | Solidarity groups: formation, membership tenure and leadership, share allocation, joint liability for the whole balance, per-member contributions and governed member exit | Tests: `packages/shared/test/group.test.ts, apps/api/test/lending/groups.int-spec.ts` |

### Disbursement

| Capability | Status | Phase | Description | Evidence / limitation |
|---|---|---|---|---|
| `disbursement.manual` | ✅ Fully implemented | 1 | Single disbursement recorded by operations with external reference (maker-checker) | Tests: `apps/api/test/lending/*.int-spec.ts` |
| `disbursement.payment_rail` | 🔌 Requires integration | 2 | Automated payout through a payment provider | Only a mock adapter exists; it is blocked in production. |

### Servicing

| Capability | Status | Phase | Description | Evidence / limitation |
|---|---|---|---|---|
| `servicing.repayment` | ✅ Fully implemented | 1 | Repayment posting with configurable allocation order and idempotency | Tests: `apps/api/test/lending/*.int-spec.ts` |
| `servicing.repayment_reversal` | ✅ Fully implemented | 1 | Repayment reversal by contra entry (latest-first) | Tests: `apps/api/test/lending/*.int-spec.ts` |
| `servicing.accrual` | ✅ Fully implemented | 1 | Daily interest accrual reconciled to scheduled interest | Tests: `apps/api/test/lending/*.int-spec.ts` |
| `servicing.partial_prepayment` | ✅ Fully implemented | 1 | Partial prepayment with recast or shortened tenor (reducing-balance loans) | Tests: `packages/shared/test/*.test.ts` |
| `servicing.early_settlement` | ✅ Fully implemented | 1 | Settlement quote and payoff with optional fee and cash rounding | Tests: `apps/api/test/lending/*.int-spec.ts` |
| `servicing.delinquency` | ✅ Fully implemented | 1 | Days past due, delinquency buckets and collections stage assignment | Tests: `apps/api/test/lending/*.int-spec.ts` |
| `servicing.write_off` | ✅ Fully implemented | 1 | Write-off proposal and approval (maker-checker) | Tests: `apps/api/test/lending/*.int-spec.ts` |
| `servicing.closure` | ✅ Fully implemented | 1 | Automatic closure on full repayment or settlement | Tests: `apps/api/test/lending/*.int-spec.ts` |
| `servicing.recovery_after_write_off` | ✅ Fully implemented | 2 | Post-write-off recoveries: cash attributed against what was written off, principal first, posted to recovery income without reviving the loan | Tests: `packages/shared/test/settlement.test.ts, apps/api/test/lending/settlement.int-spec.ts` |

### Restructuring

| Capability | Status | Phase | Description | Evidence / limitation |
|---|---|---|---|---|
| `servicing.restructure` | ✅ Fully implemented | 1 | Hardship cases: affordability, options, maker-checker approval, customer acceptance, amendment execution and monitoring | Tests: `packages/shared/test/restructure.test.ts, apps/api/test/lending/restructure.int-spec.ts` |
| `restructure.affordability` | ✅ Fully implemented | 1 | Individual, household, business (DSCR) and seasonal affordability templates | Tests: `packages/shared/test/restructure.test.ts` |
| `restructure.customer_self_service` | ✅ Fully implemented | 1 | Customers request restructuring and accept their own proposals in the borrower portal | Tests: `apps/api/test/lending/*.int-spec.ts` |
| `servicing.refinance` | ✅ Fully implemented | 2 | Refinancing: the new loan’s proceeds settle the old one in the same transaction, with arrears roll-in and evergreening reported and separately permitted | Tests: `packages/shared/test/refinance.test.ts, apps/api/test/lending/relief.int-spec.ts` |
| `servicing.negotiated_settlement` | ✅ Fully implemented | 2 | Negotiated settlement: close a loan for less than it owes, with the concession itemised by component, posted as an expense and authorized separately when principal is forgiven | Tests: `packages/shared/test/settlement.test.ts, apps/api/test/lending/settlement.int-spec.ts` |
| `servicing.payment_holiday` | ✅ Fully implemented | 2 | Payment-holiday programmes: published offers with consistent eligibility, maker-checker publication, and an explicit choice of interest and term treatment | Tests: `packages/shared/test/payment-holiday.test.ts, apps/api/test/lending/relief.int-spec.ts` |

### Facility

| Capability | Status | Phase | Description | Evidence / limitation |
|---|---|---|---|---|
| `facility.revolving` | ✅ Fully implemented | 2 | Revolving facilities: limit, availability window, maker-checker drawdowns, interest on the drawn balance, commitment fee on the undrawn, limit changes, statements and term-out | Tests: `packages/shared/test/facility.test.ts, apps/api/test/lending/facilities.int-spec.ts` |
| `facility.overdraft` | ✅ Fully implemented | 2 | Overdraft: debit balance against a limit, minimum payment, over-limit pricing | Tests: `packages/shared/test/facility.test.ts, apps/api/test/lending/facilities.int-spec.ts` |
| `facility.staged_drawdown` | ✅ Fully implemented | 2 | Staged construction drawdowns: tranches released in full, gated by date and conditions precedent, with no limit reinstatement | Tests: `packages/shared/test/facility.test.ts, apps/api/test/lending/facilities.int-spec.ts` |

### Limits

| Capability | Status | Phase | Description | Evidence / limitation |
|---|---|---|---|---|
| `limits.connected_exposure` | ⛔ Not implemented | 2 | Group and connected-party exposure checks |  |

### Accounting

| Capability | Status | Phase | Description | Evidence / limitation |
|---|---|---|---|---|
| `accounting.double_entry` | ✅ Fully implemented | 1 | Immutable financial events with balanced double-entry postings and reversals | Tests: `apps/api/test/lending/*.int-spec.ts` |
| `accounting.reconciliation` | ✅ Fully implemented | 1 | Sub-ledger to general-ledger reconciliation | Tests: `apps/api/test/lending/*.int-spec.ts` |
| `accounting.external_export` | 🔌 Requires integration | 2 | Export to an external accounting system | Outbox messages are recorded; no external adapter ships. |

### Integration

| Capability | Status | Phase | Description | Evidence / limitation |
|---|---|---|---|---|
| `integration.kyc` | 🔌 Requires integration | 2 | External identity / KYC verification | Manual KYC status only. |
| `integration.credit_bureau` | 🔌 Requires integration | 2 | Live credit bureau enquiry | The existing CBC provider is used when configured; products requiring a bureau cannot activate without it. |
| `integration.notifications` | 🔌 Requires integration | 2 | Borrower notifications (SMS / Telegram) |  |

### Specialized

| Capability | Status | Phase | Description | Evidence / limitation |
|---|---|---|---|---|
| `card.revolving_credit` | ✅ Fully implemented | 3 | Credit cards: purchases, cash advances and instalment plans as separate balances; monthly statements with a due date and minimum payment; purchase interest waived when the previous statement is paid in full by its due date; cash-advance fee plus interest from day one | Tests: `packages/shared/test/card.test.ts, apps/api/test/lending/cards.int-spec.ts` |
| `bnpl.merchant_settlement` | ✅ Fully implemented | 3 | BNPL: the merchant is paid the purchase price net of its discount at disbursement; a merchant refund reduces the remaining instalments latest first, refunds what the customer already paid, and claws the money back from the merchant | Tests: `packages/shared/test/bnpl.test.ts, apps/api/test/lending/bnpl-lease.int-spec.ts` |
| `trade.documentary` | ✅ Fully implemented | 3 | Import and export loans against trade documents: one trade transaction per loan, a document checklist received and verified by different people that gates disbursement, amount within the financing ratio, tenor ending by the expected proceeds plus grace, and repayment from the proceeds (settling the loan, the rest passed to the customer) | Tests: `packages/shared/test/receivables.test.ts, apps/api/test/lending/import-export-loans.int-spec.ts`<br>No document examination against an LC or SWIFT messaging; the remitted surplus is recorded, not paid, by the lending ledger (DECISIONS D-059). |
| `trade.invoice_finance` | ✅ Fully implemented | 3 | Invoice financing on a revolving limit: invoice register, maker-checker advances at the product advance rate, fee per period, debtor settlement with the balance paid to the borrower, and full recourse aged as arrears | Tests: `packages/shared/test/trade.test.ts, apps/api/test/lending/trade.int-spec.ts`<br>Full recourse only (limited and non-recourse purchase is trade.factoring); no late penalty on recourse arrears (DECISIONS D-025). |
| `trade.letter_of_credit` | ✅ Fully implemented | 3 | Import letters of credit: maker-checker issuance with a fee and an off-balance-sheet contingent memo; a payment by the bank converts into a term loan for the importer | Tests: `packages/shared/test/trade.test.ts, apps/api/test/lending/trade.int-spec.ts`<br>No SWIFT messaging, document examination or confirmation; payment is recorded, not sent. |
| `trade.factoring` | ✅ Fully implemented | 3 | Factoring: invoices bought on a revolving limit at the advance rate net of a service fee, debtor notification before the advance, debtor concentration limit, collections clearing fee then advance with the balance paid to the seller, and FULL, LIMITED or NO recourse when the debtor defaults, the lender’s share written off under maker-checker | Tests: `packages/shared/test/receivables.test.ts, apps/api/test/lending/factoring.int-spec.ts`<br>No late charge on defaulted debtors; no credit insurance (DECISIONS D-055, D-056). |
| `trade.supply_chain` | ✅ Fully implemented | 3 | Supply-chain (payables) finance: the anchor buyer’s programme limit, suppliers onboarded under maker-checker, buyer-approved invoices paid to the supplier early at a discount, the discount earned daily, and the buyer paying the face at maturity or ageing as arrears | Tests: `packages/shared/test/receivables.test.ts, apps/api/test/lending/supply-chain-finance.int-spec.ts`<br>No supplier self-service portal; the buyer’s approval is recorded by staff (DECISIONS D-057). |
| `trade.forfaiting` | ✅ Fully implemented | 3 | Forfaiting: bills of exchange and promissory notes bought without recourse at a discount rate for the days to maturity plus grace, the aval recorded before purchase, the discount earned daily, collection of the face at maturity, and a defaulted instrument written off as the lender’s loss | Tests: `packages/shared/test/receivables.test.ts, apps/api/test/lending/forfaiting.int-spec.ts`<br>No secondary-market sale of bought paper (DECISIONS D-058). |
| `education.income_contingent` | ✅ Fully implemented | 3 | Income-contingent repayment: the instalment is a share of declared income above a threshold, reassessed annually or on a change of circumstances under maker-checker with evidence; nothing is due below the threshold, uncovered interest is capitalised (to a cap) or subsidised, and the balance left at the end of the term is forgiven | Tests: `packages/shared/test/income-contingent.test.ts, apps/api/test/lending/income-contingent.int-spec.ts`<br>Monthly payments on the contract grid; voluntary extra payments are held as an advance, not prepaid. Instalments already in arrears are not forgiven at term end (DECISIONS D-066). |
| `syndication.participations` | ✅ Fully implemented | 3 | Syndicated loans: the tenant as agent, participants by share or amount (summing to 100%), funding by participant, every collection split by share into a participant sub-ledger, and maker-checker payouts | Tests: `packages/shared/test/syndication.test.ts, apps/api/test/lending/syndication.int-spec.ts`<br>Losses on write-off or negotiated settlement are not shared automatically (DECISIONS D-015). |
| `project_finance.waterfall` | ✅ Fully implemented | 3 | Project finance: staged construction drawdowns with capitalized interest, term-out on a repayment profile sculpted to projected CFADS at a target DSCR, a debt service reserve, and a cash waterfall (debt service, reserve top-up, cash sweep, distributions) with lock-up below a DSCR threshold | Tests: `packages/shared/test/project-finance.test.ts, apps/api/test/lending/project-finance.int-spec.ts`<br>One senior tranche; CFADS and receipts are entered by operations; no hedging, subordinated debt or multi-account cash management (DECISIONS D-061). |
| `covenants.monitoring` | ✅ Fully implemented | 3 | Financial covenants (minimum DSCR, maximum LTV, maximum net leverage, minimum interest cover, financial statements) set up from the product at booking or per loan, tested on schedule, with breach notices, cure by a later test and maker-checker waiver | Tests: `packages/shared/test/covenants.test.ts, apps/api/test/lending/commercial-covenants.int-spec.ts, apps/api/test/lending/acquisition-finance.int-spec.ts`<br>Figures are entered from the borrower’s accounts; a breach raises a notice and the work queue, it does not reprice or accelerate the loan automatically (DECISIONS D-060). |
| `institutional.counterparty_limits` | ✅ Fully implemented | 3 | Institutional lending (interbank, municipal, sovereign, development): registered counterparties with ratings, counterparty and country exposure limits approved under maker-checker within approval authority, utilisation checked at submission, approval and disbursement, money-market (ACT/360 bullet) and concessional (grace, grant element) conventions, and an exposure view | Tests: `packages/shared/test/institutional.test.ts, apps/api/test/lending/institutional.int-spec.ts`<br>Limits are per currency (no FX conversion of exposures); connected-group limits are not modelled (limits.connected_exposure) (DECISIONS D-065, D-068). |
| `lease.true_lease` | ✅ Fully implemented | 3 | True lease: the lender buys and owns the asset (paid to the supplier), rentals to a residual purchase-option price, and at the end title transfer on purchase or return of the asset | Tests: `packages/shared/test/bnpl.test.ts, apps/api/test/lending/bnpl-lease.int-spec.ts` |

### Islamic

| Capability | Status | Phase | Description | Evidence / limitation |
|---|---|---|---|---|
| `islamic.murabaha` | ✅ Fully implemented | 3 | Murabaha: the financier buys the asset (paid to its supplier) and sells it at cost plus a disclosed, fixed profit; the profit is deferred and recognised over the term on its own accounts, late charges go to charity, and unearned profit is rebated (ibra’) on early settlement per product | Tests: `packages/shared/test/murabaha.test.ts, apps/api/test/lending/murabaha.int-spec.ts`<br>Profit is recognised as the contract schedule accrues it (no separate Sharia profit-recognition method); the deferred-profit memo is trued up at end of day and on closure (DECISIONS D-067). |
| `islamic.ijarah` | ✅ Fully implemented | 3 | Ijarah: lease with rentals and asset ownership, rental income and late charges to charity on their own accounts | Tests: `packages/shared/test/bnpl.test.ts, apps/api/test/lending/bnpl-lease.int-spec.ts`<br>Lessor accounting is the net-investment (finance-lease) method; an operating Ijarah with depreciation is not modelled (DECISIONS D-032). |

### Access

| Capability | Status | Phase | Description | Evidence / limitation |
|---|---|---|---|---|
| `access.emergency_break_glass` | ⛔ Not implemented | 2 | Emergency (break-glass) access |  |

## Product templates

| Family | Template | Phase 1 slice | Available | Missing capabilities |
|---|---|---|---|---|
| Personal / consumer | Personal instalment loan (`PERSONAL_INSTALMENT`) | Yes | ✅ |  |
| Personal / consumer | Salary loan (`SALARY_LOAN`) |  | ✅ |  |
| Personal / consumer | Salary advance (`SALARY_ADVANCE`) |  | ✅ |  |
| Personal / consumer | Emergency loan (`EMERGENCY_LOAN`) |  | ✅ |  |
| Personal / consumer | Debt consolidation (`DEBT_CONSOLIDATION`) |  | ✅ |  |
| Personal / consumer | Credit card (`CREDIT_CARD`) |  | ✅ |  |
| Personal / consumer | Buy now, pay later (`BNPL`) |  | ✅ |  |
| Personal / consumer | Murabaha financing (`MURABAHA`) |  | ✅ |  |
| Property | Home mortgage (`HOME_MORTGAGE`) | Yes | ✅ |  |
| Property | Construction loan (`CONSTRUCTION`) |  | ✅ |  |
| Property | Renovation loan (`RENOVATION`) |  | ✅ |  |
| Property | Home equity term loan (`HOME_EQUITY_TERM`) |  | ✅ |  |
| Property | Home equity line (`HOME_EQUITY_LINE`) |  | ✅ |  |
| Property | Investment property loan (`INVESTMENT_PROPERTY`) |  | ✅ |  |
| Property | Bridge loan (`BRIDGE_LOAN`) |  | ✅ |  |
| Vehicle / assets | Car loan (`CAR_LOAN`) |  | ✅ |  |
| Vehicle / assets | Motorcycle loan (`MOTORCYCLE_LOAN`) |  | ✅ |  |
| Vehicle / assets | Commercial vehicle loan (`COMMERCIAL_VEHICLE`) |  | ✅ |  |
| Vehicle / assets | Machinery / equipment loan (`EQUIPMENT_LOAN`) |  | ✅ |  |
| Vehicle / assets | Balloon vehicle loan (`BALLOON_VEHICLE`) |  | ✅ |  |
| Vehicle / assets | Ijarah financing (`IJARAH`) |  | ✅ |  |
| Education | Student loan (`STUDENT_LOAN`) |  | ✅ |  |
| Education | Tuition loan (`TUITION_LOAN`) |  | ✅ |  |
| Education | Vocational training loan (`VOCATIONAL_TRAINING`) |  | ✅ |  |
| Education | Income-contingent education loan (`INCOME_CONTINGENT_EDUCATION`) |  | ✅ |  |
| Microfinance | Individual microenterprise loan (`MICRO_INDIVIDUAL`) | Yes | ✅ |  |
| Microfinance | Group lending (`MICRO_GROUP`) |  | ✅ |  |
| Microfinance | Livelihood loan (`MICRO_LIVELIHOOD`) |  | ✅ |  |
| Microfinance | Seasonal microloan (`MICRO_SEASONAL`) |  | ✅ |  |
| SME / commercial | SME business term loan (`SME_TERM`) | Yes | ✅ |  |
| SME / commercial | Working capital loan (`WORKING_CAPITAL`) |  | ✅ |  |
| SME / commercial | Overdraft (`OVERDRAFT`) |  | ✅ |  |
| SME / commercial | Revolving credit facility (`REVOLVING_CREDIT`) |  | ✅ |  |
| SME / commercial | Inventory-backed loan (`INVENTORY_BACKED`) |  | ✅ |  |
| SME / commercial | Commercial property loan (`COMMERCIAL_PROPERTY`) |  | ✅ |  |
| Agriculture | Seasonal crop loan (`AGRI_CROP_SEASONAL`) | Yes | ✅ |  |
| Agriculture | Livestock loan (`AGRI_LIVESTOCK`) |  | ✅ |  |
| Agriculture | Fisheries loan (`AGRI_FISHERIES`) |  | ✅ |  |
| Agriculture | Farm equipment loan (`AGRI_FARM_EQUIPMENT`) |  | ✅ |  |
| Agriculture | Plantation development loan (`AGRI_PLANTATION`) |  | ✅ |  |
| Corporate / project | Corporate term loan (`CORPORATE_TERM`) |  | ✅ |  |
| Corporate / project | Syndicated loan (`SYNDICATED`) |  | ✅ |  |
| Corporate / project | Project finance (`PROJECT_FINANCE`) |  | ✅ |  |
| Corporate / project | Infrastructure finance (`INFRASTRUCTURE`) |  | ✅ |  |
| Corporate / project | Acquisition finance (`ACQUISITION_FINANCE`) |  | ✅ |  |
| Trade / receivables | Import loan (`IMPORT_LOAN`) |  | ✅ |  |
| Trade / receivables | Export working capital (`EXPORT_WORKING_CAPITAL`) |  | ✅ |  |
| Trade / receivables | Invoice-backed loan (`INVOICE_BACKED`) |  | ✅ |  |
| Trade / receivables | Import letter of credit (`LETTER_OF_CREDIT`) |  | ✅ |  |
| Trade / receivables | Factoring (`FACTORING`) |  | ✅ |  |
| Trade / receivables | Supply-chain finance (`SUPPLY_CHAIN_FINANCE`) |  | ✅ |  |
| Trade / receivables | Forfaiting (`FORFAITING`) |  | ✅ |  |
| Institutional / public | Interbank loan (`INTERBANK`) |  | ✅ |  |
| Institutional / public | Municipal loan (`MUNICIPAL`) |  | ✅ |  |
| Institutional / public | Sovereign loan (`SOVEREIGN`) |  | ✅ |  |
| Institutional / public | Development / concessional loan (`DEVELOPMENT_CONCESSIONAL`) |  | ✅ |  |
