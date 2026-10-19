-- CreateTable
CREATE TABLE "LoanCovenant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "threshold" DECIMAL(12,6),
    "frequencyMonths" INTEGER NOT NULL,
    "nextTestOn" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanCovenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CovenantTest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "covenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "testedOn" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "value" DECIMAL(14,6),
    "passed" BOOLEAN NOT NULL,
    "inputs" JSONB NOT NULL,
    "evidence" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'TEST',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CovenantTest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoanCovenant_tenantId_status_nextTestOn_idx" ON "LoanCovenant"("tenantId", "status", "nextTestOn");

-- CreateIndex
CREATE INDEX "LoanCovenant_tenantId_loanAccountId_idx" ON "LoanCovenant"("tenantId", "loanAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "LoanCovenant_tenantId_id_key" ON "LoanCovenant"("tenantId", "id");

-- CreateIndex
CREATE INDEX "CovenantTest_tenantId_covenantId_idx" ON "CovenantTest"("tenantId", "covenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CovenantTest_tenantId_id_key" ON "CovenantTest"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "LoanCovenant" ADD CONSTRAINT "LoanCovenant_tenantId_loanAccountId_fkey" FOREIGN KEY ("tenantId", "loanAccountId") REFERENCES "LoanAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CovenantTest" ADD CONSTRAINT "CovenantTest_tenantId_covenantId_fkey" FOREIGN KEY ("tenantId", "covenantId") REFERENCES "LoanCovenant"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for covenants.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "LoanCovenant" ADD CONSTRAINT "LoanCovenant_type_check" CHECK ("type" IN ('MIN_DSCR', 'MAX_LTV', 'FINANCIAL_STATEMENTS'));
ALTER TABLE "LoanCovenant" ADD CONSTRAINT "LoanCovenant_status_check" CHECK ("status" IN ('ACTIVE', 'BREACHED', 'WAIVED', 'RELEASED'));
ALTER TABLE "LoanCovenant" ADD CONSTRAINT "LoanCovenant_threshold_check"
  CHECK (("type" = 'FINANCIAL_STATEMENTS') = ("threshold" IS NULL) AND ("threshold" IS NULL OR "threshold" > 0) AND "frequencyMonths" BETWEEN 1 AND 24);
ALTER TABLE "CovenantTest" ADD CONSTRAINT "CovenantTest_kind_check" CHECK ("kind" IN ('TEST', 'WAIVER'));

ALTER TABLE "LoanCovenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LoanCovenant" FORCE ROW LEVEL SECURITY;
CREATE POLICY "LoanCovenant_tenant_isolation" ON "LoanCovenant"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "CovenantTest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CovenantTest" FORCE ROW LEVEL SECURITY;
CREATE POLICY "CovenantTest_tenant_isolation" ON "CovenantTest"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
