import { LedgerAccountType } from '@microloan/db';

// Default chart of accounts provisioned for every tenant. Codes are stable
// identifiers referenced by the automated posting rules; do not renumber.
export interface DefaultAccount {
    code: string;
    name: string;
    type: LedgerAccountType;
}

export const ACCOUNT_CODES = {
    CASH: '1000',
    LOANS_RECEIVABLE: '1200',
    ALLOWANCE_FOR_LOAN_LOSSES: '1300',
    INTEREST_INCOME: '4000',
    PENALTY_INCOME: '4100',
    FEE_INCOME: '4200',
    PROVISION_EXPENSE: '5000',
    WRITE_OFF_EXPENSE: '5100',
} as const;

export const DEFAULT_CHART_OF_ACCOUNTS: DefaultAccount[] = [
    { code: ACCOUNT_CODES.CASH, name: 'Cash / Bank', type: LedgerAccountType.ASSET },
    { code: ACCOUNT_CODES.LOANS_RECEIVABLE, name: 'Loans Receivable', type: LedgerAccountType.ASSET },
    { code: ACCOUNT_CODES.ALLOWANCE_FOR_LOAN_LOSSES, name: 'Allowance for Loan Losses', type: LedgerAccountType.ASSET },
    { code: ACCOUNT_CODES.INTEREST_INCOME, name: 'Interest Income', type: LedgerAccountType.INCOME },
    { code: ACCOUNT_CODES.PENALTY_INCOME, name: 'Penalty Income', type: LedgerAccountType.INCOME },
    { code: ACCOUNT_CODES.FEE_INCOME, name: 'Fee Income', type: LedgerAccountType.INCOME },
    { code: ACCOUNT_CODES.PROVISION_EXPENSE, name: 'Loan Loss Provision Expense', type: LedgerAccountType.EXPENSE },
    { code: ACCOUNT_CODES.WRITE_OFF_EXPENSE, name: 'Loans Written Off', type: LedgerAccountType.EXPENSE },
];
