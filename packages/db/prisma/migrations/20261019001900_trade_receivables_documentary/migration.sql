-- CreateTable
CREATE TABLE "TradeReceivable" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "recourse" TEXT NOT NULL,
    "recourseCap" DECIMAL(24,4),
    "serviceFeeRate" DECIMAL(12,8) NOT NULL DEFAULT 0,
    "serviceFee" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "discountRate" DECIMAL(12,8) NOT NULL DEFAULT 0,
    "dayCountBasis" INTEGER NOT NULL DEFAULT 360,
    "discountMethod" TEXT NOT NULL DEFAULT 'STRAIGHT',
    "discountGraceDays" INTEGER NOT NULL DEFAULT 0,
    "discountDays" INTEGER NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "discountEarned" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "purchasePrice" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "supplierId" TEXT,
    "instrumentType" TEXT,
    "guarantorName" TEXT,
    "acknowledgementType" TEXT NOT NULL,
    "acknowledgementMethod" TEXT,
    "acknowledgementReference" TEXT,
    "acknowledgedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "defaultedAt" TIMESTAMP(3),
    "writtenOff" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "writeOffEventId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeReceivable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeSupplier" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "taxId" TEXT,
    "bankName" TEXT,
    "accountNumber" TEXT,
    "sublimit" DECIMAL(24,4),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "statusReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeTransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "counterpartyName" TEXT NOT NULL,
    "counterpartyCountry" TEXT,
    "goodsDescription" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "transactionValue" DECIMAL(24,4) NOT NULL,
    "cycleStartDate" DATE NOT NULL,
    "expectedProceedsDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "proceedsReceived" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "proceedsApplied" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "proceedsRemitted" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reference" TEXT,
    "description" TEXT,
    "receivedBy" TEXT,
    "receivedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeProceeds" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "applied" DECIMAL(24,4) NOT NULL,
    "remitted" DECIMAL(24,4) NOT NULL,
    "settled" BOOLEAN NOT NULL DEFAULT false,
    "payerName" TEXT NOT NULL,
    "externalReference" TEXT,
    "remitReference" TEXT,
    "valueDate" DATE NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeProceeds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TradeReceivable_writeOffEventId_key" ON "TradeReceivable"("writeOffEventId");

-- CreateIndex
CREATE INDEX "TradeReceivable_tenantId_facilityId_kind_idx" ON "TradeReceivable"("tenantId", "facilityId", "kind");

-- CreateIndex
CREATE INDEX "TradeReceivable_tenantId_supplierId_idx" ON "TradeReceivable"("tenantId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeReceivable_tenantId_id_key" ON "TradeReceivable"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TradeReceivable_tenantId_invoiceId_key" ON "TradeReceivable"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "TradeSupplier_tenantId_facilityId_status_idx" ON "TradeSupplier"("tenantId", "facilityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TradeSupplier_tenantId_id_key" ON "TradeSupplier"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TradeSupplier_tenantId_reference_key" ON "TradeSupplier"("tenantId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "TradeSupplier_tenantId_facilityId_nameKey_key" ON "TradeSupplier"("tenantId", "facilityId", "nameKey");

-- CreateIndex
CREATE INDEX "TradeTransaction_tenantId_status_idx" ON "TradeTransaction"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TradeTransaction_tenantId_id_key" ON "TradeTransaction"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TradeTransaction_tenantId_loanAccountId_key" ON "TradeTransaction"("tenantId", "loanAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeTransaction_tenantId_reference_key" ON "TradeTransaction"("tenantId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "TradeDocument_tenantId_id_key" ON "TradeDocument"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TradeDocument_tenantId_transactionId_code_key" ON "TradeDocument"("tenantId", "transactionId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "TradeProceeds_eventId_key" ON "TradeProceeds"("eventId");

-- CreateIndex
CREATE INDEX "TradeProceeds_tenantId_transactionId_idx" ON "TradeProceeds"("tenantId", "transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeProceeds_tenantId_id_key" ON "TradeProceeds"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "TradeReceivable" ADD CONSTRAINT "TradeReceivable_tenantId_invoiceId_fkey" FOREIGN KEY ("tenantId", "invoiceId") REFERENCES "TradeInvoice"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeReceivable" ADD CONSTRAINT "TradeReceivable_tenantId_supplierId_fkey" FOREIGN KEY ("tenantId", "supplierId") REFERENCES "TradeSupplier"("tenantId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeSupplier" ADD CONSTRAINT "TradeSupplier_tenantId_facilityId_fkey" FOREIGN KEY ("tenantId", "facilityId") REFERENCES "Facility"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeTransaction" ADD CONSTRAINT "TradeTransaction_tenantId_loanAccountId_fkey" FOREIGN KEY ("tenantId", "loanAccountId") REFERENCES "LoanAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeDocument" ADD CONSTRAINT "TradeDocument_tenantId_transactionId_fkey" FOREIGN KEY ("tenantId", "transactionId") REFERENCES "TradeTransaction"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeProceeds" ADD CONSTRAINT "TradeProceeds_tenantId_transactionId_fkey" FOREIGN KEY ("tenantId", "transactionId") REFERENCES "TradeTransaction"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;




-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for bought receivables and documentary trade loans.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Invoice register: a bought receivable can default and be written off ──
ALTER TABLE "TradeInvoice" DROP CONSTRAINT "TradeInvoice_status_check";
ALTER TABLE "TradeInvoice" ADD CONSTRAINT "TradeInvoice_status_check"
  CHECK ("status" IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'ADVANCE_REQUESTED', 'ADVANCE_APPROVED', 'FUNDED', 'RECOURSE', 'DEFAULTED', 'SETTLED', 'WRITTEN_OFF', 'CANCELLED'));
ALTER TABLE "TradeInvoice" DROP CONSTRAINT "TradeInvoice_funded_check";
ALTER TABLE "TradeInvoice" ADD CONSTRAINT "TradeInvoice_funded_check" CHECK (
  "status" NOT IN ('FUNDED', 'RECOURSE', 'DEFAULTED', 'SETTLED', 'WRITTEN_OFF') OR ("advanceEventId" IS NOT NULL AND "advanceDate" IS NOT NULL));

-- ── Bought receivables (factoring, supply chain, forfaiting) ──────────────
ALTER TABLE "TradeReceivable" ADD CONSTRAINT "TradeReceivable_kind_check" CHECK (
  "kind" IN ('FACTORING', 'SUPPLY_CHAIN', 'FORFAITING')
  AND "recourse" IN ('FULL', 'LIMITED', 'NONE')
  AND "acknowledgementType" IN ('DEBTOR_NOTICE', 'BUYER_APPROVAL', 'AVAL')
  AND "discountMethod" IN ('STRAIGHT', 'YIELD')
  AND "dayCountBasis" IN (360, 365)
  AND ("instrumentType" IS NULL OR "instrumentType" IN ('BILL_OF_EXCHANGE', 'PROMISSORY_NOTE'))
  -- Forfaiting is without recourse by definition.
  AND ("kind" <> 'FORFAITING' OR "recourse" = 'NONE'));
ALTER TABLE "TradeReceivable" ADD CONSTRAINT "TradeReceivable_amounts_check" CHECK (
  ("recourse" = 'LIMITED') = ("recourseCap" IS NOT NULL)
  AND ("recourseCap" IS NULL OR "recourseCap" > 0)
  AND "serviceFeeRate" >= 0 AND "serviceFee" >= 0
  AND "discountRate" >= 0 AND "discountRate" < 1 AND "discountGraceDays" >= 0 AND "discountDays" >= 0
  AND "discountAmount" >= 0 AND "discountEarned" >= 0 AND "discountEarned" <= "discountAmount"
  AND "purchasePrice" >= 0 AND "writtenOff" >= 0);
-- Money moved at purchase: the receivable's terms freeze with it.
CREATE OR REPLACE FUNCTION lending_trade_receivable_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."purchasePrice" = 0 OR lending_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'lending: bought receivable % cannot be deleted', OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."purchasePrice" > 0 AND (
       NEW.kind IS DISTINCT FROM OLD.kind OR
       NEW.recourse IS DISTINCT FROM OLD.recourse OR
       NEW."recourseCap" IS DISTINCT FROM OLD."recourseCap" OR
       NEW."serviceFee" IS DISTINCT FROM OLD."serviceFee" OR
       NEW."discountRate" IS DISTINCT FROM OLD."discountRate" OR
       NEW."discountAmount" IS DISTINCT FROM OLD."discountAmount" OR
       NEW."purchasePrice" IS DISTINCT FROM OLD."purchasePrice" OR
       NEW."supplierId" IS DISTINCT FROM OLD."supplierId" OR
       NEW."invoiceId" IS DISTINCT FROM OLD."invoiceId"
     ) THEN
    RAISE EXCEPTION 'lending: receivable % is bought; its terms are frozen', OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."discountEarned" < OLD."discountEarned" OR NEW."writtenOff" < OLD."writtenOff" THEN
    RAISE EXCEPTION 'lending: earned discount and write-offs on receivable % only grow', OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "TradeReceivable_guard" BEFORE UPDATE OR DELETE ON "TradeReceivable"
  FOR EACH ROW EXECUTE FUNCTION lending_trade_receivable_guard();

-- ── Supply-chain programme suppliers ──────────────────────────────────────
ALTER TABLE "TradeSupplier" ADD CONSTRAINT "TradeSupplier_check" CHECK (
  "status" IN ('PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED')
  AND ("sublimit" IS NULL OR "sublimit" > 0)
  -- Onboarding is maker-checker.
  AND ("approvedBy" IS NULL OR "approvedBy" <> "createdBy")
  AND ("status" <> 'ACTIVE' OR "approvedBy" IS NOT NULL));

-- ── Documentary trade loans ───────────────────────────────────────────────
ALTER TABLE "TradeTransaction" ADD CONSTRAINT "TradeTransaction_check" CHECK (
  "direction" IN ('IMPORT', 'EXPORT')
  AND "status" IN ('OPEN', 'FINANCED', 'SETTLED', 'CANCELLED')
  AND "transactionValue" > 0
  AND "expectedProceedsDate" >= "cycleStartDate"
  AND "proceedsReceived" >= 0 AND "proceedsApplied" >= 0 AND "proceedsRemitted" >= 0
  AND "proceedsApplied" + "proceedsRemitted" = "proceedsReceived");
ALTER TABLE "TradeDocument" ADD CONSTRAINT "TradeDocument_check" CHECK (
  "status" IN ('PENDING', 'RECEIVED', 'VERIFIED', 'REJECTED')
  AND ("status" = 'PENDING' OR "receivedBy" IS NOT NULL)
  -- The person who received a document never verifies it.
  AND ("status" <> 'VERIFIED' OR ("verifiedBy" IS NOT NULL AND "verifiedBy" <> "receivedBy")));
ALTER TABLE "TradeProceeds" ADD CONSTRAINT "TradeProceeds_check" CHECK (
  "amount" > 0 AND "applied" >= 0 AND "remitted" >= 0 AND "applied" + "remitted" = "amount");
CREATE TRIGGER "TradeProceeds_append_only"
  BEFORE UPDATE OR DELETE ON "TradeProceeds"
  FOR EACH ROW EXECUTE FUNCTION lending_append_only();

-- ── Tenant isolation ──────────────────────────────────────────────────────
ALTER TABLE "TradeReceivable" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TradeReceivable" FORCE ROW LEVEL SECURITY;
CREATE POLICY "TradeReceivable_tenant_isolation" ON "TradeReceivable"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "TradeSupplier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TradeSupplier" FORCE ROW LEVEL SECURITY;
CREATE POLICY "TradeSupplier_tenant_isolation" ON "TradeSupplier"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "TradeTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TradeTransaction" FORCE ROW LEVEL SECURITY;
CREATE POLICY "TradeTransaction_tenant_isolation" ON "TradeTransaction"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "TradeDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TradeDocument" FORCE ROW LEVEL SECURITY;
CREATE POLICY "TradeDocument_tenant_isolation" ON "TradeDocument"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "TradeProceeds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TradeProceeds" FORCE ROW LEVEL SECURITY;
CREATE POLICY "TradeProceeds_tenant_isolation" ON "TradeProceeds"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
