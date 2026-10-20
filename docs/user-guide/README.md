# User guide — lending web portal

This guide is for the people who use the lending web portal every day at a
bank or microfinance institution: loan officers, credit analysts and
approvers, loan operations, collections, finance, product teams, risk and
compliance, auditors and administrators. It explains **how to do your work
in the portal**, step by step, using the same words you see on the screen.
You do not need any technical knowledge to use it.

If you are new, start with [Getting started](01-getting-started.md) and
[Roles, permissions and approvals](02-roles-and-approvals.md), then go to the
chapters for your role (see the table below). To practise safely, follow the
[demo walkthrough](demo-walkthrough.md) in the demo organisation.

## Contents

**Basics**

- 01 [Getting started](01-getting-started.md) — signing in, setting up your authenticator (two-factor authentication), changing language (English / Khmer), resetting your password, finding your way around, your work queues.
- 02 [Roles, permissions and approvals](02-roles-and-approvals.md) — what each role can do, maker-checker (four-eyes), approval limits, delegations, when you need your authenticator code, why a button may be missing or refused.

**Customers and origination**

- 03 [Customers and documents](03-customers-and-documents.md) — borrower records, KYC, consent, the customer document library and document review.
- 04 [Products and policies](04-products-and-policies.md) — the product catalogue, creating and approving products, versions, the policy library, workflows and the simulator.
- 05 [Applications and credit decisions](05-applications-and-credit-decisions.md) — creating an application, assessment (affordability, collateral, guarantors, credit score), recommendation, approval and booking.
- 06 [Disbursement](06-disbursement.md) — down payments, payees, preparing, approving and paying out a loan.
- 24 [Scorecards and alternative data](24-scorecards-and-alternative-data.md) — the credit score on an application, scorecards and their approval, testing, decision strategies (champion, challenger, thin-file, grade rules), customer consent, alternative data and scorecard monitoring.

**Servicing**

- 07 [Repayments and payments](07-repayments-and-payments.md) — posting repayments, payment channels, unidentified payments, refunds, payoff quotes, closure letters and early settlement.
- 08 [Servicing changes](08-servicing-changes.md) — restructuring and hardship, rescheduling, prepayment, rate resets, payment holidays, refinancing, fee waivers, negotiated settlement and reversals.
- 09 [Facilities](09-facilities.md) — credit lines, overdrafts, staged drawdowns, limits, statements, renewal and borrowing base.
- 10 [Group lending](10-group-lending.md) — solidarity groups and joint liability.
- 11 [Collections and recovery](11-collections-and-recovery.md) — work queues, collection ladder, guarantor demands, set-off, recovery, write-off.
- 12 [Specialised products](12-specialised-products.md) — cards, BNPL, leases and Ijarah, trade finance, syndication, project finance, Murabaha, income-contingent education loans, institutional lending and counterparty limits.
- 13 [Covenants and collateral](13-covenants-and-collateral.md).

**Finance, reporting and control**

- 14 [Accounting and period close](14-accounting-and-period-close.md) — ledger and reconciliation, account mapping, end of day, business date, impairment, month-end and year-end close.
- 15 [Reports and regulatory returns](15-reports-and-regulatory-returns.md) — statements, notices, NBC returns, exports, Reports, Performance and the KPI dashboard (portfolio, money received, ageing and PAR).
- 16 [Loan-book migration](16-loan-book-migration.md) — bringing loans over from a legacy system.
- 21 [Legacy loan archive and migration](21-legacy-archive-and-migration.md) — the retired original loan module: where its work is done now, the read-only legacy loan archive, moving running loans to the lending platform, the borrower portal and the collection QR.
- 19 [Audit trail](19-audit-trail.md).

**Administration**

- 17 [Webhooks and integrations](17-webhooks-and-integrations.md).
- 18 [Tenant administration](18-tenant-administration.md) — team members, settings, access and policy, feature flags, lending settings.
- 20 [Platform administration](20-platform-administration.md) — for the platform operator (super-admin) only.

**Help**

- 25 [Learning centre](25-learning-centre.md) — self-paced lessons, guided tours, quizzes, badges and certificates, and the team progress report.
- 26 [AML and compliance](26-aml-and-compliance.md) — the lending gate (KYC, AML clearance, EDD), watch lists and screening cases, customer risk rating, the cash transaction report and suspicious transaction referrals.
- 22 [Troubleshooting and FAQ](22-troubleshooting.md)
- 23 [Glossary](23-glossary.md)
- [Demo walkthrough](demo-walkthrough.md) — a guided end-to-end exercise in the demo organisation.

## Which chapters should I read?

Chapter numbers below are the numbers at the start of each chapter's file
name. Everyone should read 01, 02 and 22 (troubleshooting) and keep the
glossary (23) at hand. The [Learning centre](25-learning-centre.md) in the
portal turns these chapters into lessons, tours and quizzes for each role.
Then:

| Your role (as shown in Access & policy) | Main chapters | Also useful |
|---|---|---|
| Relationship officer / loan officer | 03, 05, 10, 07 | 24 (consent and alternative data), 06, 08, 11, 13 |
| Credit analyst | 05, 24, 03, 13 | 08, 10, 12 |
| Credit approver | 05, 02 | 24, 08, 12, 13 |
| Loan operations maker | 06, 07, 08 | 05, 09, 11, 12, 13 |
| Loan operations checker | 06, 07, 08 | 02, 09, 11, 12 |
| Collections officer | 11, 07 | 08, 13 |
| Restructure committee | 08 | 02, 11 |
| Finance officer | 14, 15, 07 | 16, 21, 09, 12 |
| Product maker / product checker | 04 | 24 (Scoring step), 02, 12, 09 |
| Risk / compliance reviewer | 02, 15, 19, 24 | 04, 14, 11, 21 |
| Auditor | 19, 15 | 02, 14, 21, 24 |
| Tenant administrator | 18, 02, 17 | 01, 16, 19 |
| Platform super-admin | 20 | 01 |

Many people hold more than one role. Your menu shows only the pages your
roles allow, so if a chapter describes a page you cannot see, you do not
have that role (see [chapter 02](02-roles-and-approvals.md)).

## Conventions used in this guide

- **Bold text** is something you see on the screen: a menu item, a tab, a
  button, a field or a status, spelled exactly as the portal shows it.
- Menu paths are written **Section › Item**, for example
  **Loans › Loan accounts** means: in the left-hand menu, under the
  **Loans** heading, click **Loan accounts**.
- Numbered steps are done in order. "What happens next" tells you where
  the work goes after you. "If it is blocked" tells you what a refusal
  means and what to do.
- **Note** lines flag things that depend on your organisation's
  configuration (for example a feature switched off by default) or that
  need a connection to an outside system that may not be set up yet.
- Screens are described in English. The portal can also be shown in Khmer
  (see [chapter 01](01-getting-started.md)); some newer lending screens are
  currently shown in English only.
- Amounts, dates and statuses in examples are illustrations; your
  organisation's products and limits may differ.
- This guide never contains passwords. Ask your administrator for your
  sign-in details.
