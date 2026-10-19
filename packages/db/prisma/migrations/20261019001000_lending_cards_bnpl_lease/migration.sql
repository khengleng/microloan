-- CreateTable
CREATE TABLE "CardAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "maskedNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "purchaseBalance" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "cashBalance" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "planBalance" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "lastStatementTo" DATE,
    "closedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardTransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "transactionDate" DATE NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "fee" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "purchaseDelta" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "cashDelta" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "planDelta" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "merchantName" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "eventId" TEXT,
    "planId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardStatement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "facilityStatementId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "purchaseBalance" DECIMAL(24,4) NOT NULL,
    "cashBalance" DECIMAL(24,4) NOT NULL,
    "planBalance" DECIMAL(24,4) NOT NULL,
    "statementBalance" DECIMAL(24,4) NOT NULL,
    "purchaseInterest" DECIMAL(24,4) NOT NULL,
    "purchaseInterestWaived" DECIMAL(24,4) NOT NULL,
    "cashInterest" DECIMAL(24,4) NOT NULL,
    "planInterest" DECIMAL(24,4) NOT NULL,
    "planPrincipalBilled" DECIMAL(24,4) NOT NULL,
    "cashAdvanceFees" DECIMAL(24,4) NOT NULL,
    "minimumPayment" DECIMAL(24,4) NOT NULL,
    "graceApplied" BOOLEAN NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardInstalmentPlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "sourceTransactionId" TEXT NOT NULL,
    "principal" DECIMAL(24,4) NOT NULL,
    "annualRate" DECIMAL(12,8) NOT NULL,
    "months" INTEGER NOT NULL,
    "instalmentAmount" DECIMAL(24,4) NOT NULL,
    "lines" JSONB NOT NULL,
    "billedCount" INTEGER NOT NULL DEFAULT 0,
    "principalRemaining" DECIMAL(24,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardInstalmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BnplPlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "merchantName" TEXT NOT NULL,
    "merchantReference" TEXT NOT NULL DEFAULT '',
    "purchaseAmount" DECIMAL(24,4) NOT NULL,
    "merchantDiscountRate" DECIMAL(12,8) NOT NULL,
    "merchantDiscount" DECIMAL(24,4) NOT NULL,
    "merchantNet" DECIMAL(24,4) NOT NULL,
    "refundedAmount" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "discountReversed" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "disbursementEventId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BnplPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BnplRefund" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "merchantReference" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "appliedToPrincipal" DECIMAL(24,4) NOT NULL,
    "customerRefund" DECIMAL(24,4) NOT NULL,
    "discountReversed" DECIMAL(24,4) NOT NULL,
    "merchantClawback" DECIMAL(24,4) NOT NULL,
    "reductions" JSONB NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CLAWBACK_DUE',
    "collectedEventId" TEXT,
    "collectedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BnplRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaseAsset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL DEFAULT '',
    "supplierName" TEXT NOT NULL,
    "cost" DECIMAL(24,4) NOT NULL,
    "residualValue" DECIMAL(24,4) NOT NULL,
    "ownership" TEXT NOT NULL DEFAULT 'LESSOR',
    "endOption" TEXT,
    "endDate" DATE,
    "endEventId" TEXT,
    "returnCondition" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "registeredBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeaseAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardAccount_facilityId_key" ON "CardAccount"("facilityId");

-- CreateIndex
CREATE INDEX "CardAccount_tenantId_status_idx" ON "CardAccount"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CardAccount_tenantId_id_key" ON "CardAccount"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CardAccount_tenantId_reference_key" ON "CardAccount"("tenantId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "CardAccount_tenantId_facilityId_key" ON "CardAccount"("tenantId", "facilityId");

-- CreateIndex
CREATE INDEX "CardTransaction_tenantId_cardId_transactionDate_idx" ON "CardTransaction"("tenantId", "cardId", "transactionDate");

-- CreateIndex
CREATE UNIQUE INDEX "CardTransaction_tenantId_id_key" ON "CardTransaction"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CardStatement_facilityStatementId_key" ON "CardStatement"("facilityStatementId");

-- CreateIndex
CREATE INDEX "CardStatement_tenantId_cardId_periodEnd_idx" ON "CardStatement"("tenantId", "cardId", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "CardStatement_cardId_sequence_key" ON "CardStatement"("cardId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "CardStatement_tenantId_id_key" ON "CardStatement"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CardInstalmentPlan_sourceTransactionId_key" ON "CardInstalmentPlan"("sourceTransactionId");

-- CreateIndex
CREATE INDEX "CardInstalmentPlan_tenantId_cardId_status_idx" ON "CardInstalmentPlan"("tenantId", "cardId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CardInstalmentPlan_tenantId_id_key" ON "CardInstalmentPlan"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BnplPlan_loanAccountId_key" ON "BnplPlan"("loanAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "BnplPlan_tenantId_id_key" ON "BnplPlan"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BnplPlan_tenantId_loanAccountId_key" ON "BnplPlan"("tenantId", "loanAccountId");

-- CreateIndex
CREATE INDEX "BnplRefund_tenantId_loanAccountId_idx" ON "BnplRefund"("tenantId", "loanAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "BnplRefund_tenantId_id_key" ON "BnplRefund"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LeaseAsset_loanAccountId_key" ON "LeaseAsset"("loanAccountId");

-- CreateIndex
CREATE INDEX "LeaseAsset_tenantId_ownership_idx" ON "LeaseAsset"("tenantId", "ownership");

-- CreateIndex
CREATE UNIQUE INDEX "LeaseAsset_tenantId_id_key" ON "LeaseAsset"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LeaseAsset_tenantId_loanAccountId_key" ON "LeaseAsset"("tenantId", "loanAccountId");

-- AddForeignKey
ALTER TABLE "CardAccount" ADD CONSTRAINT "CardAccount_tenantId_facilityId_fkey" FOREIGN KEY ("tenantId", "facilityId") REFERENCES "Facility"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardTransaction" ADD CONSTRAINT "CardTransaction_tenantId_cardId_fkey" FOREIGN KEY ("tenantId", "cardId") REFERENCES "CardAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardStatement" ADD CONSTRAINT "CardStatement_tenantId_cardId_fkey" FOREIGN KEY ("tenantId", "cardId") REFERENCES "CardAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardInstalmentPlan" ADD CONSTRAINT "CardInstalmentPlan_tenantId_cardId_fkey" FOREIGN KEY ("tenantId", "cardId") REFERENCES "CardAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BnplPlan" ADD CONSTRAINT "BnplPlan_tenantId_loanAccountId_fkey" FOREIGN KEY ("tenantId", "loanAccountId") REFERENCES "LoanAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BnplRefund" ADD CONSTRAINT "BnplRefund_tenantId_planId_fkey" FOREIGN KEY ("tenantId", "planId") REFERENCES "BnplPlan"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseAsset" ADD CONSTRAINT "LeaseAsset_tenantId_loanAccountId_fkey" FOREIGN KEY ("tenantId", "loanAccountId") REFERENCES "LoanAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for cards, BNPL and leases.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "CardAccount" ADD CONSTRAINT "CardAccount_status_check" CHECK ("status" IN ('ACTIVE', 'BLOCKED', 'CLOSED'));
-- Balances may go briefly negative only through an overpayment, which the service refuses.
ALTER TABLE "CardAccount" ADD CONSTRAINT "CardAccount_balances_check" CHECK ("purchaseBalance" >= 0 AND "cashBalance" >= 0 AND "planBalance" >= 0);
ALTER TABLE "CardTransaction" ADD CONSTRAINT "CardTransaction_type_check" CHECK ("type" IN ('PURCHASE', 'CASH_ADVANCE', 'PAYMENT', 'PLAN_CONVERSION', 'PLAN_BILLING'));
ALTER TABLE "CardTransaction" ADD CONSTRAINT "CardTransaction_amounts_check" CHECK ("amount" > 0 AND "fee" >= 0);
ALTER TABLE "CardStatement" ADD CONSTRAINT "CardStatement_period_check" CHECK ("periodEnd" > "periodStart" AND "dueDate" > "periodEnd");
ALTER TABLE "CardStatement" ADD CONSTRAINT "CardStatement_amounts_check" CHECK ("minimumPayment" >= 0 AND "purchaseInterest" >= 0 AND "purchaseInterestWaived" >= 0 AND "cashInterest" >= 0 AND "planInterest" >= 0);
-- A grace period waives purchase interest; it never both waives and charges it.
ALTER TABLE "CardStatement" ADD CONSTRAINT "CardStatement_grace_check" CHECK (("graceApplied" AND "purchaseInterest" = 0) OR (NOT "graceApplied" AND "purchaseInterestWaived" = 0));
ALTER TABLE "CardInstalmentPlan" ADD CONSTRAINT "CardInstalmentPlan_status_check" CHECK ("status" IN ('ACTIVE', 'COMPLETED'));
ALTER TABLE "CardInstalmentPlan" ADD CONSTRAINT "CardInstalmentPlan_amounts_check" CHECK ("principal" > 0 AND "principalRemaining" >= 0 AND "principalRemaining" <= "principal" AND "months" BETWEEN 1 AND 60 AND "billedCount" BETWEEN 0 AND "months");
ALTER TABLE "BnplPlan" ADD CONSTRAINT "BnplPlan_amounts_check" CHECK ("purchaseAmount" > 0 AND "merchantDiscount" >= 0 AND "merchantNet" + "merchantDiscount" = "purchaseAmount" AND "refundedAmount" >= 0 AND "refundedAmount" <= "purchaseAmount" AND "discountReversed" >= 0 AND "discountReversed" <= "merchantDiscount");
ALTER TABLE "BnplRefund" ADD CONSTRAINT "BnplRefund_status_check" CHECK ("status" IN ('CLAWBACK_DUE', 'COLLECTED'));
ALTER TABLE "BnplRefund" ADD CONSTRAINT "BnplRefund_amounts_check" CHECK ("amount" > 0 AND "appliedToPrincipal" + "customerRefund" = "amount" AND "merchantClawback" + "discountReversed" = "amount");
ALTER TABLE "LeaseAsset" ADD CONSTRAINT "LeaseAsset_ownership_check" CHECK ("ownership" IN ('LESSOR', 'TRANSFERRED', 'RETURNED'));
ALTER TABLE "LeaseAsset" ADD CONSTRAINT "LeaseAsset_end_check" CHECK (("ownership" = 'LESSOR' AND "endOption" IS NULL) OR ("ownership" = 'TRANSFERRED' AND "endOption" = 'PURCHASE') OR ("ownership" = 'RETURNED' AND "endOption" = 'RETURN'));
ALTER TABLE "LeaseAsset" ADD CONSTRAINT "LeaseAsset_amounts_check" CHECK ("cost" > 0 AND "residualValue" >= 0 AND "residualValue" < "cost");

ALTER TABLE "CardAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CardAccount" FORCE ROW LEVEL SECURITY;
CREATE POLICY "CardAccount_tenant_isolation" ON "CardAccount"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "CardTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CardTransaction" FORCE ROW LEVEL SECURITY;
CREATE POLICY "CardTransaction_tenant_isolation" ON "CardTransaction"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "CardStatement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CardStatement" FORCE ROW LEVEL SECURITY;
CREATE POLICY "CardStatement_tenant_isolation" ON "CardStatement"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "CardInstalmentPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CardInstalmentPlan" FORCE ROW LEVEL SECURITY;
CREATE POLICY "CardInstalmentPlan_tenant_isolation" ON "CardInstalmentPlan"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "BnplPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BnplPlan" FORCE ROW LEVEL SECURITY;
CREATE POLICY "BnplPlan_tenant_isolation" ON "BnplPlan"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "BnplRefund" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BnplRefund" FORCE ROW LEVEL SECURITY;
CREATE POLICY "BnplRefund_tenant_isolation" ON "BnplRefund"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "LeaseAsset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaseAsset" FORCE ROW LEVEL SECURITY;
CREATE POLICY "LeaseAsset_tenant_isolation" ON "LeaseAsset"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
