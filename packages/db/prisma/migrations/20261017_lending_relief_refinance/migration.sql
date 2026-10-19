-- ═══════════════════════════════════════════════════════════════════════════
-- Payment-holiday programmes and refinancing (Phase 2).
--
-- Fully additive: three new tables, and four columns that are all nullable or
-- defaulted, so the migration is safe on a populated database.
--
-- RefinanceRecord stores the supervisory facts — how much of the payoff was
-- arrears, how much of those arrears the new loan funded, and whether the
-- loan it replaced was delinquent — beside the money. Those facts are what
-- distinguishes a refinance from evergreening, and recomputing them later
-- from a closed loan's balances is not possible, so they are written at the
-- moment the refinance happens.
-- ═══════════════════════════════════════════════════════════════════════════

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "refinancesLoanId" TEXT;

-- AlterTable
ALTER TABLE "LoanAccount" ADD COLUMN     "refinanceCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refinancedByLoanId" TEXT,
ADD COLUMN     "refinancedFromLoanId" TEXT;

-- CreateTable
CREATE TABLE "PaymentHolidayProgramme" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "maxInstalments" INTEGER NOT NULL,
    "interestTreatment" TEXT NOT NULL,
    "termTreatment" TEXT NOT NULL,
    "opensOn" DATE NOT NULL,
    "closesOn" DATE NOT NULL,
    "minInstalmentsPaid" INTEGER NOT NULL DEFAULT 0,
    "maxDaysPastDue" INTEGER NOT NULL DEFAULT 30,
    "minInstalmentsRemaining" INTEGER NOT NULL DEFAULT 1,
    "maxHolidaysPerLoan" INTEGER NOT NULL DEFAULT 1,
    "allowRestructured" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentHolidayProgramme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentHolidayEnrolment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "instalments" INTEGER NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "resumesOn" DATE NOT NULL,
    "deferredInterest" DECIMAL(24,4) NOT NULL,
    "interestTreatment" TEXT NOT NULL,
    "termTreatment" TEXT NOT NULL,
    "agreementVersion" INTEGER NOT NULL,
    "calculation" JSONB NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "grantedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentHolidayEnrolment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefinanceRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "previousLoanId" TEXT NOT NULL,
    "newLoanId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "payoffAmount" DECIMAL(24,4) NOT NULL,
    "appliedToPayoff" DECIMAL(24,4) NOT NULL,
    "topUpToBorrower" DECIMAL(24,4) NOT NULL,
    "shortfallPaid" DECIMAL(24,4) NOT NULL,
    "arrears" DECIMAL(24,4) NOT NULL,
    "arrearsRolledIn" DECIMAL(24,4) NOT NULL,
    "previousDaysPastDue" INTEGER NOT NULL,
    "evergreening" BOOLEAN NOT NULL,
    "calculation" JSONB NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "executedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefinanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentHolidayProgramme_tenantId_status_idx" ON "PaymentHolidayProgramme"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentHolidayProgramme_tenantId_code_key" ON "PaymentHolidayProgramme"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentHolidayProgramme_tenantId_id_key" ON "PaymentHolidayProgramme"("tenantId", "id");

-- CreateIndex
CREATE INDEX "PaymentHolidayEnrolment_tenantId_loanAccountId_idx" ON "PaymentHolidayEnrolment"("tenantId", "loanAccountId");

-- CreateIndex
CREATE INDEX "PaymentHolidayEnrolment_tenantId_programmeId_idx" ON "PaymentHolidayEnrolment"("tenantId", "programmeId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentHolidayEnrolment_tenantId_id_key" ON "PaymentHolidayEnrolment"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RefinanceRecord_newLoanId_key" ON "RefinanceRecord"("newLoanId");

-- CreateIndex
CREATE INDEX "RefinanceRecord_tenantId_previousLoanId_idx" ON "RefinanceRecord"("tenantId", "previousLoanId");

-- CreateIndex
CREATE INDEX "RefinanceRecord_tenantId_borrowerId_idx" ON "RefinanceRecord"("tenantId", "borrowerId");

-- CreateIndex
CREATE UNIQUE INDEX "RefinanceRecord_tenantId_id_key" ON "RefinanceRecord"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "PaymentHolidayProgramme" ADD CONSTRAINT "PaymentHolidayProgramme_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentHolidayEnrolment" ADD CONSTRAINT "PaymentHolidayEnrolment_tenantId_programmeId_fkey" FOREIGN KEY ("tenantId", "programmeId") REFERENCES "PaymentHolidayProgramme"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for relief and refinancing.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs, so tests run against the same rules
-- production enforces. Keep it to constraints, triggers and policies — no
-- table or index DDL, which `prisma db push` has already created there.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "PaymentHolidayProgramme" ADD CONSTRAINT "PaymentHolidayProgramme_status_check"
  CHECK ("status" IN ('DRAFT', 'OPEN', 'CLOSED'));
ALTER TABLE "PaymentHolidayProgramme" ADD CONSTRAINT "PaymentHolidayProgramme_treatment_check"
  CHECK ("interestTreatment" IN ('PAY_SEPARATELY', 'DEFER_NO_CAPITALIZATION', 'CAPITALIZE', 'WAIVE')
     AND "termTreatment" IN ('EXTEND_TERM', 'KEEP_MATURITY'));
ALTER TABLE "PaymentHolidayProgramme" ADD CONSTRAINT "PaymentHolidayProgramme_window_check"
  CHECK ("closesOn" >= "opensOn" AND "maxInstalments" >= 1 AND "maxHolidaysPerLoan" >= 1);

-- A holiday defers at least one instalment and resumes after it starts.
ALTER TABLE "PaymentHolidayEnrolment" ADD CONSTRAINT "PaymentHolidayEnrolment_shape_check"
  CHECK ("instalments" >= 1 AND "resumesOn" > "effectiveDate" AND "deferredInterest" >= 0);

ALTER TABLE "RefinanceRecord" ADD CONSTRAINT "RefinanceRecord_amounts_check"
  CHECK ("payoffAmount" > 0
     AND "appliedToPayoff" >= 0
     AND "topUpToBorrower" >= 0
     AND "shortfallPaid" >= 0
     AND "arrears" >= 0
     AND "arrearsRolledIn" >= 0
     AND "arrearsRolledIn" <= "arrears"
     AND "appliedToPayoff" + "shortfallPaid" = "payoffAmount");
-- Evergreening is precisely: replaced a delinquent loan and funded its
-- arrears. A row claiming otherwise would misreport the thing supervisors
-- look for, so the database refuses it.
ALTER TABLE "RefinanceRecord" ADD CONSTRAINT "RefinanceRecord_evergreening_check"
  CHECK ("evergreening" = ("previousDaysPastDue" > 0 AND "arrearsRolledIn" > 0));
-- A loan cannot refinance itself.
ALTER TABLE "RefinanceRecord" ADD CONSTRAINT "RefinanceRecord_distinct_check"
  CHECK ("previousLoanId" <> "newLoanId");

-- Granting a holiday and executing a refinance are both part of the loan's
-- history; a correction is a reversal of the amendment, never an edit here.
-- lending_append_only() is created by the Phase 1 migration.
CREATE TRIGGER "PaymentHolidayEnrolment_append_only"
  BEFORE UPDATE OR DELETE ON "PaymentHolidayEnrolment"
  FOR EACH ROW EXECUTE FUNCTION lending_append_only();
CREATE TRIGGER "RefinanceRecord_append_only"
  BEFORE UPDATE OR DELETE ON "RefinanceRecord"
  FOR EACH ROW EXECUTE FUNCTION lending_append_only();

-- Row-level security: the second wall behind the Prisma tenant guard.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['PaymentHolidayProgramme','PaymentHolidayEnrolment','RefinanceRecord']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true)) '
      || 'WITH CHECK (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true))',
      t || '_tenant_isolation', t);
  END LOOP;
END $$;
