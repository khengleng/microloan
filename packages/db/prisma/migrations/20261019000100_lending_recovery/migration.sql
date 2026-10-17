-- CreateTable
CREATE TABLE "Repossession" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "collateralId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "location" TEXT NOT NULL,
    "seizedOn" DATE NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "taskId" TEXT,
    "valuationAmount" DECIMAL(24,4),
    "valuer" TEXT,
    "valuedOn" DATE,
    "salePrice" DECIMAL(24,4),
    "saleCosts" DECIMAL(24,4),
    "buyer" TEXT,
    "soldOn" DATE,
    "saleEventId" TEXT,
    "surplus" DECIMAL(24,4),
    "deficiency" DECIMAL(24,4),
    "proposedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Repossession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PawnItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "weightGrams" DECIMAL(14,4) NOT NULL,
    "karat" INTEGER,
    "purity" DECIMAL(8,6) NOT NULL,
    "pricePerGram" DECIMAL(24,4) NOT NULL,
    "appraisedValue" DECIMAL(24,4) NOT NULL,
    "custodyLocation" TEXT NOT NULL,
    "sealNumber" TEXT,
    "receivedOn" DATE NOT NULL,
    "redemptionDeadline" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_CUSTODY',
    "forfeitedAt" TIMESTAMP(3),
    "returnedOn" DATE,
    "returnReference" TEXT,
    "salePrice" DECIMAL(24,4),
    "saleCosts" DECIMAL(24,4),
    "buyer" TEXT,
    "soldOn" DATE,
    "saleEventId" TEXT,
    "surplus" DECIMAL(24,4),
    "deficiency" DECIMAL(24,4),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PawnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsurancePolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "insurer" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "coverType" TEXT NOT NULL,
    "premium" DECIMAL(24,4) NOT NULL,
    "premiumTreatment" TEXT NOT NULL,
    "premiumRemitted" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "premiumEventId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsurancePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsuranceClaim" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventDate" DATE NOT NULL,
    "evidenceReference" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "amountClaimed" DECIMAL(24,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "taskId" TEXT,
    "settlementEventId" TEXT,
    "surplus" DECIMAL(24,4),
    "deficiency" DECIMAL(24,4),
    "received" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsuranceClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebtSale" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "buyer" TEXT NOT NULL,
    "price" DECIMAL(24,4) NOT NULL,
    "saleDate" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "externalReference" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "taskId" TEXT,
    "grossReceivable" DECIMAL(24,4),
    "carryingAmount" DECIMAL(24,4),
    "gainLoss" DECIMAL(24,4),
    "eventId" TEXT,
    "proposedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DebtSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecoveryRefund" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "payee" TEXT NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PAYABLE',
    "sourceEventId" TEXT NOT NULL,
    "paidEventId" TEXT,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Repossession_saleEventId_key" ON "Repossession"("saleEventId");

-- CreateIndex
CREATE INDEX "Repossession_tenantId_status_idx" ON "Repossession"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Repossession_tenantId_loanAccountId_idx" ON "Repossession"("tenantId", "loanAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Repossession_tenantId_id_key" ON "Repossession"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PawnItem_saleEventId_key" ON "PawnItem"("saleEventId");

-- CreateIndex
CREATE INDEX "PawnItem_tenantId_loanAccountId_idx" ON "PawnItem"("tenantId", "loanAccountId");

-- CreateIndex
CREATE INDEX "PawnItem_tenantId_status_idx" ON "PawnItem"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PawnItem_tenantId_id_key" ON "PawnItem"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "InsurancePolicy_premiumEventId_key" ON "InsurancePolicy"("premiumEventId");

-- CreateIndex
CREATE INDEX "InsurancePolicy_tenantId_loanAccountId_idx" ON "InsurancePolicy"("tenantId", "loanAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "InsurancePolicy_tenantId_insurer_policyNumber_key" ON "InsurancePolicy"("tenantId", "insurer", "policyNumber");

-- CreateIndex
CREATE UNIQUE INDEX "InsurancePolicy_tenantId_id_key" ON "InsurancePolicy"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceClaim_settlementEventId_key" ON "InsuranceClaim"("settlementEventId");

-- CreateIndex
CREATE INDEX "InsuranceClaim_tenantId_loanAccountId_idx" ON "InsuranceClaim"("tenantId", "loanAccountId");

-- CreateIndex
CREATE INDEX "InsuranceClaim_tenantId_status_idx" ON "InsuranceClaim"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "InsuranceClaim_tenantId_id_key" ON "InsuranceClaim"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DebtSale_eventId_key" ON "DebtSale"("eventId");

-- CreateIndex
CREATE INDEX "DebtSale_tenantId_status_idx" ON "DebtSale"("tenantId", "status");

-- CreateIndex
CREATE INDEX "DebtSale_tenantId_loanAccountId_idx" ON "DebtSale"("tenantId", "loanAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "DebtSale_tenantId_id_key" ON "DebtSale"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryRefund_paidEventId_key" ON "RecoveryRefund"("paidEventId");

-- CreateIndex
CREATE INDEX "RecoveryRefund_tenantId_status_idx" ON "RecoveryRefund"("tenantId", "status");

-- CreateIndex
CREATE INDEX "RecoveryRefund_tenantId_loanAccountId_idx" ON "RecoveryRefund"("tenantId", "loanAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryRefund_tenantId_id_key" ON "RecoveryRefund"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "Repossession" ADD CONSTRAINT "Repossession_tenantId_loanAccountId_fkey" FOREIGN KEY ("tenantId", "loanAccountId") REFERENCES "LoanAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PawnItem" ADD CONSTRAINT "PawnItem_tenantId_loanAccountId_fkey" FOREIGN KEY ("tenantId", "loanAccountId") REFERENCES "LoanAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsurancePolicy" ADD CONSTRAINT "InsurancePolicy_tenantId_loanAccountId_fkey" FOREIGN KEY ("tenantId", "loanAccountId") REFERENCES "LoanAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_tenantId_policyId_fkey" FOREIGN KEY ("tenantId", "policyId") REFERENCES "InsurancePolicy"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtSale" ADD CONSTRAINT "DebtSale_tenantId_loanAccountId_fkey" FOREIGN KEY ("tenantId", "loanAccountId") REFERENCES "LoanAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecoveryRefund" ADD CONSTRAINT "RecoveryRefund_tenantId_loanAccountId_fkey" FOREIGN KEY ("tenantId", "loanAccountId") REFERENCES "LoanAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;




-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for recovery workflows.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "Repossession" ADD CONSTRAINT "Repossession_status_check"
  CHECK ("status" IN ('PROPOSED', 'SEIZED', 'VALUED', 'SOLD', 'REJECTED'));
ALTER TABLE "Repossession" ADD CONSTRAINT "Repossession_amounts_check"
  CHECK (coalesce("valuationAmount", 0) >= 0 AND coalesce("salePrice", 0) >= 0
         AND coalesce("saleCosts", 0) >= 0 AND coalesce("surplus", 0) >= 0
         AND coalesce("deficiency", 0) >= 0
         AND ("status" <> 'SOLD' OR ("salePrice" > 0 AND "saleEventId" IS NOT NULL)));
-- One repossession in progress per asset.
CREATE UNIQUE INDEX "Repossession_one_open_per_asset" ON "Repossession" ("tenantId", "collateralId")
  WHERE "status" IN ('PROPOSED', 'SEIZED', 'VALUED');

ALTER TABLE "PawnItem" ADD CONSTRAINT "PawnItem_status_check"
  CHECK ("status" IN ('IN_CUSTODY', 'FORFEITED', 'SOLD', 'RETURNED'));
ALTER TABLE "PawnItem" ADD CONSTRAINT "PawnItem_measures_check"
  CHECK ("weightGrams" > 0 AND "purity" > 0 AND "purity" <= 1 AND "pricePerGram" > 0
         AND "appraisedValue" >= 0 AND ("karat" IS NULL OR "karat" BETWEEN 1 AND 24)
         AND "itemType" IN ('GOLD', 'JEWELLERY', 'OTHER')
         AND coalesce("salePrice", 0) >= 0 AND coalesce("saleCosts", 0) >= 0
         AND ("status" <> 'SOLD' OR "saleEventId" IS NOT NULL)
         AND ("status" <> 'RETURNED' OR "returnedOn" IS NOT NULL));

ALTER TABLE "InsurancePolicy" ADD CONSTRAINT "InsurancePolicy_check"
  CHECK ("coverType" IN ('DEATH', 'DISABILITY', 'DEATH_AND_DISABILITY')
         AND "premiumTreatment" IN ('FINANCED', 'PAID')
         AND "status" IN ('ACTIVE', 'CLAIMED')
         AND "premium" >= 0 AND "premiumRemitted" >= 0 AND "premiumRemitted" <= "premium");
ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_check"
  CHECK ("eventType" IN ('DEATH', 'DISABILITY')
         AND "status" IN ('PENDING', 'SETTLED', 'REJECTED')
         AND "amountClaimed" > 0 AND "received" >= 0
         AND ("status" <> 'SETTLED' OR "settlementEventId" IS NOT NULL));
-- One claim under consideration per policy.
CREATE UNIQUE INDEX "InsuranceClaim_one_pending" ON "InsuranceClaim" ("tenantId", "policyId")
  WHERE "status" = 'PENDING';

ALTER TABLE "DebtSale" ADD CONSTRAINT "DebtSale_check"
  CHECK ("status" IN ('PENDING', 'EXECUTED', 'REJECTED') AND "price" > 0
         AND ("status" <> 'EXECUTED' OR "eventId" IS NOT NULL));
-- A loan is sold at most once, and has at most one sale awaiting approval.
CREATE UNIQUE INDEX "DebtSale_one_live_per_loan" ON "DebtSale" ("tenantId", "loanAccountId")
  WHERE "status" IN ('PENDING', 'EXECUTED');

ALTER TABLE "RecoveryRefund" ADD CONSTRAINT "RecoveryRefund_check"
  CHECK ("source" IN ('REPOSSESSION', 'PAWN_AUCTION', 'INSURANCE_CLAIM')
         AND "status" IN ('PAYABLE', 'PAID') AND "amount" > 0
         AND (("status" = 'PAID') = ("paidEventId" IS NOT NULL)));

-- A pledged asset can now also be sold in a repossession.
ALTER TABLE "CollateralPledge" DROP CONSTRAINT IF EXISTS "CollateralPledge_status_check";
ALTER TABLE "CollateralPledge" ADD CONSTRAINT "CollateralPledge_status_check"
  CHECK ("status" IN ('ACTIVE', 'RELEASED', 'SOLD'));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Repossession','PawnItem','InsurancePolicy','InsuranceClaim','DebtSale','RecoveryRefund']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true)) '
      || 'WITH CHECK (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true))',
      t || '_tenant_isolation', t);
  END LOOP;
END $$;
