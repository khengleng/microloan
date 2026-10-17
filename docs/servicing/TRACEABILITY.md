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
| Loan types (LT) | 15 | 8 | 1 | 24 |
| Use cases (UC) | 48 | 8 | 19 | 75 |
| Operations (OPS) | 3 | 5 | 0 | 8 |
| Documents (DOC) | 0 | 6 | 4 | 10 |
| Test vectors (TV) | 20 match | 0 engine only | 0 not reproduced | 20 |

## Closed in this build-out

Every item of the original risk ranking except the document store:
early payments held as advances (UC-26/27), non-accrual (UC-62),
impairment for lending loans (OPS-5), facility term-out and arrears
(UC-43/38), suspense and refunds (UC-28/74), the legacy payoff that could
not close a loan (UC-31 G), fee waivers (UC-32), group contributions
(UC-22), Rule of 78 / actuarial rebates (UC-33). Also: composable loan
policies with lock-in charges, margin calls and collateral release
(UC-51/73), combined LTV (LT-04), late-fee options and caps (UC-54/55),
returned-payment fee (UC-23), third-party payer (UC-20), promise-to-pay
follow-up (UC-59), and every golden test vector.

## Remaining gaps ranked by risk to money owed

| # | Gap | Items | Why it matters |
|---|---|---|---|
| 1 | Customer documents live in three unrelated stores, two of them as base64 in the database | DOC-1..10 | No single record of what a customer gave the bank; no retention or expiry |
| 2 | No collection escalation engine or collector work queues in the lending stack; guarantor demand and set-off missing | UC-58, UC-60, UC-61 | Arrears follow-up relies on people remembering |
| 3 | Payment channels beyond manual and service-account posting | UC-16, UC-18, UC-19, UC-21 | Auto-debit, wallet settlement files, payroll files and cross-currency payments must be keyed by hand |
| 4 | Recovery workflows: repossession, pawn forfeiture, insurance claim, debt sale | UC-65, UC-66, UC-68, UC-71 | Recoveries happen off-system |
| 5 | Disbursement: down payment and payment to third parties | UC-02, UC-05, UC-35 | Dealer, school and previous-lender payouts are not recorded |
| 6 | Specialised products: cards, BNPL | LT-07, LT-11 and their UCs | Not offered (capability-gated). Invoice finance, letters of credit and syndication were added on 17 Oct 2026 (below). |
| 7 | Closure letter and credit bureau update; promotional rates; payoff letter | UC-75, UC-46, UC-34 | Customer and bureau communication off-system |

## Loan types

| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| LT-01 Personal | ✅ | L, G | `PERSONAL_INSTALMENT` eng/catalogue.ts:200; legacy formulas.ts; int/phase1-slice.int-spec.ts:31 | Flat-rate loans cannot take partial prepayments |
| LT-02 Mortgage | ✅ | L | `HOME_MORTGAGE` catalogue.ts:220; floating pricing; int/floating.int-spec.ts | LTV ignores financed fees |
| LT-03 Home equity | 🟡 | L | `HOME_EQUITY_TERM` catalogue.ts:241; LTV gate api/origination/applications.service.ts:1617 | No combined LTV with senior liens |
| LT-04 HELOC | ✅ | L | `HOME_EQUITY_LINE`; combined LTV with prior liens (applications.service assess); term-out books a schedule (facilities.service termOut); int/collateral.int-spec.ts (TV-17), int/facilities.int-spec.ts | — |
| LT-05 Auto / motorbike | 🟡 | L | `CAR_LOAN`, `MOTORCYCLE_LOAN`, `BALLOON_VEHICLE` catalogue.ts:246-250 | No down payment (UC-02), no dealer payout (UC-05) |
| LT-06 Student | ✅ | L | `STUDENT_LOAN`; grace + capitalization, `pricing.capitalization.basis` SIMPLE (TV-16) | Template still COMPOUND by default (D-009) |
| LT-07 Credit card | ⛔ | — | `CREDIT_CARD` blocked by `card.revolving_credit` | No purchase grace, statement cycle or card minimum payment |
| LT-08 Payday | ✅ | L | `SALARY_ADVANCE` catalogue.ts:204 (interest-only, one instalment) | Needs reconfiguring for a fee; no nominal APR (TV-08) |
| LT-09 Pawn / gold | 🟡 | L | Collateral codes + max LTV | No custody, valuation by weight/purity, forfeiture or auction |
| LT-10 Debt consolidation | 🟡 | L | `DEBT_CONSOLIDATION` catalogue.ts:210 | Cannot pay off several or external debts (UC-35) |
| LT-11 BNPL | 🟡 | L | `BNPL` blocked by `bnpl.merchant_settlement`; a 4×fortnightly 0% plan can be configured | No merchant settlement or refund handling (UC-52) |
| LT-12 Term loan | ✅ | L | `SME_TERM` catalogue.ts:301; `CORPORATE_TERM` :353 (quarterly) | Quarterly untested end to end |
| LT-13 Overdraft | 🟡 | L | `OVERDRAFT`; minimum-payment arrears aged (int/facilities.int-spec.ts UC-38) | No annual renewal (UC-42) |
| LT-14 Business line of credit | ✅ | L | `REVOLVING_CREDIT`; term-out books an amortizing schedule (int/facilities.int-spec.ts UC-43) | — |
| LT-15 Equipment lease | 🟡 | L | `EQUIPMENT_LOAN` catalogue.ts:249 with balloon; TV-19 passes | True lease (`IJARAH`) blocked |
| LT-16 Commercial real estate | 🟡 | L | `COMMERCIAL_PROPERTY` catalogue.ts:325; LTV gate | No origination DSCR; covenant monitoring not implemented |
| LT-17 Construction | ✅ | L | `CONSTRUCTION` staged facility; term-out schedule | — |
| LT-18 Invoice financing | ✅ | L | `INVOICE_BACKED` (revolving, `trade.invoice`); register, maker-checker advance, debtor settlement and borrower payout: api/trade/invoice-finance.service.ts; eng/invoice.ts `allocateInvoiceCollection`; et/trade.test.ts; int/trade.int-spec.ts "LT-18", "TV-20" | No factoring / non-recourse purchase; collections cannot be reversed through the API (D-011) |
| LT-19 Letter of credit | ✅ | L | `LETTER_OF_CREDIT` (`trade.letterOfCredit`); maker-checker issue with fee and off-balance-sheet memo (9100/9200), expiry/cancel: api/trade/letters-of-credit.service.ts; eng/letter-of-credit.ts; int/trade.int-spec.ts "LT-19" | No SWIFT messaging or document examination; fee collected at issue only (D-013) |
| LT-20 SME | ✅ | L | `SME_TERM`; int/phase1-slice.int-spec.ts:86 | — |
| LT-21 Microfinance | ✅ | L | `MICRO_INDIVIDUAL` :266, `MICRO_GROUP` :281; int/groups.int-spec.ts | Member contributions not collectable (UC-22) |
| LT-22 Agricultural | ✅ | L | `AGRI_CROP_SEASONAL` :327; int/phase1-slice.int-spec.ts:224 | — |
| LT-23 Bridge | ✅ | L | `BRIDGE_LOAN` :244 (interest-only bullet) | Rolled-up interest untested |
| LT-24 Syndicated | ✅ | L | `SYNDICATED` (`syndication`), floating benchmark + margin; participants by share or amount (sum 100%), maker-checker approval, funding before disbursement, every collection and reversal split into the participant sub-ledger, maker-checker payouts: api/syndication/syndication.service.ts; eng/syndication.ts; et/syndication.test.ts; int/syndication.int-spec.ts | Losses on write-off / negotiated settlement not shared automatically; no secondary transfers of participations (D-015) |

## Use cases

### A. Disbursement
| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| UC-01 | ✅ | L, G | eng/fees.ts:49 `netDisbursement`; `svc` disbursement; et/servicing.test.ts:136 | — |
| UC-02 | ⛔ | — | none | No down-payment field or collection before disbursement |
| UC-03 | ✅ | L, G | `svc` prepare/approve/execute (maker-checker); int/security.int-spec.ts:118 | — |
| UC-04 | ✅ | L | `CONSTRUCTION` staged facility; int/facilities.int-spec.ts:559 | Interest posted at statement, not daily |
| UC-05 | ⛔ | — | Disbursement takes only an external reference | No payee split (seller, dealer, school, other lender) |
| UC-06 | 🟡 | L | Fee treatment `FINANCED` eng/fees.ts:77 | Premium booked as fee income, not an insurer payable; no policy record |
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
| UC-15 | 🟡 | L | Only via `EXPLICIT` dated amounts | No step-up/step-down method |

### C. Payment channels
| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| UC-16 | ⛔ | — | Payments adapter is mock only | No mandates or auto-debit |
| UC-17 | ✅ | L, G | `svc` repayment with external reference; int/phase1-slice.int-spec.ts:257 | — |
| UC-18 | 🟡 | L, G | Service-account repayment API (int/security.int-spec.ts:815); KHQR display | No wallet/agent settlement-file import or reconciliation |
| UC-19 | ⛔ | — | `SALARY_LOAN` eligibility only | No payroll deduction file |
| UC-20 | ✅ | L | Repayment `payer` (name, relationship, reference); int/late-charges.int-spec.ts | — |
| UC-21 | ⛔ | — | Repayment must be in the account currency | No conversion or FX gain/loss posting |
| UC-22 | ✅ | L | Repayment `contributions` split by member, recorded with the repayment; reversed ones excluded; int/groups.int-spec.ts | — |
| UC-23 | 🟡 | L, G | Reversal with `returned` charges `pricing.returnedPaymentFee`; int/late-charges.int-spec.ts | Repayments that triggered a reschedule still cannot be reversed |

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
| UC-31 | 🟡 | L, G | L: settlement quote (advance, lock-in, rebate); G: POST /repayments/settlements closes at the quote (int/legacy-payoff.int-spec.ts) | Quote not stored with a validity date; no payoff letter |
| UC-32 | ✅ | L | Lock-in tiers (policies); maker-checker fee waiver; int/policies.int-spec.ts, int/fee-waivers.int-spec.ts | — |
| UC-33 | ✅ | L | `earlySettlement.rebateMethod` RULE_OF_78 / ACTUARIAL (eng/rebate.ts); TV-12 via live flow (int/rebates.int-spec.ts) | — |
| UC-34 | 🟡 | L | Internal refinance `svc`; int/relief.int-spec.ts:372 | No payoff letter; no takeover from another lender |
| UC-35 | ⛔ | — | `refinancesLoanId` is one internal loan | Cannot pay off several or external debts |

### F. Revolving credit
| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| UC-36 | ✅ | L | api/facilities/facilities.service.ts:170; int/facilities.int-spec.ts:217 | — |
| UC-37 | ✅ | L | eng/facility.ts:471; TV-07; int/facilities.int-spec.ts:320 | Posted at statement, not by end-of-day |
| UC-38 | ✅ | L | Overdraft minimum payment; unpaid minimum aged by end of day (facilities batch hook) | — |
| UC-39 | ⛔ | — | `card.revolving_credit` not implemented | No purchase grace |
| UC-40 | ⛔ | — | none | No cash-advance type or fee |
| UC-41 | 🟡 | L | Over-limit rate; limit change maker-checker (int/facilities.int-spec.ts:394) | No flat over-limit fee |
| UC-42 | ⛔ | L | Manual expiry only | No renewal or review workflow |
| UC-43 | ✅ | L | Term-out books an amortizing schedule; int/facilities.int-spec.ts | — |
| UC-44 | ⛔ | — | none | — |

### G. Changes during the loan
| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| UC-45 | ✅ | L | api/servicing/rate-reset.service.ts; int/floating.int-spec.ts (incl. end-of-day batch) | Recalculates instalment only, not term |
| UC-46 | ⛔ | — | Only hardship rate cuts | No promotional rate with expiry |
| UC-47 | ✅ | L | Restructure option `DUE_DATE_CHANGE` | Only through the hardship workflow |
| UC-48 | ✅ | L | Restructure option `TERM_EXTENSION`; int/relief.int-spec.ts | — |
| UC-49 | ✅ | L | Payment-holiday programmes api/restructuring/payment-holiday.service.ts; int/relief.int-spec.ts | Capitalize path engine-tested only; TV-13 not driven through it |
| UC-50 | ✅ | L | Refinance top-up eng/refinance.ts:125 | Only via refinance |
| UC-51 | ✅ | L | Revaluation → margin call with deadline, cure/expiry by end of day; api/collateral/collateral.service.ts; int/collateral.int-spec.ts (TV-18) | — |
| UC-52 | ⛔ | — | BNPL blocked | — |
| UC-53 | ✅ | L | Drawing request → approve → pay books the importer's loan under the configured conversion product (schedule, account, DISBURSEMENT to the beneficiary) and releases the memo: `LettersOfCreditService.payDrawing`; int/trade.int-spec.ts "UC-53" | Conversion loans carry no upfront fee (D-014) |

### H. Late and missed payments
| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| UC-54 | ✅ | L | `graceDays`; int/late-charges.int-spec.ts | Legacy penalty has no grace |
| UC-55 | ✅ | L | FLAT / PERCENT_PER_INSTALMENT, caps per instalment and per loan; int/late-charges.int-spec.ts | Legacy uncapped |
| UC-56 | ✅ | L | `svc` penalty assessment; TV-14; int/phase1-slice.int-spec.ts:339 | Day count fixed at ACT/365F |
| UC-57 | ✅ | L, G | `delinquency()` in `svc`; int/phase1-slice.int-spec.ts:257 | Facilities excluded |
| UC-58 | 🟡 | L, G | Collection stages config; legacy queue + reminder crons | No escalation engine or collector work queues; lending notifications are mocks |
| UC-59 | ✅ | G | Daily review marks promises KEPT/BROKEN and flags broken ones (collections.service reviewPromises); int/promises.int-spec.ts | Lending stack has no promise-to-pay of its own |
| UC-60 | ⛔ | — | Guarantees captured only | No demand or guarantor payment |
| UC-61 | ⛔ | — | none | — |
| UC-62 | ✅ | L | Non-accrual with interest in suspense, release on collection / cure; int/advances.int-spec.ts | — |

### I. Restructuring and recovery
| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| UC-63 | ✅ | L, G | api/restructuring/restructuring.service.ts; int/restructure.int-spec.ts | Legacy restructure has no maker-checker |
| UC-64 | ✅ | L | Negotiated settlement `svc`; int/settlement.int-spec.ts:114 | No web screen |
| UC-65 | ⛔ | — | none | No repossession workflow |
| UC-66 | ⛔ | — | none | — |
| UC-67 | ✅ | L | End-of-day batch puts an invoice unpaid after due date + grace into RECOURSE: fee frozen at that date, advance + fee owed by the borrower, days past due / bucket / stage from the recourse date; recourse payments capped at what is owed: `InvoiceFinanceService.recourseHook`; int/trade.int-spec.ts "UC-67" | No late penalty on recourse arrears (D-012); factoring (`trade.factoring`) still not offered |
| UC-68 | ⛔ | — | none | — |
| UC-69 | ✅ | L, G | Write-off propose/approve `svc`; int/settlement.int-spec.ts:275 | Legacy write-off has no maker-checker |
| UC-70 | ✅ | L | Recovery `svc`; int/settlement.int-spec.ts:296 | No web screen |
| UC-71 | ⛔ | — | none | — |

### J. Closure
| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| UC-72 | ✅ | L, G | `closeIfRepaid` in `svc`; int/security.int-spec.ts:852 | — |
| UC-73 | ✅ | L | Release after closure, signed off by a second user; int/collateral.int-spec.ts | — |
| UC-74 | ✅ | L | Advance refunds and suspense refunds under maker-checker; int/suspense.int-spec.ts | — |
| UC-75 | ⛔ | L, G | Only a `lending.settled` outbox event | No closure letter or bureau reporting |

## Operations

| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| OPS-1 | ✅ | L | api/products/products.service.ts (versions, diff, maker-checker, capability gate); et/config.test.ts | — |
| OPS-2 | 🟡 | L, G | Eligibility, DSR, LTV, guarantors in applications.service.ts:1425+; legacy scorecard + credit bureau | No credit score or origination DSCR in lending; KYC and bureau are mocks |
| OPS-3 | 🟡 | L | Collateral, haircuts, guarantees in applications.service.ts:525 | No revaluation, release, enforcement or guarantor calls |
| OPS-4 | 🟡 | L | Automatic end of day: accrual, advances, penalties, DPD, non-accrual, classification and provisioning, facility arrears, margin calls, rate resets (eod-scheduler.service.ts) | No billing notices or statements in the batch |
| OPS-5 | ✅ | L, G | Lending: tenant impairment policy (REGULATORY or ECL by stage), allowance posted by end of day (api/accounting/impairment.service.ts; int/impairment.int-spec.ts); legacy NBC runs | — |
| OPS-6 | 🟡 | L, G | Balanced double-entry + reconciliation (api/accounting/operations.service.ts); legacy ledger | External GL export is a mock; two ledgers not consolidated |
| OPS-7 | 🟡 | L, G | Facility statements; legacy NBC report, receipts, key facts | No term-loan statements or notices; lending missing from regulatory reports |
| OPS-8 | ✅ | L | RBAC + ABAC + MFA + authority (api/policy); audit events; int/security.int-spec.ts | Break-glass not implemented; legacy approvals partly without maker-checker |

## Customer document management

| ID | Status | Evidence | Gap |
|---|---|---|---|
| DOC-1 | ⛔ | Three separate stores: `KycDocument` (per borrower), `Document` (per legacy loan), `ApplicationDocument` (per lending application) | No single customer library |
| DOC-2 | 🟡 | `ApplicationDocument` has file name, size, SHA-256, storage key (S3 or local); legacy vault uploads to S3 | KYC and loan documents are base64 in the database; S3 keys use the raw file name |
| DOC-3 | 🟡 | Product config "documents and conditions"; application stage checks (int/phase1-slice.int-spec.ts) | Lending applications only |
| DOC-4 | 🟡 | KYC review accept/reject (apps/api/src/borrower-portal/kyc-review.service.ts) | No review for other documents |
| DOC-5 | ⛔ | — | No versions; replacing loses history |
| DOC-6 | ⛔ | — | No expiry dates or reminders |
| DOC-7 | ⛔ | Deleting a loan document removes the row and leaves the S3 object | No retention or legal hold |
| DOC-8 | 🟡 | Vault serves pre-signed S3 links; role checks | KYC content rendered as a raw URL; no audit of views or downloads; no branch scope |
| DOC-9 | 🟡 | Key facts statement versions stored (agreements) | Statements, notices and letters not filed |
| DOC-10 | 🟡 | Portal e-KYC upload, statement and key facts download | No "documents requested from you" list |

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
