-- CX Batch #6: borrower self-service portal (OTP auth) + manual e-KYC documents
CREATE TABLE "BorrowerOtp" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BorrowerOtp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BorrowerOtp_phone_expiresAt_idx" ON "BorrowerOtp"("phone", "expiresAt");
CREATE INDEX "BorrowerOtp_borrowerId_idx" ON "BorrowerOtp"("borrowerId");

ALTER TABLE "BorrowerOtp" ADD CONSTRAINT "BorrowerOtp_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "KycDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "mimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KycDocument_tenantId_borrowerId_idx" ON "KycDocument"("tenantId", "borrowerId");

ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE CASCADE ON UPDATE CASCADE;
