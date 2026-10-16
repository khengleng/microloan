# Financial reference cases

Expected values in the engine tests are computed **independently** of the
engine, with `bc -l` at 30-digit scale from the textbook formulas, then rounded
by hand to the currency increment. The engine must reproduce them exactly.

| Case | Formula / inputs | Reference (bc) | Expected |
|---|---|---|---|
| Annuity | 10,000 × 0.01 / (1 − 1.01⁻¹²) | 888.48788678341707… | 888.49 |
| Zero rate | 1,000 / 3 | — | 333.33, 333.33, 333.34 |
| Equal principal | Σ 0.01 × 1,000 × (12 … 1) | 780 | 780.00 |
| Flat | 10,000 × 0.12 × 1 | 1,200 | 1,200.00; last line 933.37 |
| Effective monthly rate | 1.12^(1/12) − 1 | 0.0094887929346… | 0.009488792935 (12 d.p.) |
| ACT/ACT ISDA | 10,000 × 0.1 × (1/365 + 1/366) | 5.4719664645557… | 5.4719664646 |
| ACT/365F, 2 days | 10,000 × 0.1 × 2/365 | 5.4794520547945… | 5.4794520548 |
| ACT/360, 2 days | 10,000 × 0.1 × 2/360 | 5.5555555555555… | 5.5555555556 |
| Irregular first period | 46/29/31-day factors at 12% ACT/365F | 3416.6374921171… | 3,416.64; first interest 151.23 |
| Grace + capitalization | 10,100 × 0.01 / (1 − 1.01⁻⁴) | 2588.4390485077… | 2,588.44 |
| Balloon | [20,000 − 8,000/(1+0.1/12)³⁶] × (0.1/12) / [1 − (1+0.1/12)⁻³⁶] | 453.8729129927… | 453.87 |
| Seasonal | 5,000 × 0.14 × 167/365 ; 3,000 × 0.14 × 127/365 | 320.2739… ; 146.1369… | 320.27 ; 146.14 |
| KHR (100-riel increment) | 4,000,000 × 0.015 / (1 − 1.015⁻¹²) | 366,719.9716… | 366,700 |
| KWD (3 d.p.) | 1,000 × (0.05/12) / (1 − (1+0.05/12)⁻⁴) | 252.6095807158… | 252.610 |
| Recast after prepayment | new balance × 0.01 / (1 − 1.01⁻⁹) | factor 0.1167403628496811… | per test |
| Term from capacity | −ln(1 − 10,000 × 0.01 / 500) / ln(1.01) | 22.4257418780… | 23 |
| Term from capacity (restructure) | −ln(1 − 8,150 × 0.01 / 400) / ln(1.01) | 22.8979393206… | 23 |

Day counts for the dated cases were taken from the operating system calendar
(`date -j`): 2024-03-01 → 2024-08-15 = 167, 2024-08-15 → 2024-12-20 = 127,
2024-01-10 → 2024-02-25 = 46.
