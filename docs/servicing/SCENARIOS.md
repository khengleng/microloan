# End-to-end scenarios: onboarding to closure

QA suite added 17 Oct 2026. Every scenario is a journey over the real HTTP
API, guards and PostgreSQL (row-level security on, `WALL_STRICT=1`): a
customer is onboarded, a loan originated, the business date moved forward
through end of day, and the loan serviced through the events of the
scenario to closure.

Code: `apps/api/test/lending/e2e/` — `journey.ts` (harness) and one spec
per family. They run with the rest of the integration suite:

```bash
export LENDING_TEST_DATABASE_URL="postgresql://…/microloan_test_qa?schema=public&connection_limit=4"
pnpm test:lending:db && pnpm test:lending:int
# only the journeys:
cd apps/api && npx jest -c test/lending/jest-int.json --runInBand test/lending/e2e
```

`connection_limit` keeps each Nest app's pool small; on a Postgres shared
with other test runs the suite otherwise runs out of connections
(`FATAL: remaining connection slots are reserved`), which is what broke the
`floating` suite in the first baseline run.

## How every journey runs

Each scenario (`describe`) boots its own tenant, so it owns its business
date (starting 5 Jan 2026).

1. **Onboarding** — `POST /borrowers` by a branch relationship officer with
   the KYC fields (ID type and number, date of birth, phone, address,
   occupation, income and expenses); the borrower lands in the officer's
   branch with `kycStatus: PENDING`. `POST /kyc/:id/verify` by one
   administrator records the verification (`KYC_VERIFICATION_RECORDED`); the
   same call by a second administrator confirms it, sets `VERIFIED` and writes
   `KYC_VERIFIED` to the audit log.
   S01 shows an application cannot be submitted before that (`SUBMISSION_BLOCKED`, `KYC`).
2. **Product** — drafted by the product maker from a template, approved and
   activated by the checker; the maker's own approval is refused (403).
3. **Origination** — application → documents → collateral / guarantors as
   the product requires → submit (assessment, nothing blocking) → recommend
   (analyst) → approve (within authority; a second, independent approver
   where the workflow requires two) → book (`BOOKED`) → every condition
   precedent satisfied with evidence → disbursement prepared by operations,
   approved by a checker (the maker's own approval is refused), executed
   with an `Idempotency-Key`. Facilities are booked and then drawn.
4. **End of day** — `POST /lending/ops/business-date` in steps of at most
   31 days, `POST /lending/loans/batch/run` after each; no account may fail.
5. **Checkpoint after every step** — status; principal, interest, fee,
   penalty, advance, suspense and allowance balances to the cent; days past
   due, bucket and non-accrual where relevant; **every journal entry on the
   loan balanced**; `GET /lending/ops/reconciliation` with **no breaks and a
   balanced trial balance** (and `GET /lending/ops/trial-balance` balanced
   per currency); and the step's action in `GET /lending/ops/audit`.

`payOnTime` moves to each due date, checks the instalment fell due with
nothing late, pays exactly what it owes and checks the principal it leaves.

## Scenarios

Figures are asserted to the cent unless marked otherwise.

### Consumer — `e2e/consumer.int-spec.ts`

**S01 LT-01 personal loan paid on time to maturity (TV-01).**
10,000 at 12% over 12 months, 1% processing fee deducted.
- KYC gate: submit refused with `KYC` until the borrower is verified.
- Disbursement journal `1200 Dr 10,000 / 1000 Cr 9,900 / 4200 Cr 100` (UC-01).
- TV-01 on the booked schedule: instalment 888.49; month 1 interest 100.00 / principal 788.49 (balance 9,211.51); month 2 92.12 / 796.37 (balance 8,415.14); month 11 17.51 / 870.98; month 12 8.80 / 879.67 = 888.47; total interest 661.86.
- 20 Jan: 48.39 accrued (100.00 × 15/31).
- Twelve payments on the due dates; each leaves the scheduled balance. Closed; interest recognised over the life 661.86; 10,661.86 repaid.
- A closed loan refuses money and is skipped by end of day.

**S02 LT-08 salary advance (RM-6).** 500, one bullet of 506.25 on 5 Feb (one month at 15%). An early part-payment is refused (product allows no prepayment). Paid on payday → closed.

**S03 LT-10 debt consolidation by refinance (UC-34, UC-50).** 3,000 over 12 months, two instalments paid; a 6,000 consolidation loan for the same borrower (`refinancesLoanId`) settles the first at disbursement in one transaction: old loan `CLOSED` with a `SETTLEMENT` for its balance, new loan `ACTIVE` 6,000; net cash paid out across the two journals = 6,000 − the payoff; audit `loan.refinance.execute` with `evergreening: false`. One instalment, then early settlement at the quote → closed.

**S04 LT-06 student loan (TV-16, UC-14).** 20,000 at 6%, 48 months interest and principal grace with `capitalization.basis = SIMPLE`, then 12 instalments. Each grace month capitalizes 100.00 (checked at months 1, 2, 12, 24, 36, 48; current throughout). 48 capitalizations = 4,800.00; principal at repayment start 24,800.00. Repaid on time → closed.

**S34 LT-01 broken first period (TV-09, UC-07).** 10,000 at 12%, disbursed 5 Jan, first due 15 Feb (41 days, DAILY accrual): instalment 1 interest 134.79; on 15 Jan the first 10 days have accrued 32.88 (= 10,000 × 12% × 10/365). Repaid on the 15th to maturity.

### Property — `e2e/property.int-spec.ts`

**S05 LT-02 variable-rate mortgage (TV-02, TV-06, UC-29, UC-31, UC-32, UC-45, UC-73).**
100,000 over 240 months, NBC base 5% + 3% margin (floor 6%, cap 12%, quarterly reset); lock-in 3% of the amount repaid early for 24 months; title deed and valuation at approval; conditions `AGREEMENT_SIGNED`, `MORTGAGE_REGISTERED` satisfied before disbursement.
- TV-02 at booking: 8%, instalment 836.44, final 836.37, total interest 100,745.53. TV-06: balance after 60 payments 87,525.57.
- Two instalments paid; base observed at 6% on 1 April; instalment 3 paid at 8%; the batch on 5 April applies the reset: `0.08 → 0.09`, bound `BENCHMARK`, new agreement version `RATE_RESET`, unpaid tail at 9%, higher instalment, paid lines untouched; audit `loan.rate_reset.apply`.
- 5 May: instalment + 10,300 → prepaid 10,000, lock-in charge 300 (`TIER`), SHORTEN keeps the instalment and drops instalments.
- Two more instalments; 20 July quote: lock-in charge 3% of principal, payable = principal + accrued + charge; settled → closed (audit `loan.settlement`); title released by a second person.

**S06 LT-03 home equity term loan (UC-06, UC-32, UC-54, UC-56, UC-57).** 30,000 behind a 100,000 first mortgage on a 200,000 home (70% combined LTV); 1% credit-life premium financed: booked 30,300, journal `1200 Dr 30,300 / 1000 Cr 30,000 / 4200 Cr 300`. Two instalments; instalment 3 late: on day 3 DPD 3, no penalty (grace); day 10 penalty = 6% × overdue × 7/365, `DPD_1_30`, `REMINDER`; arrears and penalty paid → current. Two more; a 2% settlement fee quoted, waived by maker-checker (own approval refused), quote drops by exactly the fee; settled; collateral released.

**S07 LT-04 HELOC (TV-17, TV-07, UC-36, UC-37, UC-43, UC-57).** 24% line, 3-month availability.
- TV-17: behind 120,000 on a 200,000 home at 80% the line is at most 40,000 — 40,001 refused at approval (`LTV`, "Combined loan-to-value … 40000"); 40,000 approved and booked as a facility (available 40,000, nothing drawn, loan `BOOKED`).
- Draw 1,000; TV-07: statement for 30 days = 19.73.
- Draw 9,000 (available 30,000); repay 2,019.73 → outstanding 8,000, available 32,000 (D-QA-03).
- End of availability: statement, term-out of 8,000 into instalments (`TERM_OUT`, facility `TERMED_OUT`, stated interest due with instalment 1).
- Instalment 1 unpaid: DPD 10 `DPD_1_30`, DPD 35 `DPD_31_60` / `FIELD_FOLLOW_UP`; arrears paid → `CURRENT`. Settled; home released.

**S08 LT-17 construction (UC-04, UC-43).** 100,000 at 12% in three tranches (30% now, 40% after 3 months + surveyor report, 30% after 6 months + surveyor and occupancy certificate). Foundation 30,000 drawn; statement 305.75 (30,000 × 12% × 31/365) paid → principal stays 30,000 (D-QA-03). Structure refused before its date and then for the missing surveyor report; released after the condition is satisfied. Completion released; fully drawn (available 0). Term-out of 100,000 with the stated interest in instalment 1; two instalments; settled; collateral released.

**S09 LT-23 bridge loan (TV-05).** 10,000 at 12%, 12 months interest only: months 1–11 = 100.00, month 12 = 10,100.00; paid exactly so → closed; title released.

**S10 LT-16 commercial real estate with a balloon (TV-06).** 100,000 at 8%, 60 instalments, balloon 87,525.57: instalment 836.44; 88,362.01 due on instalment 60 (= 836.44 + 87,525.57). All 60 paid → closed; property released.

### Vehicle and assets — `e2e/vehicle-asset.int-spec.ts`

**S11 LT-05 auto loan: default → write-off → recovery (UC-56, UC-57, UC-58, UC-69, UC-70).** 20,000 over 48 months on a 30,000 car. Three instalments paid, then nothing: DPD 10 `DPD_1_30`/`REMINDER`, 45 `DPD_31_60`/`FIELD_FOLLOW_UP`, 75 `DPD_61_90`, 100 `DPD_90_PLUS`/`RECOVERY`, penalty growing at each. Write-off refused before 180 DPD; at 180 proposed and approved (maker-checker): `WRITTEN_OFF`, every receivable zero, the journal credits exactly the balance owed; end of day ignores it. 9,000 recovered: allocation `PRINCIPAL 9000`, journal `1000 Dr 9,000 / 4300 Cr 9,000`, still `WRITTEN_OFF`.

**S12 LT-15 equipment finance with a residual (TV-19).** 50,000 at 10%, 36 months, residual 10,000: instalment 1,374.02 (35 of them); the last ≈ 11,374.02. Paid to maturity; equipment released.

**S13 LT-09 gold loan (TV-18, UC-51, UC-73).** 7,000 interest-only against 10,000 of gold (max LTV 80%): 70.00 a month, principal at the end. Gold revalued to 8,000 on day one: LTV 0.875, repay 600 or pledge 750, call `OPEN`, deadline 10 Jan. 600 repaid the same day (prepaid principal 600). *D-QA-04:* the call is still open at the next end of day (`it.failing`). 10 g more gold pledged → `CURED`. Interest paid monthly, principal at maturity → closed; both items returned.

### Business — `e2e/business.int-spec.ts`

**S14 LT-20 SME loan (TV-03, UC-09, UC-25, UC-54).** 10,000 at 12%, equal principal, shophouse collateral; arrangement fee 1% + 10% VAT deducted: `1200 Dr 10,000 / 1000 Cr 9,890 / 4200 Cr 100 / 2200 Cr 10`. TV-03: 833.33 × 11 and 833.37; 933.33, 925.00 … 841.70; interest 650.00. Instalment 6 part-paid (500) on its date and completed 2 days later: DPD 2, no penalty (3 grace days). Closed; title released.

**S15 LT-12 corporate term loan, quarterly.** 400,000 at 10%, 4 quarterly equal-principal instalments: 100,000 each, interest 10,000 / 7,500 / 5,000 / 2,500. An approver with 200,000 authority is refused (403, "exceeds your approval authority"); the 1,000,000 approver approves. Four quarters paid → closed.

**S16 LT-13 overdraft (UC-38).** 20,000 limit at 18%, 8,000 drawn; 30-day statement: interest 118.36, minimum 518.36 (5% + charges) due 25 Feb. Unpaid: DPD 7 on 4 Mar, `REMINDER`. Half paid → still DPD 7; the rest → DPD 0, interest cleared, principal reduced by the excess. Balance repaid (available 20,000), facility expired at review (manual; no renewal workflow, UC-42).

**S17 LT-14 revolving credit (UC-36, UC-37, UC-41, UC-43).** 100,000 limit at 12% with a 0.5% commitment fee. 40,000 drawn; month statement: interest 407.67, commitment fee 25.48. 10,433.15 repaid → outstanding 30,000, available 70,000, charges cleared. A cut below the drawn balance refused; an increase to 150,000 approved by a second person (available 120,000). Term-out of 30,000, two instalments, settlement → closed.

### Microfinance and agriculture — `e2e/microfinance.int-spec.ts`

**S18 LT-21 solidarity group, weekly (UC-20, UC-22, UC-25, UC-57).** Five members onboarded through the API, leader + four, joint liability: every member's share 1,000, `liableFor` 5,000. 10 weekly instalments (interest 14.42 a week at 15% ÷ 52). Week 1 paid in five shares (contributions recorded per member). Week 2: member 5 misses, the leader covers half her share → part payment, DPD 3, no penalty; the leader's contributions rise by her share + the half, member 5's do not. Week 3: member 5 pays what she missed with her share; arrears and late interest clear → `CURRENT`. Remaining weeks on time → closed; the group may then disband.

**S19 LT-21 flat-rate microloan, Rule of 78 (TV-04, TV-12, UC-10, UC-33).** 10,000 at 12% flat over 12 months, guarantor required: 933.33 × 11 and 933.37, interest 1,200.00. Six paid; quote: rebate 323.08 (`RULE_OF_78`), interest owed 276.92, principal 5,000.02; settled → closed.

**S20 LT-22 seasonal crop loan: failed harvest, restructure, cure (UC-13, UC-63).** 2,000 at 14% daily, harvests 14 June (Sunday → 15 June on the KH calendar) and 16 Nov; June interest 122.74. June harvest fails: DPD 30 with penalty interest on 15 July. Staff request with consent (`DELAYED_HARVEST`), evidence, verified assessment (sustainable), proposal: principal on 16 Nov and 15 Mar, arrears spread, penalties waived; approved by the committee (as many independent approvals as the proposal requires, each with waiver authority); signed acceptance; executed (`RESTRUCTURE`, `isRestructured`); penalty 0; June's interest (137.01) carried as deferred interest on the new harvests. November paid on time → probation earned, `CURRENT`; March paid → closed.

**S21 LT-21 individual microloan, fortnightly (UC-01, UC-18, UC-20, UC-55).** 1,500, guarantor; administration fee 5.00 + tax 0.50 separate, due on the disbursement day (`1220 Dr 5.50 / 4200 Cr 5 / 2200 Cr 0.50`), paid that day. Fortnight 2 missed: day 2 no fee, day 3 flat late fee 2.00, charged once (still 2.00 on day 10). The guarantor pays arrears + fee (`payer.relationship: GUARANTOR`) → current. Fortnight 3 paid from a mobile wallet through `POST /lending/integrations/loans/:id/repayments` with a service-account key. The rest on time → closed.

### Servicing events — `e2e/servicing-events.int-spec.ts`

**S22 bounced payment (TV-01, TV-14, TV-15, UC-23, UC-24, UC-25, UC-56).** TV-01 loan, penalty 18% from day 0, returned-payment fee 10, order fee → tax → penalty → interest → principal. Cheque for 888.49 on 5 Feb (interest 100 / principal 788.49) bounces; reversal with `returned` restores the instalment and charges `RETURNED_PAYMENT` 10.00. 15 Feb: penalty 4.38 (TV-14), DPD 10. 500.00 paid: fee 10.00, penalty 4.38, interest 100.00, principal 385.62; 402.87 still overdue (TV-15); 32.90 of February interest accrued meanwhile. 402.87 paid → current; repaid on time to maturity.

**S23 advance (UC-26, UC-27, UC-31, UC-74, D-001, D-007).** 6,000; instalment paid 16 days early → advance (`2300` credited), nothing prepaid; applied on 5 Feb (`ADVANCE_APPLIED`), never late. Two instalments at once → applied one per due date. A payment above the balance refused (D-007). 50.00 over → advance → refunded under maker-checker (`ADVANCE_REFUND`). 200 advance netted in the payoff quote; settled → closed.

**S24 non-accrual (UC-62, D-002, D-006).** 6,000, `nonAccrual.fromDpd = 30`. Nothing paid: DPD 29 accrual; DPD 30 (7 Mar) → non-accrual, recognised interest moved to suspense (`interestInSuspense = interestReceivable`), `NON_ACCRUAL ENTER`; further accruals suspended. Arrears paid → the interest collected released; next day `CURE`, suspense 0. Two on time, then settled.

**S25 impairment through a loan's life (OPS-5, D-010).** Nothing posted before a policy exists; finance proposes the NBC template, finance's own approval refused, risk approves. Current: `STANDARD` 1% = 100.00. 15 days late: `SPECIAL_MENTION` 3% = 300.00, the provision posted is the 200.00 change. Arrears paid: `STANDARD` 1% of 9,211.51. Two months on time: 1% of 7,610.80. Settled: allowance 0, nothing left on `1300` for the loan.

**S26 unidentified payment (UC-28, UC-74).** 700.00 bank transfer with no loan → suspense `OPEN`; the instalment due matched from it (repayment funded from `2500`, not cash); the rest refunded under maker-checker → `MATCHED`, remaining 0 (audit `payment.refund.approve`); loan repaid on time.

**S27 payment holidays (TV-13, UC-49).** Two TV-01 loans (SIMPLE capitalization), two programmes published by a second person (the drafter's own publication refused). After two instalments (8,415.14): a 3-month `CAPITALIZE` holiday reports 252.45; capitalized 84.15 × 3 as each month ends → principal 8,667.59 on 5 June, maturity 5 Apr 2027, never late; repaid to the extended maturity (D-QA-02). A `DEFER_NO_CAPITALIZATION` holiday on the other loan reports interest deferred, but *D-QA-05:* none of it reappears on the schedule (`it.failing`); the loan resumes and is settled.

**S28 negotiated settlement (UC-64).** 5,000; two paid, then 61 DPD with penalties. Quote for principal − 300: full amount and concession by component, nothing posted. Settled by the committee: closed; journal `1000 Dr agreed / 1200, 1210, 1230 Cr balances / 5110 Dr concession` (O-2).

**S29 partial prepayment (TV-10, UC-29, UC-30).** Two TV-01 loans, two instalments paid each (8,415.14), then 2,000 prepaid: RECAST → 6,415.14, 10 instalments of 677.32; SHORTEN → 7 × 888.49 then 473.43 (interest 4.69), due 5 Nov — two months early. Both repaid to their new maturities.

**S30 payoff with a 2% penalty (TV-11, UC-31, UC-32).** TV-01 loan, two paid, quote on 20 March (15 days into month 3): principal 8,415.14, penalty 168.30. *D-QA-06:* accrued interest 40.72, not 41.50, so payable 8,624.16 not 8,624.94 (`it.failing`). Settled at the live quote; the penalty is fee income.

**S31 due-date change and extension (UC-47, UC-48).** 6,000, two paid; restructure (consent, assessment, proposal of 16 instalments from 20 April, committee approval, signed acceptance, execution): 16 instalments all on the 20th, lower instalment, `isRestructured`. Two paid on the 20th, then settled.

### Legacy core app — `e2e/legacy.int-spec.ts`

**S32 legacy loan, borrower creation to `POST /repayments/settlements` (UC-31, UC-59, UC-72).** Borrower created and KYC-verified through the API; `POST /loans` (3,000, 12% flat, 3 months, started 40 days ago, with collateral and a guarantor) by the officer (D-QA-01); the officer cannot approve; approved by one administrator, who cannot also disburse; disbursed by another; instalments 1,030 × 3; journals balanced. A promise to pay today, the instalment paid (1,000 principal, 30 interest), the daily review marks the promise `KEPT`. Payoff quote: principal 2,000, future interest 60 waived; a different amount refused; paying the quote closes the loan, once (idempotent replay returns the same repayment).

### Loan-type coverage — `e2e/catalogue.int-spec.ts`

**S33.** Every template used by a journey is offerable in the catalogue; a product cannot be drafted from a template whose capability is not built (`TEMPLATE_UNAVAILABLE`). Pending modules are `it.todo`.

## Coverage matrix

Legend: **Sxx** = journey that exercises it end to end · *pending module* =
being built separately, template seeded unavailable · *not implemented* =
⛔ in [TRACEABILITY.md](TRACEABILITY.md), nothing to drive · 🟡 = partially
implemented; what the journey covers is noted.

### Loan types

| LT | Type | Template | Journey(s) |
|---|---|---|---|
| LT-01 | Personal | `PERSONAL_INSTALMENT` | S01, S22–S31, S34 |
| LT-02 | Mortgage | `HOME_MORTGAGE` (floating) | S05 |
| LT-03 | Home equity | `HOME_EQUITY_TERM` | S06 |
| LT-04 | HELOC | `HOME_EQUITY_LINE` | S07 |
| LT-05 | Auto | `CAR_LOAN` | S11 |
| LT-06 | Student | `STUDENT_LOAN` | S04 |
| LT-07 | Credit card | `CREDIT_CARD` | *pending module* (`card.revolving_credit`) |
| LT-08 | Payday | `SALARY_ADVANCE` | S02 (interest-based; TV-08's fee-based APR is engine-only) |
| LT-09 | Pawn / gold | configured from `PERSONAL_INSTALMENT` (GOLD collateral, interest only) | S13 — no custody, forfeiture or auction (UC-66) |
| LT-10 | Debt consolidation | `DEBT_CONSOLIDATION` | S03 — one internal loan only (UC-35 not implemented) |
| LT-11 | BNPL | `BNPL` | *pending module* (`bnpl.merchant_settlement`) |
| LT-12 | Term loan | `CORPORATE_TERM` | S15 (quarterly) |
| LT-13 | Overdraft | `OVERDRAFT` | S16 |
| LT-14 | Business line | `REVOLVING_CREDIT` | S17 |
| LT-15 | Equipment | `EQUIPMENT_LOAN` (balloon) | S12 |
| LT-16 | Commercial real estate | `COMMERCIAL_PROPERTY` (balloon) | S10 — no DSCR/covenant monitoring |
| LT-17 | Construction | `CONSTRUCTION` | S08 |
| LT-18 | Invoice financing | `INVOICE_BACKED` | *pending module* (`trade.invoice_finance`) |
| LT-19 | Letter of credit | — | *pending module* (no template) |
| LT-20 | SME | `SME_TERM` | S14 |
| LT-21 | Microfinance | `MICRO_GROUP`, `MICRO_INDIVIDUAL` | S18, S19, S21 |
| LT-22 | Agricultural | `AGRI_CROP_SEASONAL` | S20 |
| LT-23 | Bridge | `BRIDGE_LOAN` | S09 |
| LT-24 | Syndicated | `SYNDICATED` | *pending module* (`syndication.participations`) |

19 of 24 loan types have a journey; the other 5 are pending modules.

### Use cases

| UC | Journey(s) | Notes |
|---|---|---|
| UC-01 Upfront fee deduction | S01, S14, S21 | deducted, deducted with VAT, separate with tax |
| UC-02 Down payment | *not implemented* | |
| UC-03 Full disbursement | every term-loan journey | prepare / approve / execute, idempotent |
| UC-04 Staged disbursement | S08 | |
| UC-05 Payment to a third party | *not implemented* | |
| UC-06 Financed premium | S06 | 🟡 booked as fee income, no insurer payable |
| UC-07 Broken period | S34 | TV-09 |
| UC-08 Equal instalment | S01, S05 | TV-01, TV-02 |
| UC-09 Equal principal | S14, S15 | TV-03 |
| UC-10 Flat rate | S19 | TV-04 |
| UC-11 Interest only | S09, S13 | TV-05 |
| UC-12 Balloon / bullet | S09, S10, S12 | TV-05, TV-06, TV-19 |
| UC-13 Seasonal | S20 | |
| UC-14 Grace period | S04 | capitalized grace |
| UC-15 Step-up / step-down | S20 (dated amounts) | 🟡 only via explicit schedules |
| UC-16 Auto-debit | *not implemented* | |
| UC-17 Branch / cash | S01 and every journey; S22 (cheque reference) | |
| UC-18 Mobile / wallet | S21 | 🟡 single payment via the integration API; no settlement files |
| UC-19 Payroll deduction | *not implemented* | |
| UC-20 Third-party payer | S18 (group member), S21 (guarantor) | |
| UC-21 Other currency | *not implemented* | |
| UC-22 Group collection | S18 | |
| UC-23 Bounced payment | S22 | |
| UC-24 Allocation waterfall | S22 | TV-15 |
| UC-25 Partial payment | S14, S18, S22 | |
| UC-26 Overpayment | S23 | |
| UC-27 Advance | S23 | |
| UC-28 Unidentified payment | S26 | |
| UC-29 Prepay, shorten | S05, S29 | TV-10 B |
| UC-30 Prepay, recast | S13, S29 | TV-10 A |
| UC-31 Full payoff | S03, S05–S08, S17, S23, S24, S30, S31, S32 | TV-11 partly (D-QA-06) |
| UC-32 Prepayment penalty | S05 (lock-in), S06 (waiver), S30 | |
| UC-33 Rebate | S19 | TV-12 |
| UC-34 Refinance / takeover | S03 | 🟡 internal refinance only; no payoff letter |
| UC-35 Consolidation of several debts | *not implemented* | |
| UC-36 Drawdown | S07, S08, S16, S17 | |
| UC-37 Daily interest on drawn | S07, S08, S16, S17 | TV-07 |
| UC-38 Minimum payment | S16 | |
| UC-39 Purchase grace | *pending module* (cards) | |
| UC-40 Cash advance | *not implemented* | |
| UC-41 Limit change / over-limit fee | S17 | 🟡 no flat over-limit fee |
| UC-42 Annual renewal | *not implemented* | S16 shows the manual expiry only |
| UC-43 Term-out | S07, S08, S17 | |
| UC-44 Purchase to instalments | *not implemented* | |
| UC-45 Variable rate reset | S05 | |
| UC-46 Promotional rate | *not implemented* | |
| UC-47 Due-date change | S31 | |
| UC-48 Tenure extension | S31 | |
| UC-49 Payment holiday | S27 | TV-13; D-QA-02 and D-QA-05 fixed |
| UC-50 Top-up | S03 | via refinance |
| UC-51 Margin call | S13 | TV-18; D-QA-04 fixed |
| UC-52 BNPL refund | *pending module* | |
| UC-53 LC to loan | *pending module* | |
| UC-54 Grace days | S06, S14, S21 | |
| UC-55 Late fee | S21 (flat, once) | percentage + per-loan cap only in `late-charges.int-spec.ts` |
| UC-56 Penalty interest | S06, S11, S20, S22 | TV-14 |
| UC-57 DPD ageing | S06, S07, S11 (every bucket), S22 | |
| UC-58 Collection escalation | S11 (stages by DPD) | 🟡 no escalation engine or work queues |
| UC-59 Promise to pay | S32 (legacy) | lending stack has none |
| UC-60 Guarantor called | *not implemented* | S21 guarantor pays voluntarily |
| UC-61 Set-off | *not implemented* | |
| UC-62 Non-accrual | S24 | |
| UC-63 Restructure | S20, S31 | |
| UC-64 Negotiated settlement | S28 | |
| UC-65 Repossession | *not implemented* | S11 posts the sale proceeds as a recovery |
| UC-66 Pawn forfeiture | *not implemented* | |
| UC-67 Invoice recourse | *pending module* | |
| UC-68 Credit insurance claim | *not implemented* | |
| UC-69 Write-off | S11 | |
| UC-70 Recovery | S11 | |
| UC-71 Debt sale | *not implemented* | |
| UC-72 Final payoff and closure | S01, S02, S04, S09, S10, S12–S15, S18–S22, S29, S32 … | |
| UC-73 Collateral release | S05–S10, S12–S14 | |
| UC-74 Refund of excess | S23 (advance), S26 (suspense) | |
| UC-75 Closure letter / bureau | *not implemented* | |

54 of the 75 use cases are exercised end to end (6 of them only as far as
they are implemented, marked 🟡); 17 are not implemented and 4 belong to
pending modules (UC-39, UC-52, UC-53, UC-67).

### Operations

| OPS | Where |
|---|---|
| OPS-1 product setup, maker-checker | every journey (`Journey.product`; maker's own approval refused) |
| OPS-2 origination | every journey: KYC gate (S01), documents by stage, DSR (S02), LTV / combined LTV (S07), authority (S15), two approvers (`SECURED_TWO_LEVEL`) |
| OPS-3 collateral and guarantors | S05–S14, S19, S21, S32 |
| OPS-4 end of day | every journey (accrual, capitalization, advances, penalties, DPD, non-accrual, provisioning, rate resets, margin calls, facility arrears) |
| OPS-5 impairment | S25 |
| OPS-6 ledger and reconciliation | every checkpoint |
| OPS-7 statements | S07, S08, S16, S17 (facility statements) |
| OPS-8 roles, maker-checker, audit | every journey |

### Test vectors through the live flow

| TV | Journey | Live result |
|---|---|---|
| TV-01 | S01 | every figure ✅ |
| TV-02 | S05 | ✅ (booked schedule) |
| TV-03 | S14 | ✅ |
| TV-04 | S19 | schedule ✅; the nominal/effective APR is engine-only (the API exposes an XIRR `effectiveAnnualRate` from `simulate`, a different convention) |
| TV-05 | S09 | ✅ |
| TV-06 | S05, S10 | ✅ |
| TV-07 | S07 | ✅ |
| TV-08 | — | engine only: no fee-based payday product; APR not exposed |
| TV-09 | S34 | ✅ (10 days = 32.88) |
| TV-10 | S29 | both options ✅ |
| TV-11 | S30 | penalty 168.30 ✅; accrued interest ❌ 40.72 vs 41.50 (D-QA-06) |
| TV-12 | S19 | ✅ |
| TV-13 | S27 | ✅ after D-QA-02 |
| TV-14 | S22 | ✅ |
| TV-15 | S22 | ✅ |
| TV-16 | S04 | ✅ |
| TV-17 | S07 | ✅ |
| TV-18 | S13 | ✅ on the valuation day (the exposure includes accrued interest afterwards) |
| TV-19 | S12 | ✅ |
| TV-20 | — | *pending module* (invoice finance; engine only) |

## Defects found

Fixed defects have a focused regression test outside `e2e/` and their own
`fix(...)` commit. Open ones are pinned in the journeys with `it.failing`,
asserting the correct behaviour: the suite stays green while the defect
exists and goes red when it is fixed, so the marker must then be removed.

| ID | Status | Defect | Where | Evidence |
|---|---|---|---|---|
| D-QA-01 | **Fixed** | Legacy `POST /loans` refused every new loan with 403 "RepaymentSchedule.createMany: parent loan … belongs to another tenant": the schedule was written with a separate `createMany` in the creating transaction, and the tenant guard resolves a relation-scoped child's parent outside that transaction. | `apps/api/src/loans/loans.service.ts` (create); guard lookup `apps/api/src/prisma/tenant-guard.ts:350` | commit `fix(loans): legacy loans can be created again`; `legacy-payoff.int-spec.ts` "a loan created through POST /loans…"; S32 |
| D-QA-02 | **Fixed** | A `CAPITALIZE` payment holiday never capitalized: the rewritten schedule dropped `capitalizedInterest`, so nothing accrued or capitalized, the schedule's principal ran ahead of the ledger (`schedulePrincipal` reconciliation break from the grant), the enrolment reported 0 deferred, and a SIMPLE product compounded. | `apps/api/src/lending/restructuring/payment-holiday.service.ts` (enrol), `packages/shared/src/lending/payment-holiday.ts` (`holidayDeferredInterest`) | commit `fix(lending): a capitalizing payment holiday capitalizes the interest`; `payment-holiday.test.ts`, `relief.int-spec.ts` (TV-13); S27 |
| D-QA-03 | **Fixed** | A facility repayment counted its whole amount as principal repaid, although part paid stated interest/fees: the facility showed less outstanding and more headroom than the loan carried, and reconciliation reported a `facilityDrawn` break on every facility that had paid a statement. | `apps/api/src/lending/facilities/facility-state.ts` (movements), `apps/api/src/lending/accounting/operations.service.ts` (reconciliation) | commit `fix(lending): a facility repayment reinstates only the principal it repaid`; `facilities.int-spec.ts` "a repayment that also pays stated interest"; S07, S08 |
| D-QA-04 | Fixed | Paying a margin call's `requiredRepayment` does not cure it: the cure test at end of day recomputes LTV on an exposure that includes interest accrued since the call, so the LTV is a few cents above the maximum and the call stays `OPEN` until it `EXPIRES`. Needs a rule (cure on the required amount being paid, or quote a buffer) — a business decision. | `apps/api/src/lending/collateral/collateral.service.ts:543` (`reviewMarginCall`), exposure at `:467` | `it.failing` in S13  Fixed: a call is also cured once repayments since the call reach its `requiredRepayment` (collateral.service reviewMarginCall). |
| D-QA-05 | Fixed | A `DEFER_NO_CAPITALIZATION` payment holiday reports the interest it defers (`deferredInterest` > 0, "payable later") but writes no `deferredInterestDue` on the new schedule, and the deferred interest is never accrued: it is silently forgiven with no concession posted. Fixing it needs the deferred interest accrued as well as carried, so it is not a one-line fix. | `apps/api/src/lending/restructuring/payment-holiday.service.ts:348` (`createMany`) | `it.failing` in S27  Fixed: the deferred lines carry `deferredAccrual` (earned over the holiday) and later lines `deferredInterestDue` (collected); the same applies to restructure deferrals. |
| D-QA-06 | Open (decision) | TV-11: the settlement quote accrues a PERIODIC loan's current-period interest as the scheduled interest × elapsed days / days in the period (84.15 × 15/31 = 40.72); the vector specifies ACT/365 on the balance (8,415.14 × 12% × 15/365 = 41.50). The payoff is 0.78 lower than the vector. A day-count convention that changes money owed is the product owner's call (DECISIONS preamble). | `packages/shared/src/lending/servicing.ts:94` (`accruedOnLine`, PERIODIC branch) | `it.failing` in S30 |

### Observations (not defects; for the product owner)

- **O-1** Assessment does not check `eligibility.employmentTypes`,
  `identity.customerTypes` or `minBusinessAgeMonths` (`apps/api/src/lending/origination/applications.service.ts`, `assess`): a student
  loan or a farmer-only crop loan accepts any occupation. Matches OPS-2 🟡.
- **O-2** A negotiated settlement expenses the waived interest and penalty
  to `5110` (principal forgiveness) together with the principal; restructure
  waivers use `5200` (concessions). The ledger balances; the classification
  differs (S28).
- **O-3** A separate (non-deducted) fee falls due on the disbursement day,
  so a borrower who pays it with the first instalment is counted 14 days
  past due (S21).
- **O-4** Benchmark observations can be recorded with an observation date
  after the business date; the reset on that later date then uses it.
- **O-5** Margin-call exposure includes accrued interest, fees and penalties,
  so TV-18's figures reproduce only on the valuation day (see D-QA-04).
- **O-6** The legacy stack runs on the wall clock; the lending stack on the
  tenant business date. S32 therefore starts its loan 40 days in the past.
- **O-7** Other places that create a relation-scoped child in the same
  transaction as its parent may hit D-QA-01's guard behaviour; not verified
  here: `apps/api/src/lending/access/access-admin.service.ts:90`
  (`rolePermission.createMany` after an `accessRole.upsert` inside a
  transaction) and `apps/api/src/auth/auth.service.ts:229`
  (`federatedIdentity.create` after creating the user).

- **O-8** `tenant-wall.int-spec.ts` › "a phone shared by two organisations…"
  is flaky: it creates the two borrowers back to back and expects the OTP
  codes "oldest borrower first", but `Borrower.createdAt` has millisecond
  precision, so two inserts in the same millisecond come back in either
  order (`borrower-auth.service.ts:57`, `orderBy: { createdAt: 'asc' }`). It
  failed once in this QA's full runs and passes in isolation. The wall suite
  also fingerprints whole tables, so nothing else may write to the test
  database while it runs.

## Not covered, and why

- **Pending modules** (being built separately): credit cards (LT-07,
  UC-39), BNPL (LT-11, UC-52), invoice finance (LT-18, UC-67, TV-20),
  letters of credit (LT-19, UC-53), syndication (LT-24). Listed as
  `it.todo` in S33.
- **Not implemented** (nothing to drive): UC-02, UC-05, UC-16, UC-19,
  UC-21, UC-35, UC-40, UC-42, UC-44, UC-46, UC-60, UC-61, UC-65, UC-66,
  UC-68, UC-71, UC-75; and DOC-1..10 beyond application documents and KYC
  review.
- **Engine-only vectors**: TV-08 (no fee-based payday product; APR not
  exposed by the API) and TV-04's APR figures.
- **Covered only by the component suites**: the percentage late fee with a
  per-loan cap (UC-55, `late-charges.int-spec.ts`), ECL-mode impairment
  (`impairment.int-spec.ts`), the customer portal side of restructuring
  (`restructure.int-spec.ts`), policy-library lock-ins (`policies.int-spec.ts`).
