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
| Loan types (LT) | 15 | 6 | 3 | 24 |
| Use cases (UC) | 53 | 8 | 14 | 75 |
| Operations (OPS) | 3 | 5 | 0 | 8 |
| Documents (DOC) | 0 | 6 | 4 | 10 |
| Test vectors (TV) | 19 match | 1 engine only | 0 not reproduced | 20 |

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
follow-up (UC-59), and every golden test vector. Later: payment channels —
auto-debit mandates and collection (UC-16, mock bank), settlement and payroll
files with daily reconciliation (UC-18, UC-19), cross-currency payments with
FX gain/loss (UC-21).

Then the recovery workflows: repossession (UC-65), pawn
custody, forfeiture and auction (UC-66, LT-09), credit insurance with a
financed premium owed to the insurer (UC-06, UC-68) and debt sale (UC-71),
in `api/recovery/` with the web recovery card and desk. Assumptions are
DECISIONS D-011 to D-016.

Then the specialised products: credit cards on a revolving line with
purchases, cash advances and instalment plans as separate balances, the
purchase grace period and card minimum-payment arrears (LT-07, UC-39, UC-40,
UC-44); BNPL with merchant settlement net of the merchant discount and
merchant refunds that shrink the remaining instalments (LT-11, UC-52); and a
true lease / Ijarah with the lender owning the asset, rental income, and title
transfer or return at the end (LT-15). Code in `api/cards/` and `api/bnpl/`,
engines `eng/card.ts` and `eng/bnpl.ts`; assumptions are DECISIONS D-030 to
D-034.

## Remaining gaps ranked by risk to money owed

| # | Gap | Items | Why it matters |
|---|---|---|---|
| 1 | Customer documents live in three unrelated stores, two of them as base64 in the database | DOC-1..10 | No single record of what a customer gave the bank; no retention or expiry |
| 2 | No collection escalation engine or collector work queues in the lending stack; guarantor demand and set-off missing | UC-58, UC-60, UC-61 | Arrears follow-up relies on people remembering |
| 3 | Auto-debit has no real bank integration (mandates, collection, retries and reconciliation are built on a mock bank) | UC-16 | Production cannot collect by direct debit until a bank adapter exists |
| 4 | Recovery workflows: repossession, pawn forfeiture, insurance claim, debt sale | UC-65, UC-66, UC-68, UC-71 | Recoveries happen off-system |
| 5 | Disbursement: down payment and payment to third parties | UC-02, UC-05, UC-35 | Dealer, school and previous-lender payouts are not recorded |
| 6 | Specialised products: invoice finance, letters of credit, syndication | LT-18, LT-19, LT-24 and their UCs | Not offered (capability-gated) |
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
| LT-07 Credit card | ✅ | L | `CREDIT_CARD` on a REVOLVING facility; balances by kind, monthly statements with due date and minimum payment, grace period, card arrears: eng/card.ts; api/cards/cards.service.ts; et/card.test.ts; int/cards.int-spec.ts | Transactions are posted by operations (no card-processor feed); purchases settle to cash on the day (D-031); no annual fee or rewards |
| LT-08 Payday | ✅ | L | `SALARY_ADVANCE` catalogue.ts:204 (interest-only, one instalment) | Needs reconfiguring for a fee; no nominal APR (TV-08) |
| LT-09 Pawn / gold | ✅ | L | Custody record, valuation by weight × purity × price per gram (eng/recovery.ts `pawnValuation`), forfeiture after the redemption deadline under maker-checker, auction, return on redemption: api/recovery/recovery.service.ts; et/recovery.test.ts; int/recovery.int-spec.ts | Gold price entered per item (no price feed) |
| LT-10 Debt consolidation | 🟡 | L | `DEBT_CONSOLIDATION` catalogue.ts:210 | Cannot pay off several or external debts (UC-35) |
| LT-11 BNPL | ✅ | L | `BNPL` (interest-free fortnightly plan); merchant paid net of the merchant discount through a disbursement hook: api/bnpl/bnpl-lease.service.ts; eng/bnpl.ts; et/bnpl.test.ts; int/bnpl-lease.int-spec.ts | Merchant discount is one rate per product (per merchant programme), recognised at disbursement (D-030) |
| LT-12 Term loan | ✅ | L | `SME_TERM` catalogue.ts:301; `CORPORATE_TERM` :353 (quarterly) | Quarterly untested end to end |
| LT-13 Overdraft | 🟡 | L | `OVERDRAFT`; minimum-payment arrears aged (int/facilities.int-spec.ts UC-38) | No annual renewal (UC-42) |
| LT-14 Business line of credit | ✅ | L | `REVOLVING_CREDIT`; term-out books an amortizing schedule (int/facilities.int-spec.ts UC-43) | — |
| LT-15 Equipment lease | ✅ | L | `EQUIPMENT_LOAN` with balloon (TV-19); true lease `IJARAH`: asset registered and paid to its supplier, owned by the lender, rentals as rental income (1250/1255/4510), late charges to charity (2800), title transfer or return at the end: api/bnpl/bnpl-lease.service.ts; int/bnpl-lease.int-spec.ts | Net-investment lessor accounting, no depreciation or operating-lease model; returned assets held at the residual, remarketing off-system (D-032) |
| LT-16 Commercial real estate | 🟡 | L | `COMMERCIAL_PROPERTY` catalogue.ts:325; LTV gate | No origination DSCR; covenant monitoring not implemented |
| LT-17 Construction | ✅ | L | `CONSTRUCTION` staged facility; term-out schedule | — |
| LT-18 Invoice financing | ⛔ | — | `INVOICE_BACKED` blocked (`trade.invoice_finance`) | No invoice register, advance or debtor settlement |
| LT-19 Letter of credit | ⛔ | — | none | — |
| LT-20 SME | ✅ | L | `SME_TERM`; int/phase1-slice.int-spec.ts:86 | — |
| LT-21 Microfinance | ✅ | L | `MICRO_INDIVIDUAL` :266, `MICRO_GROUP` :281; int/groups.int-spec.ts | Member contributions not collectable (UC-22) |
| LT-22 Agricultural | ✅ | L | `AGRI_CROP_SEASONAL` :327; int/phase1-slice.int-spec.ts:224 | — |
| LT-23 Bridge | ✅ | L | `BRIDGE_LOAN` :244 (interest-only bullet) | Rolled-up interest untested |
| LT-24 Syndicated | ⛔ | — | `SYNDICATED` blocked (`syndication.participations`) | No participants or shares |

## Use cases

### A. Disbursement
| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| UC-01 | ✅ | L, G | eng/fees.ts:49 `netDisbursement`; `svc` disbursement; et/servicing.test.ts:136 | — |
| UC-02 | ⛔ | — | none | No down-payment field or collection before disbursement |
| UC-03 | ✅ | L, G | `svc` prepare/approve/execute (maker-checker); int/security.int-spec.ts:118 | — |
| UC-04 | ✅ | L | `CONSTRUCTION` staged facility; int/facilities.int-spec.ts:559 | Interest posted at statement, not daily |
| UC-05 | ⛔ | — | Disbursement takes only an external reference | No payee split (seller, dealer, school, other lender) |
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
| UC-15 | 🟡 | L | Only via `EXPLICIT` dated amounts | No step-up/step-down method |

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
| UC-39 | ✅ | L | Purchase interest computed daily from each purchase and waived when the previous statement was paid in full by its due date: eng/card.ts `cardGraceApplies`, `cardCycleCharges`; api/cards/cards.service.ts `generateStatement`; int/cards.int-spec.ts (kept, then lost) | Interest is charged at statement, not daily |
| UC-40 | ✅ | L | Cash advance: fee (rate with minimum) charged at once to 4520, interest at the cash-advance rate from the advance date, never waived, cash-advance share of the limit: eng/card.ts `cashAdvanceFee`; int/cards.int-spec.ts | — |
| UC-41 | 🟡 | L | Over-limit rate; limit change maker-checker (int/facilities.int-spec.ts:394) | No flat over-limit fee |
| UC-42 | ⛔ | L | Manual expiry only | No renewal or review workflow |
| UC-43 | ✅ | L | Term-out books an amortizing schedule; int/facilities.int-spec.ts | — |
| UC-44 | ✅ | L | A current-cycle purchase converts into a fixed monthly plan; one instalment billed per statement into the purchase balance and the minimum payment: eng/card.ts `instalmentPlan`; api/cards/cards.service.ts `convertToPlan`; int/cards.int-spec.ts | No conversion fee; plans prepay only after purchases (D-034) |

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
| UC-52 | ✅ | L | Merchant refund reduces remaining instalments latest first, refunds what the customer already paid, reverses the merchant discount pro rata, merchant clawback (1240) collected separately: eng/bnpl.ts `bnplRefund`; api/bnpl/bnpl-lease.service.ts; int/bnpl-lease.int-spec.ts | Clawback is not netted against later merchant settlements (D-030) |
| UC-53 | ⛔ | — | none | — |

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
| UC-65 | ✅ | L | Seize (maker-checker) → value → sell; proceeds waterfall eng/recovery.ts `applyRecoveryProceeds`; surplus to a borrower payable paid out under maker-checker; deficiency stays on the open loan; pledge SOLD: api/recovery/recovery.service.ts; int/recovery.int-spec.ts (surplus, deficiency, write-off then recovery) | Proceeds order and costs are assumptions (DECISIONS D-011, D-012) |
| UC-66 | ✅ | L | Forfeiture after the deadline (maker-checker), auction through the same waterfall: api/recovery/recovery.service.ts; int/recovery.int-spec.ts | — |
| UC-67 | ⛔ | — | `trade.factoring` not implemented | — |
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
| UC-75 | ⛔ | L, G | Only a `lending.settled` outbox event | No closure letter or bureau reporting |

## Operations

| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| OPS-1 | ✅ | L | api/products/products.service.ts (versions, diff, maker-checker, capability gate); et/config.test.ts | — |
| OPS-2 | 🟡 | L, G | Eligibility, DSR, LTV, guarantors in applications.service.ts:1425+; legacy scorecard + credit bureau | No credit score or origination DSCR in lending; KYC and bureau are mocks |
| OPS-3 | 🟡 | L | Collateral, haircuts, guarantees in applications.service.ts:525 | No revaluation, release, enforcement or guarantor calls |
| OPS-4 | 🟡 | L | Automatic end of day: auto-debit collection (UC-16), accrual, advances, penalties, DPD, non-accrual, classification and provisioning, facility arrears, margin calls, rate resets (eod-scheduler.service.ts) | No billing notices or statements in the batch |
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

Automated in `packages/shared/test/test-vectors.test.ts` (every vector is a passing test; none remain `todo`). TV-12, TV-17 and TV-18 are also reproduced through the live API (int/rebates, int/collateral).

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
| TV-20 | 🟡 | Engine only (eng/invoice.ts); no invoice-finance product module |
