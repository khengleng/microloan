-- Compliance Batch #4: Key Facts Statement + e-signature (loan agreement)
CREATE TABLE "LoanAgreement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "keyFacts" JSONB NOT NULL,
    "agreementHash" TEXT NOT NULL,
    "signatureName" TEXT,
    "signatureImage" TEXT,
    "signerRole" TEXT NOT NULL,
    "signedByBorrowerId" TEXT,
    "signedByUserId" TEXT,
    "ipAddress" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanAgreement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoanAgreement_tenantId_loanId_idx" ON "LoanAgreement"("tenantId", "loanId");

ALTER TABLE "LoanAgreement" ADD CONSTRAINT "LoanAgreement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoanAgreement" ADD CONSTRAINT "LoanAgreement_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
