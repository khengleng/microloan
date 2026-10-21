-- SaaS readiness (DECISIONS D-166…D-170):
--   * StripeWebhookEvent — Stripe deliveries already handled, by event id
--     (idempotent webhook), platform-only;
--   * CollectionPromise — promises to pay on lending loans, reviewed daily
--     after end of day (UC-59).

-- CreateTable
CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "livemode" BOOLEAN NOT NULL DEFAULT false,
    "tenantRef" TEXT,
    "outcome" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionPromise" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "taskId" TEXT,
    "amount" DECIMAL(24,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "promisedOn" DATE NOT NULL,
    "payBy" DATE NOT NULL,
    "graceDays" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "received" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "reviewedOn" DATE,
    "followUpTaskId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionPromise_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_outcome_reviewedAt_idx" ON "StripeWebhookEvent"("outcome", "reviewedAt");

-- CreateIndex
CREATE INDEX "CollectionPromise_tenantId_status_payBy_idx" ON "CollectionPromise"("tenantId", "status", "payBy");

-- CreateIndex
CREATE INDEX "CollectionPromise_tenantId_loanAccountId_idx" ON "CollectionPromise"("tenantId", "loanAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionPromise_tenantId_id_key" ON "CollectionPromise"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "CollectionPromise" ADD CONSTRAINT "CollectionPromise_tenantId_loanAccountId_fkey" FOREIGN KEY ("tenantId", "loanAccountId") REFERENCES "LoanAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- Invariants and the tenant wall.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "StripeWebhookEvent" ADD CONSTRAINT "StripeWebhookEvent_outcome_check"
  CHECK ("outcome" IN ('PROCESSED', 'IGNORED', 'NEEDS_REVIEW'));
ALTER TABLE "StripeWebhookEvent" ADD CONSTRAINT "StripeWebhookEvent_text_check"
  CHECK (length("id") BETWEEN 1 AND 255 AND length("type") BETWEEN 1 AND 255
         AND length("detail") <= 1000);
ALTER TABLE "StripeWebhookEvent" ADD CONSTRAINT "StripeWebhookEvent_review_check"
  CHECK (("reviewedAt" IS NULL) = ("reviewedBy" IS NULL));

ALTER TABLE "CollectionPromise" ADD CONSTRAINT "CollectionPromise_status_check"
  CHECK ("status" IN ('PENDING', 'KEPT', 'BROKEN', 'CANCELLED'));
ALTER TABLE "CollectionPromise" ADD CONSTRAINT "CollectionPromise_amount_check"
  CHECK ("amount" > 0 AND "received" >= 0);
ALTER TABLE "CollectionPromise" ADD CONSTRAINT "CollectionPromise_dates_check"
  CHECK ("payBy" >= "promisedOn" AND "graceDays" BETWEEN 0 AND 366);
ALTER TABLE "CollectionPromise" ADD CONSTRAINT "CollectionPromise_reviewed_check"
  CHECK (("status" = 'PENDING') = ("reviewedOn" IS NULL));
ALTER TABLE "CollectionPromise" ADD CONSTRAINT "CollectionPromise_note_check"
  CHECK (length("note") <= 1000);

-- Platform-only (docs/security/RLS.md): system or platform context only.
ALTER TABLE "StripeWebhookEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StripeWebhookEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "StripeWebhookEvent_platform_only" ON "StripeWebhookEvent"
  USING (current_setting('app.system', true) = 'on')
  WITH CHECK (current_setting('app.system', true) = 'on');

-- Strict tenant wall.
ALTER TABLE "CollectionPromise" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CollectionPromise" FORCE ROW LEVEL SECURITY;
CREATE POLICY "CollectionPromise_tenant_wall" ON "CollectionPromise"
  USING (current_setting('app.system', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.system', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true));
