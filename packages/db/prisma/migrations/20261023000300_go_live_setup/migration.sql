-- Go-live setup checklist (DECISIONS D-171…D-175): the items a tenant
-- administrator marked "not applicable". The checklist is computed from real
-- data on every read; this table holds only those marks.

-- CreateTable
CREATE TABLE "GoLiveSetupWaiver" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "markedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoLiveSetupWaiver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoLiveSetupWaiver_tenantId_itemKey_key" ON "GoLiveSetupWaiver"("tenantId", "itemKey");

-- CreateIndex
CREATE UNIQUE INDEX "GoLiveSetupWaiver_tenantId_id_key" ON "GoLiveSetupWaiver"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "GoLiveSetupWaiver" ADD CONSTRAINT "GoLiveSetupWaiver_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Invariants and the tenant wall.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "GoLiveSetupWaiver" ADD CONSTRAINT "GoLiveSetupWaiver_item_check"
  CHECK ("itemKey" ~ '^[a-z][a-z0-9_]{1,59}$');
ALTER TABLE "GoLiveSetupWaiver" ADD CONSTRAINT "GoLiveSetupWaiver_reason_check"
  CHECK (length(btrim("reason")) BETWEEN 5 AND 500);
ALTER TABLE "GoLiveSetupWaiver" ADD CONSTRAINT "GoLiveSetupWaiver_marked_by_check"
  CHECK (length("markedBy") BETWEEN 1 AND 100);

-- Strict tenant wall (docs/security/RLS.md).
ALTER TABLE "GoLiveSetupWaiver" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GoLiveSetupWaiver" FORCE ROW LEVEL SECURITY;
CREATE POLICY "GoLiveSetupWaiver_tenant_wall" ON "GoLiveSetupWaiver"
  USING (current_setting('app.system', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.system', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true));
