-- AlterTable
ALTER TABLE "LoanAccount" ADD COLUMN     "allowance" DECIMAL(24,4) NOT NULL DEFAULT 0,
ADD COLUMN     "classification" TEXT,
ADD COLUMN     "impairmentStage" INTEGER;

-- CreateTable
CREATE TABLE "ImpairmentPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "settings" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "makerId" TEXT NOT NULL,
    "checkerId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpairmentPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImpairmentPolicy_tenantId_status_idx" ON "ImpairmentPolicy"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ImpairmentPolicy_tenantId_version_key" ON "ImpairmentPolicy"("tenantId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ImpairmentPolicy_tenantId_id_key" ON "ImpairmentPolicy"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "ImpairmentPolicy" ADD CONSTRAINT "ImpairmentPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for impairment.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "ImpairmentPolicy" ADD CONSTRAINT "ImpairmentPolicy_status_check"
  CHECK ("status" IN ('PENDING', 'ACTIVE', 'REJECTED', 'RETIRED'));
ALTER TABLE "ImpairmentPolicy" ADD CONSTRAINT "ImpairmentPolicy_maker_checker_check"
  CHECK ("checkerId" IS NULL OR "checkerId" <> "makerId");
-- One policy in force per tenant.
CREATE UNIQUE INDEX "ImpairmentPolicy_one_active" ON "ImpairmentPolicy" ("tenantId") WHERE "status" = 'ACTIVE';
ALTER TABLE "LoanAccount" ADD CONSTRAINT "LoanAccount_allowance_nonneg_check" CHECK ("allowance" >= 0);

ALTER TABLE "ImpairmentPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ImpairmentPolicy" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ImpairmentPolicy_tenant_isolation" ON "ImpairmentPolicy"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
