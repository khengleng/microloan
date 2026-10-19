-- AlterTable
ALTER TABLE "LoanAccount" ADD COLUMN     "downPaymentHeld" DECIMAL(24,4) NOT NULL DEFAULT 0,
ADD COLUMN     "downPaymentReceived" DECIMAL(24,4) NOT NULL DEFAULT 0;



-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for down payments and payees.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "LoanAccount" ADD CONSTRAINT "LoanAccount_down_payment_check"
  CHECK ("downPaymentReceived" >= 0 AND "downPaymentHeld" >= 0 AND "downPaymentHeld" <= "downPaymentReceived");
