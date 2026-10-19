# Composable loan policies

A loan contract is composed from reusable, versioned **policies**. A product
offers a default and a menu per policy kind; each contract picks from the menu
(and sets any adjustable parameters within bounds). The resolved policies are
frozen into the contract at booking. Changing one later is an agreement
amendment with customer consent.

Decision: [DECISIONS.md](DECISIONS.md) D-003.

## Layers

```
Policy library   (tenant, versioned, maker-checker)
  PREPAYMENT  P-LOCK12   v2  lock-in 12 months: 3% of amount repaid; afterwards free
  LATE        L-STD      v3  3 grace days, 18% p.a. on overdue, cap 50.00 per instalment
  ALLOCATION  A-ADVANCE  v1  penalty > fee > tax > interest > principal; early money held as advance
  NON_ACCRUAL N-90       v1  interest to suspense from 90 days past due; cure at 0 days past due

Product PL-STD v4  (product configuration)
  policies.PREPAYMENT  default P-LOCK12   menu [P-LOCK12, P-LOCK24, P-NONE]
                       lockInMonths adjustable 6..24
  policies.LATE        default L-STD      menu [L-STD]

Contract LN-2026-00412  (frozen in AgreementVersion at booking)
  PREPAYMENT  P-LOCK24 v1  lockInMonths=18   (non-default: shown to the approver)
  LATE        L-STD v3
```

## How resolution works

Each policy kind owns one part of the product configuration, and a policy
body has exactly that part's shape:

| Kind | Configuration path it replaces |
|---|---|
| `PREPAYMENT` | `repayment.prepayment`, `repayment.earlySettlement`, `repayment.earlyRepaymentCharges` |
| `LATE_CHARGES` | `pricing.penalty` |
| `ALLOCATION` | `repayment.allocation` |
| `NON_ACCRUAL` | `operations.nonAccrual` |

At booking, `composeContractConfig(productConfig, resolvedPolicies)` overlays
each chosen policy body onto its path, then validates the result with the same
schema and cross-field rules as any product. The composed configuration is
what the agreement snapshot stores and what servicing reads. A product with no
`policies` section behaves exactly as before: its inline sections are the
contract's policies.

## Parameters

A policy may declare parameters and reference them in its body:

```json
{
  "parameters": { "lockInMonths": { "type": "int", "default": 12, "min": 6, "max": 24 } },
  "body": {
    "earlyRepaymentCharges": {
      "basis": "AMOUNT_REPAID",
      "tiers": [{ "untilMonth": { "$param": "lockInMonths" }, "action": "CHARGE", "rate": "0.03" }]
    }
  }
}
```

The product can narrow a parameter's bounds; the contract supplies a value
inside them. Resolution substitutes values before validation, so a contract can
never hold an out-of-range or structurally invalid policy.

## Lock-in and early repayment charges

`repayment.earlyRepaymentCharges` applies to partial prepayments and early
settlement (`appliesTo`). Tiers are checked in order by months elapsed since
disbursement; the first tier whose `untilMonth` has not passed applies:

| `action` | Effect |
|---|---|
| `CHARGE` | charge `rate × basis + fixed`, basis = amount repaid early or outstanding principal |
| `REFUSE` | early repayment is not allowed during the tier (a hard lock-in) |

After the last tier the base fees apply (`prepayment.feeRate`,
`earlySettlement.feeRate` / `feeFixed`). Every charge records the tier and
months elapsed in the event's explanation.

## Governance

- Policy versions: `DRAFT → SUBMITTED → APPROVED → RETIRED`; approval by a
  different person (maker-checker); approved versions are immutable.
- A contract's non-default choice or adjusted parameter is part of the
  application terms, so it is visible at recommendation and approval.
- Amending a running contract's policy creates a new agreement version and
  requires recorded customer consent and a checker.

## API

| Method | Path | Action |
|---|---|---|
| GET | `/v1/lending/policies?kind=` | `lending_policy.read` — the library, with every version |
| POST | `/v1/lending/policies` | `lending_policy.create` — a new policy and its version 1 (DRAFT) |
| POST | `/v1/lending/policies/:id/versions` | `lending_policy.create` — next version (DRAFT) |
| POST | `/v1/lending/policy-versions/:id/submit` · `approve` · `reject` · `retire` | maker-checker lifecycle |

Policy actions reuse the product permissions (`loan_product.*`), so the
product maker and checker roles govern the library too.

- A policy body is validated on save by resolving it at its defaults and
  laying it over a known-good configuration.
- A product version cannot be **activated** while any code on its menus has
  no APPROVED version (`POLICY_NOT_APPROVED`).
- An application's `terms.policies` is checked when it is created or edited,
  and resolved at **booking** against the latest APPROVED version. The
  agreement version stores the composed configuration and
  `policies: [{kind, code, version, policyVersionId, parameters}]`.
  Later amendments carry the policies forward unchanged.
- Servicing reads only the composed configuration: a partial prepayment or
  settlement quote inside a lock-in carries the tier's charge
  (`components.prepaymentCharge`, `settlementFeeExplanation`), and a REFUSE
  tier answers `PREPAYMENT_LOCKED_IN` / `SETTLEMENT_LOCKED_IN`.
