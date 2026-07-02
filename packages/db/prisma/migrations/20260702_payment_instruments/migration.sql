-- Payments Batch P1: static-QR payment rail (display-only)
CREATE TABLE "PaymentInstrument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "label" TEXT NOT NULL,
    "bankName" TEXT,
    "accountName" TEXT,
    "accountNumber" TEXT,
    "qrPayload" TEXT,
    "qrImage" TEXT,
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentInstrument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PaymentInstrument_tenantId_branchId_idx" ON "PaymentInstrument"("tenantId", "branchId");

ALTER TABLE "PaymentInstrument" ADD CONSTRAINT "PaymentInstrument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentInstrument" ADD CONSTRAINT "PaymentInstrument_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
