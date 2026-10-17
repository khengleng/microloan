# Traceability: loan servicing scope vs. this codebase

Every LT, UC, OPS, DOC and TV item from [USE_CASES.md](USE_CASES.md) and
[TEST_VECTORS.md](TEST_VECTORS.md), with the code that implements it, the
tests that prove it, and a status. First reviewed 17 Oct 2026; updated the
same day after the build-out on `feat/composable-policies`.

Status: ✅ Done · 🟡 Partial · ⛔ Missing.
Stack: **L** = configurable lending platform (`packages/shared/src/lending`,
`apps/api/src/lending`), **G** = legacy core app (`apps/api/src/{loans,repayments,…}`).

Path shorthand: `eng/` = `packages/shared/src/lending/`, `api/` = `apps/api/src/lending/`,
`svc` = `api/servicing/servicing.service.ts`, `int/` = `apps/api/test/lending/`,
`et/` = `packages/shared/test/`.

## Summary

Updated 17 Oct 2026 after the build-out on `feat/composable-policies`.

| Group | ✅ | 🟡 | ⛔ | Total |
|---|---|---|---|---|
| Loan types (LT) | 21 | 2 | 1 | 24 |
| Use cases (UC) | 70 | 1 | 4 | 75 |
| Operations (OPS) | 7 | 1 | 0 | 8 |
| Documents (DOC) | 10 | 0 | 0 | 10 |
| Test vectors (TV) | 20 match | 0 engine only | 0 not reproduced | 20 |

## Closed in this build-out

Every item of the original risk ranking, including the customer document library (DOC-1..10):
early payments held as advances (UC-26/27), non-accrual (UC-62),
impairment for lending loans (OPS-5), facility term-out and arrears
(UC-43/38), suspense and refunds (UC-28/74), the legacy payoff that could
not close a loan (UC-31 G), fee waivers (UC-32), group contributions
(UC-22), Rule of 78 / actuarial rebates (UC-33). Also: composable loan
policies with lock-in charges, margin calls and collateral release
(UC-51/73), combined LTV (LT-04), late-fee options and caps (UC-54/55),
returned-payment fee (UC-23), third-party payer (UC-20), promise-to-pay
follow-up (UC-59), and every golden test vector. Later: payment channels —
auto-debit mandates and collection (UC-16, mock bank), settlement and payroll
files with daily reconciliation (UC-18, UC-19), cross-currency payments with
FX gain/loss (UC-21).

Then the recovery workflows: repossession (UC-65), pawn
custody, forfeiture and auction (UC-66, LT-09), credit insurance with a
financed premium owed to the insurer (UC-06, UC-68) and debt sale (UC-71),
in `api/recovery/` with the web recovery card and desk. Assumptions are
DECISIONS D-011 to D-016.

Then: down payments and third-party payees with consolidation (UC-02, UC-05,
UC-35, LT-10), stepped instalments and promotional rates (UC-15, UC-46),
payoff and takeover letters (UC-31, UC-34), reversal of rescheduling
prepayments (UC-23), the collections ladder with work queues, guarantor
demands and set-off (UC-58, UC-60, UC-61), over-limit fee and facility
renewal (UC-41, UC-42), statements, notices, closure letters, bureau file
and GL export (OPS-4/6/7, UC-75), origination credit score and DSCR with
covenant monitoring (OPS-2, LT-16), the customer document library
(DOC-1..10), invoice finance, letters of credit and syndication (LT-18,
LT-19, LT-24).

## Remaining gaps ranked by risk to money owed

| # | Gap | Items | Why it matters |
|---|---|---|---|
| 1 | Auto-debit has no real bank integration (mandates, collection, retries and reconciliation are built on a mock bank) | UC-16 | Production cannot collect by direct debit until a bank adapter exists |
| 2 | Specialised products: cards and BNPL merchant settlement; true lease (Ijarah) | LT-07, LT-11, LT-15, UC-39, UC-40, UC-44, UC-52 | Not offered (capability-gated) |
| 3 | Borrower notices are listed on demand, not sent by the end-of-day batch; SMS, KYC and bureau adapters are mocks | OPS-4, UC-58, UC-75 | Communication depends on a person exporting and sending |

## Loan types

| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| LT-01 Personal | ✅ | L, G | `PERSONAL_INSTALMENT` eng/catalogue.ts:200; legacy formulas.ts; int/phase1-slice.int-spec.ts:31 | Flat-rate loans cannot take partial prepayments |
| LT-02 Mortgage | ✅ | L | `HOME_MORTGAGE` catalogue.ts:220; floating pricing; int/floating.int-spec.ts | LTV ignores financed fees |
| LT-03 Home equity | ✅ | L | `HOME_EQUITY_TERM` catalogue.ts:241; combined LTV with prior liens (applications.service assess); int/collateral.int-spec.ts, int/commercial-covenants.int-spec.ts | — |
| LT-04 HELOC | ✅ | L | `HOME_EQUITY_LINE`; combined LTV with prior liens (applications.service assess); term-out books a schedule (facilities.service termOut); int/collateral.int-spec.ts (TV-17), int/facilities.int-spec.ts | — |
| LT-05 Auto / motorbike | ✅ | L | `CAR_LOAN`, `MOTORCYCLE_LOAN`, `BALLOON_VEHICLE`; minimum down payment (UC-02) and dealer payout (UC-05); repossession (UC-65); int/disbursement-payees.int-spec.ts, int/recovery.int-spec.ts | — |
| LT-06 Student | ✅ | L | `STUDENT_LOAN`; grace + capitalization, `pricing.capitalization.basis` SIMPLE (TV-16) | Template still COMPOUND by default (D-009) |
| LT-07 Credit card | ⛔ | — | `CREDIT_CARD` blocked by `card.revolving_credit` | No purchase grace, statement cycle or card minimum payment |
| LT-08 Payday | ✅ | L | `SALARY_ADVANCE` catalogue.ts:204 (interest-only, one instalment) | Needs reconfiguring for a fee; no nominal APR (TV-08) |
| LT-09 Pawn / gold | ✅ | L | Custody record, valuation by weight × purity × price per gram (eng/recovery.ts `pawnValuation`), forfeiture after the redemption deadline under maker-checker, auction, return on redemption: api/recovery/recovery.service.ts; et/recovery.test.ts; int/recovery.int-spec.ts | Gold price entered per item (no price feed) |
| LT-10 Debt consolidation | ✅ | L | `DEBT_CONSOLIDATION`; disbursement payees settle several internal loans (`INTERNAL_LOAN`) and pay outside lenders (`PREVIOUS_LENDER`) from the proceeds (servicing.service executeDisbursement); int/disbursement-payees.int-spec.ts | — |
| LT-11 BNPL | 🟡 | L | `BNPL` blocked by `bnpl.merchant_settlement`; a 4×fortnightly 0% plan can be configured | No merchant settlement or refund handling (UC-52) |
| LT-12 Term loan | ✅ | L | `SME_TERM` catalogue.ts:301; `CORPORATE_TERM` :353 (quarterly) | Quarterly untested end to end |
| LT-13 Overdraft | ✅ | L | `OVERDRAFT`; minimum-payment arrears aged (UC-38); renewal (UC-42) and over-limit allowance/fee (UC-41): int/facilities.int-spec.ts | — |
| LT-14 Business line of credit | ✅ | L | `REVOLVING_CREDIT`; term-out books an amortizing schedule (int/facilities.int-spec.ts UC-43) | — |
| LT-15 Equipment lease | 🟡 | L | `EQUIPMENT_LOAN` catalogue.ts:249 with balloon; TV-19 passes | True lease (`IJARAH`) blocked |
| LT-16 Commercial real estate | ✅ | L | `COMMERCIAL_PROPERTY`; origination DSCR gate `eligibility.minDscr` from `terms.financials` (eng/scorecard.ts `debtServiceCoverage`); covenants MIN_DSCR / MAX_LTV / FINANCIAL_STATEMENTS tested on schedule, breach → notice, cure or waiver by a second person (api/covenants/covenants.service.ts); int/commercial-covenants.int-spec.ts | — |
| LT-17 Construction | ✅ | L | `CONSTRUCTION` staged facility; term-out schedule | — |
| LT-18 Invoice financing | ✅ | L | `INVOICE_BACKED` (revolving, `trade.invoice`); register, maker-checker advance, debtor settlement and borrower payout: api/trade/invoice-finance.service.ts; eng/invoice.ts `allocateInvoiceCollection`; et/trade.test.ts; int/trade.int-spec.ts "LT-18", "TV-20" | No factoring / non-recourse purchase; collections cannot be reversed through the API (D-024) |
| LT-19 Letter of credit | ✅ | L | `LETTER_OF_CREDIT` (`trade.letterOfCredit`); maker-checker issue with fee and off-balance-sheet memo (9100/9200), expiry/cancel: api/trade/letters-of-credit.service.ts; eng/letter-of-credit.ts; int/trade.int-spec.ts "LT-19" | No SWIFT messaging or document examination; fee collected at issue only (D-026) |
| LT-20 SME | ✅ | L | `SME_TERM`; int/phase1-slice.int-spec.ts:86 | — |
| LT-21 Microfinance | ✅ | L | `MICRO_INDIVIDUAL` :266, `MICRO_GROUP` :281; int/groups.int-spec.ts | Member contributions not collectable (UC-22) |
| LT-22 Agricultural | ✅ | L | `AGRI_CROP_SEASONAL` :327; int/phase1-slice.int-spec.ts:224 | — |
| LT-23 Bridge | ✅ | L | `BRIDGE_LOAN` :244 (interest-only bullet) | Rolled-up interest untested |
| LT-24 Syndicated | ✅ | L | `SYNDICATED` (`syndication`), floating benchmark + margin; participants by share or amount (sum 100%), maker-checker approval, funding before disbursement, every collection and reversal split into the participant sub-ledger, maker-checker payouts: api/syndication/syndication.service.ts; eng/syndication.ts; et/syndication.test.ts; int/syndication.int-spec.ts | Losses on write-off / negotiated settlement not shared automatically; no secondary transfers of participations (D-028) |

## Use cases

### A. Disbursement
| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| UC-01 | ✅ | L, G | eng/fees.ts:49 `netDisbursement`; `svc` disbursement; et/servicing.test.ts:136 | — |
| UC-02 | ✅ | L | `terms.downPayment` checked against `operations.downPayment.minFraction`; recorded before disbursement (POST /loans/:id/down-payments, LENDER-held → 2600 or paid to seller); disbursement refused until received, held amount paid out with the proceeds; int/disbursement-payees.int-spec.ts | — |
| UC-03 | ✅ | L, G | `svc` prepare/approve/execute (maker-checker); int/security.int-spec.ts:118 | — |
| UC-04 | ✅ | L | `CONSTRUCTION` staged facility; int/facilities.int-spec.ts:559 | Interest posted at statement, not daily |
| UC-05 | ✅ | L | Disbursement `payees` (seller, dealer, school, previous lender, borrower, other) must add up to the payout; recorded on the event; int/disbursement-payees.int-spec.ts | — |
| UC-06 | ✅ | L | Fee `FINANCED` with `payee: INSURER` credits the insurer payable (2600) at disbursement, not fee income (`svc` executeDisbursement); policy record and remittance under maker-checker api/recovery/recovery.service.ts; int/recovery.int-spec.ts (UC-06) | — |
| UC-07 | ✅ | L | Irregular first period eng/schedule.ts:212; et/schedule.test.ts:146; TV-09 | No template enables it |

### B. Scheduled repayment
| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| UC-08 | ✅ | L, G | eng/schedule.ts:425; TV-01, TV-02 | — |
| UC-09 | ✅ | L | eng/schedule.ts:447; TV-03 | Not in legacy |
| UC-10 | ✅ | L, G | eng/schedule.ts:371; TV-04 | — |
| UC-11 | ✅ | L | Principal grace eng/schedule.ts:417; TV-05 | — |
| UC-12 | ✅ | L | Balloon / interest-only eng/schedule.ts:425-456; TV-05, TV-06 | — |
| UC-13 | ✅ | L | `EXPLICIT` method; int/phase1-slice.int-spec.ts:224 | — |
| UC-14 | ✅ | L | Interest grace with capitalization eng/schedule.ts:411 | Always capitalizes (no "accrue and pay later") |
| UC-15 | ✅ | L | `repayment.instalmentSteps` (graduated / step-down multipliers, solved so the loan closes) eng/schedule.ts `stepWeights`; eng/steps-promotion.test.ts; int/promotion-steps.int-spec.ts (serviced to closure) | Prepayment recast returns to level instalments |

### C. Payment channels
| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| UC-16 | 🟡 | L | Direct-debit mandates per loan; end of day collects due instalments through the bank adapter, posts the repayment, retries per policy, queues a failure notice (api/payments/payment-channels.service.ts `collectDue`; eng/channels.ts `nextDebitAttempt`, `amountToCollect`; D-017); int/payment-channels.int-spec.ts | Bank adapter is a mock (refused in production): no real bank integration yet |
| UC-17 | ✅ | L, G | `svc` repayment with external reference; int/phase1-slice.int-spec.ts:257 | — |
| UC-18 | ✅ | L, G | Mobile / QR / wallet / agent settlement-file import, idempotent per file hash and channel transaction id; unmatched lines to suspense; daily reconciliation per channel (api/payments/channel-files.service.ts; eng/channels.ts `parseSettlementFile`, `reconcileChannel`; D-018); service accounts may push files; int/payment-channels.int-spec.ts; et/channels.test.ts | — |
| UC-19 | ✅ | L | Employer remittance import by national id (blind index) or loan reference, employer recorded as payer; per-employer summary (api/payments/channel-files.service.ts; eng/channels.ts `parsePayrollFile`; D-018); int/payment-channels.int-spec.ts | — |
| UC-20 | ✅ | L | Repayment `payer` (name, relationship, reference); int/late-charges.int-spec.ts | — |
| UC-21 | ✅ | L | Payment in another currency converted at mid less a configurable spread from the tenant rate table, rate stored on the event, FX gain/loss (4410) via FX position (1050), refused without a rate for the value date (api/payments/payment-channels.service.ts `fxRepayment`; eng/channels.ts `convertPayment`; D-019); int/payment-channels.int-spec.ts; et/channels.test.ts | Reversal returns the loan-currency leg only; the foreign cash stays in the FX position |
| UC-22 | ✅ | L | Repayment `contributions` split by member, recorded with the repayment; reversed ones excluded; int/groups.int-spec.ts | — |
| UC-23 | ✅ | L, G | Reversal with `returned` charges `pricing.returnedPaymentFee`; a prepayment that rescheduled the loan is reversed by a new agreement version restoring the replaced instalments, instalment and maturity; int/late-charges.int-spec.ts, int/prepayment-reversal.int-spec.ts | — |

### D. Payment allocation
| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| UC-24 | ✅ | L | Config order + strategy; eng/servicing.ts:266; TV-15 | Legacy order fixed |
| UC-25 | ✅ | L, G | eng/servicing.ts:282; TV-15 | — |
| UC-26 | ✅ | L | `excessHandling` ADVANCE / PREPAY / REJECT, customer choice; int/advances.int-spec.ts | — |
| UC-27 | ✅ | L | Advance applied by end of day before penalties and DPD; int/advances.int-spec.ts | — |
| UC-28 | ✅ | L | Unidentified payments in suspense (2500), matching, refunds, aging; api/payments/suspense.service.ts; int/suspense.int-spec.ts | — |

### E. Early repayment
| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| UC-29 | ✅ | L | `SHORTEN` eng/servicing.ts:183; TV-10 option B | Not on flat-rate loans |
| UC-30 | ✅ | L | `RECAST` eng/servicing.ts:130; TV-10 option A; int/phase1-slice.int-spec.ts:344 | Not on flat-rate loans |
| UC-31 | ✅ | L, G | Payoff letters good through a date (daily payoff table, per diem), settled against with `payoffQuoteId`; stale or expired letters refused (api/servicing payoff-quotes); int/payoff-letters.int-spec.ts | — |
| UC-32 | ✅ | L | Lock-in tiers (policies); maker-checker fee waiver; int/policies.int-spec.ts, int/fee-waivers.int-spec.ts | — |
| UC-33 | ✅ | L | `earlySettlement.rebateMethod` RULE_OF_78 / ACTUARIAL (eng/rebate.ts); TV-12 via live flow (int/rebates.int-spec.ts) | — |
| UC-34 | ✅ | L | Internal refinance; TAKEOVER payoff letter addressed to the acquiring lender and settled with its funds; int/payoff-letters.int-spec.ts | — |
| UC-35 | ✅ | L | `INTERNAL_LOAN` payees settle the borrower's other loans from the proceeds, `PREVIOUS_LENDER` pays outside debts; another borrower's loan refused; int/disbursement-payees.int-spec.ts | — |

### F. Revolving credit
| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| UC-36 | ✅ | L | api/facilities/facilities.service.ts:170; int/facilities.int-spec.ts:217 | — |
| UC-37 | ✅ | L | eng/facility.ts:471; TV-07; int/facilities.int-spec.ts:320 | Posted at statement, not by end-of-day |
| UC-38 | ✅ | L | Overdraft minimum payment; unpaid minimum aged by end of day (facilities batch hook) | — |
| UC-39 | ⛔ | — | `card.revolving_credit` not implemented | No purchase grace |
| UC-40 | ⛔ | — | none | No cash-advance type or fee |
| UC-41 | ✅ | L | Over-limit rate plus `facility.overlimitTolerance` allowance on drawdowns and a flat `facility.overlimitFee` per statement period over the limit; limit change maker-checker; int/facilities.int-spec.ts | — |
| UC-42 | ✅ | L | RENEWAL limit change (maker-checker) extends availability and maturity by `renewalMonths`, reactivating an expired line; int/facilities.int-spec.ts | — |
| UC-43 | ✅ | L | Term-out books an amortizing schedule; int/facilities.int-spec.ts | — |
| UC-44 | ⛔ | — | none | — |

### G. Changes during the loan
| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| UC-45 | ✅ | L | api/servicing/rate-reset.service.ts; int/floating.int-spec.ts (incl. end-of-day batch) | Recalculates instalment only, not term |
| UC-46 | ✅ | L | `pricing.promotion` campaign rate for the first instalments when the contract quotes its code; instalment re-solved at the contract rate after; int/promotion-steps.int-spec.ts | — |
| UC-47 | ✅ | L | Restructure option `DUE_DATE_CHANGE` | Only through the hardship workflow |
| UC-48 | ✅ | L | Restructure option `TERM_EXTENSION`; int/relief.int-spec.ts | — |
| UC-49 | ✅ | L | Payment-holiday programmes api/restructuring/payment-holiday.service.ts; int/relief.int-spec.ts | Capitalize path engine-tested only; TV-13 not driven through it |
| UC-50 | ✅ | L | Refinance top-up eng/refinance.ts:125 | Only via refinance |
| UC-51 | ✅ | L | Revaluation → margin call with deadline, cure/expiry by end of day; api/collateral/collateral.service.ts; int/collateral.int-spec.ts (TV-18) | — |
| UC-52 | ⛔ | — | BNPL blocked | — |
| UC-53 | ✅ | L | Drawing request → approve → pay books the importer's loan under the configured conversion product (schedule, account, DISBURSEMENT to the beneficiary) and releases the memo: `LettersOfCreditService.payDrawing`; int/trade.int-spec.ts "UC-53" | Conversion loans carry no upfront fee (D-027) |

### H. Late and missed payments
| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| UC-54 | ✅ | L | `graceDays`; int/late-charges.int-spec.ts | Legacy penalty has no grace |
| UC-55 | ✅ | L | FLAT / PERCENT_PER_INSTALMENT, caps per instalment and per loan; int/late-charges.int-spec.ts | Legacy uncapped |
| UC-56 | ✅ | L | `svc` penalty assessment; TV-14; int/phase1-slice.int-spec.ts:339 | Day count fixed at ACT/365F |
| UC-57 | ✅ | L, G | `delinquency()` in `svc`; int/phase1-slice.int-spec.ts:257 | Facilities excluded |
| UC-58 | ✅ | L, G | Collection ladder `operations.collectionStages` (SMS, call, visit, notice, legal review): end of day raises one task per stage per arrears episode; SMS/notices sent via outbox, calls/visits in collector queues (claim, outcome); cured loans close tasks (api/collections/collections.service.ts); int/collections-work.int-spec.ts | SMS delivery adapter is a mock |
| UC-59 | ✅ | G | Daily review marks promises KEPT/BROKEN and flags broken ones (collections.service reviewPromises); int/promises.int-spec.ts | Lending stack has no promise-to-pay of its own |
| UC-60 | ✅ | L | Demand on a guarantor up to the guarantee and the debt, letter, guarantor payments posted as repayments with the guarantor as payer; int/collections-work.int-spec.ts | — |
| UC-61 | ✅ | L | Set-off of the borrower's deposit up to the overdue amount, maker-checker, posted through set-off clearing (2700); int/collections-work.int-spec.ts | Core-banking deposit debit is outside this system |
| UC-62 | ✅ | L | Non-accrual with interest in suspense, release on collection / cure; int/advances.int-spec.ts | — |

### I. Restructuring and recovery
| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| UC-63 | ✅ | L, G | api/restructuring/restructuring.service.ts; int/restructure.int-spec.ts | Legacy restructure has no maker-checker |
| UC-64 | ✅ | L | Negotiated settlement `svc`; int/settlement.int-spec.ts:114 | No web screen |
| UC-65 | ✅ | L | Seize (maker-checker) → value → sell; proceeds waterfall eng/recovery.ts `applyRecoveryProceeds`; surplus to a borrower payable paid out under maker-checker; deficiency stays on the open loan; pledge SOLD: api/recovery/recovery.service.ts; int/recovery.int-spec.ts (surplus, deficiency, write-off then recovery) | Proceeds order and costs are assumptions (DECISIONS D-011, D-012) |
| UC-66 | ✅ | L | Forfeiture after the deadline (maker-checker), auction through the same waterfall: api/recovery/recovery.service.ts; int/recovery.int-spec.ts | — |
| UC-67 | ✅ | L | End-of-day batch puts an invoice unpaid after due date + grace into RECOURSE: fee frozen at that date, advance + fee owed by the borrower, days past due / bucket / stage from the recourse date; recourse payments capped at what is owed: `InvoiceFinanceService.recourseHook`; int/trade.int-spec.ts "UC-67" | No late penalty on recourse arrears (D-025); factoring (`trade.factoring`) still not offered |
| UC-68 | ✅ | L | Policy per loan; claim approved by a second user settles the loan against an insurer receivable (1410), excess to the estate; insurer payment clears it: api/recovery/recovery.service.ts; int/recovery.int-spec.ts | D-013 |
| UC-69 | ✅ | L, G | Write-off propose/approve `svc`; int/settlement.int-spec.ts:275 | Legacy write-off has no maker-checker |
| UC-70 | ✅ | L | Recovery `svc`; int/settlement.int-spec.ts:296 | No web screen |
| UC-71 | ✅ | L | Debt sale of a delinquent or written-off loan under maker-checker and authority; gain/loss net of allowance (eng/recovery.ts `debtSaleResult`, 4400 / 5400); status SOLD, no further servicing: api/recovery/recovery.service.ts; int/recovery.int-spec.ts | D-015 |

### J. Closure
| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| UC-72 | ✅ | L, G | `closeIfRepaid` in `svc`; int/security.int-spec.ts:852 | — |
| UC-73 | ✅ | L | Release after closure, signed off by a second user; int/collateral.int-spec.ts | — |
| UC-74 | ✅ | L | Advance refunds and suspense refunds under maker-checker; int/suspense.int-spec.ts | — |
| UC-75 | ✅ | L, G | Closure letter for closed loans (api/reporting closure-letter; also filed in the customer library), credit bureau file `/lending/ops/bureau-export.csv`; int/reporting.int-spec.ts | Bureau submission adapter not connected |

## Operations

| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| OPS-1 | ✅ | L | api/products/products.service.ts (versions, diff, maker-checker, capability gate); et/config.test.ts | — |
| OPS-2 | ✅ | L, G | Eligibility, DSR, LTV, guarantors; explainable origination credit score with `eligibility.minCreditScore` (eng/scorecard.ts) and DSCR gate; legacy scorecard + credit bureau | KYC and bureau adapters are mocks |
| OPS-3 | ✅ | L | Collateral, haircuts, guarantees; revaluation and margin calls (UC-51), release (UC-73), repossession (UC-65), guarantor demands (UC-60), covenants (LT-16) | — |
| OPS-4 | 🟡 | L | Automatic end of day: auto-debit collection (UC-16), accrual, advances, penalties, DPD, non-accrual, classification and provisioning, facility arrears, margin calls, rate resets (eod-scheduler.service.ts) | Notices are listed on demand, not sent by the batch |
| OPS-5 | ✅ | L, G | Lending: tenant impairment policy (REGULATORY or ECL by stage), allowance posted by end of day (api/accounting/impairment.service.ts; int/impairment.int-spec.ts); legacy NBC runs | — |
| OPS-6 | ✅ | L, G | Balanced double-entry + reconciliation (api/accounting/operations.service.ts); GL export of journal lines for a period `/lending/ops/gl-export.csv` with debit/credit totals; int/reporting.int-spec.ts | Lending and legacy ledgers not consolidated |
| OPS-7 | ✅ | L, G | Loan statements for any period (`/loans/:id/statement`), due-soon and overdue notices with message text (`/ops/notices`), facility statements, closure letters; int/reporting.int-spec.ts | Lending missing from the legacy NBC regulatory report |
| OPS-8 | ✅ | L | RBAC + ABAC + MFA + authority (api/policy); audit events; int/security.int-spec.ts | Break-glass not implemented; legacy approvals partly without maker-checker |

## Customer document management

| ID | Status | Evidence | Gap |
|---|---|---|---|
| DOC-1 | ✅ | One library per borrower: `CustomerDocument` + `CustomerDocumentVersion` (api/lending/documents/customer-documents.service.ts). Application uploads and portal e-KYC write through; older `KycDocument`, legacy `Document` and `ApplicationDocument` rows are linked in when a library is opened (or all at once), never moved or deleted (int/documents.int-spec.ts "DOC-1") | Collateral documents are filed against the customer with an optional `collateralId`; there is no collateral screen for them yet |
| DOC-2 | ✅ | Object storage only (S3, or a local-disk store for development / a mounted volume); key `tenants/<tenant>/customers/<borrower>/documents/<doc>/v<n>-<uuid>`; SHA-256, size, MIME allowlist checked against the bytes (api/lending/documents/document-storage.ts; storage CHECK in migration 20261019000400; "DOC-1/DOC-2") | Older KYC images stay base64 in `KycDocument` until replaced (linked, not migrated) |
| DOC-3 | ✅ | Required documents from the product configuration per application and stage, read from the library: missing, rejected or expired mandatory items block submission and approval (`GET /lending/applications/:id/document-checklist`, `GET /lending/customers/:id/document-checklist`; "DOC-3") | DISBURSEMENT-stage items are shown but not yet enforced at disbursement |
| DOC-4 | ✅ | Every document version is reviewed: accept, or reject with a reason; the uploader can never review (maker-checker, `document.review`); review queue (`GET /lending/document-review-queue`; "DOC-4") | — |
| DOC-5 | ✅ | Replacing creates version n+1; earlier versions stay downloadable; stored versions are immutable and documents are never hard-deleted (database triggers; "DOC-5") | — |
| DOC-6 | ✅ | Issue/expiry dates; nightly job (`DOCUMENT_EXPIRY_CRON`) and on demand (`POST /lending/document-expiries/run`) flag expired documents and raise one `document.expiry_reminder` outbox notice before expiry; expiry list (`GET /lending/document-expiries`; "DOC-6") | The outbox notices are not yet delivered by SMS/Telegram (notification adapter is a mock) |
| DOC-7 | ✅ | Retention per category or type (defaults D-020, tenant rules via `PUT /lending/document-retention`), counted from the end of the relationship; legal hold; deletion is a soft delete plus removal of the stored files, refused early or under hold, audited ("DOC-7") | Content of linked older records is kept in its old store on deletion |
| DOC-8 | ✅ | `document.*` permissions, branch-scoped on the customer's branch; every library view, document view, link and download audited; links expire in 30 s–15 min (S3 pre-signed or HMAC-signed API link); tenant wall maps every new route ("DOC-8" ×2, int/tenant-wall.int-spec.ts) | — |
| DOC-9 | ✅ | `fileGenerated()` for any module; key facts statement filed at booking, settlement quote letter (`POST /lending/loans/:id/settlement-quote-letter`), closure letter on settlement ("DOC-9") | Periodic statements and arrears notices are not generated yet, so not filed |
| DOC-10 | ✅ | Portal "documents requested from you" (`GET /borrower/document-requests`), upload against a request with re-upload after rejection, own documents with download (`/borrower/my-documents`); staff raise requests from the library ("DOC-10") | — |

## Test vectors

Automated in `packages/shared/test/test-vectors.test.ts` (every vector is a passing test; none remain `todo`). TV-12, TV-17, TV-18 and TV-20 are also reproduced through the live API (int/rebates, int/collateral, int/trade).

| ID | Status | Note |
|---|---|---|
| TV-01 | ✅ | Every listed figure matches |
| TV-02 | ✅ | — |
| TV-03 | ✅ | — |
| TV-04 | ✅ | Nominal 21.46% / effective 23.70% (periodicRateFromPayments) |
| TV-05 | ✅ | — |
| TV-06 | ✅ | — |
| TV-07 | ✅ | — |
| TV-08 | ✅ | Nominal APR 391.07% |
| TV-09 | ✅ | — |
| TV-10 | ✅ | Both options |
| TV-11 | ✅ | Accrued interest via engine; penalty base read from the settlement quote code |
| TV-12 | ✅ | Engine and live flow |
| TV-13 | ✅ | Simple capitalization in the schedule engine |
| TV-14 | ✅ | — |
| TV-15 | ✅ | — |
| TV-16 | ✅ | Simple capitalization |
| TV-17 | ✅ | Combined LTV at origination |
| TV-18 | ✅ | Margin call on revaluation |
| TV-19 | ✅ | — |
| TV-20 | ✅ | Engine (et/test-vectors.test.ts, et/trade.test.ts) and live API: advance 8,000.00, fee 400.00 after 60 days, 1,600.00 paid to the borrower (int/trade.int-spec.ts "TV-20") |
