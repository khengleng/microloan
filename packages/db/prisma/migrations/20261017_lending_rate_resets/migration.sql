-- ═══════════════════════════════════════════════════════════════════════════
-- Contractual floating-rate resets (Phase 2).
--
-- Additive: one new table. A reset is not a money movement — no cash moves
-- and nothing is posted — but it re-prices a booked contract, so it is held
-- to the same standard as one: append-only, one row per reset date per loan,
-- recording the observation it priced off and the agreement version it
-- produced. The schedule it replaced survives as the previous
-- AgreementVersion; nothing is overwritten.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE "RateReset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "resetDate" DATE NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "benchmarkCode" TEXT NOT NULL,
    "observationDate" DATE NOT NULL,
    "observedRate" DECIMAL(18,10) NOT NULL,
    "margin" DECIMAL(18,10) NOT NULL,
    "indicatedRate" DECIMAL(18,10) NOT NULL,
    "bound" TEXT NOT NULL,
    "previousAnnualRate" DECIMAL(18,10) NOT NULL,
    "newAnnualRate" DECIMAL(18,10) NOT NULL,
    "agreementVersion" INTEGER NOT NULL,
    "instalmentAmount" DECIMAL(24,4),
    "calculation" JSONB NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "appliedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateReset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RateReset_tenantId_id_key" ON "RateReset"("tenantId", "id");
-- A reset date re-prices a loan exactly once, however often the job runs.
CREATE UNIQUE INDEX "RateReset_loanAccountId_resetDate_key" ON "RateReset"("loanAccountId", "resetDate");
CREATE INDEX "RateReset_tenantId_loanAccountId_resetDate_idx" ON "RateReset"("tenantId", "loanAccountId", "resetDate");

-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for rate resets.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs, so tests run against the same rules
-- production enforces. Keep it to constraints, triggers and policies — no
-- table or index DDL, which `prisma db push` has already created there.
-- ═══════════════════════════════════════════════════════════════════════════

-- A reset must move forward in time and price off an observation that already
-- existed when it was taken.
ALTER TABLE "RateReset" ADD CONSTRAINT "RateReset_dates_check"
  CHECK ("effectiveFrom" >= "resetDate" AND "observationDate" <= "resetDate");
ALTER TABLE "RateReset" ADD CONSTRAINT "RateReset_rates_check"
  CHECK ("newAnnualRate" >= 0 AND "previousAnnualRate" >= 0 AND "agreementVersion" > 0);
ALTER TABLE "RateReset" ADD CONSTRAINT "RateReset_bound_check"
  CHECK ("bound" IN ('BENCHMARK', 'FLOOR', 'CAP'));

-- Append-only, like every other record of what a contract was priced at.
-- lending_append_only() is created by the Phase 1 migration.
CREATE TRIGGER "RateReset_append_only"
  BEFORE UPDATE OR DELETE ON "RateReset"
  FOR EACH ROW EXECUTE FUNCTION lending_append_only();

-- Row-level security: the second wall behind the Prisma tenant guard.
ALTER TABLE "RateReset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RateReset" FORCE ROW LEVEL SECURITY;
CREATE POLICY "RateReset_tenant_isolation" ON "RateReset"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
