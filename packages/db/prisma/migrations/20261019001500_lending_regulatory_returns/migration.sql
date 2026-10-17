-- CreateTable
CREATE TABLE "RegulatoryReturn" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "basis" TEXT NOT NULL,
    "periodId" TEXT,
    "content" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "generatedBy" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submissionRequestedBy" TEXT,
    "submissionRequestedAt" TIMESTAMP(3),
    "submittedBy" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submissionReference" TEXT NOT NULL DEFAULT '',
    "supersededById" TEXT,
    "comment" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegulatoryReturn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RegulatoryReturn_tenantId_year_month_idx" ON "RegulatoryReturn"("tenantId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryReturn_tenantId_id_key" ON "RegulatoryReturn"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RegulatoryReturn_tenantId_year_month_version_key" ON "RegulatoryReturn"("tenantId", "year", "month", "version");


-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for regulatory returns.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "RegulatoryReturn" ADD CONSTRAINT "RegulatoryReturn_status_check"
  CHECK ("status" IN ('DRAFT', 'PENDING_SUBMISSION', 'SUBMITTED', 'SUPERSEDED'));
ALTER TABLE "RegulatoryReturn" ADD CONSTRAINT "RegulatoryReturn_period_check"
  CHECK ("month" BETWEEN 1 AND 12 AND "year" BETWEEN 2000 AND 2200 AND "version" >= 1 AND "basis" IN ('CLOSED_PERIOD'));
-- Maker-checker: a return waiting for submission names who asked; a submitted
-- one names a different person who submitted it.
ALTER TABLE "RegulatoryReturn" ADD CONSTRAINT "RegulatoryReturn_submission_check"
  CHECK (
    ("status" <> 'PENDING_SUBMISSION' OR "submissionRequestedBy" IS NOT NULL)
    AND ("status" <> 'SUBMITTED' OR ("submissionRequestedBy" IS NOT NULL AND "submittedBy" IS NOT NULL
      AND "submittedAt" IS NOT NULL AND "submittedBy" <> "submissionRequestedBy"))
  );

-- A stored return is never edited or deleted: only its workflow moves, and a
-- submitted or superseded return is final (an amendment is a new version).
CREATE OR REPLACE FUNCTION regulatory_return_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'REGULATORY_RETURN_IMMUTABLE: regulatory returns are never deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."tenantId" <> OLD."tenantId" OR NEW."year" <> OLD."year" OR NEW."month" <> OLD."month"
     OR NEW."version" <> OLD."version" OR NEW."basis" <> OLD."basis"
     OR NEW."periodId" IS DISTINCT FROM OLD."periodId"
     OR NEW."content" IS DISTINCT FROM OLD."content" OR NEW."contentHash" <> OLD."contentHash"
     OR NEW."generatedBy" <> OLD."generatedBy" OR NEW."generatedAt" <> OLD."generatedAt" THEN
    RAISE EXCEPTION 'REGULATORY_RETURN_IMMUTABLE: the content of a regulatory return cannot change; generate a new version'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'SUBMITTED' AND (
       NEW."status" <> 'SUBMITTED'
       OR NEW."submittedBy" IS DISTINCT FROM OLD."submittedBy"
       OR NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt"
       OR NEW."submissionRequestedBy" IS DISTINCT FROM OLD."submissionRequestedBy"
       OR NEW."submissionReference" <> OLD."submissionReference") THEN
    RAISE EXCEPTION 'REGULATORY_RETURN_IMMUTABLE: a submitted return is final'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT ((OLD."status", NEW."status") IN (
      ('DRAFT', 'DRAFT'), ('DRAFT', 'PENDING_SUBMISSION'), ('DRAFT', 'SUPERSEDED'),
      ('PENDING_SUBMISSION', 'PENDING_SUBMISSION'), ('PENDING_SUBMISSION', 'SUBMITTED'),
      ('PENDING_SUBMISSION', 'DRAFT'), ('SUBMITTED', 'SUBMITTED'), ('SUPERSEDED', 'SUPERSEDED'))) THEN
    RAISE EXCEPTION 'REGULATORY_RETURN_IMMUTABLE: a return cannot move from % to %', OLD."status", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "RegulatoryReturn_guard" ON "RegulatoryReturn";
CREATE TRIGGER "RegulatoryReturn_guard" BEFORE UPDATE OR DELETE ON "RegulatoryReturn"
  FOR EACH ROW EXECUTE FUNCTION regulatory_return_guard();

ALTER TABLE "RegulatoryReturn" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RegulatoryReturn" FORCE ROW LEVEL SECURITY;
CREATE POLICY "RegulatoryReturn_tenant_isolation" ON "RegulatoryReturn"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
