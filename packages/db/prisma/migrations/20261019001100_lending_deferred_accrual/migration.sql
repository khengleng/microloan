-- AlterTable
ALTER TABLE "ScheduleInstalment" ADD COLUMN     "deferredAccrual" DECIMAL(24,4) NOT NULL DEFAULT 0;


-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for deferred accrual.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "ScheduleInstalment" ADD CONSTRAINT "ScheduleInstalment_deferred_accrual_check" CHECK ("deferredAccrual" >= 0);
