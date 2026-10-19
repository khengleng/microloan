-- NBC classification and provisioning (DECISIONS D-113…D-117).
--
-- The NBC band set a loan is graded on depends on its ORIGINAL maturity
-- (one year or less: short-term bands; longer: long-term bands). A
-- restructure moves "maturityDate", so the maturity first agreed is kept
-- in its own column. Everything else (both band sets, the restructured
-- minimum class, the write-off floor, the regulatory reserve account) lives
-- in the lender's settings (TenantLendingSettings.settings, JSON).

-- AlterTable
ALTER TABLE "LoanAccount" ADD COLUMN     "originalMaturityDate" DATE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Backfill and database-level invariants.
-- ═══════════════════════════════════════════════════════════════════════════

-- Loans already booked: the latest maturity of their first agreement
-- version's schedule (a later restructure or recast never changed those
-- rows), else the maturity on the account.
UPDATE "LoanAccount" la
SET "originalMaturityDate" = COALESCE(
  (
    SELECT max(si."dueDate")
    FROM "ScheduleInstalment" si
    WHERE si."tenantId" = la."tenantId"
      AND si."loanAccountId" = la."id"
      AND si."agreementVersion" = (
        SELECT min(s2."agreementVersion")
        FROM "ScheduleInstalment" s2
        WHERE s2."tenantId" = la."tenantId" AND s2."loanAccountId" = la."id"
      )
  ),
  la."maturityDate"
)
WHERE la."originalMaturityDate" IS NULL
  AND la."status" <> 'BOOKED';

UPDATE "LoanAccount"
SET "originalMaturityDate" = "maturityDate"
WHERE "originalMaturityDate" IS NULL
  AND "status" = 'BOOKED';

-- The original maturity follows the maturity while the loan is being booked
-- and at disbursement (the update that moves it out of BOOKED), then never
-- changes: a restructure, recast or the application itself cannot move it.
CREATE OR REPLACE FUNCTION lending_loan_original_maturity() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD."status" = 'BOOKED' THEN
    NEW."originalMaturityDate" := NEW."maturityDate";
  ELSIF OLD."originalMaturityDate" IS NOT NULL THEN
    NEW."originalMaturityDate" := OLD."originalMaturityDate";
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "LoanAccount_original_maturity" ON "LoanAccount";
CREATE TRIGGER "LoanAccount_original_maturity"
  BEFORE INSERT OR UPDATE ON "LoanAccount"
  FOR EACH ROW EXECUTE FUNCTION lending_loan_original_maturity();

-- The regulatory reserve appropriation (D-115) is tenant-level money: it
-- belongs to no loan, like the year-end close.
ALTER TABLE "FinancialEvent" DROP CONSTRAINT IF EXISTS "FinancialEvent_tenant_level_check";
ALTER TABLE "FinancialEvent" ADD CONSTRAINT "FinancialEvent_tenant_level_check"
  CHECK ("loanAccountId" IS NOT NULL OR "type" IN ('SUSPENSE_RECEIPT', 'SUSPENSE_REFUND', 'REVERSAL', 'LC_ISSUE', 'LC_FEE', 'LC_DRAWING', 'LC_RELEASE', 'YEAR_END_CLOSE', 'REGULATORY_RESERVE'));
