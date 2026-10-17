# Decisions and assumptions

Business rules chosen during the build, with who decided and why. Rules that
affect money owed are decided by the product owner, not assumed.

| ID | Date | Decision | Decided by | Notes |
|---|---|---|---|---|
| D-001 | 2026-10-17 | When a borrower pays more than is due, the default is to hold the excess as an **advance** and apply it automatically to the next instalments on their due dates (before penalties and days-past-due are assessed). Prepayment (`PREPAY`) and refusal (`REJECT`) remain product choices. | Product owner | UC-26, UC-27. Existing contracts keep the handling they were booked with; the new default applies to new products. |
| D-002 | 2026-10-17 | **Non-accrual** is off unless a product sets a days-past-due threshold. When on, interest keeps accruing on the loan but is booked to interest in suspense instead of income, and moves to income when the loan cures. | Product owner | UC-62 |
| D-003 | 2026-10-17 | Loans are **composed from reusable, versioned policies**. Products offer a default and a menu per policy kind; each contract chooses within that menu and parameter bounds; resolved policies are frozen in the contract. | Product owner | See [POLICY_MODEL.md](POLICY_MODEL.md) |
| D-004 | 2026-10-17 | **Lock-in periods**: prepaying or settling before the lock-in ends carries a configurable charge (or is refused), set per policy and frozen per contract. Months are counted from the disbursement date to the value date of the repayment. | Product owner | UC-32 |
| D-005 | 2026-10-17 | Lock-in tiers replace the base prepayment and settlement fee while they apply; after the last tier the base fee applies. They never stack. | Assumed (sensible default) | Confirm with product owner |
