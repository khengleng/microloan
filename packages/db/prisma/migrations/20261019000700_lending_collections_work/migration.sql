-- CreateTable
CREATE TABLE "CollectionTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "episodeFrom" DATE NOT NULL,
    "daysPastDue" INTEGER NOT NULL,
    "amountOverdue" DECIMAL(24,4) NOT NULL,
    "dueOn" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assignedTo" TEXT,
    "outcome" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "completedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuarantorDemand" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "guaranteeId" TEXT NOT NULL,
    "guarantorName" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "paid" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "issuedOn" DATE NOT NULL,
    "payBy" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "letter" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuarantorDemand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CollectionTask_tenantId_status_queue_idx" ON "CollectionTask"("tenantId", "status", "queue");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionTask_tenantId_id_key" ON "CollectionTask"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionTask_loanAccountId_stage_episodeFrom_key" ON "CollectionTask"("loanAccountId", "stage", "episodeFrom");

-- CreateIndex
CREATE INDEX "GuarantorDemand_tenantId_loanAccountId_idx" ON "GuarantorDemand"("tenantId", "loanAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "GuarantorDemand_tenantId_id_key" ON "GuarantorDemand"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "GuarantorDemand_tenantId_reference_key" ON "GuarantorDemand"("tenantId", "reference");

-- AddForeignKey
ALTER TABLE "CollectionTask" ADD CONSTRAINT "CollectionTask_tenantId_loanAccountId_fkey" FOREIGN KEY ("tenantId", "loanAccountId") REFERENCES "LoanAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuarantorDemand" ADD CONSTRAINT "GuarantorDemand_tenantId_loanAccountId_fkey" FOREIGN KEY ("tenantId", "loanAccountId") REFERENCES "LoanAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for collections work, guarantor demands and set-off.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "CollectionTask" ADD CONSTRAINT "CollectionTask_status_check" CHECK ("status" IN ('OPEN', 'DONE', 'CANCELLED'));
ALTER TABLE "CollectionTask" ADD CONSTRAINT "CollectionTask_action_check" CHECK ("action" IN ('SMS', 'CALL', 'VISIT', 'NOTICE', 'LEGAL_REVIEW'));
ALTER TABLE "GuarantorDemand" ADD CONSTRAINT "GuarantorDemand_status_check" CHECK ("status" IN ('OPEN', 'PAID', 'WITHDRAWN'));
ALTER TABLE "GuarantorDemand" ADD CONSTRAINT "GuarantorDemand_amounts_check" CHECK ("amount" > 0 AND "paid" >= 0 AND "paid" <= "amount");

ALTER TABLE "CollectionTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CollectionTask" FORCE ROW LEVEL SECURITY;
CREATE POLICY "CollectionTask_tenant_isolation" ON "CollectionTask"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "GuarantorDemand" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GuarantorDemand" FORCE ROW LEVEL SECURITY;
CREATE POLICY "GuarantorDemand_tenant_isolation" ON "GuarantorDemand"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
