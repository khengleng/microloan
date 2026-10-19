-- AlterTable
ALTER TABLE "CollateralAsset" ADD COLUMN     "priorLienAmount" DECIMAL(24,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CollateralPledge" ADD COLUMN     "releaseReference" TEXT,
ADD COLUMN     "releasedAt" TIMESTAMP(3),
ADD COLUMN     "releasedBy" TEXT;

-- CreateTable
CREATE TABLE "MarginCall" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "valuationId" TEXT NOT NULL,
    "ltv" DECIMAL(12,6) NOT NULL,
    "maxLtv" DECIMAL(12,6) NOT NULL,
    "outstanding" DECIMAL(24,4) NOT NULL,
    "lendingValue" DECIMAL(24,4) NOT NULL,
    "requiredRepayment" DECIMAL(24,4) NOT NULL,
    "requiredCollateral" DECIMAL(24,4) NOT NULL,
    "deadline" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarginCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarginCall_tenantId_status_idx" ON "MarginCall"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarginCall_tenantId_id_key" ON "MarginCall"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "MarginCall" ADD CONSTRAINT "MarginCall_tenantId_loanAccountId_fkey" FOREIGN KEY ("tenantId", "loanAccountId") REFERENCES "LoanAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for collateral servicing.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "MarginCall" ADD CONSTRAINT "MarginCall_status_check"
  CHECK ("status" IN ('OPEN', 'CURED', 'EXPIRED'));
-- One open margin call per loan at a time.
CREATE UNIQUE INDEX "MarginCall_one_open" ON "MarginCall" ("loanAccountId") WHERE "status" = 'OPEN';
ALTER TABLE "CollateralAsset" ADD CONSTRAINT "CollateralAsset_prior_lien_check" CHECK ("priorLienAmount" >= 0);
ALTER TABLE "CollateralPledge" ADD CONSTRAINT "CollateralPledge_status_check" CHECK ("status" IN ('ACTIVE', 'RELEASED'));

ALTER TABLE "MarginCall" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarginCall" FORCE ROW LEVEL SECURITY;
CREATE POLICY "MarginCall_tenant_isolation" ON "MarginCall"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
