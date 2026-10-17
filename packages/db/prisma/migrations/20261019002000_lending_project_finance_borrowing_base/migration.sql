-- CreateTable
CREATE TABLE "ProjectFinance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "facilityId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CONSTRUCTION',
    "targetDscr" DECIMAL(12,6) NOT NULL,
    "lockUpDscr" DECIMAL(12,6),
    "dsraMonths" INTEGER NOT NULL,
    "cashSweepRate" DECIMAL(12,6),
    "dsraBalance" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "lockUpBalance" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "lockedUp" BOOLEAN NOT NULL DEFAULT false,
    "sculpting" JSONB,
    "termedOutOn" DATE,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectFinance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectWaterfallRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "receivedOn" DATE NOT NULL,
    "revenue" DECIMAL(24,4) NOT NULL,
    "operatingCosts" DECIMAL(24,4) NOT NULL,
    "taxes" DECIMAL(24,4) NOT NULL,
    "cfads" DECIMAL(24,4) NOT NULL,
    "periodDebtService" DECIMAL(24,4) NOT NULL,
    "dscr" DECIMAL(14,6),
    "lockedUp" BOOLEAN NOT NULL,
    "seniorDebtService" DECIMAL(24,4) NOT NULL,
    "dsraDraw" DECIMAL(24,4) NOT NULL,
    "dsraTopUp" DECIMAL(24,4) NOT NULL,
    "cashSweep" DECIMAL(24,4) NOT NULL,
    "lockUpRetained" DECIMAL(24,4) NOT NULL,
    "lockUpReleased" DECIMAL(24,4) NOT NULL,
    "distribution" DECIMAL(24,4) NOT NULL,
    "dsraTarget" DECIMAL(24,4) NOT NULL,
    "dsraBalanceAfter" DECIMAL(24,4) NOT NULL,
    "lockUpBalanceAfter" DECIMAL(24,4) NOT NULL,
    "steps" JSONB NOT NULL,
    "eventId" TEXT NOT NULL,
    "externalReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectWaterfallRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BorrowingBaseCertificate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "asOfDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "currency" TEXT NOT NULL,
    "grossValue" DECIMAL(24,4) NOT NULL,
    "ineligibleValue" DECIMAL(24,4) NOT NULL,
    "eligibleValue" DECIMAL(24,4) NOT NULL,
    "borrowingBase" DECIMAL(24,4) NOT NULL,
    "lines" JSONB NOT NULL,
    "calculation" JSONB NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "engineVersion" TEXT NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BorrowingBaseCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectFinance_tenantId_id_key" ON "ProjectFinance"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectFinance_tenantId_loanAccountId_key" ON "ProjectFinance"("tenantId", "loanAccountId");

-- CreateIndex
CREATE INDEX "ProjectWaterfallRun_tenantId_loanAccountId_idx" ON "ProjectWaterfallRun"("tenantId", "loanAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectWaterfallRun_tenantId_id_key" ON "ProjectWaterfallRun"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectWaterfallRun_tenantId_projectId_sequence_key" ON "ProjectWaterfallRun"("tenantId", "projectId", "sequence");

-- CreateIndex
CREATE INDEX "BorrowingBaseCertificate_tenantId_facilityId_status_idx" ON "BorrowingBaseCertificate"("tenantId", "facilityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BorrowingBaseCertificate_tenantId_id_key" ON "BorrowingBaseCertificate"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BorrowingBaseCertificate_tenantId_facilityId_sequence_key" ON "BorrowingBaseCertificate"("tenantId", "facilityId", "sequence");

-- AddForeignKey
ALTER TABLE "ProjectFinance" ADD CONSTRAINT "ProjectFinance_tenantId_loanAccountId_fkey" FOREIGN KEY ("tenantId", "loanAccountId") REFERENCES "LoanAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectWaterfallRun" ADD CONSTRAINT "ProjectWaterfallRun_tenantId_projectId_fkey" FOREIGN KEY ("tenantId", "projectId") REFERENCES "ProjectFinance"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BorrowingBaseCertificate" ADD CONSTRAINT "BorrowingBaseCertificate_tenantId_facilityId_fkey" FOREIGN KEY ("tenantId", "facilityId") REFERENCES "Facility"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for project finance and borrowing bases.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════
-- Covenants gain net leverage and interest cover (LT-16).
ALTER TABLE "LoanCovenant" DROP CONSTRAINT IF EXISTS "LoanCovenant_type_check";
ALTER TABLE "LoanCovenant" ADD CONSTRAINT "LoanCovenant_type_check"
  CHECK ("type" IN ('MIN_DSCR', 'MAX_LTV', 'FINANCIAL_STATEMENTS', 'MAX_LEVERAGE', 'MIN_INTEREST_COVER'));

ALTER TABLE "ProjectFinance" ADD CONSTRAINT "ProjectFinance_status_check"
  CHECK ("status" IN ('CONSTRUCTION', 'OPERATIONS', 'CLOSED'));
ALTER TABLE "ProjectFinance" ADD CONSTRAINT "ProjectFinance_terms_check"
  CHECK ("targetDscr" > 0 AND ("lockUpDscr" IS NULL OR "lockUpDscr" > 0)
     AND "dsraMonths" BETWEEN 0 AND 24
     AND ("cashSweepRate" IS NULL OR ("cashSweepRate" >= 0 AND "cashSweepRate" <= 1)));
ALTER TABLE "ProjectFinance" ADD CONSTRAINT "ProjectFinance_balances_check"
  CHECK ("dsraBalance" >= 0 AND "lockUpBalance" >= 0);

ALTER TABLE "ProjectWaterfallRun" ADD CONSTRAINT "ProjectWaterfallRun_amounts_check"
  CHECK ("revenue" >= 0 AND "operatingCosts" >= 0 AND "taxes" >= 0 AND "periodDebtService" >= 0
     AND "seniorDebtService" >= 0 AND "dsraDraw" >= 0 AND "dsraTopUp" >= 0 AND "cashSweep" >= 0
     AND "lockUpRetained" >= 0 AND "lockUpReleased" >= 0 AND "distribution" >= 0
     AND "dsraTarget" >= 0 AND "dsraBalanceAfter" >= 0 AND "lockUpBalanceAfter" >= 0);
-- A run is the record of money already posted: it is never edited or removed.
CREATE OR REPLACE FUNCTION project_waterfall_run_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'WATERFALL_RUN_IMMUTABLE: a waterfall run is never changed or deleted; post a reversal instead'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "ProjectWaterfallRun_guard" ON "ProjectWaterfallRun";
CREATE TRIGGER "ProjectWaterfallRun_guard" BEFORE UPDATE OR DELETE ON "ProjectWaterfallRun"
  FOR EACH ROW EXECUTE FUNCTION project_waterfall_run_guard();

ALTER TABLE "BorrowingBaseCertificate" ADD CONSTRAINT "BorrowingBaseCertificate_status_check"
  CHECK ("status" IN ('SUBMITTED', 'ACCEPTED', 'REJECTED', 'SUPERSEDED'));
ALTER TABLE "BorrowingBaseCertificate" ADD CONSTRAINT "BorrowingBaseCertificate_amounts_check"
  CHECK ("grossValue" >= 0 AND "ineligibleValue" >= 0 AND "eligibleValue" >= 0 AND "borrowingBase" >= 0
     AND "eligibleValue" + "ineligibleValue" = "grossValue" AND "borrowingBase" <= "eligibleValue");
-- Maker-checker: whoever decides a certificate did not submit it.
ALTER TABLE "BorrowingBaseCertificate" ADD CONSTRAINT "BorrowingBaseCertificate_decision_check"
  CHECK (("status" = 'SUBMITTED') = ("decidedBy" IS NULL) AND ("decidedBy" IS NULL OR "decidedBy" <> "submittedBy"));
-- The figures of a certificate are fixed once submitted; only the decision moves.
CREATE OR REPLACE FUNCTION borrowing_base_certificate_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'BORROWING_BASE_IMMUTABLE: certificates are never deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."tenantId" <> OLD."tenantId" OR NEW."facilityId" <> OLD."facilityId" OR NEW."sequence" <> OLD."sequence"
     OR NEW."asOfDate" <> OLD."asOfDate" OR NEW."currency" <> OLD."currency"
     OR NEW."grossValue" <> OLD."grossValue" OR NEW."ineligibleValue" <> OLD."ineligibleValue"
     OR NEW."eligibleValue" <> OLD."eligibleValue" OR NEW."borrowingBase" <> OLD."borrowingBase"
     OR NEW."lines" IS DISTINCT FROM OLD."lines" OR NEW."calculation" IS DISTINCT FROM OLD."calculation"
     OR NEW."submittedBy" <> OLD."submittedBy" OR NEW."submittedAt" <> OLD."submittedAt" THEN
    RAISE EXCEPTION 'BORROWING_BASE_IMMUTABLE: the figures of a certificate cannot change; submit a new one'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT ((OLD."status", NEW."status") IN (
      ('SUBMITTED', 'SUBMITTED'), ('SUBMITTED', 'ACCEPTED'), ('SUBMITTED', 'REJECTED'),
      ('ACCEPTED', 'ACCEPTED'), ('ACCEPTED', 'SUPERSEDED'),
      ('REJECTED', 'REJECTED'), ('SUPERSEDED', 'SUPERSEDED'))) THEN
    RAISE EXCEPTION 'BORROWING_BASE_IMMUTABLE: a certificate cannot move from % to %', OLD."status", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "BorrowingBaseCertificate_guard" ON "BorrowingBaseCertificate";
CREATE TRIGGER "BorrowingBaseCertificate_guard" BEFORE UPDATE OR DELETE ON "BorrowingBaseCertificate"
  FOR EACH ROW EXECUTE FUNCTION borrowing_base_certificate_guard();

ALTER TABLE "ProjectFinance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectFinance" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ProjectFinance_tenant_isolation" ON "ProjectFinance"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "ProjectWaterfallRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectWaterfallRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ProjectWaterfallRun_tenant_isolation" ON "ProjectWaterfallRun"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "BorrowingBaseCertificate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BorrowingBaseCertificate" FORCE ROW LEVEL SECURITY;
CREATE POLICY "BorrowingBaseCertificate_tenant_isolation" ON "BorrowingBaseCertificate"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
