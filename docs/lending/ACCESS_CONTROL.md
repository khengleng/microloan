# Lending access control

Effective access to any protected lending action requires, **in order**:

1. an authenticated, active identity;
2. the correct tenant boundary;
3. the RBAC permission;
4. ABAC allow — scope, maker-checker, approval authority, authentication
   assurance and the tenant's ABAC policies;
5. the required feature flags;
6. a valid product configuration / state;
7. a valid workflow state.

`decide()` (`apps/api/src/lending/policy/decision.ts`) evaluates every check and
records each result, so an explanation lists *everything* that blocked, but the
outcome is **default deny, deny-overrides**. A missing attribute is a failed
check. Feature flags are evaluated *after* authorization and can never turn a
deny into an allow.

## Where it is enforced

* **Every service method** calls `PolicyService.enforce(actor, action, resource, tx)`
  inside its transaction, after re-reading the resource, so the decision is made
  on committed state. This is the authoritative decision.
* **Routes** declare `@LendingAction('…')`; the global `LendingActionGuard` turns
  away principals who hold the permission nowhere. Hiding a button is only a UI
  convenience — the integration suite proves direct API calls are refused.
* **Background jobs** (end-of-day batch) and **exports** are filtered to the
  actor's scope and authorize per account.
* **Integrations** authenticate with service-account keys
  (`X-Service-Key: <prefix>.<secret>`, peppered SHA-256 at rest), bound to one
  tenant with narrow scopes (`loan.repayment.post`, `loan.read`).
* **Customers** (borrower portal) are a separate principal limited to
  `restructure.request`, `restructure.read_own`, `restructure.accept_own`, and
  an ABAC owner check on every resource.
* The **capabilities endpoint**
  (`GET /v1/lending/access/capabilities/:type/:id`) returns the permitted
  actions and blocking reasons for the UI; it uses the same engine.
* Denials are written to `AuditEvent` with the full decision.

## Platform administrators

A `SUPERADMIN` holds only platform-catalogue permissions (`loan_product.read`,
`catalogue.manage`, `audit.read` of platform events, platform feature flags).
The tenant check refuses every tenant-data and money action for a platform
principal — they cannot read borrower data or approve transactions.

## Roles (seeded per tenant)

| Role | Purpose (see `policy/catalogue.ts` for the exact permissions) |
|---|---|
| Tenant administrator | access governance, flags, simulator, business date — no credit or money actions |
| Product maker / checker | draft and submit / approve, activate and retire products and workflows |
| Relationship officer | applications, documents, collateral; restructure requests and branch acceptance records |
| Credit analyst | recommendations; restructure assessment, simulation and proposals |
| Credit approver | credit approval/rejection within authority; restructure approval within authority |
| Loan operations maker | booking, disbursement preparation, repayments, write-off proposals, batch |
| Loan operations checker | disbursement approval/execution, reversals, write-off approval, restructure execution |
| Collections officer | servicing reads, repayments, restructure requests and monitoring |
| Restructure committee | restructure approval with waivers, rate concessions and principal forgiveness |
| Finance officer | accounting, business date, rates, batch, exports, the legacy loan archive |
| Risk / compliance reviewer | read across lending, audit, simulator, exports, the legacy loan archive |
| Auditor | read-only including the audit trail and the legacy loan archive |
| Integration service account | template for service-account scopes |

`legacy_loan.read` (D-154) opens the read-only legacy loan archive of the
original module's loans, within the holder's branches; it gates nothing else.

Assigning a **sensitive** role (any financial or approve permission, or
`access_policy.manage`) is a maker-checker change: it stays `PENDING` until a
second administrator — neither the requester nor the assignee — approves it.

## ABAC

Built-in conditions per action (`policy/actions.ts`): branch / portfolio /
legal-entity scope, maker-checker (the actor is not among the resource's makers),
approval authority (amount ≤ authority for the permission and currency;
cross-currency needs an approved FX rate no older than 3 days, otherwise deny),
MFA, and workflow state.

Tenant ABAC policies use a **constrained schema** (`policy/abac.ts`): rules are
`DENY` or `REQUIRE`, name actions (exact or `prefix.*`), and test a whitelist of
attributes with a fixed set of operators. They can only *restrict*. Evaluation is
three-valued: an unknown attribute makes a `DENY` rule fire and a `REQUIRE` rule
fail. A stored policy that no longer parses denies the actions it names.
Policy changes are maker-checker.

## Feature flags

Flags are availability controls, not permissions. Precedence (deterministic):

1. Unknown flag key → **off** (fail closed)
2. Platform emergency-off → off, cannot be overridden
3. Tenant emergency-off → off, cannot be overridden by narrower tenant rules
4. Most specific matching tenant rule: COHORT > SEGMENT > CHANNEL > BRANCH > PRODUCT > TENANT
   (ties: lower priority, then later `effectiveFrom`, then id)
5. Platform rule
6. Flag default

Only `ACTIVE` rules inside their effective window count; every rule change is
maker-checker. Cohorts are explicit memberships (no random per-request
behaviour). The spec's example `lending.product.mortgage.origination` is
expressed as a `lending.origination` rule scoped `PRODUCT = <product code>`.

| Flag | Gates |
|---|---|
| `lending.origination` | applications, approvals, booking, disbursement |
| `lending.family.<family>.enabled` | origination in one family |
| `lending.servicing` | repayments, accruals, servicing (independent of origination) |
| `lending.accounting.posting` | every money movement — off means refused, never unposted |
| `lending.repayment.balloon`, `lending.pricing.floating_rate`, `lending.integration.credit_bureau`, `lending.group.joint_liability`, `lending.revolving.drawdown` | product features |
| `lending.restructure.request` / `.simulation` / `.execution` | restructuring stages |
| `lending.restructure.term_extension` / `.payment_deferral` / `.interest_only` / `.rate_reduction` / `.capitalization` / `.charge_waiver` / `.principal_forgiveness` | restructure options (forgiveness defaults off) |

Retiring a product or switching off origination never blocks repayments,
accruals, statements or servicing of existing loans; switching off restructure
execution never touches executed amendments.

## Caching and revocation

Subjects and tenant context (flags, policies, FX) are cached for at most 30
seconds and keyed by the tenant's `authzVersion`, which is re-read on every
request and bumped inside every transaction that changes roles, assignments,
delegations, authorities, policies, flags or cohorts — so a revocation takes
effect on the next request. Decisions themselves are never cached or reused
across tenants or resources.

## Policy simulator

`POST /v1/lending/access/simulate` answers "Can this user perform this action on
this resource, and why?" with the same engine and inputs as a real request. It
is side-effect free — it writes nothing, not even an audit row.
