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
  C('servicing.refinance', 'Restructuring', 'NOT_IMPLEMENTED', 2, 'Refinancing into a new loan linked to the original agreement'),
  C('servicing.negotiated_settlement', 'Restructuring', 'IMPLEMENTED', 2, 'Negotiated settlement: close a loan for less than it owes, with the concession itemised by component, posted as an expense and authorized separately when principal is forgiven', 'packages/shared/test/settlement.test.ts, apps/api/test/lending/settlement.int-spec.ts'),
  C('servicing.payment_holiday', 'Restructuring', 'NOT_IMPLEMENTED', 2, 'Stand-alone payment holiday programme (relief is available inside a restructure as a payment deferral)'),
  C('servicing.recovery_after_write_off', 'Servicing', 'IMPLEMENTED', 2, 'Post-write-off recoveries: cash attributed against what was written off, principal first, posted to recovery income without reviving the loan', 'packages/shared/test/settlement.test.ts, apps/api/test/lending/settlement.int-spec.ts'),
  // Facilities (Phase 2)
  C('facility.revolving', 'Facility', 'IMPLEMENTED', 2, 'Revolving facilities: limit, availability window, maker-checker drawdowns, interest on the drawn balance, commitment fee on the undrawn, limit changes, statements and term-out', FACILITY_TESTS),
  C('facility.overdraft', 'Facility', 'IMPLEMENTED', 2, 'Overdraft: debit balance against a limit, minimum payment, over-limit pricing', FACILITY_TESTS),
  C('facility.staged_drawdown', 'Facility', 'IMPLEMENTED', 2, 'Staged construction drawdowns: tranches released in full, gated by date and conditions precedent, with no limit reinstatement', FACILITY_TESTS),
  C('collateral.borrowing_base', 'Security', 'NOT_IMPLEMENTED', 2, 'Borrowing-base eligibility and advance rates'),
  C('limits.connected_exposure', 'Limits', 'NOT_IMPLEMENTED', 2, 'Group and connected-party exposure checks'),
  // Accounting & integrations
  C('accounting.double_entry', 'Accounting', 'IMPLEMENTED', 1, 'Immutable financial events with balanced double-entry postings and reversals', FLOW_TESTS),
  C('accounting.reconciliation', 'Accounting', 'IMPLEMENTED', 1, 'Sub-ledger to general-ledger reconciliation', FLOW_TESTS),
  C('accounting.external_export', 'Accounting', 'REQUIRES_INTEGRATION', 2, 'Export to an external accounting system', undefined, 'Outbox messages are recorded; no external adapter ships.'),
  C('integration.kyc', 'Integration', 'REQUIRES_INTEGRATION', 2, 'External identity / KYC verification', undefined, 'Manual KYC status only.'),
  C('integration.credit_bureau', 'Integration', 'REQUIRES_INTEGRATION', 2, 'Live credit bureau enquiry', undefined, 'The existing CBC provider is used when configured; products requiring a bureau cannot activate without it.'),
  C('integration.notifications', 'Integration', 'REQUIRES_INTEGRATION', 2, 'Borrower notifications (SMS / Telegram)'),
  // Specialized (Phase 3)
  C('card.revolving_credit', 'Specialized', 'NOT_IMPLEMENTED', 3, 'Credit cards: statements, minimum payment, grace on purchases'),
  C('bnpl.merchant_settlement', 'Specialized', 'NOT_IMPLEMENTED', 3, 'BNPL: merchant settlement and purchase-linked plans'),
  C('trade.documentary', 'Specialized', 'NOT_IMPLEMENTED', 3, 'Import / export finance against trade documents'),
  C('trade.invoice_finance', 'Specialized', 'NOT_IMPLEMENTED', 3, 'Invoice-backed lending with an invoice register'),
  C('trade.factoring', 'Specialized', 'NOT_IMPLEMENTED', 3, 'Factoring with debtor collections and recourse'),
  C('trade.supply_chain', 'Specialized', 'NOT_IMPLEMENTED', 3, 'Supply-chain (reverse factoring) programmes'),
  C('trade.forfaiting', 'Specialized', 'NOT_IMPLEMENTED', 3, 'Forfaiting of receivables without recourse'),
  C('education.income_contingent', 'Specialized', 'NOT_IMPLEMENTED', 3, 'Income-contingent repayment'),
  C('syndication.participations', 'Specialized', 'NOT_IMPLEMENTED', 3, 'Syndicated loans: agency, participations, pro-rata sharing'),
  C('project_finance.waterfall', 'Specialized', 'NOT_IMPLEMENTED', 3, 'Project finance: cash waterfall, DSCR covenants, sculpted repayment'),
  C('covenants.monitoring', 'Specialized', 'NOT_IMPLEMENTED', 3, 'Financial covenant monitoring'),
  C('institutional.counterparty_limits', 'Specialized', 'NOT_IMPLEMENTED', 3, 'Interbank / sovereign / municipal counterparty limits and conventions'),
  C('islamic.murabaha', 'Islamic', 'NOT_IMPLEMENTED', 3, 'Murabaha: asset purchase and resale at disclosed profit'),
  C('islamic.ijarah', 'Islamic', 'NOT_IMPLEMENTED', 3, 'Ijarah: lease with rentals and asset ownership'),
  C('access.emergency_break_glass', 'Access', 'NOT_IMPLEMENTED', 2, 'Emergency (break-glass) access'),
];

export const CAPABILITY_BY_ID: Record<string, Capability> = Object.fromEntries(CAPABILITIES.map((c) => [c.id, c]));

export function missingCapabilities(required: string[]): Capability[] {
  return required
    .map((id) => CAPABILITY_BY_ID[id] ?? { id, area: 'Unknown', description: 'Unknown capability', status: 'NOT_IMPLEMENTED' as const, phase: 3 as const })
    .filter((c) => c.status !== 'IMPLEMENTED');
}
