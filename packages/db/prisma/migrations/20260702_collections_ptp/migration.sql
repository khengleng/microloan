-- P1 #10: collections — promise-to-pay
CREATE TYPE "PtpStatus" AS ENUM ('PENDING', 'KEPT', 'BROKEN');
CREATE TABLE "PromiseToPay" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "promisedDate" TIMESTAMP(3) NOT NULL,
    "status" "PtpStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PromiseToPay_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PromiseToPay_tenantId_loanId_idx" ON "PromiseToPay"("tenantId", "loanId");
CREATE INDEX "PromiseToPay_tenantId_status_promisedDate_idx" ON "PromiseToPay"("tenantId", "status", "promisedDate");
ALTER TABLE "PromiseToPay" ADD CONSTRAINT "PromiseToPay_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PromiseToPay" ADD CONSTRAINT "PromiseToPay_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
