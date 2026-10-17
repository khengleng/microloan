-- AlterTable
ALTER TABLE "OutboxMessage" ADD COLUMN     "webhooksQueuedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "topics" TEXT[],
    "secret" TEXT NOT NULL,
    "secretPrefix" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_APPROVAL',
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastDeliveryAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "disabledReason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "outboxMessageId" TEXT,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseStatus" INTEGER,
    "lastError" TEXT NOT NULL DEFAULT '',
    "durationMs" INTEGER,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookEndpoint_tenantId_status_idx" ON "WebhookEndpoint"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEndpoint_tenantId_id_key" ON "WebhookEndpoint"("tenantId", "id");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_tenantId_endpointId_createdAt_idx" ON "WebhookDelivery"("tenantId", "endpointId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_tenantId_id_key" ON "WebhookDelivery"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_endpointId_outboxMessageId_key" ON "WebhookDelivery"("endpointId", "outboxMessageId");

-- CreateIndex
CREATE INDEX "OutboxMessage_webhooksQueuedAt_createdAt_idx" ON "OutboxMessage"("webhooksQueuedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_tenantId_endpointId_fkey" FOREIGN KEY ("tenantId", "endpointId") REFERENCES "WebhookEndpoint"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for tenant webhooks.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_status_check"
  CHECK ("status" IN ('PENDING_APPROVAL', 'ACTIVE', 'DISABLED'));
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_approval_check"
  CHECK ("approvedBy" IS NULL OR "approvedBy" <> "createdBy");
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_url_check"
  CHECK ("url" ~ '^https?://' AND length("url") <= 500);
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_status_check"
  CHECK ("status" IN ('PENDING', 'SENT', 'FAILED'));

ALTER TABLE "WebhookEndpoint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookEndpoint" FORCE ROW LEVEL SECURITY;
CREATE POLICY "WebhookEndpoint_tenant_isolation" ON "WebhookEndpoint"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "WebhookDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookDelivery" FORCE ROW LEVEL SECURITY;
CREATE POLICY "WebhookDelivery_tenant_isolation" ON "WebhookDelivery"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
