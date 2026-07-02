-- Feature #1 (dual-currency + NBC rate cap) and Feature #3 (GL, provisioning, CBC)

-- ── Enums ───────────────────────────────────────────────────────────────────
CREATE TYPE "Currency" AS ENUM ('USD', 'KHR');
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');
CREATE TYPE "JournalSource" AS ENUM ('DISBURSEMENT', 'REPAYMENT', 'PENALTY', 'PROVISION', 'WRITEOFF', 'MANUAL');
CREATE TYPE "LoanClassification" AS ENUM ('STANDARD', 'SPECIAL_MENTION', 'SUBSTANDARD', 'DOUBTFUL', 'LOSS');
CREATE TYPE "CreditCheckStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- ── Feature #1: currency + rate cap on existing tables ──────────────────────
ALTER TABLE "Tenant" ADD COLUMN "baseCurrency" "Currency" NOT NULL DEFAULT 'USD';
ALTER TABLE "Tenant" ADD COLUMN "maxAnnualInterestRatePct" DECIMAL(5,2) NOT NULL DEFAULT 18.00;
ALTER TABLE "Tenant" ADD COLUMN "requireCreditCheckForApproval" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Tenant" ADD COLUMN "creditCheckValidityDays" INTEGER NOT NULL DEFAULT 90;

ALTER TABLE "LoanProduct" ADD COLUMN "currency" "Currency" NOT NULL DEFAULT 'USD';

ALTER TABLE "Loan" ADD COLUMN "currency" "Currency" NOT NULL DEFAULT 'USD';
ALTER TABLE "Loan" ADD COLUMN "fxRateToBase" DECIMAL(18,8);

ALTER TABLE "Repayment" ADD COLUMN "currency" "Currency" NOT NULL DEFAULT 'USD';

-- ── Feature #1: exchange rates ──────────────────────────────────────────────
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fromCurrency" "Currency" NOT NULL,
    "toCurrency" "Currency" NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ExchangeRate_tenantId_fromCurrency_toCurrency_effectiveDate_idx"
    ON "ExchangeRate"("tenantId", "fromCurrency", "toCurrency", "effectiveDate");
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Feature #3: General Ledger ──────────────────────────────────────────────
CREATE TABLE "LedgerAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LedgerAccount_tenantId_code_key" ON "LedgerAccount"("tenantId", "code");
CREATE INDEX "LedgerAccount_tenantId_idx" ON "LedgerAccount"("tenantId");
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "JournalSource" NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "description" TEXT NOT NULL,
    "loanId" TEXT,
    "referenceId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "JournalEntry_tenantId_date_idx" ON "JournalEntry"("tenantId", "date");
CREATE INDEX "JournalEntry_tenantId_source_idx" ON "JournalEntry"("tenantId", "source");
CREATE INDEX "JournalEntry_loanId_idx" ON "JournalEntry"("loanId");
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_loanId_fkey"
    FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "JournalLine_entryId_idx" ON "JournalLine"("entryId");
CREATE INDEX "JournalLine_accountId_idx" ON "JournalLine"("accountId");
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey"
    FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Feature #3: Provisioning ────────────────────────────────────────────────
CREATE TABLE "ProvisionRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalProvision" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "loanCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProvisionRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProvisionRun_tenantId_runDate_idx" ON "ProvisionRun"("tenantId", "runDate");
ALTER TABLE "ProvisionRun" ADD CONSTRAINT "ProvisionRun_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LoanProvision" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "daysOverdue" INTEGER NOT NULL,
    "classification" "LoanClassification" NOT NULL,
    "outstandingPrincipal" DECIMAL(18,2) NOT NULL,
    "provisionRate" DECIMAL(6,4) NOT NULL,
    "provisionAmount" DECIMAL(18,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    CONSTRAINT "LoanProvision_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LoanProvision_runId_idx" ON "LoanProvision"("runId");
CREATE INDEX "LoanProvision_loanId_idx" ON "LoanProvision"("loanId");
ALTER TABLE "LoanProvision" ADD CONSTRAINT "LoanProvision_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "ProvisionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoanProvision" ADD CONSTRAINT "LoanProvision_loanId_fkey"
    FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Feature #3: Credit Bureau Cambodia (CBC) ────────────────────────────────
CREATE TABLE "CreditCheck" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'CBC',
    "status" "CreditCheckStatus" NOT NULL DEFAULT 'PENDING',
    "score" INTEGER,
    "grade" TEXT,
    "reportRef" TEXT,
    "summary" TEXT,
    "requestedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "CreditCheck_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CreditCheck_tenantId_borrowerId_idx" ON "CreditCheck"("tenantId", "borrowerId");
ALTER TABLE "CreditCheck" ADD CONSTRAINT "CreditCheck_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditCheck" ADD CONSTRAINT "CreditCheck_borrowerId_fkey"
    FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE CASCADE ON UPDATE CASCADE;
