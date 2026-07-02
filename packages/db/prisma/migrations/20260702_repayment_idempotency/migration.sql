-- P0 #2: repayment idempotency key (prevents double-posting on retry)
ALTER TABLE "Repayment" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "Repayment_tenantId_idempotencyKey_key" ON "Repayment"("tenantId", "idempotencyKey");
