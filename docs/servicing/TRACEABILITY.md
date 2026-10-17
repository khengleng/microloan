# Traceability: loan servicing scope vs. this codebase

Every LT, UC, OPS, DOC and TV item from [USE_CASES.md](USE_CASES.md) and
[TEST_VECTORS.md](TEST_VECTORS.md), with the code that implements it, the
tests that prove it, and a status. Reviewed 17 Oct 2026 against branch
`docs/servicing-coverage` (which includes the open fix branches).

Status: ✅ Done · 🟡 Partial · ⛔ Missing.
Stack: **L** = configurable lending platform (`packages/shared/src/lending`,
`apps/api/src/lending`), **G** = legacy core app (`apps/api/src/{loans,repayments,…}`).

Path shorthand: `eng/` = `packages/shared/src/lending/`, `api/` = `apps/api/src/lending/`,
`svc` = `api/servicing/servicing.service.ts`, `int/` = `apps/api/test/lending/`,
`et/` = `packages/shared/test/`.

## Summary

| Group | ✅ | 🟡 | ⛔ | Total |
|---|---|---|---|---|
| Loan types (LT) | 9 | 11 | 4 | 24 |
| Use cases (UC) | 30 | 17 | 28 | 75 |
| Operations (OPS) | 2 | 6 | 0 | 8 |
| Documents (DOC) | 0 | 6 | 4 | 10 |
| Test vectors (TV) | 12 match | 2 convention | 6 not reproduced | 20 |

## Gaps ranked by risk to money owed

| # | Gap | Items | Why it matters |
|---|---|---|---|
| 1 | An instalment paid before its due date is treated as a principal prepayment (or refused), so the instalment stays due | UC-27, UC-26 | Borrowers who pay early can still go delinquent and be charged penalties (`svc` repayment: dues only include lines due on or before the value date) |
| 2 | No non-accrual: interest is recognised as income at any days past due | UC-62, OPS-4/5 | Overstates income and receivables on bad loans |
| 3 | No impairment on the lending portfolio; provisioning covers legacy loans only, fixed tiers, no ECL | OPS-5 | Lending loans carry no loss allowance |
| 4 | Revolving term-out and facility arrears: term-out books no schedule, facility days past due not computed | UC-43, UC-38, LT-04/13/14/17 | Termed-out and overdue facility balances show as current, with no due dates or penalties |
| 5 | No suspense, advance or refund: overpayments are refused, unidentified money has nowhere to go | UC-26, UC-28, UC-74 | Cash received cannot be posted |
| 6 | Legacy payoff quote cannot actually close the loan (quoted amount leaves principal unpaid) | UC-31 (G) | Customer pays the quote and the loan stays open |
| 7 | Prepayment and settlement fees cannot be waived under maker-checker | UC-32 | Fee waivers happen off-system |
| 8 | Group contributions: `recordContributions` exists but nothing calls it | UC-22, LT-21 | Group repayments cannot be split by member |
| 9 | Customer documents live in three unrelated stores, two of them as base64 in the database | DOC-1..10 | No single record of what a customer gave the bank; no retention or expiry |
| 10 | Flat-rate rebate is straight-line only; no Rule of 78 or actuarial; no nominal APR | UC-33, TV-04, TV-08, TV-12 | Early payoff amounts and disclosures may not meet the required method |

## Loan types

| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| LT-01 Personal | ✅ | L, G | `PERSONAL_INSTALMENT` eng/catalogue.ts:200; legacy formulas.ts; int/phase1-slice.int-spec.ts:31 | Flat-rate loans cannot take partial prepayments |
| LT-02 Mortgage | ✅ | L | `HOME_MORTGAGE` catalogue.ts:220; floating pricing; int/floating.int-spec.ts | LTV ignores financed fees |
| LT-03 Home equity | 🟡 | L | `HOME_EQUITY_TERM` catalogue.ts:241; LTV gate api/origination/applications.service.ts:1617 | No combined LTV with senior liens |
| LT-04 HELOC | 🟡 | L | `HOME_EQUITY_LINE` catalogue.ts:242 (revolving + term-out) | Term-out books no schedule; no facility days past due |
| LT-05 Auto / motorbike | 🟡 | L | `CAR_LOAN`, `MOTORCYCLE_LOAN`, `BALLOON_VEHICLE` catalogue.ts:246-250 | No down payment (UC-02), no dealer payout (UC-05) |
| LT-06 Student | ✅ | L | `STUDENT_LOAN` catalogue.ts:256; grace + capitalization eng/schedule.ts:411 | Capitalization compounds per period; simple option missing (TV-16) |
| LT-07 Credit card | ⛔ | — | `CREDIT_CARD` blocked by `card.revolving_credit` | No purchase grace, statement cycle or card minimum payment |
| LT-08 Payday | ✅ | L | `SALARY_ADVANCE` catalogue.ts:204 (interest-only, one instalment) | Needs reconfiguring for a fee; no nominal APR (TV-08) |
| LT-09 Pawn / gold | 🟡 | L | Collateral codes + max LTV | No custody, valuation by weight/purity, forfeiture or auction |
| LT-10 Debt consolidation | 🟡 | L | `DEBT_CONSOLIDATION` catalogue.ts:210 | Cannot pay off several or external debts (UC-35) |
| LT-11 BNPL | 🟡 | L | `BNPL` blocked by `bnpl.merchant_settlement`; a 4×fortnightly 0% plan can be configured | No merchant settlement or refund handling (UC-52) |
| LT-12 Term loan | ✅ | L | `SME_TERM` catalogue.ts:301; `CORPORATE_TERM` :353 (quarterly) | Quarterly untested end to end |
| LT-13 Overdraft | 🟡 | L | `OVERDRAFT` catalogue.ts:322; int/facilities.int-spec.ts:480 | No annual renewal; no facility days past due |
| LT-14 Business line of credit | 🟡 | L | `REVOLVING_CREDIT` catalogue.ts:323; int/facilities.int-spec.ts:202 | Term-out books no schedule |
| LT-15 Equipment lease | 🟡 | L | `EQUIPMENT_LOAN` catalogue.ts:249 with balloon; TV-19 passes | True lease (`IJARAH`) blocked |
| LT-16 Commercial real estate | 🟡 | L | `COMMERCIAL_PROPERTY` catalogue.ts:325; LTV gate | No origination DSCR; covenant monitoring not implemented |
| LT-17 Construction | 🟡 | L | `CONSTRUCTION` catalogue.ts:239; int/facilities.int-spec.ts:544 | Term-out books no amortizing schedule |
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
| UC-20 | ⛔ | — | Repayment has no payer field | Third-party payer not recorded |
| UC-21 | ⛔ | — | Repayment must be in the account currency | No conversion or FX gain/loss posting |
| UC-22 | 🟡 | L | `splitContributions` eng/group.ts:237; `recordContributions` api/groups (no caller) | Contributions cannot be recorded through the API |
| UC-23 | 🟡 | L, G | Reversal `svc` (int/security.int-spec.ts:516); legacy reversal | No bounce fee; repayments that triggered a reschedule cannot be reversed |

### D. Payment allocation
| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| UC-24 | ✅ | L | Config order + strategy; eng/servicing.ts:266; TV-15 | Legacy order fixed |
| UC-25 | ✅ | L, G | eng/servicing.ts:282; TV-15 | — |
| UC-26 | 🟡 | L | `excessHandling` PREPAY or REJECT only | No advance / credit balance; payment above payoff refused |
| UC-27 | ⛔ | — | Dues include only lines due by the value date | Early payment becomes a prepayment (gap #1) |
| UC-28 | ⛔ | — | No suspense account | No unidentified-payment queue or matching |

### E. Early repayment
| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| UC-29 | ✅ | L | `SHORTEN` eng/servicing.ts:183; TV-10 option B | Not on flat-rate loans |
| UC-30 | ✅ | L | `RECAST` eng/servicing.ts:130; TV-10 option A; int/phase1-slice.int-spec.ts:344 | Not on flat-rate loans |
| UC-31 | 🟡 | L, G | Settlement quote `svc` (TV-11); int/security.int-spec.ts:850 | Quote not stored, no validity date or letter; legacy quote cannot close the loan (gap #6) |
| UC-32 | 🟡 | L | `prepayment.feeRate`, `earlySettlement.feeRate/feeFixed` | No maker-checker waiver |
| UC-33 | 🟡 | L | Straight-line by-days rebate on flat loans | No Rule of 78 or actuarial (TV-12) |
| UC-34 | 🟡 | L | Internal refinance `svc`; int/relief.int-spec.ts:372 | No payoff letter; no takeover from another lender |
| UC-35 | ⛔ | — | `refinancesLoanId` is one internal loan | Cannot pay off several or external debts |

### F. Revolving credit
| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| UC-36 | ✅ | L | api/facilities/facilities.service.ts:170; int/facilities.int-spec.ts:217 | — |
| UC-37 | ✅ | L | eng/facility.ts:471; TV-07; int/facilities.int-spec.ts:320 | Posted at statement, not by end-of-day |
| UC-38 | 🟡 | L | eng/facility.ts:583 (overdraft) | Unpaid minimum never aged or penalized |
| UC-39 | ⛔ | — | `card.revolving_credit` not implemented | No purchase grace |
| UC-40 | ⛔ | — | none | No cash-advance type or fee |
| UC-41 | 🟡 | L | Over-limit rate; limit change maker-checker (int/facilities.int-spec.ts:394) | No flat over-limit fee |
| UC-42 | ⛔ | L | Manual expiry only | No renewal or review workflow |
| UC-43 | 🟡 | L | eng/facility.ts:709 `termOut`; facilities.service.ts:995 | Sets status only; no schedule booked (gap #4) |
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
| UC-51 | ⛔ | — | Valuation only at application | No revaluation or margin call (TV-18) |
| UC-52 | ⛔ | — | BNPL blocked | — |
| UC-53 | ⛔ | — | none | — |

### H. Late and missed payments
| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| UC-54 | 🟡 | L | `graceDays` in penalty assessment | Untested; legacy penalty has no grace |
| UC-55 | 🟡 | L, G | Flat per instalment + per-instalment cap | No percent late fee; no per-loan cap; legacy uncapped |
| UC-56 | ✅ | L | `svc` penalty assessment; TV-14; int/phase1-slice.int-spec.ts:339 | Day count fixed at ACT/365F |
| UC-57 | ✅ | L, G | `delinquency()` in `svc`; int/phase1-slice.int-spec.ts:257 | Facilities excluded |
| UC-58 | 🟡 | L, G | Collection stages config; legacy queue + reminder crons | No escalation engine or collector work queues; lending notifications are mocks |
| UC-59 | 🟡 | G | apps/api/src/collections/collections.service.ts:102 | Broken promises not flagged automatically |
| UC-60 | ⛔ | — | Guarantees captured only | No demand or guarantor payment |
| UC-61 | ⛔ | — | none | — |
| UC-62 | ⛔ | — | none | Gap #2 |

### I. Restructuring and recovery
| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| UC-63 | ✅ | L, G | api/restructuring/restructuring.service.ts; int/restructure.int-spec.ts | Legacy restructure has no maker-checker |
| UC-64 | ✅ | L | Negotiated settlement `svc`; int/settlement.int-spec.ts:114 | No web screen |
| UC-65 | ⛔ | — | none | No repossession workflow |
| UC-66 | ⛔ | — | none | — |
| UC-67 | ⛔ | — | `trade.factoring` not implemented | — |
| UC-68 | ⛔ | — | none | — |
| UC-69 | ✅ | L, G | Write-off propose/approve `svc`; int/settlement.int-spec.ts:275 | Legacy write-off has no maker-checker |
| UC-70 | ✅ | L | Recovery `svc`; int/settlement.int-spec.ts:296 | No web screen |
| UC-71 | ⛔ | — | none | — |

### J. Closure
| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| UC-72 | ✅ | L, G | `closeIfRepaid` in `svc`; int/security.int-spec.ts:852 | — |
| UC-73 | ⛔ | L | Pledge status `RELEASED` defined, never set | No lien release |
| UC-74 | ⛔ | L | Overpayment refused | No refund |
| UC-75 | ⛔ | L, G | Only a `lending.settled` outbox event | No closure letter or bureau reporting |

## Operations

| ID | Status | Stack | Evidence | Gap |
|---|---|---|---|---|
| OPS-1 | ✅ | L | api/products/products.service.ts (versions, diff, maker-checker, capability gate); et/config.test.ts | — |
| OPS-2 | 🟡 | L, G | Eligibility, DSR, LTV, guarantors in applications.service.ts:1425+; legacy scorecard + credit bureau | No credit score or origination DSCR in lending; KYC and bureau are mocks |
| OPS-3 | 🟡 | L | Collateral, haircuts, guarantees in applications.service.ts:525 | No revaluation, release, enforcement or guarantor calls |
| OPS-4 | 🟡 | L | api/servicing/eod-scheduler.service.ts (automatic daily run); int/eod.int-spec.ts | Batch has no billing, statements, classification, provisioning or non-accrual; skips tenants with no active accounts |
| OPS-5 | 🟡 | G | apps/api/src/provisioning (NBC DPD tiers) | Manual; no ECL or IFRS 9 stages; lending loans excluded |
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

Automated in `packages/shared/test/test-vectors.test.ts` (14 passing tests, 8 `todo`).

| ID | Status | Note |
|---|---|---|
| TV-01 | ✅ | Every listed figure matches |
| TV-02 | ✅ | — |
| TV-03 | ✅ | — |
| TV-04 | 🟡 | Schedule matches. Effective rate 23.68% vs 23.70% (engine uses actual days); no nominal-rate (21.46%) function |
| TV-05 | ✅ | — |
| TV-06 | ✅ | — |
| TV-07 | ✅ | — |
| TV-08 | 🟡 | No nominal APR; engine gives compounded 3,723.66% |
| TV-09 | ✅ | — |
| TV-10 | ✅ | Both options |
| TV-11 | ✅ | Accrued interest via engine; penalty base read from the settlement quote code |
| TV-12 | ⛔ | No Rule of 78 |
| TV-13 | ⛔ | Not yet driven through the payment-holiday engine |
| TV-14 | ✅ | — |
| TV-15 | ✅ | — |
| TV-16 | ⛔ | Engine compounds grace interest (25,409.81); no simple capitalization |
| TV-17 | ⛔ | No combined-LTV limit |
| TV-18 | ⛔ | No margin call |
| TV-19 | ✅ | — |
| TV-20 | ⛔ | No invoice finance |
