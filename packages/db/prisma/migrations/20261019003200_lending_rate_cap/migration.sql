-- Interest-rate cap (NBC Prakas B7-017-109; DECISIONS D-102…D-109).
--
-- No table changes: the cap is resolved from configuration (the deployment
-- ceiling, Tenant."maxAnnualInterestRatePct", the product version's
-- pricing.regulatoryCapAnnualRate) and the lender's settings
-- (TenantLendingSettings.settings -> rateCap, JSON). A floating-rate reset
-- held at the cap in force records a new bound, REGULATORY_CAP (D-108).

-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for the interest-rate cap.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs, so tests run against the same rules
-- production enforces. Keep it to constraints, triggers and policies — no
-- table or index DDL, which `prisma db push` has already created there.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "RateReset" DROP CONSTRAINT IF EXISTS "RateReset_bound_check";
ALTER TABLE "RateReset" ADD CONSTRAINT "RateReset_bound_check"
  CHECK ("bound" IN ('BENCHMARK', 'FLOOR', 'CAP', 'REGULATORY_CAP'));
