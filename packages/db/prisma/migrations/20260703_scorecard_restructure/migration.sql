-- Risk Batch #7: scorecard, affordability inputs, restructuring
ALTER TABLE "Borrower" ADD COLUMN "monthlyIncome" DECIMAL(12,2);
ALTER TABLE "Borrower" ADD COLUMN "monthlyExpenses" DECIMAL(12,2);

ALTER TABLE "Loan" ADD COLUMN "isRestructured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Loan" ADD COLUMN "restructuredAt" TIMESTAMP(3);
ALTER TABLE "Loan" ADD COLUMN "restructureCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "CreditScore" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "grade" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "dsr" DECIMAL(6,4),
    "recommendedRate" DECIMAL(5,2),
    "factors" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditScore_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CreditScore_tenantId_loanId_idx" ON "CreditScore"("tenantId", "loanId");
ALTER TABLE "CreditScore" ADD CONSTRAINT "CreditScore_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "LoanRestructure" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "oldTermMonths" INTEGER NOT NULL,
    "oldAnnualInterestRate" DECIMAL(5,2) NOT NULL,
    "oldOutstanding" DECIMAL(12,2) NOT NULL,
    "newTermMonths" INTEGER NOT NULL,
    "newAnnualInterestRate" DECIMAL(5,2) NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanRestructure_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LoanRestructure_tenantId_loanId_idx" ON "LoanRestructure"("tenantId", "loanId");
ALTER TABLE "LoanRestructure" ADD CONSTRAINT "LoanRestructure_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
