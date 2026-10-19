-- CreateTable
CREATE TABLE "TenantLendingSettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "settings" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "makerId" TEXT NOT NULL,
    "checkerId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantLendingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledJobClaim" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "runKey" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),

    CONSTRAINT "ScheduledJobClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantLendingSettings_tenantId_status_idx" ON "TenantLendingSettings"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TenantLendingSettings_tenantId_version_key" ON "TenantLendingSettings"("tenantId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "TenantLendingSettings_tenantId_id_key" ON "TenantLendingSettings"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledJobClaim_tenantId_job_runKey_key" ON "ScheduledJobClaim"("tenantId", "job", "runKey");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledJobClaim_tenantId_id_key" ON "ScheduledJobClaim"("tenantId", "id");



-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for tenant lending settings and job claims.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "TenantLendingSettings" ADD CONSTRAINT "TenantLendingSettings_status_check"
  CHECK ("status" IN ('PENDING', 'ACTIVE', 'REJECTED', 'RETIRED'));
ALTER TABLE "TenantLendingSettings" ADD CONSTRAINT "TenantLendingSettings_maker_checker_check"
  CHECK ("checkerId" IS NULL OR "checkerId" <> "makerId");
ALTER TABLE "TenantLendingSettings" ADD CONSTRAINT "TenantLendingSettings_decided_check"
  CHECK ("status" NOT IN ('ACTIVE', 'RETIRED') OR "checkerId" IS NOT NULL);
ALTER TABLE "TenantLendingSettings" ADD CONSTRAINT "TenantLendingSettings_settings_check"
  CHECK (jsonb_typeof("settings") = 'object');
-- One version in force per tenant.
CREATE UNIQUE INDEX "TenantLendingSettings_one_active" ON "TenantLendingSettings" ("tenantId") WHERE "status" = 'ACTIVE';

ALTER TABLE "ScheduledJobClaim" ADD CONSTRAINT "ScheduledJobClaim_keys_check"
  CHECK (length("job") BETWEEN 1 AND 100 AND length("runKey") BETWEEN 1 AND 100 AND length("holder") BETWEEN 1 AND 200);

ALTER TABLE "TenantLendingSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantLendingSettings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "TenantLendingSettings_tenant_isolation" ON "TenantLendingSettings"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "ScheduledJobClaim" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScheduledJobClaim" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ScheduledJobClaim_tenant_isolation" ON "ScheduledJobClaim"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
