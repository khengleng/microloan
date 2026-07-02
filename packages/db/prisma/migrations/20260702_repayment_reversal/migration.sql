-- P1 #13: repayment reversal audit trail
ALTER TABLE "Repayment" ADD COLUMN "reversedAt" TIMESTAMP(3);
ALTER TABLE "Repayment" ADD COLUMN "reversedByUserId" TEXT;
ALTER TABLE "Repayment" ADD COLUMN "reversalReason" TEXT;
