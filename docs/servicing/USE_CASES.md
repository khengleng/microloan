# Scope: Loan Types and Use Cases

Source: *Loan Servicing System — Claude Code Prompt Pack* (17 Oct 2026). Stable IDs
used by [TRACEABILITY.md](TRACEABILITY.md), tests and commits. DOC-x items were
added for customer document management.

## Repayment methods (RM)
- RM-1 Equal installment (amortizing)
- RM-2 Equal principal (declining balance)
- RM-3 Flat rate
- RM-4 Interest-only, then bullet or balloon
- RM-5 Revolving (daily interest on drawn balance, minimum payment)
- RM-6 Single payment (bullet, fee-based)
- RM-7 Custom / seasonal / step-up / step-down schedule

## Loan types (LT)
Consumer
- LT-01 Personal loan .............. RM-1, RM-3 | monthly | usually unsecured
- LT-02 Mortgage / home loan ....... RM-1 (fixed or variable), RM-7 | monthly | property collateral
- LT-03 Home equity loan ........... RM-1 | monthly | property collateral
- LT-04 HELOC ...................... RM-5 in draw period, then RM-1 | monthly
- LT-05 Auto / motorbike loan ...... RM-1, RM-3 | monthly | vehicle collateral, down payment
- LT-06 Student loan ............... grace period, interest capitalized, then RM-1
- LT-07 Credit card ................ RM-5 | monthly statement | grace period on purchases
- LT-08 Payday loan ................ RM-6 | 2-4 weeks
- LT-09 Pawn / gold loan ........... RM-4 or RM-6 | item held as collateral | LTV limit
- LT-10 Debt consolidation ......... RM-1 | pays off other debts at disbursement
- LT-11 Buy now, pay later ......... equal split, e.g. 4 payments every 2 weeks

Business
- LT-12 Term loan .................. RM-1, RM-2 | monthly or quarterly
- LT-13 Overdraft / working capital  RM-5 | annual renewal
- LT-14 Business line of credit .... RM-5
- LT-15 Equipment financing / lease  RM-1 with residual value
- LT-16 Commercial real estate ..... RM-1 with balloon | DSCR and LTV covenants
- LT-17 Construction loan .......... staged draws, interest-only on drawn amount, then RM-1
- LT-18 Invoice financing .......... advance against invoice, settled when customer pays
- LT-19 Letter of credit ........... fee-based; may convert to a loan (UC-53)
- LT-20 SME loan ................... RM-1, RM-2
- LT-21 Microfinance loan .......... RM-2, RM-3 | weekly, biweekly or monthly | individual or group
- LT-22 Agricultural loan .......... RM-7 seasonal or RM-6 at harvest
- LT-23 Bridge loan ................ RM-4 or rolled-up interest, RM-6
- LT-24 Syndicated loan ............ variable rate (benchmark + margin), RM-1 or bullet, multiple lenders

## Use cases (UC)

### A. Disbursement
- UC-01 Upfront fee deduction: net disbursed = principal - upfront fees
- UC-02 Down payment collected before disbursement
- UC-03 Full disbursement in one amount
- UC-04 Staged (tranche) disbursement; interest only on drawn amount
- UC-05 Disbursement to a third party (seller, dealer, school, previous lender)
- UC-06 Financed insurance premium added to principal
- UC-07 Broken-period interest for days before the first full period

### B. Scheduled repayment
- UC-08 Equal installment (RM-1)
- UC-09 Equal principal (RM-2)
- UC-10 Flat-rate installment (RM-3)
- UC-11 Interest-only period (RM-4)
- UC-12 Balloon or bullet final payment
- UC-13 Seasonal schedule tied to harvest or cash flow
- UC-14 Grace period (no payment, or interest only)
- UC-15 Step-up / step-down schedule

### C. Payment channels
- UC-16 Auto-debit from the borrower's account on the due date
- UC-17 Branch / cash payment
- UC-18 Mobile, QR, wallet or agent payment
- UC-19 Payroll deduction remitted by employer
- UC-20 Payment by a third party (guarantor, family)
- UC-21 Payment in a different currency, converted at the bank's rate
- UC-22 Group collection (one leader pays for a microfinance group)
- UC-23 Bounced or reversed payment, with reversal fee

### D. Payment allocation
- UC-24 Allocation waterfall (configurable order)
- UC-25 Partial payment (less than due)
- UC-26 Overpayment (more than due): hold as advance or apply as prepayment
- UC-27 Advance payment of future installments
- UC-28 Unidentified payment held in suspense until matched

### E. Early repayment
- UC-29 Partial prepayment, keep installment, shorten term
- UC-30 Partial prepayment, keep term, lower installment
- UC-31 Full early payoff (payoff quote valid to a date)
- UC-32 Prepayment penalty
- UC-33 Interest rebate on flat-rate loans (Rule of 78 or actuarial)
- UC-34 Refinance / takeover by another lender (payoff letter)
- UC-35 Consolidation payoff of other loans

### F. Revolving credit
- UC-36 Drawdown within limit
- UC-37 Daily interest on drawn balance
- UC-38 Minimum payment calculation
- UC-39 Full statement payment waives purchase interest (grace period)
- UC-40 Cash advance: fee plus interest from day one
- UC-41 Over-limit fee and limit increase or decrease
- UC-42 Annual renewal or review of the facility
- UC-43 Draw period ends; balance converts to installments
- UC-44 Convert a large purchase into an installment plan

### G. Changes during the loan
- UC-45 Variable rate reset: recalculate installment or term
- UC-46 Promotional rate expiry
- UC-47 Due date change, with interest adjustment for gap days
- UC-48 Tenure extension
- UC-49 Payment holiday / deferral, interest capitalized
- UC-50 Top-up loan added to an existing loan
- UC-51 Collateral margin call when collateral value falls (gold, securities)
- UC-52 BNPL refund or return reduces remaining installments
- UC-53 Letter of credit paid by bank converts to a loan for the importer

### H. Late and missed payments
- UC-54 Grace days before late charges
- UC-55 Late fee (flat or percent, with cap)
- UC-56 Penalty interest on overdue amounts
- UC-57 Days-past-due (DPD) aging and bucket movement
- UC-58 Collection reminder escalation (SMS, call, visit, notice)
- UC-59 Promise to pay, tracked and followed up
- UC-60 Guarantor called to pay
- UC-61 Right of set-off from the borrower's other accounts
- UC-62 Non-accrual: stop recognizing interest income at the configured DPD

### I. Restructuring and recovery
- UC-63 Restructure: capitalize arrears, change term or rate
- UC-64 One-time settlement for less than owed
- UC-65 Repossess and sell collateral; apply proceeds; track deficiency or surplus
- UC-66 Pawn forfeiture: sell unredeemed item
- UC-67 Invoice recourse: borrower repays advance if customer does not pay
- UC-68 Credit insurance pays off loan on death or disability
- UC-69 Write-off
- UC-70 Recovery after write-off booked as income
- UC-71 Debt sale to a collection agency

### J. Closure
- UC-72 Final payoff and account closure
- UC-73 Collateral release (title returned, lien removed)
- UC-74 Refund of any excess balance
- UC-75 Closure letter and credit bureau update

## Bank operations (cross-cutting)
- OPS-1 Product setup and versioning
- OPS-2 Origination: application, KYC, underwriting (credit score, DTI, LTV, DSCR), approval
- OPS-3 Collateral and guarantor management
- OPS-4 End-of-day batch: accrual, billing, DPD aging, penalties, classification, provisioning
- OPS-5 Loan classification and provisioning (expected loss = PD x LGD x EAD)
- OPS-6 General ledger integration and reconciliation
- OPS-7 Statements, notices and regulatory reports
- OPS-8 Security, roles, maker-checker, audit

## Customer document management (DOC)
- DOC-1 One document library per customer, across KYC, applications, loans, collateral and agreements
- DOC-2 Upload with type, file metadata, checksum and storage outside the database (S3 or equivalent)
- DOC-3 Document checklist per product and stage; missing items block the stage
- DOC-4 Review workflow: pending, accepted, rejected with reason; reviewer recorded
- DOC-5 Versions: a replaced document keeps its history
- DOC-6 Expiry tracking (e.g. ID cards) with reminders
- DOC-7 Retention rules and legal hold; deletion only by policy, with audit
- DOC-8 Secure access: role and branch scope, time-limited download links, audit of every view and download
- DOC-9 Generated documents filed automatically (key facts statement, agreements, statements, notices, closure letters)
- DOC-10 Borrower portal: upload requested documents and download own documents
