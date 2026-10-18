-- CreateTable
CREATE TABLE "Scorecard" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "templateCode" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scorecard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScorecardVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scorecardId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "definition" JSONB NOT NULL,
    "definitionHash" TEXT NOT NULL,
    "changeSummary" TEXT NOT NULL DEFAULT '',
    "makerId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "checkerId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "activatedBy" TEXT,
    "activatedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScorecardVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreEvaluation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productVersionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "scorecardCode" TEXT NOT NULL,
    "scorecardVersionId" TEXT,
    "version" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "definitionHash" TEXT NOT NULL,
    "thinFile" BOOLEAN NOT NULL DEFAULT false,
    "inputs" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "score" INTEGER NOT NULL,
    "grade" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "strategy" JSONB NOT NULL,
    "drivesDecision" BOOLEAN NOT NULL,
    "currency" TEXT NOT NULL,
    "requestedAmount" DECIMAL(24,4) NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "evaluatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Scorecard_tenantId_code_key" ON "Scorecard"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Scorecard_tenantId_id_key" ON "Scorecard"("tenantId", "id");

-- CreateIndex
CREATE INDEX "ScorecardVersion_tenantId_status_idx" ON "ScorecardVersion"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ScorecardVersion_scorecardId_version_key" ON "ScorecardVersion"("scorecardId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ScorecardVersion_tenantId_id_key" ON "ScorecardVersion"("tenantId", "id");

-- CreateIndex
CREATE INDEX "ScoreEvaluation_tenantId_applicationId_createdAt_idx" ON "ScoreEvaluation"("tenantId", "applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "ScoreEvaluation_tenantId_scorecardCode_createdAt_idx" ON "ScoreEvaluation"("tenantId", "scorecardCode", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreEvaluation_tenantId_id_key" ON "ScoreEvaluation"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScorecardVersion" ADD CONSTRAINT "ScorecardVersion_tenantId_scorecardId_fkey" FOREIGN KEY ("tenantId", "scorecardId") REFERENCES "Scorecard"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEvaluation" ADD CONSTRAINT "ScoreEvaluation_tenantId_applicationId_fkey" FOREIGN KEY ("tenantId", "applicationId") REFERENCES "Application"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreEvaluation" ADD CONSTRAINT "ScoreEvaluation_tenantId_scorecardVersionId_fkey" FOREIGN KEY ("tenantId", "scorecardVersionId") REFERENCES "ScorecardVersion"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;




-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for scorecards and score evaluations.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "Scorecard" ADD CONSTRAINT "Scorecard_code_check"
  CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_.-]{1,47}$');
ALTER TABLE "ScorecardVersion" ADD CONSTRAINT "ScorecardVersion_status_check"
  CHECK ("status" IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ACTIVE', 'RETIRED'));
ALTER TABLE "ScorecardVersion" ADD CONSTRAINT "ScorecardVersion_version_check"
  CHECK ("version" >= 1);
ALTER TABLE "ScorecardVersion" ADD CONSTRAINT "ScorecardVersion_definition_check"
  CHECK (jsonb_typeof("definition") = 'object');
-- The checker is never the maker, and neither is whoever puts the version in force.
ALTER TABLE "ScorecardVersion" ADD CONSTRAINT "ScorecardVersion_maker_checker_check"
  CHECK (("checkerId" IS NULL OR "checkerId" <> "makerId") AND ("activatedBy" IS NULL OR "activatedBy" <> "makerId"));
ALTER TABLE "ScorecardVersion" ADD CONSTRAINT "ScorecardVersion_decided_check"
  CHECK ("status" IN ('DRAFT', 'SUBMITTED') OR "checkerId" IS NOT NULL);
ALTER TABLE "ScorecardVersion" ADD CONSTRAINT "ScorecardVersion_active_check"
  CHECK ("status" <> 'ACTIVE' OR ("activatedBy" IS NOT NULL AND "activatedAt" IS NOT NULL));
-- One version of a scorecard in force.
CREATE UNIQUE INDEX "ScorecardVersion_one_active" ON "ScorecardVersion" ("scorecardId") WHERE "status" = 'ACTIVE';

-- A scorecard version's definition is frozen once it leaves DRAFT, and its
-- status only moves forward. Score evaluations reference the version, so
-- editing it would rewrite the explanation of decisions already made.
CREATE OR REPLACE FUNCTION lending_scorecard_version_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'DRAFT' OR lending_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'lending: scorecard version % (%) cannot be deleted', OLD.id, OLD.status USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status <> 'DRAFT' AND (
       NEW.definition IS DISTINCT FROM OLD.definition OR
       NEW."definitionHash" IS DISTINCT FROM OLD."definitionHash" OR
       NEW.version IS DISTINCT FROM OLD.version OR
       NEW."scorecardId" IS DISTINCT FROM OLD."scorecardId" OR
       NEW."makerId" IS DISTINCT FROM OLD."makerId" OR
       NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
     ) THEN
    RAISE EXCEPTION 'lending: scorecard version % is % and immutable; create a new version', OLD.id, OLD.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'DRAFT' AND NEW.status = 'SUBMITTED') OR
       (OLD.status = 'SUBMITTED' AND NEW.status IN ('APPROVED', 'REJECTED', 'DRAFT')) OR
       (OLD.status = 'APPROVED' AND NEW.status IN ('ACTIVE', 'RETIRED')) OR
       (OLD.status = 'ACTIVE' AND NEW.status = 'RETIRED')
     ) THEN
    RAISE EXCEPTION 'lending: scorecard version % cannot move from % to %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ScorecardVersion_guard" BEFORE UPDATE OR DELETE ON "ScorecardVersion"
  FOR EACH ROW EXECUTE FUNCTION lending_scorecard_version_guard();

ALTER TABLE "ScoreEvaluation" ADD CONSTRAINT "ScoreEvaluation_enums_check"
  CHECK ("role" IN ('CHAMPION', 'CHALLENGER')
     AND "stage" IN ('APPLICATION', 'APPROVAL', 'RESCORE')
     AND "source" IN ('TENANT', 'TEMPLATE')
     AND "outcome" IN ('AUTO_APPROVE', 'REFER', 'DECLINE'));
-- Only the champion drives the decision; a challenger is always a shadow.
ALTER TABLE "ScoreEvaluation" ADD CONSTRAINT "ScoreEvaluation_shadow_check"
  CHECK ("drivesDecision" = ("role" = 'CHAMPION'));
-- A template scores as version 0 with no tenant version; a tenant version is numbered.
ALTER TABLE "ScoreEvaluation" ADD CONSTRAINT "ScoreEvaluation_source_check"
  CHECK (("source" = 'TEMPLATE' AND "scorecardVersionId" IS NULL AND "version" = 0)
      OR ("source" = 'TENANT' AND "scorecardVersionId" IS NOT NULL AND "version" >= 1));
ALTER TABLE "ScoreEvaluation" ADD CONSTRAINT "ScoreEvaluation_json_check"
  CHECK (jsonb_typeof("inputs") = 'object' AND jsonb_typeof("result") = 'object' AND jsonb_typeof("strategy") = 'object');
-- Every evaluation is kept exactly as it was made.
CREATE TRIGGER "ScoreEvaluation_append_only" BEFORE UPDATE OR DELETE ON "ScoreEvaluation"
  FOR EACH ROW EXECUTE FUNCTION lending_append_only();

-- Row-level security: the second wall behind the Prisma tenant guard.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Scorecard','ScorecardVersion','ScoreEvaluation']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true)) '
      || 'WITH CHECK (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true))',
      t || '_tenant_isolation', t);
  END LOOP;
END $$;
