-- AlterTable
ALTER TABLE "Borrower" ADD COLUMN     "amlNextReviewOn" DATE,
ADD COLUMN     "amlRiskFactors" JSONB,
ADD COLUMN     "amlRiskRatedAt" TIMESTAMP(3),
ADD COLUMN     "amlRiskRating" TEXT,
ADD COLUMN     "amlRiskScore" INTEGER,
ADD COLUMN     "amlScreenedAt" TIMESTAMP(3),
ADD COLUMN     "amlStatusChangedAt" TIMESTAMP(3),
ADD COLUMN     "amlStatusChangedBy" TEXT,
ADD COLUMN     "nationality" TEXT,
ADD COLUMN     "pep" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AmlWatchListVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "listCode" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "entryCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "makerId" TEXT NOT NULL,
    "checkerId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmlWatchListVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmlWatchListEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT NOT NULL,
    "listDate" DATE NOT NULL,
    "country" TEXT,
    "dateOfBirth" DATE,
    "reference" TEXT,
    "lineNo" INTEGER NOT NULL,

    CONSTRAINT "AmlWatchListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmlScreeningCase" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "screenedName" TEXT NOT NULL,
    "hits" JSONB NOT NULL,
    "topScore" DECIMAL(6,4) NOT NULL,
    "topType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "disposition" TEXT,
    "dispositionNote" TEXT NOT NULL DEFAULT '',
    "proposedBy" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmlScreeningCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmlRescreenJob" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "listVersionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "cursor" TEXT,
    "screened" INTEGER NOT NULL DEFAULT 0,
    "casesOpened" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "requestedBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmlRescreenJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmlEddRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceOfFunds" TEXT NOT NULL,
    "sourceOfWealth" TEXT NOT NULL,
    "documentReference" TEXT NOT NULL,
    "documentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "makerId" TEXT NOT NULL,
    "checkerId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmlEddRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AmlStrCase" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "loanAccountId" TEXT,
    "financialEventId" TEXT,
    "grounds" TEXT NOT NULL,
    "indicators" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "raisedBy" TEXT NOT NULL,
    "screeningCaseId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reviewNotes" TEXT NOT NULL DEFAULT '',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "cafiuReference" TEXT,
    "cafiuReportedOn" DATE,
    "reportedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmlStrCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AmlWatchListVersion_tenantId_status_idx" ON "AmlWatchListVersion"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AmlWatchListVersion_tenantId_listCode_version_key" ON "AmlWatchListVersion"("tenantId", "listCode", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AmlWatchListVersion_tenantId_id_key" ON "AmlWatchListVersion"("tenantId", "id");

-- CreateIndex
CREATE INDEX "AmlWatchListEntry_tenantId_versionId_idx" ON "AmlWatchListEntry"("tenantId", "versionId");

-- CreateIndex
CREATE UNIQUE INDEX "AmlWatchListEntry_tenantId_id_key" ON "AmlWatchListEntry"("tenantId", "id");

-- CreateIndex
CREATE INDEX "AmlScreeningCase_tenantId_status_idx" ON "AmlScreeningCase"("tenantId", "status");

-- CreateIndex
CREATE INDEX "AmlScreeningCase_tenantId_borrowerId_idx" ON "AmlScreeningCase"("tenantId", "borrowerId");

-- CreateIndex
CREATE UNIQUE INDEX "AmlScreeningCase_tenantId_reference_key" ON "AmlScreeningCase"("tenantId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "AmlScreeningCase_tenantId_id_key" ON "AmlScreeningCase"("tenantId", "id");

-- CreateIndex
CREATE INDEX "AmlRescreenJob_tenantId_status_idx" ON "AmlRescreenJob"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AmlRescreenJob_tenantId_id_key" ON "AmlRescreenJob"("tenantId", "id");

-- CreateIndex
CREATE INDEX "AmlEddRecord_tenantId_borrowerId_status_idx" ON "AmlEddRecord"("tenantId", "borrowerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AmlEddRecord_tenantId_id_key" ON "AmlEddRecord"("tenantId", "id");

-- CreateIndex
CREATE INDEX "AmlStrCase_tenantId_status_idx" ON "AmlStrCase"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AmlStrCase_tenantId_reference_key" ON "AmlStrCase"("tenantId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "AmlStrCase_tenantId_id_key" ON "AmlStrCase"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "AmlWatchListEntry" ADD CONSTRAINT "AmlWatchListEntry_tenantId_versionId_fkey" FOREIGN KEY ("tenantId", "versionId") REFERENCES "AmlWatchListVersion"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmlScreeningCase" ADD CONSTRAINT "AmlScreeningCase_tenantId_borrowerId_fkey" FOREIGN KEY ("tenantId", "borrowerId") REFERENCES "Borrower"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmlRescreenJob" ADD CONSTRAINT "AmlRescreenJob_tenantId_listVersionId_fkey" FOREIGN KEY ("tenantId", "listVersionId") REFERENCES "AmlWatchListVersion"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmlEddRecord" ADD CONSTRAINT "AmlEddRecord_tenantId_borrowerId_fkey" FOREIGN KEY ("tenantId", "borrowerId") REFERENCES "Borrower"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AmlStrCase" ADD CONSTRAINT "AmlStrCase_tenantId_borrowerId_fkey" FOREIGN KEY ("tenantId", "borrowerId") REFERENCES "Borrower"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Hand-written: constraints, guards and row-level security ───────────────

ALTER TABLE "Borrower" ADD CONSTRAINT "Borrower_aml_risk_check"
  CHECK (("amlRiskRating" IS NULL OR "amlRiskRating" IN ('LOW', 'MEDIUM', 'HIGH'))
     AND ("nationality" IS NULL OR "nationality" ~ '^[A-Z]{2}$'));

ALTER TABLE "AmlWatchListVersion" ADD CONSTRAINT "AmlWatchListVersion_enums_check"
  CHECK ("status" IN ('PENDING', 'ACTIVE', 'REJECTED', 'SUPERSEDED')
     AND "listCode" ~ '^[A-Z0-9_]{2,40}$'
     AND "version" >= 1 AND "entryCount" >= 0);
-- Maker-checker in the data: whoever uploaded a version cannot activate it.
ALTER TABLE "AmlWatchListVersion" ADD CONSTRAINT "AmlWatchListVersion_checker_check"
  CHECK ("checkerId" IS NULL OR "checkerId" <> "makerId");
-- One version of a list in force at a time.
CREATE UNIQUE INDEX "AmlWatchListVersion_one_active" ON "AmlWatchListVersion"("tenantId", "listCode") WHERE "status" = 'ACTIVE';

ALTER TABLE "AmlWatchListEntry" ADD CONSTRAINT "AmlWatchListEntry_type_check"
  CHECK ("entryType" IN ('SANCTION', 'PEP', 'INTERNAL'));
-- An uploaded list is evidence of what customers were screened against.
CREATE TRIGGER "AmlWatchListEntry_append_only" BEFORE UPDATE ON "AmlWatchListEntry"
  FOR EACH ROW EXECUTE FUNCTION lending_append_only();

ALTER TABLE "AmlScreeningCase" ADD CONSTRAINT "AmlScreeningCase_enums_check"
  CHECK ("status" IN ('OPEN', 'PENDING_APPROVAL', 'TRUE_MATCH', 'FALSE_POSITIVE')
     AND "topType" IN ('SANCTION', 'PEP', 'INTERNAL')
     AND "trigger" IN ('CUSTOMER_CREATE', 'CUSTOMER_UPDATE', 'ON_DEMAND', 'LIST_ACTIVATION', 'STATUS_CLEARANCE')
     AND ("disposition" IS NULL OR "disposition" IN ('TRUE_MATCH', 'FALSE_POSITIVE'))
     AND jsonb_typeof("hits") = 'array');
-- A disposed case was proposed by one person and decided by another.
ALTER TABLE "AmlScreeningCase" ADD CONSTRAINT "AmlScreeningCase_checker_check"
  CHECK ("status" NOT IN ('TRUE_MATCH', 'FALSE_POSITIVE')
      OR ("proposedBy" IS NOT NULL AND "decidedBy" IS NOT NULL AND "proposedBy" <> "decidedBy"));
-- At most one undisposed case per customer.
CREATE UNIQUE INDEX "AmlScreeningCase_one_open" ON "AmlScreeningCase"("tenantId", "borrowerId") WHERE "status" IN ('OPEN', 'PENDING_APPROVAL');
CREATE OR REPLACE FUNCTION lending_aml_case_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'lending: screening case % is an AML record and cannot be deleted', OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status IN ('TRUE_MATCH', 'FALSE_POSITIVE') THEN
    RAISE EXCEPTION 'lending: screening case % is disposed (%) and immutable', OLD.id, OLD.status USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "AmlScreeningCase_guard" BEFORE UPDATE OR DELETE ON "AmlScreeningCase"
  FOR EACH ROW EXECUTE FUNCTION lending_aml_case_guard();

ALTER TABLE "AmlRescreenJob" ADD CONSTRAINT "AmlRescreenJob_enums_check"
  CHECK ("status" IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED') AND "screened" >= 0 AND "casesOpened" >= 0);

ALTER TABLE "AmlEddRecord" ADD CONSTRAINT "AmlEddRecord_enums_check"
  CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED')
     AND "reason" IN ('HIGH_RISK', 'PEP')
     AND length(trim("sourceOfFunds")) > 0 AND length(trim("sourceOfWealth")) > 0
     AND length(trim("documentReference")) > 0);
ALTER TABLE "AmlEddRecord" ADD CONSTRAINT "AmlEddRecord_checker_check"
  CHECK ("checkerId" IS NULL OR "checkerId" <> "makerId");
CREATE UNIQUE INDEX "AmlEddRecord_one_pending" ON "AmlEddRecord"("tenantId", "borrowerId") WHERE "status" = 'PENDING';
CREATE OR REPLACE FUNCTION lending_aml_edd_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'lending: EDD record % is an AML record and cannot be deleted', OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."sourceOfFunds" IS DISTINCT FROM OLD."sourceOfFunds"
     OR NEW."sourceOfWealth" IS DISTINCT FROM OLD."sourceOfWealth"
     OR NEW."documentReference" IS DISTINCT FROM OLD."documentReference"
     OR NEW."makerId" IS DISTINCT FROM OLD."makerId"
     OR NEW."borrowerId" IS DISTINCT FROM OLD."borrowerId" THEN
    RAISE EXCEPTION 'lending: EDD record % cannot be edited; record a new one', OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'PENDING' AND NEW.status IN ('APPROVED', 'REJECTED', 'SUPERSEDED')) OR
       (OLD.status = 'APPROVED' AND NEW.status = 'SUPERSEDED')
     ) THEN
    RAISE EXCEPTION 'lending: EDD record % cannot move from % to %', OLD.id, OLD.status, NEW.status USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "AmlEddRecord_guard" BEFORE UPDATE OR DELETE ON "AmlEddRecord"
  FOR EACH ROW EXECUTE FUNCTION lending_aml_edd_guard();

ALTER TABLE "AmlStrCase" ADD CONSTRAINT "AmlStrCase_enums_check"
  CHECK ("status" IN ('OPEN', 'NO_FURTHER_ACTION', 'TO_REPORT', 'REPORTED')
     AND length(trim("grounds")) > 0
     AND ("status" <> 'REPORTED' OR ("cafiuReference" IS NOT NULL AND "cafiuReportedOn" IS NOT NULL)));
CREATE OR REPLACE FUNCTION lending_aml_str_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'lending: suspicious transaction referral % cannot be deleted', OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.grounds IS DISTINCT FROM OLD.grounds OR NEW."raisedBy" IS DISTINCT FROM OLD."raisedBy"
     OR NEW."borrowerId" IS DISTINCT FROM OLD."borrowerId" OR OLD.status = 'REPORTED' THEN
    RAISE EXCEPTION 'lending: suspicious transaction referral % cannot be changed that way', OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "AmlStrCase_guard" BEFORE UPDATE OR DELETE ON "AmlStrCase"
  FOR EACH ROW EXECUTE FUNCTION lending_aml_str_guard();

-- Row-level security: the second wall behind the Prisma tenant guard.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['AmlWatchListVersion','AmlWatchListEntry','AmlScreeningCase','AmlRescreenJob','AmlEddRecord','AmlStrCase']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true)) '
      || 'WITH CHECK (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true))',
      t || '_tenant_isolation', t);
  END LOOP;
END $$;
