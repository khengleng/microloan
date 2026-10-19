-- AlterTable
ALTER TABLE "FacilityLimitChange" ADD COLUMN     "renewalMonths" INTEGER;


-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for facility renewal.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "FacilityLimitChange" ADD CONSTRAINT "FacilityLimitChange_renewal_check"
  CHECK (("changeType" = 'RENEWAL') = ("renewalMonths" IS NOT NULL) AND ("renewalMonths" IS NULL OR "renewalMonths" BETWEEN 1 AND 120));
