-- P0 #4: basic KYC capture + manual KYC/AML status
CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');
CREATE TYPE "AmlStatus" AS ENUM ('NOT_SCREENED', 'CLEAR', 'FLAGGED');
ALTER TABLE "Borrower" ADD COLUMN "dateOfBirth" TIMESTAMP(3);
ALTER TABLE "Borrower" ADD COLUMN "idType" TEXT;
ALTER TABLE "Borrower" ADD COLUMN "occupation" TEXT;
ALTER TABLE "Borrower" ADD COLUMN "kycStatus" "KycStatus" NOT NULL DEFAULT 'PENDING';
ALTER TABLE "Borrower" ADD COLUMN "kycVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Borrower" ADD COLUMN "kycVerifiedByUserId" TEXT;
ALTER TABLE "Borrower" ADD COLUMN "amlStatus" "AmlStatus" NOT NULL DEFAULT 'NOT_SCREENED';
