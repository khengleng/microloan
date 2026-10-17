-- AlterTable
ALTER TABLE "TenantBusinessDate" ADD COLUMN     "lastBatchDate" DATE,
ADD COLUMN     "lastBatchFailures" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AccountingPeriod" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "checks" JSONB NOT NULL DEFAULT '[]',
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "preparedBy" TEXT,
    "preparedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "closingEventIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "reopenReason" TEXT NOT NULL DEFAULT '',
    "reopenRequestedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeriodCloseLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PeriodCloseLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountingPeriod_tenantId_status_idx" ON "AccountingPeriod"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingPeriod_tenantId_id_key" ON "AccountingPeriod"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingPeriod_tenantId_year_month_key" ON "AccountingPeriod"("tenantId", "year", "month");

-- CreateIndex
CREATE INDEX "PeriodCloseLog_tenantId_periodId_idx" ON "PeriodCloseLog"("tenantId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "PeriodCloseLog_tenantId_id_key" ON "PeriodCloseLog"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "PeriodCloseLog" ADD CONSTRAINT "PeriodCloseLog_tenantId_periodId_fkey" FOREIGN KEY ("tenantId", "periodId") REFERENCES "AccountingPeriod"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for period close.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_status_check"
  CHECK ("status" IN ('OPEN', 'PENDING', 'CLOSED', 'REOPEN_PENDING'));
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_month_check"
  CHECK ("month" BETWEEN 0 AND 12 AND "year" BETWEEN 2000 AND 2200 AND "endDate" >= "startDate");
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_closed_check"
  CHECK ("status" NOT IN ('CLOSED', 'REOPEN_PENDING') OR ("approvedBy" IS NOT NULL AND "closedAt" IS NOT NULL AND "approvedBy" <> "preparedBy"));
ALTER TABLE "PeriodCloseLog" ADD CONSTRAINT "PeriodCloseLog_action_check"
  CHECK ("action" IN ('PREPARED', 'APPROVED', 'REJECTED', 'REOPEN_REQUESTED', 'REOPENED', 'REOPEN_REJECTED'));

-- The year-end closing journal is the only event allowed without a loan beyond the existing tenant-level ones.
ALTER TABLE "FinancialEvent" DROP CONSTRAINT IF EXISTS "FinancialEvent_tenant_level_check";
ALTER TABLE "FinancialEvent" ADD CONSTRAINT "FinancialEvent_tenant_level_check"
  CHECK ("loanAccountId" IS NOT NULL OR "type" IN ('SUSPENSE_RECEIPT', 'SUSPENSE_REFUND', 'REVERSAL', 'LC_ISSUE', 'LC_FEE', 'LC_DRAWING', 'LC_RELEASE', 'YEAR_END_CLOSE'));

-- Period lock: no journal entry is dated in a closed month, whatever code path
-- writes it. The year-end closing journal is the one entry dated on the last
-- day of a closed year.
CREATE OR REPLACE FUNCTION lending_period_lock() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "AccountingPeriod" p
    WHERE p."tenantId" = NEW."tenantId" AND p."month" > 0
      AND p."status" IN ('CLOSED', 'REOPEN_PENDING')
      AND NEW."entryDate" BETWEEN p."startDate" AND p."endDate"
  ) AND NOT EXISTS (
    SELECT 1 FROM "FinancialEvent" e
    WHERE e."id" = NEW."financialEventId" AND e."type" = 'YEAR_END_CLOSE'
  ) THEN
    RAISE EXCEPTION 'PERIOD_CLOSED: the accounting period containing % is closed', NEW."entryDate"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "LendingJournalEntry_period_lock" ON "LendingJournalEntry";
CREATE TRIGGER "LendingJournalEntry_period_lock" BEFORE INSERT ON "LendingJournalEntry"
  FOR EACH ROW EXECUTE FUNCTION lending_period_lock();

ALTER TABLE "AccountingPeriod" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AccountingPeriod" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AccountingPeriod_tenant_isolation" ON "AccountingPeriod"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "PeriodCloseLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PeriodCloseLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY "PeriodCloseLog_tenant_isolation" ON "PeriodCloseLog"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
