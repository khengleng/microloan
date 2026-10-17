# Test Vectors (golden numbers)

Source: *Loan Servicing System — Claude Code Prompt Pack* (17 Oct 2026). Every
vector is an automated test in `packages/shared/test/test-vectors.test.ts`;
vectors the engine cannot yet reproduce are recorded there as `todo` with the
reason. Status per vector: [TRACEABILITY.md](TRACEABILITY.md#test-vectors).

Conventions unless stated:
- Periodic rate r = annual rate / 12 for monthly installment loans.
- Daily calculations use ACT/365.
- Interest rounded to 0.01 each period, HALF_UP. Residue goes to the final installment.

## TV-01 Equal installment (RM-1, UC-08)
P = 10,000.00 | 12% | 12 monthly
- Installment: 888.49
- Month 1: interest 100.00, principal 788.49, balance 9,211.51
- Month 2: interest 92.12, principal 796.37, balance 8,415.14
- Month 11: interest 17.51, principal 870.98, balance 879.67
- Month 12 (final): interest 8.80, principal 879.67, payment 888.47, balance 0.00
- Total interest: 661.86

## TV-02 Mortgage (RM-1, LT-02)
P = 100,000.00 | 8% | 240 monthly
- Installment: 836.44
- Final installment: 836.37
- Total interest: 100,745.53

## TV-03 Equal principal (RM-2, UC-09)
P = 10,000.00 | 12% | 12 monthly
- Principal per month: 833.33 (final month 833.37)
- Month 1: 833.33 + 100.00 = 933.33
- Month 2: 833.33 + 91.67 = 925.00
- Month 12: 833.37 + 8.33 = 841.70
- Total interest: 650.00

## TV-04 Flat rate (RM-3, UC-10)
P = 10,000.00 | 12% flat | 12 monthly
- Total interest: 1,200.00
- Installments 1-11: 933.33; installment 12: 933.37
- Effective nominal annual rate: 21.46% (effective annual rate 23.70%)

## TV-05 Interest-only then bullet (RM-4, UC-11, UC-12)
P = 10,000.00 | 12% | 12 monthly
- Months 1-11: 100.00 each
- Month 12: 10,100.00

## TV-06 Balloon balance (UC-12, LT-16)
TV-02 loan, balloon due after payment 60
- Balance after 60 payments (schedule with per-period rounding): 87,525.57
- Total due on the installment-60 date (installment 836.44 + balloon 87,525.57): 88,362.01

## TV-07 Revolving interest (RM-5, UC-37)
Average daily balance 1,000.00 | 24% APR | 30-day cycle
- Interest: 19.73

## TV-08 Payday APR (RM-6, LT-08)
P = 500.00 | fee 75.00 | 14 days
- APR: 391.07%

## TV-09 Broken-period interest (UC-07)
P = 10,000.00 | 12% | 10 extra days
- Interest: 32.88

## TV-10 Partial prepayment (UC-29, UC-30)
TV-01 loan after month 2: balance 8,415.14 | prepay 2,000.00 | new balance 6,415.14 | 10 months left
- Option A, keep term (UC-30): new installment 677.32
- Option B, keep installment (UC-29): 7 payments of 888.49, then a final payment of 473.43
  (final interest 4.69); loan ends 2 months early

## TV-11 Full payoff (UC-31, UC-32)
TV-01 loan after month 2: balance 8,415.14 | payoff 15 days into month 3 | prepayment penalty 2% of principal
- Accrued interest (ACT/365): 41.50
- Penalty: 168.30
- Payoff without penalty: 8,456.64
- Payoff with penalty: 8,624.94

## TV-12 Rule of 78 rebate (UC-33)
TV-04 loan paid off after 6 installments (6 months remaining)
- Rebate = 1,200.00 x (6 x 7) / (12 x 13) = 323.08

## TV-13 Payment deferral (UC-49)
Balance 8,415.14 | 12% | 3-month deferral, simple interest capitalized
- Capitalized interest: 252.45
- New principal: 8,667.59

## TV-14 Penalty interest (UC-56)
Overdue installment 888.49 | penalty rate 18% p.a. | 10 days overdue | ACT/365
- Penalty interest: 4.38

## TV-15 Allocation waterfall (UC-24, UC-25)
Order: fees, penalty, overdue interest, overdue principal, current interest, current principal
Due: fee 10.00, penalty 4.38, overdue interest 100.00, overdue principal 788.49 | payment 500.00
- Applied: fee 10.00, penalty 4.38, interest 100.00, principal 385.62
- Remaining overdue principal: 402.87

## TV-16 Student loan capitalization (LT-06)
P = 20,000.00 | 6% simple | 4 years in school
- Accrued interest: 4,800.00
- Principal at repayment start: 24,800.00

## TV-17 HELOC limit (LT-04)
Home value 200,000.00 | max LTV 80% | mortgage balance 120,000.00
- Available limit: 40,000.00

## TV-18 Gold loan margin call (UC-51)
Outstanding 7,000.00 | collateral value falls to 8,000.00 | max LTV 80%
- Current LTV: 87.50%
- Required repayment (or added collateral value equivalent): 600.00

## TV-19 Equipment lease with residual (LT-15)
Cost 50,000.00 | residual 10,000.00 | 10% | 36 monthly
- Payment: 1,374.02

## TV-20 Invoice financing (LT-18, UC-67)
Invoice 10,000.00 | advance rate 80% | fee 2% of invoice per 30 days | paid after 60 days
- Advance: 8,000.00
- Fee: 400.00
- Paid to borrower at settlement: 1,600.00
