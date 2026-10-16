-- ═══════════════════════════════════════════════════════════════════════════
-- Lending facilities (Phase 2): revolving lines, overdrafts and staged
-- drawdowns.
--
-- "Facility" and "Drawdown" shipped in the Phase 1 migration as structure
-- only: no code path ever inserted into either, so both are empty and are
-- recreated here rather than widened with a dozen NOT NULL columns. If a
-- deployment did somehow write to them, this migration must be reviewed
-- before it is applied — it discards their contents.
--
-- The drawn balance itself is NOT modelled here. A facility's balance,
-- accrual, repayments, delinquency and journals live on its LoanAccount,
-- exactly as for a term loan, so there is one servicing path and one set of
-- accounting invariants. These tables own only what a limit adds.
-- ═══════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS "Drawdown";
DROP TABLE IF EXISTS "Facility";

CREATE TABLE "Facility" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "portfolioId" TEXT,
    "legalEntityId" TEXT,
    "productId" TEXT NOT NULL,
    "productVersionId" TEXT NOT NULL,
    "familyCode" TEXT NOT NULL,
    "facilityType" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "agreementId" TEXT NOT NULL,
    "limitReinstates" BOOLEAN NOT NULL,
    "limitAmount" DECIMAL(24,4) NOT NULL,
    "availabilityFrom" DATE NOT NULL,
    "availabilityTo" DATE NOT NULL,
    "maturityDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "totalDrawn" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "chargesRaised" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "lastAccrualDate" DATE,
    "lastStatementTo" DATE,
    "suspendedAt" TIMESTAMP(3),
    "suspendedReason" TEXT,
    "termedOutAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Drawdown" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "valueDate" DATE NOT NULL,
    "trancheCode" TEXT,
    "purpose" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "eventId" TEXT,
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "releasedBy" TEXT,
    "releasedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "idempotencyKey" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Drawdown_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FacilityCondition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "trancheCode" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "evidence" TEXT,
    "satisfiedBy" TEXT,
    "satisfiedAt" TIMESTAMP(3),
    "waivedBy" TEXT,
    "waivedAt" TIMESTAMP(3),
    "waiverReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacilityCondition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FacilityStatement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "openingBalance" DECIMAL(24,4) NOT NULL,
    "drawdowns" DECIMAL(24,4) NOT NULL,
    "repayments" DECIMAL(24,4) NOT NULL,
    "interest" DECIMAL(24,4) NOT NULL,
    "overlimitInterest" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "commitmentFee" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "closingBalance" DECIMAL(24,4) NOT NULL,
    "chargesRaised" DECIMAL(24,4) NOT NULL,
    "minimumPayment" DECIMAL(24,4),
    "minimumPaymentDue" DATE,
    "calculation" JSONB NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacilityStatement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FacilityLimitChange" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "previousLimit" DECIMAL(24,4) NOT NULL,
    "newLimit" DECIMAL(24,4) NOT NULL,
    "changeType" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacilityLimitChange_pkey" PRIMARY KEY ("id")
);

-- ── Keys and indexes ───────────────────────────────────────────────────────

CREATE UNIQUE INDEX "Facility_tenantId_id_key" ON "Facility"("tenantId", "id");
CREATE UNIQUE INDEX "Facility_tenantId_reference_key" ON "Facility"("tenantId", "reference");
CREATE UNIQUE INDEX "Facility_agreementId_key" ON "Facility"("agreementId");
CREATE UNIQUE INDEX "Facility_tenantId_agreementId_key" ON "Facility"("tenantId", "agreementId");
CREATE INDEX "Facility_tenantId_status_idx" ON "Facility"("tenantId", "status");
CREATE INDEX "Facility_tenantId_borrowerId_idx" ON "Facility"("tenantId", "borrowerId");
CREATE INDEX "Facility_tenantId_branchId_idx" ON "Facility"("tenantId", "branchId");

CREATE UNIQUE INDEX "Drawdown_tenantId_id_key" ON "Drawdown"("tenantId", "id");
CREATE UNIQUE INDEX "Drawdown_facilityId_sequence_key" ON "Drawdown"("facilityId", "sequence");
CREATE UNIQUE INDEX "Drawdown_eventId_key" ON "Drawdown"("eventId");
-- Settles concurrent first attempts of the same drawdown request.
CREATE UNIQUE INDEX "Drawdown_tenantId_idempotencyKey_key" ON "Drawdown"("tenantId", "idempotencyKey");
CREATE INDEX "Drawdown_tenantId_facilityId_status_idx" ON "Drawdown"("tenantId", "facilityId", "status");

CREATE UNIQUE INDEX "FacilityCondition_tenantId_id_key" ON "FacilityCondition"("tenantId", "id");
CREATE UNIQUE INDEX "FacilityCondition_facilityId_trancheCode_code_key" ON "FacilityCondition"("facilityId", "trancheCode", "code");
CREATE INDEX "FacilityCondition_tenantId_facilityId_idx" ON "FacilityCondition"("tenantId", "facilityId");

CREATE UNIQUE INDEX "FacilityStatement_tenantId_id_key" ON "FacilityStatement"("tenantId", "id");
CREATE UNIQUE INDEX "FacilityStatement_facilityId_sequence_key" ON "FacilityStatement"("facilityId", "sequence");
CREATE INDEX "FacilityStatement_tenantId_facilityId_periodEnd_idx" ON "FacilityStatement"("tenantId", "facilityId", "periodEnd");

CREATE UNIQUE INDEX "FacilityLimitChange_tenantId_id_key" ON "FacilityLimitChange"("tenantId", "id");
CREATE INDEX "FacilityLimitChange_tenantId_facilityId_createdAt_idx" ON "FacilityLimitChange"("tenantId", "facilityId", "createdAt");

-- Every child references its parent by (tenantId, id), so the database itself
-- rejects a cross-tenant reference.
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Drawdown" ADD CONSTRAINT "Drawdown_tenantId_facilityId_fkey"
  FOREIGN KEY ("tenantId", "facilityId") REFERENCES "Facility"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FacilityCondition" ADD CONSTRAINT "FacilityCondition_tenantId_facilityId_fkey"
  FOREIGN KEY ("tenantId", "facilityId") REFERENCES "Facility"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FacilityStatement" ADD CONSTRAINT "FacilityStatement_tenantId_facilityId_fkey"
  FOREIGN KEY ("tenantId", "facilityId") REFERENCES "Facility"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FacilityLimitChange" ADD CONSTRAINT "FacilityLimitChange_tenantId_facilityId_fkey"
  FOREIGN KEY ("tenantId", "facilityId") REFERENCES "Facility"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for lending facilities.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs, so tests run against the same rules
-- production enforces. Keep it to constraints, triggers and policies — no
-- table or index DDL, which `prisma db push` has already created there.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Amount and window invariants ───────────────────────────────────────────
-- The service checks these too; the database is what makes them true of every
-- row, including one written by a raw query or a console session.

ALTER TABLE "Facility" ADD CONSTRAINT "Facility_amounts_check"
  CHECK ("limitAmount" > 0 AND "totalDrawn" >= 0 AND "chargesRaised" >= 0);
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_window_check"
  CHECK ("availabilityTo" >= "availabilityFrom" AND "maturityDate" >= "availabilityTo");
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_type_check"
  CHECK ("facilityType" IN ('REVOLVING', 'OVERDRAFT', 'STAGED_DRAWDOWN'));
-- A staged drawdown's limit never reinstates; the other two always do.
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_reinstatement_check"
  CHECK ("limitReinstates" = ("facilityType" <> 'STAGED_DRAWDOWN'));

ALTER TABLE "Drawdown" ADD CONSTRAINT "Drawdown_amount_check" CHECK (amount > 0);
-- A released drawdown must carry the event that posted it, and an unreleased
-- one must not: the link is what makes money movement traceable.
ALTER TABLE "Drawdown" ADD CONSTRAINT "Drawdown_release_check"
  CHECK (("status" = 'RELEASED') = ("eventId" IS NOT NULL));

ALTER TABLE "FacilityStatement" ADD CONSTRAINT "FacilityStatement_period_check"
  CHECK ("periodEnd" > "periodStart");
ALTER TABLE "FacilityStatement" ADD CONSTRAINT "FacilityStatement_amounts_check"
  CHECK ("drawdowns" >= 0 AND "repayments" >= 0 AND "interest" >= 0
     AND "overlimitInterest" >= 0 AND "commitmentFee" >= 0 AND "chargesRaised" >= 0);

ALTER TABLE "FacilityLimitChange" ADD CONSTRAINT "FacilityLimitChange_amounts_check"
  CHECK ("previousLimit" >= 0 AND "newLimit" > 0);

-- ── Immutability ───────────────────────────────────────────────────────────
-- Same rules as Phase 1: history is append-only and corrections are new rows.
-- lending_append_only() and lending_purge_allowed() are created by the Phase 1
-- migration; only the tenant GDPR purge may delete, by opting in with
-- SET LOCAL lending.purge = 'on'.

CREATE TRIGGER "FacilityStatement_append_only"
  BEFORE UPDATE OR DELETE ON "FacilityStatement"
  FOR EACH ROW EXECUTE FUNCTION lending_append_only();

-- A released drawdown is money that has left the building: its terms freeze.
CREATE OR REPLACE FUNCTION lending_drawdown_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('REQUESTED', 'CANCELLED') OR lending_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'lending: drawdown % (%) cannot be deleted', OLD.id, OLD.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status = 'RELEASED' AND (
       NEW.amount IS DISTINCT FROM OLD.amount OR
       NEW."valueDate" IS DISTINCT FROM OLD."valueDate" OR
       NEW."trancheCode" IS DISTINCT FROM OLD."trancheCode" OR
       NEW."eventId" IS DISTINCT FROM OLD."eventId" OR
       NEW."facilityId" IS DISTINCT FROM OLD."facilityId" OR
       NEW.status IS DISTINCT FROM OLD.status
     ) THEN
    RAISE EXCEPTION 'lending: drawdown % is released and immutable; reverse the disbursement instead', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Drawdown_guard" BEFORE UPDATE OR DELETE ON "Drawdown"
  FOR EACH ROW EXECUTE FUNCTION lending_drawdown_guard();

-- A limit change freezes once it is decided; a further change is a new row.
CREATE OR REPLACE FUNCTION lending_limit_change_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'REQUESTED' OR lending_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'lending: limit change % (%) cannot be deleted', OLD.id, OLD.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status <> 'REQUESTED' THEN
    RAISE EXCEPTION 'lending: limit change % is % and immutable; raise a new change', OLD.id, OLD.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."previousLimit" IS DISTINCT FROM OLD."previousLimit"
     OR NEW."newLimit" IS DISTINCT FROM OLD."newLimit"
     OR NEW."changeType" IS DISTINCT FROM OLD."changeType"
     OR NEW."effectiveDate" IS DISTINCT FROM OLD."effectiveDate"
     OR NEW."requestedBy" IS DISTINCT FROM OLD."requestedBy" THEN
    RAISE EXCEPTION 'lending: the terms of limit change % cannot be edited', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "FacilityLimitChange_guard" BEFORE UPDATE OR DELETE ON "FacilityLimitChange"
  FOR EACH ROW EXECUTE FUNCTION lending_limit_change_guard();

-- A satisfied or waived condition is the evidence a drawdown was released on.
CREATE OR REPLACE FUNCTION lending_facility_condition_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'PENDING' OR lending_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'lending: facility condition % (%) cannot be deleted', OLD.id, OLD.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'lending: facility condition % is already %', OLD.id, OLD.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "FacilityCondition_guard" BEFORE UPDATE OR DELETE ON "FacilityCondition"
  FOR EACH ROW EXECUTE FUNCTION lending_facility_condition_guard();

-- ── Row-level security ─────────────────────────────────────────────────────
-- The second wall, as in Phase 1: inside a transaction that has declared its
-- tenant, rows of any other tenant are invisible and unwritable, including to
-- raw SQL. With no tenant declared the policy is permissive, so platform,
-- system and legacy paths are unaffected.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Facility','Drawdown','FacilityCondition','FacilityStatement','FacilityLimitChange']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true)) '
      || 'WITH CHECK (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true))',
      t || '_tenant_isolation', t);
  END LOOP;
END $$;
