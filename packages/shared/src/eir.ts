// ── Compliance Batch #4: Effective Interest Rate (EIR / APR) + Key Facts ─────
// NBC / responsible-lending transparency: borrowers must see the true annual
// cost of credit including fees, not just the nominal rate. EIR is the monthly
// IRR of the loan cash flows (net cash received vs installments paid),
// annualised.

export interface KeyFactsInput {
  principal: number;
  /** Cash the borrower actually receives = principal − upfront fees. */
  netDisbursed: number;
  /** Ordered monthly installment totals (principal + interest, incl. any
   *  scheduled fees but excluding contingent penalties). */
  installments: number[];
  nominalAnnualRate: number; // %
  termMonths: number;
  processingFee?: number;
  adminFee?: number;
  currency?: string;
}

export interface KeyFacts {
  currency: string;
  principal: number;
  netDisbursed: number;
  nominalAnnualRate: number; // %
  effectiveAnnualRate: number; // EIR / APR %
  totalPrincipal: number;
  totalInterest: number;
  totalFees: number;
  totalRepayable: number; // sum of installments
  totalCostOfCredit: number; // interest + fees
  installmentCount: number;
  averageInstallment: number;
  firstInstallment: number;
}

function round(n: number, dp = 2): number {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

/**
 * Monthly internal rate of return solving:
 *   netDisbursed = Σ installment_k / (1 + r)^k
 * NPV(r) is monotonically decreasing in r, so a bisection on [0, hi] converges.
 * Returns the monthly rate (fraction), or 0 when the cash flows are degenerate.
 */
export function monthlyIrr(netDisbursed: number, installments: number[]): number {
  const total = installments.reduce((a, b) => a + b, 0);
  if (netDisbursed <= 0 || installments.length === 0 || total <= netDisbursed) {
    return 0; // no positive cost (or free/degenerate) → 0% periodic
  }

  const npv = (r: number): number =>
    installments.reduce((acc, amt, i) => acc + amt / Math.pow(1 + r, i + 1), 0) - netDisbursed;

  let lo = 0;
  let hi = 1; // 100% per month upper bound; expand if needed
  while (npv(hi) > 0 && hi < 100) hi *= 2;

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const v = npv(mid);
    if (Math.abs(v) < 1e-7) return mid;
    if (v > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Effective annual interest rate (EIR / APR) as a percentage. */
export function computeEir(netDisbursed: number, installments: number[]): number {
  const r = monthlyIrr(netDisbursed, installments);
  const annual = Math.pow(1 + r, 12) - 1;
  return round(annual * 100, 2);
}

export function buildKeyFacts(input: KeyFactsInput): KeyFacts {
  const totalFees = round((input.processingFee || 0) + (input.adminFee || 0), 2);
  const netDisbursed = input.netDisbursed ?? round(input.principal - totalFees, 2);
  const totalRepayable = round(input.installments.reduce((a, b) => a + b, 0), 2);
  const totalInterest = round(totalRepayable - input.principal, 2);
  const eir = computeEir(netDisbursed, input.installments);

  return {
    currency: input.currency || 'USD',
    principal: round(input.principal, 2),
    netDisbursed: round(netDisbursed, 2),
    nominalAnnualRate: round(input.nominalAnnualRate, 2),
    effectiveAnnualRate: eir,
    totalPrincipal: round(input.principal, 2),
    totalInterest,
    totalFees,
    totalRepayable,
    totalCostOfCredit: round(totalInterest + totalFees, 2),
    installmentCount: input.installments.length,
    averageInstallment: input.installments.length ? round(totalRepayable / input.installments.length, 2) : 0,
    firstInstallment: input.installments.length ? round(input.installments[0], 2) : 0,
  };
}
