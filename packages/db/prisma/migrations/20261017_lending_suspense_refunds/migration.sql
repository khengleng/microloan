-- AlterTable
ALTER TABLE "FinancialEvent" ALTER COLUMN "loanAccountId" DROP NOT NULL,
ALTER COLUMN "productVersionId" DROP NOT NULL,
ALTER COLUMN "agreementVersion" DROP NOT NULL;

-- AlterTable
ALTER TABLE "LendingJournalEntry" ALTER COLUMN "loanAccountId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "LendingJournalLine" ALTER COLUMN "loanAccountId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "UnidentifiedPayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "remaining" DECIMAL(24,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "valueDate" DATE NOT NULL,
    "channel" TEXT NOT NULL,
    "externalReference" TEXT NOT NULL,
    "payerName" TEXT,
    "narrative" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "receiptEventId" TEXT NOT NULL,
    "receivedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnidentifiedPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnidentifiedPaymentMatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "loanAccountId" TEXT,
    "financialEventId" TEXT NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnidentifiedPaymentMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UnidentifiedPayment_receiptEventId_key" ON "UnidentifiedPayment"("receiptEventId");

-- CreateIndex
CREATE INDEX "UnidentifiedPayment_tenantId_status_valueDate_idx" ON "UnidentifiedPayment"("tenantId", "status", "valueDate");

-- CreateIndex
CREATE UNIQUE INDEX "UnidentifiedPayment_tenantId_reference_key" ON "UnidentifiedPayment"("tenantId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "UnidentifiedPayment_tenantId_id_key" ON "UnidentifiedPayment"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "UnidentifiedPaymentMatch_financialEventId_key" ON "UnidentifiedPaymentMatch"("financialEventId");

-- CreateIndex
CREATE INDEX "UnidentifiedPaymentMatch_tenantId_paymentId_idx" ON "UnidentifiedPaymentMatch"("tenantId", "paymentId");

-- AddForeignKey
ALTER TABLE "UnidentifiedPayment" ADD CONSTRAINT "UnidentifiedPayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnidentifiedPaymentMatch" ADD CONSTRAINT "UnidentifiedPaymentMatch_tenantId_paymentId_fkey" FOREIGN KEY ("tenantId", "paymentId") REFERENCES "UnidentifiedPayment"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for unidentified payments and refunds.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "UnidentifiedPayment" ADD CONSTRAINT "UnidentifiedPayment_status_check"
  CHECK ("status" IN ('OPEN', 'MATCHED', 'REFUNDED'));
ALTER TABLE "UnidentifiedPayment" ADD CONSTRAINT "UnidentifiedPayment_amounts_check"
  CHECK ("amount" > 0 AND "remaining" >= 0 AND "remaining" <= "amount");
ALTER TABLE "UnidentifiedPaymentMatch" ADD CONSTRAINT "UnidentifiedPaymentMatch_kind_check"
  CHECK ("kind" IN ('MATCH', 'REFUND') AND "amount" > 0
         AND (("kind" = 'MATCH') = ("loanAccountId" IS NOT NULL)));
-- A loan's money movements always name the loan; only receipts into and
-- refunds out of suspense are tenant-level.
ALTER TABLE "FinancialEvent" ADD CONSTRAINT "FinancialEvent_tenant_level_check"
  CHECK ("loanAccountId" IS NOT NULL OR "type" IN ('SUSPENSE_RECEIPT', 'SUSPENSE_REFUND', 'REVERSAL'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['UnidentifiedPayment','UnidentifiedPaymentMatch']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true)) '
      || 'WITH CHECK (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true))',
      t || '_tenant_isolation', t);
  END LOOP;
END $$;
