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
  DOWN_PAYMENTS_HELD: '2600',
  // Year-end close: the year's income and expense are carried here (OPS-6)
  RETAINED_EARNINGS: '3100',
  // Opening balances of loans taken over from another system
  MIGRATION_CLEARING: '3900',
  SET_OFF_CLEARING: '2700',
  RECOVERY_INCOME: '4300',
  ROUNDING_DIFFERENCES: '4900',
  // Restructuring concessions
  PRINCIPAL_FORGIVEN: '5110',
  RESTRUCTURE_CONCESSIONS: '5200',
  // Recovery workflows (UC-06, UC-65, UC-66, UC-68, UC-71)
  INSURANCE_CLAIMS_RECEIVABLE: '1410',
  INSURER_PAYABLE: '2610',
  BORROWER_REFUNDS_PAYABLE: '2710',
  DEBT_SALE_GAIN: '4400',
  RECOVERY_COSTS: '5300',
  DEBT_SALE_LOSS: '5400',
  // Payment channels: money received in a currency other than the loan's (UC-21)
  FX_POSITION: '1050',
  FX_GAIN_LOSS: '4410',
  // Trade finance and syndication
  INVOICE_RESERVES_PAYABLE: '2310',
  PARTICIPANTS_PAYABLE: '2320',
  PARTICIPANT_FUNDING: '2330',
  PARTICIPANT_SHARE_EXPENSE: '5310',
  LC_CONTINGENT_ASSET: '9100',
  LC_CONTINGENT_LIABILITY: '9200',
  // Specialised products: BNPL merchant settlement (LT-11, UC-52)
  MERCHANT_CLAWBACK_RECEIVABLE: '1240',
  MERCHANT_DISCOUNT_INCOME: '4500',
  // Credit cards (LT-07, UC-40)
  CARD_CASH_ADVANCE_FEE_INCOME: '4520',
  // Leases / Ijarah (LT-15): the lessor's asset, rentals and charity
  IJARAH_ASSETS: '1250',
  IJARAH_RENTALS_RECEIVABLE: '1255',
  RETURNED_LEASE_ASSETS: '1260',
  IJARAH_RENTAL_INCOME: '4510',
  LATE_PAYMENT_CHARITY_PAYABLE: '2800',
  // Project finance (LT-17): reserve, lock-up and receipts in the waterfall
  PROJECT_DSRA_HELD: '2410',
  PROJECT_LOCK_UP_HELD: '2420',
  PROJECT_PROCEEDS_CLEARING: '2430',
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
    code: ACCOUNT_CODES.RETAINED_EARNINGS,
    name: 'Retained Earnings',
    type: LedgerAccountType.EQUITY,
  },
  {
    code: ACCOUNT_CODES.MIGRATION_CLEARING,
    name: 'Loan Migration Clearing (opening balances)',
    type: LedgerAccountType.EQUITY,
  },
  {
    code: ACCOUNT_CODES.DOWN_PAYMENTS_HELD,
    name: 'Down Payments Held (for sellers)',
    type: LedgerAccountType.LIABILITY,
  },
  {
    code: ACCOUNT_CODES.SET_OFF_CLEARING,
    name: 'Customer Deposits — Set-off Clearing',
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
    code: ACCOUNT_CODES.INSURANCE_CLAIMS_RECEIVABLE,
    name: 'Insurance Claims Receivable',
    type: LedgerAccountType.ASSET,
  },
  {
    code: ACCOUNT_CODES.INSURER_PAYABLE,
    name: 'Insurance Premiums Payable to Insurers',
    type: LedgerAccountType.LIABILITY,
  },
  {
    code: ACCOUNT_CODES.BORROWER_REFUNDS_PAYABLE,
    name: 'Recovery Surplus Payable to Borrowers',
    type: LedgerAccountType.LIABILITY,
  },
  {
    code: ACCOUNT_CODES.DEBT_SALE_GAIN,
    name: 'Gain on Sale of Loans',
    type: LedgerAccountType.INCOME,
  },
  {
    code: ACCOUNT_CODES.RECOVERY_COSTS,
    name: 'Unrecovered Repossession and Sale Costs',
    type: LedgerAccountType.EXPENSE,
  },
  {
    code: ACCOUNT_CODES.DEBT_SALE_LOSS,
    name: 'Loss on Sale of Loans',
    type: LedgerAccountType.EXPENSE,
  },
  // Each currency's leg of a cross-currency payment passes through here, so
  // every journal balances in its own currency.
  {
    code: ACCOUNT_CODES.FX_POSITION,
    name: 'Foreign Currency Position',
    type: LedgerAccountType.ASSET,
  },
  {
    code: ACCOUNT_CODES.FX_GAIN_LOSS,
    name: 'Foreign Exchange Gain / Loss',
    type: LedgerAccountType.INCOME,
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
  {
    code: ACCOUNT_CODES.MERCHANT_CLAWBACK_RECEIVABLE,
    name: 'Merchant Refund Clawbacks Receivable',
    type: LedgerAccountType.ASSET,
  },
  {
    code: ACCOUNT_CODES.MERCHANT_DISCOUNT_INCOME,
    name: 'Merchant Discount Income',
    type: LedgerAccountType.INCOME,
  },
  {
    code: ACCOUNT_CODES.CARD_CASH_ADVANCE_FEE_INCOME,
    name: 'Card Cash Advance Fee Income',
    type: LedgerAccountType.INCOME,
  },
  // A lease is not a loan: the asset the lessor owns, the rentals it is owed
  // and the rental income it earns sit on their own accounts.
  {
    code: ACCOUNT_CODES.IJARAH_ASSETS,
    name: 'Ijarah / Leased Assets (Net Investment)',
    type: LedgerAccountType.ASSET,
  },
  {
    code: ACCOUNT_CODES.IJARAH_RENTALS_RECEIVABLE,
    name: 'Ijarah Rentals Receivable',
    type: LedgerAccountType.ASSET,
  },
  {
    code: ACCOUNT_CODES.RETURNED_LEASE_ASSETS,
    name: 'Returned Lease Assets Held for Sale',
    type: LedgerAccountType.ASSET,
  },
  {
    code: ACCOUNT_CODES.IJARAH_RENTAL_INCOME,
    name: 'Ijarah Rental Income',
    type: LedgerAccountType.INCOME,
  },
  {
    code: ACCOUNT_CODES.LATE_PAYMENT_CHARITY_PAYABLE,
    name: 'Late Payment Charges Payable to Charity',
    type: LedgerAccountType.LIABILITY,
  },
  {
    code: ACCOUNT_CODES.PROJECT_DSRA_HELD,
    name: 'Project Debt Service Reserve Held',
    type: LedgerAccountType.LIABILITY,
  },
  {
    code: ACCOUNT_CODES.PROJECT_LOCK_UP_HELD,
    name: 'Project Distributions Held in Lock-up',
    type: LedgerAccountType.LIABILITY,
  },
  {
    code: ACCOUNT_CODES.PROJECT_PROCEEDS_CLEARING,
    name: 'Project Receipts Clearing (waterfall)',
    type: LedgerAccountType.LIABILITY,
  },
];
