-- P1 #9: loan write-off support
ALTER TYPE "LoanStatus" ADD VALUE IF NOT EXISTS 'WRITTEN_OFF';
ALTER TABLE "Loan" ADD COLUMN "writtenOffAt" TIMESTAMP(3);
ALTER TABLE "Loan" ADD COLUMN "writtenOffByUserId" TEXT;
ALTER TABLE "Loan" ADD COLUMN "writeOffReason" TEXT;
