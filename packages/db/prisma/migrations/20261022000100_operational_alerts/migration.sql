-- Operational alerts raised by the health monitor (DECISIONS D-150…D-152).

-- CreateTable
CREATE TABLE "OperationalAlert" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "key" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "summary" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "lastNotifiedAt" TIMESTAMP(3),
    "lastDelivery" TEXT,
    "notifyCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationalAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OperationalAlert_tenantId_status_idx" ON "OperationalAlert"("tenantId", "status");

-- CreateIndex
CREATE INDEX "OperationalAlert_status_openedAt_idx" ON "OperationalAlert"("status", "openedAt");

-- AddForeignKey
ALTER TABLE "OperationalAlert" ADD CONSTRAINT "OperationalAlert_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Invariants and the tenant wall.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "OperationalAlert" ADD CONSTRAINT "OperationalAlert_status_check"
  CHECK ("status" IN ('OPEN', 'RESOLVED'));
ALTER TABLE "OperationalAlert" ADD CONSTRAINT "OperationalAlert_severity_check"
  CHECK ("severity" IN ('CRITICAL', 'WARNING'));
ALTER TABLE "OperationalAlert" ADD CONSTRAINT "OperationalAlert_resolved_check"
  CHECK (("status" = 'RESOLVED') = ("resolvedAt" IS NOT NULL));
ALTER TABLE "OperationalAlert" ADD CONSTRAINT "OperationalAlert_delivery_check"
  CHECK ("lastDelivery" IS NULL OR "lastDelivery" IN ('EMAIL', 'LOG_ONLY', 'FAILED'));
ALTER TABLE "OperationalAlert" ADD CONSTRAINT "OperationalAlert_text_check"
  CHECK (length("key") BETWEEN 1 AND 100 AND length("summary") BETWEEN 1 AND 500
         AND jsonb_typeof("details") = 'object');
-- One open alert per tenant (or the platform) and key.
CREATE UNIQUE INDEX "OperationalAlert_one_open"
  ON "OperationalAlert" (coalesce("tenantId", ''), "key") WHERE "status" = 'OPEN';

-- Strict tenant wall (docs/security/RLS.md): a tenant sees its own alerts;
-- platform alerts (tenantId NULL) only in system context.
ALTER TABLE "OperationalAlert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OperationalAlert" FORCE ROW LEVEL SECURITY;
CREATE POLICY "OperationalAlert_tenant_wall" ON "OperationalAlert"
  USING (current_setting('app.system', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.system', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true));
