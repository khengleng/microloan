-- Credit reports and the in-house bureau score (DECISIONS D-176…D-181).

-- CreateTable
CREATE TABLE "CreditReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "applicationId" TEXT,
    "trigger" TEXT NOT NULL,
    "consentId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "asOf" DATE NOT NULL,
    "inputs" JSONB NOT NULL,
    "inputsHash" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "score" INTEGER,
    "grade" TEXT,
    "noScoreReason" TEXT,
    "scorecardCode" TEXT NOT NULL,
    "scorecardVersion" INTEGER NOT NULL,
    "scorecardDefinitionHash" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreditReport_tenantId_borrowerId_createdAt_idx" ON "CreditReport"("tenantId", "borrowerId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditReport_tenantId_applicationId_createdAt_idx" ON "CreditReport"("tenantId", "applicationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditReport_tenantId_id_key" ON "CreditReport"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CreditReport_tenantId_reference_key" ON "CreditReport"("tenantId", "reference");

-- AddForeignKey
ALTER TABLE "CreditReport" ADD CONSTRAINT "CreditReport_tenantId_borrowerId_fkey" FOREIGN KEY ("tenantId", "borrowerId") REFERENCES "Borrower"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditReport" ADD CONSTRAINT "CreditReport_tenantId_consentId_fkey" FOREIGN KEY ("tenantId", "consentId") REFERENCES "AltDataConsent"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Invariants, immutability and the tenant wall.
-- ═══════════════════════════════════════════════════════════════════════════

-- A borrower may consent to their credit report being pulled (D-178).
ALTER TABLE "AltDataConsent" DROP CONSTRAINT "AltDataConsent_enums_check";
ALTER TABLE "AltDataConsent" ADD CONSTRAINT "AltDataConsent_enums_check"
  CHECK ("action" IN ('GRANT', 'REVOKE')
     AND "source" IN ('INTERNAL_BEHAVIOUR', 'UTILITY_BILLS', 'TELCO_STATEMENT', 'RENT_HISTORY', 'BUSINESS_CASH_FLOW', 'SMARTPHONE_DATA', 'TELCO_DATA', 'EWALLET_DATA', 'CREDIT_REPORT')
     AND "method" IN ('SIGNED_FORM', 'RECORDED_VERBAL', 'BORROWER_PORTAL'));

ALTER TABLE "CreditReport" ADD CONSTRAINT "CreditReport_enums_check"
  CHECK ("provider" IN ('INTERNAL', 'CBC')
     AND "purpose" IN ('NEW_APPLICATION', 'ACCOUNT_REVIEW', 'COLLECTIONS', 'CUSTOMER_REQUEST')
     AND "trigger" IN ('SCORING', 'STAFF')
     AND ("noScoreReason" IS NULL OR "noScoreReason" IN ('NO_HISTORY')));
-- A report is scored (score and grade) or says why it is not — never both, never neither.
ALTER TABLE "CreditReport" ADD CONSTRAINT "CreditReport_score_check"
  CHECK (("score" IS NOT NULL AND "grade" IS NOT NULL AND "noScoreReason" IS NULL)
      OR ("score" IS NULL AND "grade" IS NULL AND "noScoreReason" IS NOT NULL));
ALTER TABLE "CreditReport" ADD CONSTRAINT "CreditReport_shape_check"
  CHECK (jsonb_typeof("content") = 'object' AND jsonb_typeof("inputs") = 'object'
     AND "inputsHash" ~ '^[0-9a-f]{64}$' AND "contentHash" ~ '^[0-9a-f]{64}$'
     AND "scorecardVersion" >= 0 AND length("reference") BETWEEN 1 AND 60
     AND ("purpose" <> 'NEW_APPLICATION' OR "applicationId" IS NOT NULL));

-- Append-only: the report and its enquiry never change. The one change ever
-- allowed is filing the printable document, once.
CREATE OR REPLACE FUNCTION lending_credit_report_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF lending_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'lending: credit report % cannot be deleted', OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."documentId" IS NOT NULL OR NEW."documentId" IS NULL
     OR (to_jsonb(NEW) - 'documentId') IS DISTINCT FROM (to_jsonb(OLD) - 'documentId') THEN
    RAISE EXCEPTION 'lending: credit report % is immutable; pull a new report', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CreditReport_guard" BEFORE UPDATE OR DELETE ON "CreditReport"
  FOR EACH ROW EXECUTE FUNCTION lending_credit_report_guard();

-- Strict tenant wall (docs/security/RLS.md): no tenant declared, no rows.
ALTER TABLE "CreditReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CreditReport" FORCE ROW LEVEL SECURITY;
CREATE POLICY "CreditReport_tenant_wall" ON "CreditReport"
  USING (current_setting('app.system', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.system', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true));
