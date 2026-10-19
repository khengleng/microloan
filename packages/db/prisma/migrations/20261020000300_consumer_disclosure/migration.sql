-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "declaredExternalMonthlyPayments" DECIMAL(24,4),
ADD COLUMN     "declaredOtherLenders" INTEGER;

-- CreateTable
CREATE TABLE "KeyFactsStatement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "termsHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "languages" TEXT[],
    "documentIds" JSONB NOT NULL,
    "content" JSONB NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "generatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByType" TEXT,
    "acceptedById" TEXT,
    "acceptanceMethod" TEXT,
    "acceptanceDocumentId" TEXT,
    "loanAccountId" TEXT,

    CONSTRAINT "KeyFactsStatement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KeyFactsStatement_tenantId_applicationId_status_idx" ON "KeyFactsStatement"("tenantId", "applicationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "KeyFactsStatement_tenantId_applicationId_version_key" ON "KeyFactsStatement"("tenantId", "applicationId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "KeyFactsStatement_tenantId_id_key" ON "KeyFactsStatement"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "KeyFactsStatement" ADD CONSTRAINT "KeyFactsStatement_tenantId_applicationId_fkey" FOREIGN KEY ("tenantId", "applicationId") REFERENCES "Application"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Hand-written: constraints, immutability and row-level security ─────────

ALTER TABLE "Application" ADD CONSTRAINT "Application_declared_obligations_check"
  CHECK (("declaredExternalMonthlyPayments" IS NULL OR "declaredExternalMonthlyPayments" >= 0)
     AND ("declaredOtherLenders" IS NULL OR "declaredOtherLenders" BETWEEN 0 AND 50));

ALTER TABLE "KeyFactsStatement" ADD CONSTRAINT "KeyFactsStatement_enums_check"
  CHECK ("status" IN ('ISSUED', 'ACCEPTED', 'SUPERSEDED', 'BOOKED')
     AND ("acceptanceMethod" IS NULL OR "acceptanceMethod" IN ('SIGNED_FORM', 'PORTAL'))
     AND ("acceptedByType" IS NULL OR "acceptedByType" IN ('CUSTOMER', 'STAFF_ON_BEHALF')));
-- An accepted statement records who accepted it, how, and (for a signed form) the form.
ALTER TABLE "KeyFactsStatement" ADD CONSTRAINT "KeyFactsStatement_acceptance_check"
  CHECK (("acceptedAt" IS NULL) = ("acceptanceMethod" IS NULL)
     AND ("acceptedAt" IS NULL OR ("acceptedById" IS NOT NULL AND "acceptedByType" IS NOT NULL))
     AND ("acceptanceMethod" IS DISTINCT FROM 'SIGNED_FORM' OR "acceptanceDocumentId" IS NOT NULL)
     AND ("status" NOT IN ('ACCEPTED', 'BOOKED') OR "acceptedAt" IS NOT NULL)
     AND ("status" <> 'BOOKED' OR "loanAccountId" IS NOT NULL));
-- At most one statement in force (issued or accepted) per application.
CREATE UNIQUE INDEX "KeyFactsStatement_one_live" ON "KeyFactsStatement" ("tenantId", "applicationId")
  WHERE "status" IN ('ISSUED', 'ACCEPTED');

-- What was disclosed never changes; only its acceptance, supersession and booking are recorded.
CREATE OR REPLACE FUNCTION lending_key_facts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - ARRAY['status', 'acceptedAt', 'acceptedByType', 'acceptedById', 'acceptanceMethod', 'acceptanceDocumentId', 'loanAccountId'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'acceptedAt', 'acceptedByType', 'acceptedById', 'acceptanceMethod', 'acceptanceDocumentId', 'loanAccountId']) THEN
    RAISE EXCEPTION 'lending: key facts statement % is immutable; generate a new version', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NOT ((OLD.status = NEW.status)
       OR (OLD.status = 'ISSUED' AND NEW.status IN ('ACCEPTED', 'SUPERSEDED'))
       OR (OLD.status = 'ACCEPTED' AND NEW.status IN ('BOOKED', 'SUPERSEDED'))) THEN
    RAISE EXCEPTION 'lending: key facts statement % cannot move from % to %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."acceptedAt" IS NOT NULL AND (
       NEW."acceptedAt" IS DISTINCT FROM OLD."acceptedAt"
    OR NEW."acceptedById" IS DISTINCT FROM OLD."acceptedById"
    OR NEW."acceptanceMethod" IS DISTINCT FROM OLD."acceptanceMethod"
    OR NEW."acceptanceDocumentId" IS DISTINCT FROM OLD."acceptanceDocumentId") THEN
    RAISE EXCEPTION 'lending: the acceptance of key facts statement % is already recorded', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "KeyFactsStatement_guard" BEFORE UPDATE ON "KeyFactsStatement"
  FOR EACH ROW EXECUTE FUNCTION lending_key_facts_guard();

-- Row-level security: the second wall behind the Prisma tenant guard.
ALTER TABLE "KeyFactsStatement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KeyFactsStatement" FORCE ROW LEVEL SECURITY;
CREATE POLICY "KeyFactsStatement_tenant_isolation" ON "KeyFactsStatement"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
