/**
 * The capability matrix: what the lending engine can actually do.
 *
 * A capability's status is a claim about shipped, tested behaviour. Only
 * IMPLEMENTED satisfies a product's activation check. SIMULATION_ONLY can be
 * priced in the simulator but never booked; REQUIRES_INTEGRATION needs a real
 * (non-mock) adapter that this platform does not yet ship; NOT_IMPLEMENTED is
 * exactly that. Updating a status here is a release decision — it must be
 * accompanied by the tests named in `evidence`.
 */
export type CapabilityStatus = 'IMPLEMENTED' | 'SIMULATION_ONLY' | 'REQUIRES_INTEGRATION' | 'NOT_IMPLEMENTED';

export interface Capability {
  id: string;
  area: string;
  description: string;
  status: CapabilityStatus;
  phase: 1 | 2 | 3;
  /** Test files or notes that back the status. */
  evidence?: string;
  limitation?: string;
}

const C = (id: string, area: string, status: CapabilityStatus, phase: 1 | 2 | 3, description: string, evidence?: string, limitation?: string): Capability => ({
  id,
  area,
  status,
  phase,
  description,
  evidence,
  limitation,
});

const ENGINE_TESTS = 'packages/shared/test/*.test.ts';
const FLOW_TESTS = 'apps/api/test/lending/*.int-spec.ts';
const FACILITY_TESTS = 'packages/shared/test/facility.test.ts, apps/api/test/lending/facilities.int-spec.ts';

export const CAPABILITIES: Capability[] = [
  // Schedules
  C('schedule.equal_instalment', 'Schedule', 'IMPLEMENTED', 1, 'Equal instalments (annuity), fixed periodic rate, zero-rate case', ENGINE_TESTS),
  C('schedule.equal_principal', 'Schedule', 'IMPLEMENTED', 1, 'Equal principal with interest on the opening balance', ENGINE_TESTS),
  C('schedule.flat_rate', 'Schedule', 'IMPLEMENTED', 1, 'Flat interest: P × r × years spread over level instalments', ENGINE_TESTS),
  C('schedule.interest_only_bullet', 'Schedule', 'IMPLEMENTED', 1, 'Interest-only with bullet principal', ENGINE_TESTS),
  C('schedule.balloon', 'Schedule', 'IMPLEMENTED', 1, 'Level instalments leaving a balloon residual', ENGINE_TESTS),
  C('schedule.explicit_dated', 'Schedule', 'IMPLEMENTED', 1, 'Seasonal / explicitly dated principal with actual-interval interest', ENGINE_TESTS),
  C('schedule.irregular_first_period', 'Schedule', 'IMPLEMENTED', 1, 'Irregular first period with DAILY accrual (periodic formulas refused)', ENGINE_TESTS),
  C('schedule.grace_principal', 'Schedule', 'IMPLEMENTED', 1, 'Principal grace (interest-only instalments)', ENGINE_TESTS),
  C('schedule.grace_interest_capitalized', 'Schedule', 'IMPLEMENTED', 1, 'Interest grace with capitalization', ENGINE_TESTS),
  C('schedule.business_day_adjustment', 'Schedule', 'IMPLEMENTED', 1, 'Holiday calendars; FOLLOWING / MODIFIED_FOLLOWING / PRECEDING', ENGINE_TESTS),
  C('schedule.custom_day_frequency', 'Schedule', 'IMPLEMENTED', 1, 'Custom day/week/month frequency (day-based requires DAILY accrual)', ENGINE_TESTS),
  // Pricing
  C('pricing.fixed_rate', 'Pricing', 'IMPLEMENTED', 1, 'Fixed nominal or effective annual rate; ACT/365F, ACT/360, ACT/ACT ISDA, 30/360 ISDA, 30E/360', ENGINE_TESTS),
  C('pricing.floating_rate', 'Pricing', 'IMPLEMENTED', 2, 'Floating rate: benchmark + margin with floor/cap, projected schedule, and contractual resets on booked loans applied in the end-of-day batch', 'packages/shared/test/floating.test.ts, apps/api/test/lending/floating.int-spec.ts'),
  C('pricing.upfront_fees', 'Pricing', 'IMPLEMENTED', 1, 'Upfront fees: deducted, financed or separately collected, with tax', ENGINE_TESTS),
  C('pricing.late_penalty', 'Pricing', 'IMPLEMENTED', 1, 'Late penalties: flat per overdue instalment or penalty rate on overdue amounts', FLOW_TESTS),
  C('pricing.effective_rate_disclosure', 'Pricing', 'IMPLEMENTED', 1, 'Effective annual rate (XIRR) including fees', ENGINE_TESTS),
  // Origination
  C('origination.individual', 'Origination', 'IMPLEMENTED', 1, 'Individual borrower applications, documents, conditions precedent', FLOW_TESTS),
  C('credit.decision', 'Credit', 'IMPLEMENTED', 1, 'Recommendation, approval and rejection history with approval authority', FLOW_TESTS),
  C('collateral.ltv', 'Security', 'IMPLEMENTED', 1, 'Collateral pledges, valuations, haircuts and LTV threshold at approval', FLOW_TESTS),
  C('guarantee.basic', 'Security', 'IMPLEMENTED', 1, 'Personal / corporate guarantee capture and minimum-count requirement', FLOW_TESTS),
  C('liability.individual', 'Liability', 'IMPLEMENTED', 1, 'Individual liability', FLOW_TESTS),
  C('liability.group_joint', 'Liability', 'IMPLEMENTED', 2, 'Solidarity groups: formation, membership tenure and leadership, share allocation, joint liability for the whole balance, per-member contributions and governed member exit', 'packages/shared/test/group.test.ts, apps/api/test/lending/groups.int-spec.ts'),
  // Disbursement & servicing
  C('disbursement.manual', 'Disbursement', 'IMPLEMENTED', 1, 'Single disbursement recorded by operations with external reference (maker-checker)', FLOW_TESTS),
  C('disbursement.payment_rail', 'Disbursement', 'REQUIRES_INTEGRATION', 2, 'Automated payout through a payment provider', undefined, 'Only a mock adapter exists; it is blocked in production.'),
  C('servicing.repayment', 'Servicing', 'IMPLEMENTED', 1, 'Repayment posting with configurable allocation order and idempotency', FLOW_TESTS),
  C('servicing.repayment_reversal', 'Servicing', 'IMPLEMENTED', 1, 'Repayment reversal by contra entry (latest-first)', FLOW_TESTS),
  C('servicing.accrual', 'Servicing', 'IMPLEMENTED', 1, 'Daily interest accrual reconciled to scheduled interest', FLOW_TESTS),
  C('servicing.partial_prepayment', 'Servicing', 'IMPLEMENTED', 1, 'Partial prepayment with recast or shortened tenor (reducing-balance loans)', ENGINE_TESTS),
  C('servicing.early_settlement', 'Servicing', 'IMPLEMENTED', 1, 'Settlement quote and payoff with optional fee and cash rounding', FLOW_TESTS),
  C('servicing.delinquency', 'Servicing', 'IMPLEMENTED', 1, 'Days past due, delinquency buckets and collections stage assignment', FLOW_TESTS),
  C('servicing.write_off', 'Servicing', 'IMPLEMENTED', 1, 'Write-off proposal and approval (maker-checker)', FLOW_TESTS),
  C('servicing.closure', 'Servicing', 'IMPLEMENTED', 1, 'Automatic closure on full repayment or settlement', FLOW_TESTS),
  C('servicing.restructure', 'Restructuring', 'IMPLEMENTED', 1, 'Hardship cases: affordability, options, maker-checker approval, customer acceptance, amendment execution and monitoring', 'packages/shared/test/restructure.test.ts, apps/api/test/lending/restructure.int-spec.ts'),
  C('restructure.affordability', 'Restructuring', 'IMPLEMENTED', 1, 'Individual, household, business (DSCR) and seasonal affordability templates', 'packages/shared/test/restructure.test.ts'),
  C('restructure.customer_self_service', 'Restructuring', 'IMPLEMENTED', 1, 'Customers request restructuring and accept their own proposals in the borrower portal', FLOW_TESTS),
  C('servicing.refinance', 'Restructuring', 'IMPLEMENTED', 2, 'Refinancing: the new loan\u2019s proceeds settle the old one in the same transaction, with arrears roll-in and evergreening reported and separately permitted', 'packages/shared/test/refinance.test.ts, apps/api/test/lending/relief.int-spec.ts'),
  C('servicing.negotiated_settlement', 'Restructuring', 'IMPLEMENTED', 2, 'Negotiated settlement: close a loan for less than it owes, with the concession itemised by component, posted as an expense and authorized separately when principal is forgiven', 'packages/shared/test/settlement.test.ts, apps/api/test/lending/settlement.int-spec.ts'),
  C('servicing.payment_holiday', 'Restructuring', 'IMPLEMENTED', 2, 'Payment-holiday programmes: published offers with consistent eligibility, maker-checker publication, and an explicit choice of interest and term treatment', 'packages/shared/test/payment-holiday.test.ts, apps/api/test/lending/relief.int-spec.ts'),
  C('servicing.recovery_after_write_off', 'Servicing', 'IMPLEMENTED', 2, 'Post-write-off recoveries: cash attributed against what was written off, principal first, posted to recovery income without reviving the loan', 'packages/shared/test/settlement.test.ts, apps/api/test/lending/settlement.int-spec.ts'),
  // Facilities (Phase 2)
  C('facility.revolving', 'Facility', 'IMPLEMENTED', 2, 'Revolving facilities: limit, availability window, maker-checker drawdowns, interest on the drawn balance, commitment fee on the undrawn, limit changes, statements and term-out', FACILITY_TESTS),
  C('facility.overdraft', 'Facility', 'IMPLEMENTED', 2, 'Overdraft: debit balance against a limit, minimum payment, over-limit pricing', FACILITY_TESTS),
  C('facility.staged_drawdown', 'Facility', 'IMPLEMENTED', 2, 'Staged construction drawdowns: tranches released in full, gated by date and conditions precedent, with no limit reinstatement', FACILITY_TESTS),
  C('collateral.borrowing_base', 'Security', 'IMPLEMENTED', 2, 'Borrowing base on a revolving line: certificates of inventory and receivables by class, stated and age ineligibles, concentration limits and advance rates; maker-checker acceptance; drawdowns limited to the lower of the limit and the base, and refused on a stale certificate', 'packages/shared/test/borrowing-base.test.ts, apps/api/test/lending/inventory-borrowing-base.int-spec.ts', 'Certificates are entered by operations from the borrower\u2019s report; there is no stock-system or ledger feed, and field exams are recorded as evidence only (DECISIONS D-062).'),
  C('limits.connected_exposure', 'Limits', 'NOT_IMPLEMENTED', 2, 'Group and connected-party exposure checks'),
  // Accounting & integrations
  C('accounting.double_entry', 'Accounting', 'IMPLEMENTED', 1, 'Immutable financial events with balanced double-entry postings and reversals', FLOW_TESTS),
  C('accounting.reconciliation', 'Accounting', 'IMPLEMENTED', 1, 'Sub-ledger to general-ledger reconciliation', FLOW_TESTS),
  C('accounting.external_export', 'Accounting', 'REQUIRES_INTEGRATION', 2, 'Export to an external accounting system', undefined, 'Outbox messages are recorded; no external adapter ships.'),
  C('integration.kyc', 'Integration', 'REQUIRES_INTEGRATION', 2, 'External identity / KYC verification', undefined, 'Manual KYC status only.'),
  C('integration.credit_bureau', 'Integration', 'REQUIRES_INTEGRATION', 2, 'Live credit bureau enquiry', undefined, 'The existing CBC provider is used when configured; products requiring a bureau cannot activate without it.'),
  C('integration.notifications', 'Integration', 'REQUIRES_INTEGRATION', 2, 'Borrower notifications (SMS / Telegram)'),
  // Specialized (Phase 3)
  C('card.revolving_credit', 'Specialized', 'IMPLEMENTED', 3, 'Credit cards: purchases, cash advances and instalment plans as separate balances; monthly statements with a due date and minimum payment; purchase interest waived when the previous statement is paid in full by its due date; cash-advance fee plus interest from day one', 'packages/shared/test/card.test.ts, apps/api/test/lending/cards.int-spec.ts'),
  C('bnpl.merchant_settlement', 'Specialized', 'IMPLEMENTED', 3, 'BNPL: the merchant is paid the purchase price net of its discount at disbursement; a merchant refund reduces the remaining instalments latest first, refunds what the customer already paid, and claws the money back from the merchant', 'packages/shared/test/bnpl.test.ts, apps/api/test/lending/bnpl-lease.int-spec.ts'),
  C('trade.documentary', 'Specialized', 'NOT_IMPLEMENTED', 3, 'Import / export finance against trade documents'),
  C('trade.invoice_finance', 'Specialized', 'IMPLEMENTED', 3, 'Invoice financing on a revolving limit: invoice register, maker-checker advances at the product advance rate, fee per period, debtor settlement with the balance paid to the borrower, and full recourse aged as arrears', 'packages/shared/test/trade.test.ts, apps/api/test/lending/trade.int-spec.ts', 'Recourse only (no factoring or non-recourse purchase); no late penalty on recourse arrears (DECISIONS D-012).'),
  C('trade.letter_of_credit', 'Specialized', 'IMPLEMENTED', 3, 'Import letters of credit: maker-checker issuance with a fee and an off-balance-sheet contingent memo; a payment by the bank converts into a term loan for the importer', 'packages/shared/test/trade.test.ts, apps/api/test/lending/trade.int-spec.ts', 'No SWIFT messaging, document examination or confirmation; payment is recorded, not sent.'),
  C('trade.factoring', 'Specialized', 'NOT_IMPLEMENTED', 3, 'Factoring with debtor collections and recourse'),
  C('trade.supply_chain', 'Specialized', 'NOT_IMPLEMENTED', 3, 'Supply-chain (reverse factoring) programmes'),
  C('trade.forfaiting', 'Specialized', 'NOT_IMPLEMENTED', 3, 'Forfaiting of receivables without recourse'),
  C('education.income_contingent', 'Specialized', 'NOT_IMPLEMENTED', 3, 'Income-contingent repayment'),
  C('syndication.participations', 'Specialized', 'IMPLEMENTED', 3, 'Syndicated loans: the tenant as agent, participants by share or amount (summing to 100%), funding by participant, every collection split by share into a participant sub-ledger, and maker-checker payouts', 'packages/shared/test/syndication.test.ts, apps/api/test/lending/syndication.int-spec.ts', 'Losses on write-off or negotiated settlement are not shared automatically (DECISIONS D-015).'),
  C('project_finance.waterfall', 'Specialized', 'IMPLEMENTED', 3, 'Project finance: staged construction drawdowns with capitalized interest, term-out on a repayment profile sculpted to projected CFADS at a target DSCR, a debt service reserve, and a cash waterfall (debt service, reserve top-up, cash sweep, distributions) with lock-up below a DSCR threshold', 'packages/shared/test/project-finance.test.ts, apps/api/test/lending/project-finance.int-spec.ts', 'One senior tranche; CFADS and receipts are entered by operations; no hedging, subordinated debt or multi-account cash management (DECISIONS D-061).'),
  C('covenants.monitoring', 'Specialized', 'IMPLEMENTED', 3, 'Financial covenants (minimum DSCR, maximum LTV, maximum net leverage, minimum interest cover, financial statements) set up from the product at booking or per loan, tested on schedule, with breach notices, cure by a later test and maker-checker waiver', 'packages/shared/test/covenants.test.ts, apps/api/test/lending/commercial-covenants.int-spec.ts, apps/api/test/lending/acquisition-finance.int-spec.ts', 'Figures are entered from the borrower\u2019s accounts; a breach raises a notice and the work queue, it does not reprice or accelerate the loan automatically (DECISIONS D-060).'),
  C('institutional.counterparty_limits', 'Specialized', 'NOT_IMPLEMENTED', 3, 'Interbank / sovereign / municipal counterparty limits and conventions'),
  C('islamic.murabaha', 'Islamic', 'NOT_IMPLEMENTED', 3, 'Murabaha: asset purchase and resale at disclosed profit'),
  C('islamic.ijarah', 'Islamic', 'IMPLEMENTED', 3, 'Ijarah: lease with rentals and asset ownership, rental income and late charges to charity on their own accounts', 'packages/shared/test/bnpl.test.ts, apps/api/test/lending/bnpl-lease.int-spec.ts', 'Lessor accounting is the net-investment (finance-lease) method; an operating Ijarah with depreciation is not modelled (DECISIONS D-032).'),
  C('lease.true_lease', 'Specialized', 'IMPLEMENTED', 3, 'True lease: the lender buys and owns the asset (paid to the supplier), rentals to a residual purchase-option price, and at the end title transfer on purchase or return of the asset', 'packages/shared/test/bnpl.test.ts, apps/api/test/lending/bnpl-lease.int-spec.ts'),
  C('access.emergency_break_glass', 'Access', 'NOT_IMPLEMENTED', 2, 'Emergency (break-glass) access'),
];

export const CAPABILITY_BY_ID: Record<string, Capability> = Object.fromEntries(CAPABILITIES.map((c) => [c.id, c]));

export function missingCapabilities(required: string[]): Capability[] {
  return required
    .map((id) => CAPABILITY_BY_ID[id] ?? { id, area: 'Unknown', description: 'Unknown capability', status: 'NOT_IMPLEMENTED' as const, phase: 3 as const })
    .filter((c) => c.status !== 'IMPLEMENTED');
}
