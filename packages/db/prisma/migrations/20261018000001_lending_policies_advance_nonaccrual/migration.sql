-- AlterTable
ALTER TABLE "AgreementVersion" ADD COLUMN     "policies" JSONB;

-- AlterTable
ALTER TABLE "LoanAccount" ADD COLUMN     "advanceBalance" DECIMAL(24,4) NOT NULL DEFAULT 0,
ADD COLUMN     "interestInSuspense" DECIMAL(24,4) NOT NULL DEFAULT 0,
ADD COLUMN     "nonAccrual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nonAccrualSince" DATE;

-- CreateTable
CREATE TABLE "LendingPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LendingPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LendingPolicyVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "body" JSONB NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "changeSummary" TEXT NOT NULL DEFAULT '',
    "makerId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "checkerId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LendingPolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LendingPolicy_tenantId_kind_code_key" ON "LendingPolicy"("tenantId", "kind", "code");

-- CreateIndex
CREATE UNIQUE INDEX "LendingPolicy_tenantId_id_key" ON "LendingPolicy"("tenantId", "id");

-- CreateIndex
CREATE INDEX "LendingPolicyVersion_tenantId_status_idx" ON "LendingPolicyVersion"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LendingPolicyVersion_policyId_version_key" ON "LendingPolicyVersion"("policyId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "LendingPolicyVersion_tenantId_id_key" ON "LendingPolicyVersion"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "LendingPolicy" ADD CONSTRAINT "LendingPolicy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LendingPolicyVersion" ADD CONSTRAINT "LendingPolicyVersion_tenantId_policyId_fkey" FOREIGN KEY ("tenantId", "policyId") REFERENCES "LendingPolicy"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for loan policies, advances and non-accrual.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "LendingPolicy" ADD CONSTRAINT "LendingPolicy_kind_check"
  CHECK ("kind" IN ('PREPAYMENT', 'LATE_CHARGES', 'ALLOCATION', 'NON_ACCRUAL'));
ALTER TABLE "LendingPolicyVersion" ADD CONSTRAINT "LendingPolicyVersion_status_check"
  CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RETIRED'));
-- The checker is never the maker.
ALTER TABLE "LendingPolicyVersion" ADD CONSTRAINT "LendingPolicyVersion_maker_checker_check"
  CHECK ("checkerId" IS NULL OR "checkerId" <> "makerId");
ALTER TABLE "LoanAccount" ADD CONSTRAINT "LoanAccount_advance_nonneg_check"
  CHECK ("advanceBalance" >= 0 AND "interestInSuspense" >= 0);

-- A policy version leaves DRAFT once, and from then on its content is frozen;
-- status only moves forward (SUBMITTED → APPROVED/REJECTED, APPROVED → RETIRED).
-- Contracts reference approved versions, so editing one would silently change
-- the terms of loans already running.
CREATE OR REPLACE FUNCTION lending_policy_version_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'DRAFT' OR lending_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'lending: policy version % (%) cannot be deleted', OLD.id, OLD.status USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status <> 'DRAFT' AND (
       NEW.body IS DISTINCT FROM OLD.body OR
       NEW.parameters IS DISTINCT FROM OLD.parameters OR
       NEW."bodyHash" IS DISTINCT FROM OLD."bodyHash" OR
       NEW.version IS DISTINCT FROM OLD.version OR
       NEW."policyId" IS DISTINCT FROM OLD."policyId" OR
       NEW."makerId" IS DISTINCT FROM OLD."makerId"
     ) THEN
    RAISE EXCEPTION 'lending: policy version % is % and immutable; create a new version', OLD.id, OLD.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'DRAFT' AND NEW.status = 'SUBMITTED') OR
       (OLD.status = 'SUBMITTED' AND NEW.status IN ('APPROVED', 'REJECTED', 'DRAFT')) OR
       (OLD.status = 'APPROVED' AND NEW.status = 'RETIRED')
     ) THEN
    RAISE EXCEPTION 'lending: policy version % cannot move from % to %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "LendingPolicyVersion_guard" BEFORE UPDATE OR DELETE ON "LendingPolicyVersion"
  FOR EACH ROW EXECUTE FUNCTION lending_policy_version_guard();

-- Row-level security: the second wall behind the Prisma tenant guard.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['LendingPolicy','LendingPolicyVersion']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true)) '
      || 'WITH CHECK (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true))',
      t || '_tenant_isolation', t);
  END LOOP;
END $$;
