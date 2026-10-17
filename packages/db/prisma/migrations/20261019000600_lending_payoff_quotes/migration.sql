-- CreateTable
CREATE TABLE "PayoffQuote" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL DEFAULT '',
    "recipientReference" TEXT NOT NULL DEFAULT '',
    "issuedOn" DATE NOT NULL,
    "expiresOn" DATE NOT NULL,
    "currency" TEXT NOT NULL,
    "goodThrough" JSONB NOT NULL,
    "perDiem" DECIMAL(24,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "settlementEventId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoffQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayoffQuote_tenantId_loanAccountId_idx" ON "PayoffQuote"("tenantId", "loanAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoffQuote_tenantId_id_key" ON "PayoffQuote"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PayoffQuote_tenantId_reference_key" ON "PayoffQuote"("tenantId", "reference");

-- AddForeignKey
ALTER TABLE "PayoffQuote" ADD CONSTRAINT "PayoffQuote_tenantId_loanAccountId_fkey" FOREIGN KEY ("tenantId", "loanAccountId") REFERENCES "LoanAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for payoff letters.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "PayoffQuote" ADD CONSTRAINT "PayoffQuote_purpose_check" CHECK ("purpose" IN ('BORROWER', 'TAKEOVER'));
ALTER TABLE "PayoffQuote" ADD CONSTRAINT "PayoffQuote_status_check" CHECK ("status" IN ('ISSUED', 'USED', 'CANCELLED'));
ALTER TABLE "PayoffQuote" ADD CONSTRAINT "PayoffQuote_dates_check" CHECK ("expiresOn" >= "issuedOn");
ALTER TABLE "PayoffQuote" ADD CONSTRAINT "PayoffQuote_used_check" CHECK (("status" = 'USED') = ("settlementEventId" IS NOT NULL));

ALTER TABLE "PayoffQuote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PayoffQuote" FORCE ROW LEVEL SECURITY;
CREATE POLICY "PayoffQuote_tenant_isolation" ON "PayoffQuote"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
