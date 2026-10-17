/** Shapes returned by the recovery endpoints (UC-65, UC-66, UC-68, UC-71). Money is always a decimal string. */

export interface Repossession {
    id: string; collateralId: string; status: 'PROPOSED' | 'SEIZED' | 'VALUED' | 'SOLD' | 'REJECTED';
    location: string; seizedOn: string; reason: string; taskId: string | null;
    valuationAmount: string | null; valuer: string | null; valuedOn: string | null;
    salePrice: string | null; saleCosts: string | null; buyer: string | null; soldOn: string | null;
    surplus: string | null; deficiency: string | null; proposedBy: string; approvedBy: string | null;
}

export interface PawnItem {
    id: string; description: string; itemType: 'GOLD' | 'JEWELLERY' | 'OTHER';
    weightGrams: string; karat: number | null; purity: string; pricePerGram: string; appraisedValue: string;
    custodyLocation: string; sealNumber: string | null; receivedOn: string; redemptionDeadline: string;
    status: 'IN_CUSTODY' | 'FORFEITED' | 'SOLD' | 'RETURNED';
    returnedOn: string | null; returnReference: string | null;
    salePrice: string | null; saleCosts: string | null; buyer: string | null; soldOn: string | null;
    surplus: string | null; deficiency: string | null; forfeitable?: boolean;
}

export interface InsuranceClaim {
    id: string; policyId: string; eventType: 'DEATH' | 'DISABILITY'; eventDate: string; evidenceReference: string;
    note: string; amountClaimed: string; status: 'PENDING' | 'SETTLED' | 'REJECTED'; received: string;
    surplus: string | null; deficiency: string | null;
}

export interface InsurancePolicy {
    id: string; insurer: string; policyNumber: string; coverType: 'DEATH' | 'DISABILITY' | 'DEATH_AND_DISABILITY';
    premium: string; premiumTreatment: 'FINANCED' | 'PAID'; premiumRemitted: string; premiumToRemit: string;
    currency: string; startDate: string; status: 'ACTIVE' | 'CLAIMED'; claims: InsuranceClaim[];
}

export interface DebtSale {
    id: string; buyer: string; price: string; saleDate: string; reason: string; status: 'PENDING' | 'EXECUTED' | 'REJECTED';
    carryingAmount: string | null; grossReceivable: string | null; gainLoss: string | null;
}

export interface RecoveryRefund {
    id: string; source: 'REPOSSESSION' | 'PAWN_AUCTION' | 'INSURANCE_CLAIM'; payee: string; amount: string; currency: string;
    status: 'PAYABLE' | 'PAID'; taskId: string | null; createdAt: string;
}

export interface RecoveryTask {
    id: string; action: RecoveryTaskKind; status: string; amount: string | null; currency: string | null;
    payload: Record<string, unknown>; makerId: string; createdAt: string;
}

export type RecoveryTaskKind = 'REPOSSESSION_SEIZURE' | 'PAWN_FORFEITURE' | 'PREMIUM_REMITTANCE' | 'INSURANCE_CLAIM' | 'DEBT_SALE' | 'RECOVERY_REFUND';

export interface LoanRecoveryView {
    businessDate: string;
    loan: { status: string; currency: string; daysPastDue: number; owed: string };
    rules: { repossessionMinDpd: number; proceedsOrder: string[]; pawnForfeitureGraceDays: number; debtSaleMinDpd: number };
    pledges: { collateralId: string; type: string; description: string; status: string }[];
    repossessions: Repossession[];
    pawnItems: PawnItem[];
    insurancePolicies: InsurancePolicy[];
    debtSales: DebtSale[];
    refunds: RecoveryRefund[];
    pendingTasks: RecoveryTask[];
}

export interface ProceedsResult {
    grossProceeds: string; costs: string; costsRecovered: string; unrecoveredCosts: string; netProceeds: string;
    applied: { component: string; amount: string }[]; totalApplied: string; surplus: string;
    deficiency: { component: string; amount: string }[]; deficiencyTotal: string; settlesLoan: boolean; explanation: string[];
}

type DeskLoan = { id: string; reference: string; status: string; currency: string; daysPastDue: number };

export interface RecoveryDeskView {
    businessDate: string;
    repossessions: (Repossession & { loanAccountId: string; loan: DeskLoan })[];
    pawnItems: (PawnItem & { loanAccountId: string; loan: DeskLoan; pastDeadline: boolean })[];
    claims: (InsuranceClaim & { loanAccountId: string; loan: DeskLoan })[];
    premiums: (InsurancePolicy & { loanAccountId: string; loan: DeskLoan })[];
    debtSales: (DebtSale & { loanAccountId: string; loan: DeskLoan })[];
    refunds: (RecoveryRefund & { loanAccountId: string; loan: DeskLoan })[];
    pendingTasks: (RecoveryTask & { subjectId: string; loan?: DeskLoan })[];
}

export const TASK_LABEL: Record<RecoveryTaskKind, string> = {
    REPOSSESSION_SEIZURE: 'Repossession — seizure',
    PAWN_FORFEITURE: 'Pawn forfeiture',
    PREMIUM_REMITTANCE: 'Premium remittance to insurer',
    INSURANCE_CLAIM: 'Insurance claim — settle loan',
    DEBT_SALE: 'Debt sale to collection agency',
    RECOVERY_REFUND: 'Surplus payout',
};

/** The action each task kind is decided under (for capability checks). */
export const TASK_ACTION: Record<RecoveryTaskKind, string> = {
    REPOSSESSION_SEIZURE: 'loan.repossession.approve',
    PAWN_FORFEITURE: 'loan.pawn.forfeit.approve',
    PREMIUM_REMITTANCE: 'loan.insurance.remit.approve',
    INSURANCE_CLAIM: 'loan.insurance.claim.approve',
    DEBT_SALE: 'loan.debt_sale.approve',
    RECOVERY_REFUND: 'loan.recovery_refund.approve',
};
