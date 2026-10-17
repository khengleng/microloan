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
  // Lending platform (accrual accounting)
  INTEREST_RECEIVABLE: '1210',
  FEES_RECEIVABLE: '1220',
  PENALTY_RECEIVABLE: '1230',
  TAX_PAYABLE: '2200',
  CUSTOMER_ADVANCES: '2300',
  INTEREST_SUSPENSE: '2400',
  UNIDENTIFIED_SUSPENSE: '2500',
  RECOVERY_INCOME: '4300',
  ROUNDING_DIFFERENCES: '4900',
  // Restructuring concessions
  PRINCIPAL_FORGIVEN: '5110',
  RESTRUCTURE_CONCESSIONS: '5200',
  // Trade finance and syndication
  INVOICE_RESERVES_PAYABLE: '2310',
  PARTICIPANTS_PAYABLE: '2320',
  PARTICIPANT_FUNDING: '2330',
  PARTICIPANT_SHARE_EXPENSE: '5300',
  LC_CONTINGENT_ASSET: '9100',
  LC_CONTINGENT_LIABILITY: '9200',
} as const;

export const DEFAULT_CHART_OF_ACCOUNTS: DefaultAccount[] = [
  {
    code: ACCOUNT_CODES.CASH,
    name: 'Cash / Bank',
    type: LedgerAccountType.ASSET,
  },
  {
    code: ACCOUNT_CODES.LOANS_RECEIVABLE,
    name: 'Loans Receivable',
    type: LedgerAccountType.ASSET,
  },
  {
    code: ACCOUNT_CODES.ALLOWANCE_FOR_LOAN_LOSSES,
    name: 'Allowance for Loan Losses',
    type: LedgerAccountType.ASSET,
  },
  {
    code: ACCOUNT_CODES.INTEREST_INCOME,
    name: 'Interest Income',
    type: LedgerAccountType.INCOME,
  },
  {
    code: ACCOUNT_CODES.PENALTY_INCOME,
    name: 'Penalty Income',
    type: LedgerAccountType.INCOME,
  },
  {
    code: ACCOUNT_CODES.FEE_INCOME,
    name: 'Fee Income',
    type: LedgerAccountType.INCOME,
  },
  {
    code: ACCOUNT_CODES.PROVISION_EXPENSE,
    name: 'Loan Loss Provision Expense',
    type: LedgerAccountType.EXPENSE,
  },
  {
    code: ACCOUNT_CODES.WRITE_OFF_EXPENSE,
    name: 'Loans Written Off',
    type: LedgerAccountType.EXPENSE,
  },
  {
    code: ACCOUNT_CODES.INTEREST_RECEIVABLE,
    name: 'Accrued Interest Receivable',
    type: LedgerAccountType.ASSET,
  },
  {
    code: ACCOUNT_CODES.FEES_RECEIVABLE,
    name: 'Fees Receivable',
    type: LedgerAccountType.ASSET,
  },
  {
    code: ACCOUNT_CODES.PENALTY_RECEIVABLE,
    name: 'Penalties Receivable',
    type: LedgerAccountType.ASSET,
  },
  {
    code: ACCOUNT_CODES.TAX_PAYABLE,
    name: 'Tax Payable',
    type: LedgerAccountType.LIABILITY,
  },
  {
    code: ACCOUNT_CODES.CUSTOMER_ADVANCES,
    name: 'Customer Advances (paid before due)',
    type: LedgerAccountType.LIABILITY,
  },
  // Contra to accrued interest receivable, like the allowance: interest accrued on
  // non-accrual loans that has not been recognised as income.
  {
    code: ACCOUNT_CODES.INTEREST_SUSPENSE,
    name: 'Interest in Suspense (non-accrual)',
    type: LedgerAccountType.ASSET,
  },
  {
    code: ACCOUNT_CODES.UNIDENTIFIED_SUSPENSE,
    name: 'Unidentified Payments (suspense)',
    type: LedgerAccountType.LIABILITY,
  },
  {
    code: ACCOUNT_CODES.RECOVERY_INCOME,
    name: 'Recoveries on Written-Off Loans',
    type: LedgerAccountType.INCOME,
  },
  {
    code: ACCOUNT_CODES.ROUNDING_DIFFERENCES,
    name: 'Rounding Differences',
    type: LedgerAccountType.INCOME,
  },
  {
    code: ACCOUNT_CODES.PRINCIPAL_FORGIVEN,
    name: 'Principal Forgiven (Restructuring)',
    type: LedgerAccountType.EXPENSE,
  },
  {
    code: ACCOUNT_CODES.RESTRUCTURE_CONCESSIONS,
    name: 'Restructure Concessions (Waivers)',
    type: LedgerAccountType.EXPENSE,
  },
  {
    code: ACCOUNT_CODES.INVOICE_RESERVES_PAYABLE,
    name: 'Invoice Reserves Payable to Borrowers',
    type: LedgerAccountType.LIABILITY,
  },
  {
    code: ACCOUNT_CODES.PARTICIPANTS_PAYABLE,
    name: 'Due to Syndicate Participants',
    type: LedgerAccountType.LIABILITY,
  },
  {
    code: ACCOUNT_CODES.PARTICIPANT_FUNDING,
    name: 'Syndicate Participant Funding',
    type: LedgerAccountType.LIABILITY,
  },
  {
    code: ACCOUNT_CODES.PARTICIPANT_SHARE_EXPENSE,
    name: "Participants' Share of Loan Income",
    type: LedgerAccountType.EXPENSE,
  },
  // Off-balance-sheet memo pair: always posted together, so they net to zero.
  {
    code: ACCOUNT_CODES.LC_CONTINGENT_ASSET,
    name: 'Letters of Credit: Customer Liability (memo)',
    type: LedgerAccountType.ASSET,
  },
  {
    code: ACCOUNT_CODES.LC_CONTINGENT_LIABILITY,
    name: 'Letters of Credit: Commitments Issued (memo)',
    type: LedgerAccountType.LIABILITY,
  },
];
