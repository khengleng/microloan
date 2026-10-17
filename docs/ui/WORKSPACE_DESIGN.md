# Web workspace design

The target design for the staff web app, borrower portal and platform console,
and a review of how much of it the code delivers today. The interactive
prototype is [`workspace-prototype.html`](workspace-prototype.html): open it in
a browser and pick a role to see that person's menu and home queue. It uses
the real role definitions from `apps/api/src/lending/policy/catalogue.ts`.

Status key: ✅ built · 🟡 partly built · ⛔ not built.

---

## Why

Staff use two apps that grew side by side: the original lending screens and
the configurable lending platform. The menus are chosen by four legacy role
names, so most people see the wrong things.

| Finding | Effect on a user | Evidence |
|---|---|---|
| The sidebar checks only `ADMIN`, `FINANCE`, `SALES`, `SUPERADMIN` | A `TENANT_ADMIN`, `ACCOUNTANT` or `LOAN_OFFICER` sees only Dashboard, Products and the lending section | `apps/web/src/app/[locale]/(app)/layout.tsx` (`isAdmin` / `isFinance` / `isSales`) |
| The lending section is shown to every tenant user | An auditor opens "Workflows" or "Access & policy" and gets an access error | same file, lending section has no gate |
| Two of everything (loans, collections, restructuring, write-off, audit, accounting, products) | Staff must know which stack a loan lives in before they can find it | `/loans` vs `/lending/loans`, `/collections` vs `/lending/collections`, … |
| No "what can I do" endpoint; the browser capability check fails open | Buttons look available, then the API refuses | `useCapabilities().can()` returns allowed for unknown actions (`components/lending/useAsync.ts`) |
| Approvals, maker-checker and MFA exist only as API errors | A checker cannot see what waits for them | no queue or badge anywhere |
| Lending screens are English only | Khmer-speaking branch staff use the hardest screens in their second language | no `useTranslations` under `components/lending/**` |

## Principles

1. **One model.** The lending permission engine decides menus, queues and
   buttons. Legacy roles are mapped to access roles once, then retired from
   the UI.
2. **Work first.** Home is the person's queue (to approve, to prepare, to
   chase), not a dashboard. Charts move to Reports.
3. **Find by name.** One search finds a borrower, loan, facility, application
   or case by name, phone, reference or ID, whichever stack it lives in.
4. **Explain refusals.** A blocked button says why and what would unblock it,
   using the reason the policy decision already returns.
5. **Hide vs. show.** No permission: the item is absent. Permission but blocked
   by state, scope, MFA or limit: the item shows, disabled, with the reason.
6. **Khmer first-class.** Every screen ships in English and Khmer, with
   currency-correct money (`$1,250.00`, `៛5,125,000`).

## Information architecture

Legacy and lending screens merge into one tree. An area appears when the user
holds any permission for one of its pages.

| Area | Page | Shown with any of | Status today |
|---|---|---|---|
| Work | Home (my queue) | everyone signed in | ✅ `/home` from `GET /me/work`; the KPI `/dashboard` stays in the menu for `CUSTOMER_VIEW` holders and is the landing page for people without lending permissions |
| Customers | Borrowers | `loan_application.read`, `loan.read` | ✅ `/borrowers` (legacy permissions) |
| | Groups | `borrower_group.read` | ⛔ API only (`/lending/applications/groups`) |
| Origination | Applications | `loan_application.read` | ✅ `/lending/applications` · legacy approval on `/loans/[id]` |
| | Credit decisions (queue) | `credit_decision.recommend`, `credit_decision.approve` | ⛔ decisions happen inside each application; no queue |
| Loans | Loan accounts | `loan.read` | 🟡 two lists: `/loans` and `/lending/loans` |
| | Facilities | `facility.read` | ⛔ API only (`/lending/facilities`) |
| | Disbursements (queue) | `loan.disbursement.*` | ⛔ panel on each loan page only |
| Collections & relief | Collections | `loan.repayment.post`, `restructure.monitor`, `loan.recovery.post` | 🟡 two pages: `/collections` and `/lending/collections` |
| | Restructure cases | `restructure.*` | ✅ `/lending/restructures` (plus legacy `RiskDecisionPanel`) |
| | Payment holidays | `payment_holiday.read` | ⛔ API only (`/lending/ops/payment-holiday-programmes`) |
| | Settlements & recoveries | `loan.settlement.negotiate`, `loan.recovery.post` | ⛔ API only; loan page says "not available" |
| Finance | Ledger & reconciliation | `accounting.read` | 🟡 two pages: `/accounting` and `/lending/accounting` |
| | End of day | `servicing.batch.run`, `business_date.manage` | 🟡 runs automatically (`EodSchedulerService`); manual buttons on `/lending/collections`; no status page |
| | Benchmark rates & calendars | `rate_observation.manage` | ⛔ API only (`/lending/ops/rates`, `/lending/ops/calendars`) |
| | Reports & exports | `loan_data.export`, `accounting.read` | ✅ `/reports`, `/kpi`, exports (legacy permissions) |
| Products | Products & versions | `loan_product.create`, `.approve`, `.activate` | 🟡 two: `/products` and `/lending/products`; editor lacks facility, group, settlement, refinance and holiday blocks |
| | Catalogue | `loan_product.create`, `.approve` | ✅ `/lending/catalogue` |
| | Workflows | `workflow.manage`, `workflow.approve` | ✅ `/lending/workflows` |
| | Simulator | `loan_product.read` | ✅ `/lending/simulator` |
| Risk & audit | Audit trail | `audit.read` | 🟡 two: `/audit` and `/lending/audit` |
| | Access simulator | `policy.simulate` | ✅ tab in `/lending/access` |
| Administration | Team & roles | `access_policy.read` | 🟡 two: `/users` (offers only legacy `ADMIN/FINANCE/SALES/CX/OPERATOR`) and `/lending/access` assignments |
| | Feature flags | `feature_flag.read` | ✅ tab in `/lending/access` |
| | Settings | `access_policy.manage` | ✅ `/settings` |

## Workspace shell

| Element | Design | Status today |
|---|---|---|
| Sidebar from permissions | Sections and items computed from effective lending permissions | ✅ `apps/web/src/lib/nav.ts` from `GET /me/access` plus legacy permissions (D-042); lending sub-tabs follow the same rules |
| Queue badges in the sidebar | Count of items waiting for this person | ✅ from `GET /me/work`, refreshed every minute |
| Global search | Borrower, phone, loan, application, case, any stack | ✅ `GET /search`; `/` or Ctrl/⌘-K; grouped by type (D-041) |
| Business-date chip | Tenant business date always visible | ✅ |
| Scope chip | "Branch · Toul Kork" / "All branches" / "Platform" | ✅ |
| Authority chip | Approval limit per currency | ✅ largest limit per currency |
| MFA state + step-up | "Password only" chip and "Verify now" banner when the role has MFA-gated actions | 🟡 chip and banner; the banner sends the person to sign in again with their code (no inline step-up) |
| Delegation banner | "Acting with authority delegated by … until …" | ✅ |
| EN / KM switch | Language switch in the top bar | ✅ |

## Home queues

Each queue appears only for holders of its permission and is filtered by the
same scope as the list pages. Checker queues show *you approve*; MFA-gated
ones are locked until the person verifies.

| Queue | Permission | Status today |
|---|---|---|
| Applications in progress | `loan_application.create` | ✅ |
| Applications to assess | `credit_decision.recommend` | ✅ |
| Waiting for your credit decision | `credit_decision.approve` | ✅ |
| Disbursements to prepare / approve | `loan.disbursement.prepare` / `.approve` | ✅ (and approved ones to pay out, `.execute`) |
| Write-offs to approve | `loan.writeoff.approve` | ✅ |
| Drawdowns to approve | `facility.drawdown.approve` | ✅ (and approved ones to release) |
| Past due in your scope | `loan.repayment.post` | ✅ with collection tasks in the person's queues |
| Restructured loans to watch | `restructure.monitor` | ✅ open review tasks |
| Hardship cases to assess / proposals to decide | `restructure.assess` / `.approve` | ✅ plus cases to propose for, acceptances to record and restructures to execute |
| Holiday programmes to publish | `payment_holiday.approve` | ✅ |
| Product versions to review / drafts | `loan_product.approve` / `.create` | ✅ including policy-library versions and approved versions to activate |
| End of day, reconciliation breaks | `servicing.batch.run`, `accounting.read` | 🟡 end-of-day failures queued; reconciliation breaks still on `/lending/accounting` |
| Benchmark rates due | `rate_observation.manage` | ⛔ |
| Access and flag changes to approve | `access_policy.approve`, `feature_flag.approve` | ✅ also on Home |
| Sensitive actions this week | `audit.read` | 🟡 refused actions this week |

Also queued (`GET /me/work`): fee waivers, refunds, set-offs, collateral
releases, recovery steps and payouts to approve (every pending maker-checker
task, any other action under "Other approvals"); approved applications to
book; documents to review; unidentified payments; month-end and year-end
closes and reopenings to approve; overdue covenant tests; outstanding payoff
letters; impairment policies; invoices, letters of credit and syndicates to
approve.

## Button states

The policy engine checks seven layers and reports every failure
(`apps/api/src/lending/policy/decision.ts`). The UI turns each into a sentence.

| Layer | Example message | Status today |
|---|---|---|
| RBAC (no permission) | Button not rendered | 🟡 lending record pages disable it; menus don't hide |
| ABAC · scope | "This loan is in Toul Kork branch. Your access covers Sen Sok and Chbar Ampov." | 🟡 the API returns the reason; lending pages show `blockedBy` text in a tooltip |
| ABAC · maker-checker | "Someone else must approve. You prepared this on 16 Oct." | 🟡 same |
| IDENTITY · MFA | "Verify with your authenticator." + Verify now | 🟡 reason shown; no inline step-up |
| ABAC · authority | "$8,400 is above your $5,000 limit." | 🟡 reason shown; limit not visible beforehand |
| WORKFLOW · state | "Nothing to approve yet. It needs to be in Prepared." | 🟡 same |
| FLAG | "Disbursements are paused for this product by your administrator." | 🟡 same |

Coverage gaps: capabilities exist only for applications, loan accounts and
product versions (restructure cases, facilities, groups and tenant actions are
not covered), the browser treats unknown actions as allowed, and legacy pages
show no reasons at all.

## Loan record page

| Element | Design | Status today |
|---|---|---|
| Header | Borrower, product version, branch, officer, status chips (state, DPD bucket, restructure probation) | 🟡 `/lending/loans/[id]` has a header; no DPD or probation chips |
| Key facts strip | Principal outstanding, arrears, next due, instalment, rate and day count | 🟡 values exist on the page |
| Activity timeline | Accruals, repayments with allocation, restructures, disbursement with maker and checker | ⛔ events exist; no timeline |
| Tabs | Schedule, agreement versions, ledger, documents, group | 🟡 schedule shown; versions, ledger, group not tabbed |
| Action rail by intent | Collect · Help the borrower · Close the loan · Correct, each limited to what the state allows | ⛔ stacked panels; refinance shown as "not available" |

## Role model

Legacy roles map once onto access-role assignments.

| Legacy role | Becomes | Status today |
|---|---|---|
| `TENANT_ADMIN`, `ADMIN` | TENANT_ADMIN | ✅ implicit in the policy engine |
| `BRANCH_MANAGER` | RELATIONSHIP_OFFICER + COLLECTIONS_OFFICER, own branch | ⛔ |
| `LOAN_OFFICER`, `OPERATOR` | RELATIONSHIP_OFFICER, own branch | ⛔ |
| `CREDIT_OFFICER` | CREDIT_ANALYST | ⛔ |
| `APPROVER` | CREDIT_APPROVER + an authority row per currency | ⛔ |
| `ACCOUNTANT`, `FINANCE` | FINANCE_OFFICER + LOAN_OPS_MAKER | ⛔ |
| `AUDITOR` | AUDITOR | ⛔ |
| `CUSTOMER_SUPPORT`, `SALES`, `CX` | new CUSTOMER_SERVICE (`loan.read`, `loan_application.read`, `restructure.request`) | ⛔ role does not exist |

## Borrower portal

| Element | Design | Status today |
|---|---|---|
| Phone + one-time code sign-in | | 🟡 built, but codes are only delivered when an SMS provider is configured, and requests are not rate-limited |
| "How much and by when" first | Amount due, date, overdue part, Pay with KHQR | 🟡 loan view and payment QR exist; layout lists loans |
| Ask for help | Payment holiday or new schedule | 🟡 restructure request exists; holiday programmes are not offered |
| Review and accept a proposal | New instalment, end date and extra interest stated plainly | ✅ acceptance flow exists (`PaymentReliefSection`) |
| Documents and signing | Key facts statement versions | ✅ |
| Khmer by default | | 🟡 portal page translated; relief section is English only |

## Platform console

| Element | Status today |
|---|---|
| Organisations, plan payments, subscription plans, platform team, audit | ✅ `/tenants`, `/platform-payments`, `/plan-tiers`, `/users`, `/audit` |
| Platform feature-flag rules | ⛔ API only |
| Platform home queue (payments to confirm, pending activations) | ✅ `/home` for the platform operator; search finds organisations and plan payments |

## API additions

| Endpoint | Purpose | Status |
|---|---|---|
| `GET /me/access` | Effective permissions, scope, authorities, delegations, MFA assurance, enabled flags | ✅ from `PolicyService.subject()`; platform variant; borrower variant at `GET /lending/portal/me/access` |
| `GET /me/work` | Counts and top items per queue, scope-filtered | ✅ maker-checker aware (D-040); platform variant (plan payments, organisations) |
| `GET /search?q=` | Global search, tenant- and scope-filtered | ✅ |
| Capabilities for `RESTRUCTURE_CASE`, `FACILITY`, `BORROWER_GROUP`, `TENANT` | Button states on every record page | ⛔ only `APPLICATION`, `LOAN_ACCOUNT`, `PRODUCT_VERSION` |
| Fail-closed client | Unknown action = not allowed | ⛔ |

## Delivery

1. **Shell and access** — `/me/access`, `/me/work`, fail-closed capabilities;
   new sidebar and top bar; role migration and Team & roles; home queues.
2. **One loan, one place** — unified search and loan page with the action
   rail; screens for facilities, rate resets and benchmark rates, groups,
   negotiated settlement, recoveries, holiday programmes and refinance; legacy
   loan pages redirect.
3. **Khmer and the portal** — translation keys for every lending, accounting
   and admin screen; phone-first portal.
4. **Retire the duplicates** — remove legacy collections, restructure,
   write-off and audit screens once their data is reachable from the unified
   pages.
