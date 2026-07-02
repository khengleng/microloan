-- P1 #11: origination fees
ALTER TABLE "LoanProduct" ADD COLUMN "processingFeePct" DECIMAL(5,2);
ALTER TABLE "LoanProduct" ADD COLUMN "adminFee" DECIMAL(10,2);
ALTER TABLE "Loan" ADD COLUMN "feeCharged" DECIMAL(10,2) NOT NULL DEFAULT 0;
