-- CreateTable
CREATE TABLE "AltDataConsent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "grantId" TEXT,
    "purpose" TEXT NOT NULL DEFAULT '',
    "scope" TEXT NOT NULL DEFAULT '',
    "method" TEXT NOT NULL,
    "documentId" TEXT,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL DEFAULT '',
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AltDataConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AltDataRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "periodFrom" DATE NOT NULL,
    "periodTo" DATE NOT NULL,
    "documentId" TEXT NOT NULL,
    "consentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT NOT NULL DEFAULT '',
    "recordedBy" TEXT NOT NULL,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AltDataRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AltDataProviderConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "providerCode" TEXT NOT NULL,
    "endpointUrl" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "makerId" TEXT NOT NULL,
    "checkerId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AltDataProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AltDataConsent_tenantId_borrowerId_source_idx" ON "AltDataConsent"("tenantId", "borrowerId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "AltDataConsent_tenantId_id_key" ON "AltDataConsent"("tenantId", "id");

-- CreateIndex
CREATE INDEX "AltDataRecord_tenantId_borrowerId_kind_status_idx" ON "AltDataRecord"("tenantId", "borrowerId", "kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AltDataRecord_tenantId_id_key" ON "AltDataRecord"("tenantId", "id");

-- CreateIndex
CREATE INDEX "AltDataProviderConfig_tenantId_source_status_idx" ON "AltDataProviderConfig"("tenantId", "source", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AltDataProviderConfig_tenantId_id_key" ON "AltDataProviderConfig"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "AltDataConsent" ADD CONSTRAINT "AltDataConsent_tenantId_borrowerId_fkey" FOREIGN KEY ("tenantId", "borrowerId") REFERENCES "Borrower"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AltDataRecord" ADD CONSTRAINT "AltDataRecord_tenantId_borrowerId_fkey" FOREIGN KEY ("tenantId", "borrowerId") REFERENCES "Borrower"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AltDataRecord" ADD CONSTRAINT "AltDataRecord_tenantId_documentId_fkey" FOREIGN KEY ("tenantId", "documentId") REFERENCES "CustomerDocument"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AltDataRecord" ADD CONSTRAINT "AltDataRecord_tenantId_consentId_fkey" FOREIGN KEY ("tenantId", "consentId") REFERENCES "AltDataConsent"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;




-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for alternative data and consent.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "AltDataConsent" ADD CONSTRAINT "AltDataConsent_enums_check"
  CHECK ("action" IN ('GRANT', 'REVOKE')
     AND "source" IN ('INTERNAL_BEHAVIOUR', 'UTILITY_BILLS', 'TELCO_STATEMENT', 'RENT_HISTORY', 'BUSINESS_CASH_FLOW', 'SMARTPHONE_DATA', 'TELCO_DATA', 'EWALLET_DATA')
     AND "method" IN ('SIGNED_FORM', 'RECORDED_VERBAL', 'BORROWER_PORTAL'));
-- A grant states its purpose and ends; a revocation names the grant it ends.
ALTER TABLE "AltDataConsent" ADD CONSTRAINT "AltDataConsent_shape_check"
  CHECK (("action" = 'GRANT' AND "grantId" IS NULL AND "expiresAt" IS NOT NULL AND "expiresAt" > "effectiveAt" AND length(trim("purpose")) > 0)
      OR ("action" = 'REVOKE' AND "grantId" IS NOT NULL AND "expiresAt" IS NULL));
-- A grant is revoked at most once.
CREATE UNIQUE INDEX "AltDataConsent_one_revocation" ON "AltDataConsent" ("tenantId", "grantId") WHERE "action" = 'REVOKE';

-- A revocation must end a grant of the same borrower and source.
CREATE OR REPLACE FUNCTION lending_alt_data_consent_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.action = 'REVOKE' AND NOT EXISTS (
       SELECT 1 FROM "AltDataConsent" g
        WHERE g.id = NEW."grantId" AND g."tenantId" = NEW."tenantId" AND g.action = 'GRANT'
          AND g."borrowerId" = NEW."borrowerId" AND g.source = NEW.source
     ) THEN
    RAISE EXCEPTION 'lending: consent revocation % does not end a grant of this borrower and source', NEW.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "AltDataConsent_revocation_check" BEFORE INSERT ON "AltDataConsent"
  FOR EACH ROW EXECUTE FUNCTION lending_alt_data_consent_check();
-- Consent history is never edited: a withdrawal is a new row.
CREATE TRIGGER "AltDataConsent_append_only" BEFORE UPDATE OR DELETE ON "AltDataConsent"
  FOR EACH ROW EXECUTE FUNCTION lending_append_only();

ALTER TABLE "AltDataRecord" ADD CONSTRAINT "AltDataRecord_enums_check"
  CHECK ("kind" IN ('UTILITY_BILLS', 'TELCO_STATEMENT', 'RENT_HISTORY', 'BUSINESS_CASH_FLOW')
     AND "status" IN ('PENDING', 'VERIFIED', 'REJECTED'));
ALTER TABLE "AltDataRecord" ADD CONSTRAINT "AltDataRecord_period_check"
  CHECK ("periodFrom" <= "periodTo" AND jsonb_typeof("data") = 'object');
-- Verified (or rejected) by someone other than the officer who captured it.
ALTER TABLE "AltDataRecord" ADD CONSTRAINT "AltDataRecord_maker_checker_check"
  CHECK (("status" = 'PENDING' AND "verifiedBy" IS NULL)
      OR ("status" IN ('VERIFIED', 'REJECTED') AND "verifiedBy" IS NOT NULL AND "verifiedBy" <> "recordedBy" AND "verifiedAt" IS NOT NULL));

-- What was captured is frozen; the only change is the one-way verification decision.
CREATE OR REPLACE FUNCTION lending_alt_data_record_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF lending_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'lending: alternative data record % cannot be deleted', OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status <> 'PENDING'
     OR NEW.status NOT IN ('VERIFIED', 'REJECTED')
     OR (to_jsonb(NEW) - ARRAY['status', 'verifiedBy', 'verifiedAt', 'rejectionReason'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'verifiedBy', 'verifiedAt', 'rejectionReason']) THEN
    RAISE EXCEPTION 'lending: alternative data record % is immutable once decided; capture a new record', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "AltDataRecord_guard" BEFORE UPDATE OR DELETE ON "AltDataRecord"
  FOR EACH ROW EXECUTE FUNCTION lending_alt_data_record_guard();

ALTER TABLE "AltDataProviderConfig" ADD CONSTRAINT "AltDataProviderConfig_enums_check"
  CHECK ("source" IN ('SMARTPHONE_DATA', 'TELCO_DATA', 'EWALLET_DATA')
     AND "status" IN ('PENDING', 'ACTIVE', 'REJECTED', 'DISABLED'));
-- Credentials are stored only as field-encrypted ciphertext.
ALTER TABLE "AltDataProviderConfig" ADD CONSTRAINT "AltDataProviderConfig_encrypted_check"
  CHECK ("credentials" LIKE 'enc:v1:%');
ALTER TABLE "AltDataProviderConfig" ADD CONSTRAINT "AltDataProviderConfig_maker_checker_check"
  CHECK (("checkerId" IS NULL OR "checkerId" <> "makerId") AND ("status" IN ('PENDING') OR "checkerId" IS NOT NULL));
-- One provider in force per data source.
CREATE UNIQUE INDEX "AltDataProviderConfig_one_active" ON "AltDataProviderConfig" ("tenantId", "source") WHERE "status" = 'ACTIVE';

-- Row-level security: the second wall behind the Prisma tenant guard.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['AltDataConsent','AltDataRecord','AltDataProviderConfig']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true)) '
      || 'WITH CHECK (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true))',
      t || '_tenant_isolation', t);
  END LOOP;
END $$;
