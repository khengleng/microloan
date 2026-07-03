// ── Risk Batch #7: Internal credit scorecard + decisioning ──────────────────
// A transparent, rules-based scorecard (0–100) with an explainable factor
// breakdown. Deliberately deterministic so decisions are auditable and can be
// defended to a regulator — no opaque ML. Feeds risk-based pricing.

export type Decision = 'APPROVE' | 'REFER' | 'DECLINE';

export interface ScorecardInput {
  bureauGrade?: string | null; // CreditCheck.grade (A..E / EXCELLENT..)
  hasCreditCheck: boolean;
  requireCreditCheck: boolean;
  monthlyIncome?: number | null;
  monthlyExpenses?: number | null;
  installmentAmount: number; // this loan's periodic installment
  onTimeInstallments: number; // borrower's prior on-time installments
  lateInstallments: number; // borrower's prior late installments
  priorDefaults: number; // prior defaulted/written-off loans
  kycStatus: string; // PENDING | VERIFIED | REJECTED
  collateralValue: number;
  principal: number;
  guarantorCount: number;
}

export interface ScoreFactor {
  key: string;
  label: string;
  points: number;
  max: number;
  detail: string;
}

export interface ScorecardResult {
  score: number; // 0..100
  grade: string; // A..E
  decision: Decision;
  dsr: number | null; // debt-service ratio (0..1+), null if income unknown
  factors: ScoreFactor[];
  reasons: string[]; // hard override reasons, if any
}

function bureauPoints(grade?: string | null): number {
  const g = (grade || '').toUpperCase();
  if (['A', 'EXCELLENT', 'AA'].includes(g)) return 30;
  if (['B', 'GOOD'].includes(g)) return 24;
  if (['C', 'FAIR'].includes(g)) return 15;
  if (['D', 'POOR'].includes(g)) return 8;
  if (['E', 'BAD'].includes(g)) return 3;
  return 5; // unknown grade but a check exists
}

export function computeScorecard(input: ScorecardInput): ScorecardResult {
  const factors: ScoreFactor[] = [];
  const reasons: string[] = [];

  // 1. Credit bureau (30)
  const bureau = input.hasCreditCheck ? bureauPoints(input.bureauGrade) : 0;
  factors.push({
    key: 'bureau', label: 'Credit bureau', points: bureau, max: 30,
    detail: input.hasCreditCheck ? `Grade ${input.bureauGrade || 'n/a'}` : 'No credit check on file',
  });

  // 2. Affordability / DSR (25)
  const disposable =
    input.monthlyIncome != null
      ? Math.max(0, input.monthlyIncome - (input.monthlyExpenses || 0))
      : null;
  let dsr: number | null = null;
  let dsrPoints = 0;
  if (disposable != null && disposable > 0) {
    dsr = input.installmentAmount / disposable;
    if (dsr <= 0.3) dsrPoints = 25;
    else if (dsr <= 0.4) dsrPoints = 20;
    else if (dsr <= 0.5) dsrPoints = 12;
    else if (dsr <= 0.6) dsrPoints = 6;
    else dsrPoints = 0;
  }
  factors.push({
    key: 'affordability', label: 'Affordability (DSR)', points: dsrPoints, max: 25,
    detail: dsr != null ? `DSR ${(dsr * 100).toFixed(0)}%` : 'Income not captured',
  });

  // 3. Repayment history (20)
  const totalHist = input.onTimeInstallments + input.lateInstallments;
  let histPoints: number;
  if (totalHist === 0) {
    histPoints = 10; // no history — neutral
  } else {
    const onTimeRatio = input.onTimeInstallments / totalHist;
    histPoints = Math.round(onTimeRatio * 20);
  }
  histPoints = Math.max(0, histPoints - input.priorDefaults * 8);
  factors.push({
    key: 'history', label: 'Repayment history', points: histPoints, max: 20,
    detail: totalHist === 0 ? 'No prior installments' : `${input.onTimeInstallments}/${totalHist} on time, ${input.priorDefaults} default(s)`,
  });

  // 4. KYC (10)
  const kycPoints = input.kycStatus === 'VERIFIED' ? 10 : input.kycStatus === 'PENDING' ? 4 : 0;
  factors.push({ key: 'kyc', label: 'Identity (KYC)', points: kycPoints, max: 10, detail: input.kycStatus });

  // 5. Collateral coverage (10)
  const coverage = input.principal > 0 ? input.collateralValue / input.principal : 0;
  const colPoints = coverage >= 1 ? 10 : coverage >= 0.5 ? 6 : coverage > 0 ? 3 : 0;
  factors.push({
    key: 'collateral', label: 'Collateral coverage', points: colPoints, max: 10,
    detail: `${(coverage * 100).toFixed(0)}% of principal`,
  });

  // 6. Guarantors (5)
  const guaPoints = input.guarantorCount >= 1 ? 5 : 0;
  factors.push({ key: 'guarantors', label: 'Guarantors', points: guaPoints, max: 5, detail: `${input.guarantorCount}` });

  const score = factors.reduce((a, f) => a + f.points, 0);

  const grade = score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'E';

  // Decision with hard overrides.
  let decision: Decision = score >= 65 ? 'APPROVE' : score >= 45 ? 'REFER' : 'DECLINE';
  if (input.kycStatus === 'REJECTED') { decision = 'DECLINE'; reasons.push('KYC rejected'); }
  if (dsr != null && dsr > 0.6) { decision = 'DECLINE'; reasons.push('Debt-service ratio above 60%'); }
  if (input.requireCreditCheck && !input.hasCreditCheck) {
    if (decision === 'APPROVE') decision = 'REFER';
    reasons.push('Credit check required before approval');
  }

  return { score, grade, decision, dsr, factors, reasons };
}
