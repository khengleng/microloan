-- AlterTable
ALTER TABLE "User" ADD COLUMN     "totpLastStep" INTEGER;

-- CreateTable
CREATE TABLE "MfaChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformApproval" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "makerId" TEXT NOT NULL,
    "checkerId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT,
    "executedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantArchive" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tenantName" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "recordCounts" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantArchive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MfaChallenge_userId_idx" ON "MfaChallenge"("userId");

-- CreateIndex
CREATE INDEX "MfaChallenge_expiresAt_idx" ON "MfaChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "PlatformApproval_action_subjectId_status_idx" ON "PlatformApproval"("action", "subjectId", "status");

-- CreateIndex
CREATE INDEX "PlatformApproval_status_createdAt_idx" ON "PlatformApproval"("status", "createdAt");

-- CreateIndex
CREATE INDEX "TenantArchive_tenantId_createdAt_idx" ON "TenantArchive"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "MfaChallenge" ADD CONSTRAINT "MfaChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;




-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for platform MFA, platform approvals and tenant
-- archives (DECISIONS D-128…D-132).
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "User" ADD CONSTRAINT "User_totpLastStep_check"
  CHECK ("totpLastStep" IS NULL OR "totpLastStep" >= 0);

ALTER TABLE "MfaChallenge" ADD CONSTRAINT "MfaChallenge_consumed_check"
  CHECK ("consumedAt" IS NULL OR "consumedAt" >= "createdAt");

ALTER TABLE "PlatformApproval" ADD CONSTRAINT "PlatformApproval_action_check"
  CHECK ("action" IN ('SUPERADMIN_GRANT', 'TENANT_PURGE'));
ALTER TABLE "PlatformApproval" ADD CONSTRAINT "PlatformApproval_status_check"
  CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXECUTED'));
-- Maker-checker: the second super-administrator is never the requester.
ALTER TABLE "PlatformApproval" ADD CONSTRAINT "PlatformApproval_checker_check"
  CHECK ("checkerId" IS NULL OR "checkerId" <> "makerId");
-- An approved or executed request names its checker.
ALTER TABLE "PlatformApproval" ADD CONSTRAINT "PlatformApproval_approved_check"
  CHECK ("status" NOT IN ('APPROVED', 'EXECUTED') OR "checkerId" IS NOT NULL
         OR ("payload" ->> 'soleSuperadmin') = 'true');
-- One open request per action and subject.
CREATE UNIQUE INDEX "PlatformApproval_one_open_idx" ON "PlatformApproval"("action", "subjectId")
  WHERE "status" IN ('PENDING', 'APPROVED');

ALTER TABLE "TenantArchive" ADD CONSTRAINT "TenantArchive_sha256_check"
  CHECK ("sha256" ~ '^[0-9a-f]{64}$' AND "sizeBytes" >= 0);

-- An archive record is the evidence for the purge it allowed: never changed or removed.
CREATE OR REPLACE FUNCTION tenant_archive_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'TenantArchive rows are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "TenantArchive_immutable"
  BEFORE UPDATE OR DELETE ON "TenantArchive"
  FOR EACH ROW EXECUTE FUNCTION tenant_archive_immutable();

-- Platform-only tables: visible to platform and system sessions (no tenant
-- set), never to a session pinned to a tenant.
ALTER TABLE "PlatformApproval" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformApproval" FORCE ROW LEVEL SECURITY;
CREATE POLICY "PlatformApproval_platform_only" ON "PlatformApproval"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '')
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '');

ALTER TABLE "TenantArchive" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantArchive" FORCE ROW LEVEL SECURITY;
CREATE POLICY "TenantArchive_platform_only" ON "TenantArchive"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '')
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '');
