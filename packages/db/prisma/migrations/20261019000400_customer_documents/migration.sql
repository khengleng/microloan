-- CreateTable
CREATE TABLE "CustomerDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "typeCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "applicationId" TEXT,
    "loanAccountId" TEXT,
    "legacyLoanId" TEXT,
    "collateralId" TEXT,
    "requestId" TEXT,
    "origin" TEXT NOT NULL,
    "customerVisible" BOOLEAN NOT NULL DEFAULT false,
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "issuedOn" DATE,
    "expiresOn" DATE,
    "expiryState" TEXT NOT NULL DEFAULT 'NONE',
    "reminderSentOn" DATE,
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "legalHoldReason" TEXT,
    "legalHoldBy" TEXT,
    "legalHoldAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "deletedAt" TIMESTAMP(3),
    "deletedBy" TEXT,
    "deletionReason" TEXT,
    "legacySource" TEXT,
    "legacyId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerDocumentVersion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploaderType" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "purgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "typeCode" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "applicationId" TEXT,
    "loanAccountId" TEXT,
    "dueOn" DATE,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "documentId" TEXT,
    "lastRejection" TEXT,
    "requestedBy" TEXT NOT NULL,
    "fulfilledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentRetentionRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "retentionYears" INTEGER NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentRetentionRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerDocument_tenantId_borrowerId_status_idx" ON "CustomerDocument"("tenantId", "borrowerId", "status");

-- CreateIndex
CREATE INDEX "CustomerDocument_tenantId_reviewStatus_idx" ON "CustomerDocument"("tenantId", "reviewStatus");

-- CreateIndex
CREATE INDEX "CustomerDocument_tenantId_expiresOn_idx" ON "CustomerDocument"("tenantId", "expiresOn");

-- CreateIndex
CREATE INDEX "CustomerDocument_tenantId_applicationId_idx" ON "CustomerDocument"("tenantId", "applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerDocument_tenantId_id_key" ON "CustomerDocument"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerDocument_tenantId_legacySource_legacyId_key" ON "CustomerDocument"("tenantId", "legacySource", "legacyId");

-- CreateIndex
CREATE INDEX "CustomerDocumentVersion_tenantId_documentId_idx" ON "CustomerDocumentVersion"("tenantId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerDocumentVersion_documentId_version_key" ON "CustomerDocumentVersion"("documentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerDocumentVersion_tenantId_id_key" ON "CustomerDocumentVersion"("tenantId", "id");

-- CreateIndex
CREATE INDEX "DocumentRequest_tenantId_borrowerId_status_idx" ON "DocumentRequest"("tenantId", "borrowerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentRequest_tenantId_id_key" ON "DocumentRequest"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentRetentionRule_tenantId_scope_code_key" ON "DocumentRetentionRule"("tenantId", "scope", "code");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentRetentionRule_tenantId_id_key" ON "DocumentRetentionRule"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "CustomerDocument" ADD CONSTRAINT "CustomerDocument_tenantId_borrowerId_fkey" FOREIGN KEY ("tenantId", "borrowerId") REFERENCES "Borrower"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDocumentVersion" ADD CONSTRAINT "CustomerDocumentVersion_tenantId_documentId_fkey" FOREIGN KEY ("tenantId", "documentId") REFERENCES "CustomerDocument"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentRequest" ADD CONSTRAINT "DocumentRequest_tenantId_borrowerId_fkey" FOREIGN KEY ("tenantId", "borrowerId") REFERENCES "Borrower"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;




-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for customer documents.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "CustomerDocument" ADD CONSTRAINT "CustomerDocument_category_check"
  CHECK ("category" IN ('KYC', 'APPLICATION', 'LOAN', 'COLLATERAL', 'AGREEMENT', 'GENERATED', 'OTHER'));
ALTER TABLE "CustomerDocument" ADD CONSTRAINT "CustomerDocument_origin_check"
  CHECK ("origin" IN ('STAFF', 'PORTAL', 'GENERATED', 'LEGACY'));
ALTER TABLE "CustomerDocument" ADD CONSTRAINT "CustomerDocument_review_check"
  CHECK ("reviewStatus" IN ('PENDING_REVIEW', 'ACCEPTED', 'REJECTED', 'NOT_REQUIRED'));
ALTER TABLE "CustomerDocument" ADD CONSTRAINT "CustomerDocument_expiry_state_check"
  CHECK ("expiryState" IN ('NONE', 'REMINDED', 'EXPIRED'));
ALTER TABLE "CustomerDocument" ADD CONSTRAINT "CustomerDocument_status_check"
  CHECK ("status" IN ('ACTIVE', 'DELETED'));
ALTER TABLE "CustomerDocument" ADD CONSTRAINT "CustomerDocument_version_check" CHECK ("currentVersion" >= 1);
ALTER TABLE "CustomerDocument" ADD CONSTRAINT "CustomerDocument_dates_check"
  CHECK ("issuedOn" IS NULL OR "expiresOn" IS NULL OR "expiresOn" >= "issuedOn");
-- A document under legal hold is never deleted; a deletion records who and why.
ALTER TABLE "CustomerDocument" ADD CONSTRAINT "CustomerDocument_hold_check"
  CHECK (NOT ("status" = 'DELETED' AND "legalHold"));
ALTER TABLE "CustomerDocument" ADD CONSTRAINT "CustomerDocument_deleted_check"
  CHECK ("status" <> 'DELETED' OR ("deletedAt" IS NOT NULL AND "deletedBy" IS NOT NULL AND coalesce("deletionReason", '') <> ''));
ALTER TABLE "CustomerDocument" ADD CONSTRAINT "CustomerDocument_legacy_check"
  CHECK (("legacySource" IS NULL) = ("legacyId" IS NULL)
     AND ("legacySource" IS NULL OR "legacySource" IN ('KYC_DOCUMENT', 'LOAN_DOCUMENT', 'APPLICATION_DOCUMENT')));

ALTER TABLE "CustomerDocumentVersion" ADD CONSTRAINT "CustomerDocumentVersion_version_check" CHECK ("version" >= 1);
ALTER TABLE "CustomerDocumentVersion" ADD CONSTRAINT "CustomerDocumentVersion_size_check" CHECK ("sizeBytes" >= 0);
ALTER TABLE "CustomerDocumentVersion" ADD CONSTRAINT "CustomerDocumentVersion_uploader_check"
  CHECK ("uploaderType" IN ('USER', 'CUSTOMER', 'SYSTEM'));
ALTER TABLE "CustomerDocumentVersion" ADD CONSTRAINT "CustomerDocumentVersion_review_check"
  CHECK ("reviewStatus" IN ('PENDING_REVIEW', 'ACCEPTED', 'REJECTED', 'NOT_REQUIRED'));
-- New files: a real checksum, and a key inside the tenant's own prefix.
ALTER TABLE "CustomerDocumentVersion" ADD CONSTRAINT "CustomerDocumentVersion_storage_check"
  CHECK ("storageProvider" LIKE 'LEGACY\_%'
     OR ("sha256" ~ '^[0-9a-f]{64}$'
         AND "storageKey" LIKE 'tenants/' || "tenantId" || '/customers/%'
         AND position('..' in "storageKey") = 0));

ALTER TABLE "DocumentRequest" ADD CONSTRAINT "DocumentRequest_status_check"
  CHECK ("status" IN ('OPEN', 'SUBMITTED', 'ACCEPTED', 'CANCELLED'));
ALTER TABLE "DocumentRetentionRule" ADD CONSTRAINT "DocumentRetentionRule_scope_check"
  CHECK ("scope" IN ('CATEGORY', 'TYPE'));
ALTER TABLE "DocumentRetentionRule" ADD CONSTRAINT "DocumentRetentionRule_years_check"
  CHECK ("retentionYears" BETWEEN 1 AND 100);

-- Library rows are never hard-deleted (soft delete only), except by the
-- opted-in tenant purge.
CREATE OR REPLACE FUNCTION customer_document_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF lending_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'documents: % rows are never deleted; use the retention deletion', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CustomerDocument_guard" BEFORE DELETE ON "CustomerDocument"
  FOR EACH ROW EXECUTE FUNCTION customer_document_guard();

-- A stored version is history: its file, checksum and uploader never change.
-- Only the review outcome and the purge marker may be written.
CREATE OR REPLACE FUNCTION customer_document_version_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF lending_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'documents: document versions are never deleted'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['reviewStatus', 'reviewedBy', 'reviewedAt', 'rejectionReason', 'purgedAt'])
     = (to_jsonb(OLD) - ARRAY['reviewStatus', 'reviewedBy', 'reviewedAt', 'rejectionReason', 'purgedAt']) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'documents: version % of document % is immutable', OLD.version, OLD."documentId"
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
CREATE TRIGGER "CustomerDocumentVersion_guard" BEFORE UPDATE OR DELETE ON "CustomerDocumentVersion"
  FOR EACH ROW EXECUTE FUNCTION customer_document_version_guard();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['CustomerDocument', 'CustomerDocumentVersion', 'DocumentRequest', 'DocumentRetentionRule']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true))',
      t || '_tenant_isolation', t);
  END LOOP;
END $$;
