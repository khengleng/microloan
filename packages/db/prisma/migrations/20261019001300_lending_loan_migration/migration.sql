-- CreateTable
CREATE TABLE "MigrationBatch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "cutOverDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'VALIDATED',
    "rowCount" INTEGER NOT NULL,
    "validCount" INTEGER NOT NULL,
    "errorCount" INTEGER NOT NULL,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "postedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "totals" JSONB NOT NULL,
    "controlTotals" JSONB NOT NULL DEFAULT '[]',
    "fileIssues" JSONB NOT NULL DEFAULT '[]',
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT NOT NULL DEFAULT '',
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MigrationBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationRow" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "externalLoanId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "preview" JSONB NOT NULL DEFAULT '{}',
    "borrowerId" TEXT,
    "loanAccountId" TEXT,
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "MigrationRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MigrationBatch_tenantId_status_idx" ON "MigrationBatch"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MigrationBatch_tenantId_id_key" ON "MigrationBatch"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MigrationBatch_tenantId_reference_key" ON "MigrationBatch"("tenantId", "reference");

-- CreateIndex
CREATE INDEX "MigrationRow_tenantId_batchId_status_idx" ON "MigrationRow"("tenantId", "batchId", "status");

-- CreateIndex
CREATE INDEX "MigrationRow_tenantId_externalLoanId_idx" ON "MigrationRow"("tenantId", "externalLoanId");

-- CreateIndex
CREATE UNIQUE INDEX "MigrationRow_tenantId_id_key" ON "MigrationRow"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "MigrationRow" ADD CONSTRAINT "MigrationRow_tenantId_batchId_fkey" FOREIGN KEY ("tenantId", "batchId") REFERENCES "MigrationBatch"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for loan-book migration.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "MigrationBatch" ADD CONSTRAINT "MigrationBatch_status_check"
  CHECK ("status" IN ('VALIDATED', 'POSTING', 'POSTED', 'PARTIALLY_POSTED', 'REJECTED', 'CANCELLED'));
ALTER TABLE "MigrationBatch" ADD CONSTRAINT "MigrationBatch_counts_check"
  CHECK ("rowCount" >= 0 AND "validCount" >= 0 AND "errorCount" >= 0 AND "postedCount" >= 0 AND "failedCount" >= 0
     AND "validCount" + "errorCount" = "rowCount");
ALTER TABLE "MigrationBatch" ADD CONSTRAINT "MigrationBatch_approval_check"
  CHECK ("approvedBy" IS NULL OR "approvedBy" <> "createdBy");
ALTER TABLE "MigrationRow" ADD CONSTRAINT "MigrationRow_status_check"
  CHECK ("status" IN ('VALID', 'WARNING', 'ERROR', 'POSTED', 'FAILED'));
ALTER TABLE "MigrationRow" ADD CONSTRAINT "MigrationRow_posted_check"
  CHECK (("status" = 'POSTED') = ("loanAccountId" IS NOT NULL));
-- A loan from the old system is migrated once.
CREATE UNIQUE INDEX "MigrationRow_one_posting" ON "MigrationRow" ("tenantId", "externalLoanId") WHERE "status" = 'POSTED';

ALTER TABLE "MigrationBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MigrationBatch" FORCE ROW LEVEL SECURITY;
CREATE POLICY "MigrationBatch_tenant_isolation" ON "MigrationBatch"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "MigrationRow" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MigrationRow" FORCE ROW LEVEL SECURITY;
CREATE POLICY "MigrationRow_tenant_isolation" ON "MigrationRow"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
