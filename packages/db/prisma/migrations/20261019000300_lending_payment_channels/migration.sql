-- CreateTable
CREATE TABLE "PaymentChannelSettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fxSpreadBps" INTEGER NOT NULL DEFAULT 0,
    "fxMaxRateAgeDays" INTEGER NOT NULL DEFAULT 0,
    "autoDebitMaxAttempts" INTEGER NOT NULL DEFAULT 3,
    "autoDebitRetryDays" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentChannelSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectDebitMandate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "mandateReference" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "consentDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "revokeReason" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectDebitMandate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoDebitAttempt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mandateId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "businessDate" DATE NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "failureCode" TEXT,
    "bankReference" TEXT,
    "financialEventId" TEXT,
    "unidentifiedPaymentId" TEXT,
    "nextRetryDate" DATE,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AutoDebitAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelFile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "employer" TEXT,
    "period" TEXT,
    "lineCount" INTEGER NOT NULL,
    "postedCount" INTEGER NOT NULL,
    "suspenseCount" INTEGER NOT NULL,
    "duplicateCount" INTEGER NOT NULL,
    "totals" JSONB NOT NULL,
    "businessDate" DATE NOT NULL,
    "importedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelFileLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "channelTxnId" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "reference" TEXT NOT NULL DEFAULT '',
    "loanRef" TEXT,
    "employeeRef" TEXT,
    "nationalIdHash" TEXT,
    "nationalIdHint" TEXT,
    "payerName" TEXT,
    "amount" DECIMAL(24,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "valueDate" DATE NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "loanAccountId" TEXT,
    "financialEventId" TEXT,
    "unidentifiedPaymentId" TEXT,
    "duplicateOfLineId" TEXT,
    "conflicting" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelFileLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentChannelSettings_tenantId_key" ON "PaymentChannelSettings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentChannelSettings_tenantId_id_key" ON "PaymentChannelSettings"("tenantId", "id");

-- CreateIndex
CREATE INDEX "DirectDebitMandate_tenantId_loanAccountId_idx" ON "DirectDebitMandate"("tenantId", "loanAccountId");

-- CreateIndex
CREATE INDEX "DirectDebitMandate_tenantId_status_idx" ON "DirectDebitMandate"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DirectDebitMandate_tenantId_mandateReference_key" ON "DirectDebitMandate"("tenantId", "mandateReference");

-- CreateIndex
CREATE UNIQUE INDEX "DirectDebitMandate_tenantId_id_key" ON "DirectDebitMandate"("tenantId", "id");

-- CreateIndex
CREATE INDEX "AutoDebitAttempt_tenantId_status_nextRetryDate_idx" ON "AutoDebitAttempt"("tenantId", "status", "nextRetryDate");

-- CreateIndex
CREATE INDEX "AutoDebitAttempt_tenantId_loanAccountId_idx" ON "AutoDebitAttempt"("tenantId", "loanAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "AutoDebitAttempt_tenantId_mandateId_dueDate_attemptNo_key" ON "AutoDebitAttempt"("tenantId", "mandateId", "dueDate", "attemptNo");

-- CreateIndex
CREATE UNIQUE INDEX "AutoDebitAttempt_tenantId_id_key" ON "AutoDebitAttempt"("tenantId", "id");

-- CreateIndex
CREATE INDEX "ChannelFile_tenantId_channel_businessDate_idx" ON "ChannelFile"("tenantId", "channel", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelFile_tenantId_kind_fileHash_key" ON "ChannelFile"("tenantId", "kind", "fileHash");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelFile_tenantId_id_key" ON "ChannelFile"("tenantId", "id");

-- CreateIndex
CREATE INDEX "ChannelFileLine_tenantId_fileId_idx" ON "ChannelFileLine"("tenantId", "fileId");

-- CreateIndex
CREATE INDEX "ChannelFileLine_tenantId_channel_valueDate_idx" ON "ChannelFileLine"("tenantId", "channel", "valueDate");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelFileLine_tenantId_dedupeKey_key" ON "ChannelFileLine"("tenantId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelFileLine_tenantId_id_key" ON "ChannelFileLine"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "DirectDebitMandate" ADD CONSTRAINT "DirectDebitMandate_tenantId_loanAccountId_fkey" FOREIGN KEY ("tenantId", "loanAccountId") REFERENCES "LoanAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoDebitAttempt" ADD CONSTRAINT "AutoDebitAttempt_tenantId_mandateId_fkey" FOREIGN KEY ("tenantId", "mandateId") REFERENCES "DirectDebitMandate"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelFileLine" ADD CONSTRAINT "ChannelFileLine_tenantId_fileId_fkey" FOREIGN KEY ("tenantId", "fileId") REFERENCES "ChannelFile"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;




-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for payment channels.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "PaymentChannelSettings" ADD CONSTRAINT "PaymentChannelSettings_ranges_check"
  CHECK ("fxSpreadBps" BETWEEN 0 AND 1000 AND "fxMaxRateAgeDays" BETWEEN 0 AND 31
         AND "autoDebitMaxAttempts" BETWEEN 1 AND 10 AND "autoDebitRetryDays" BETWEEN 1 AND 31);
ALTER TABLE "DirectDebitMandate" ADD CONSTRAINT "DirectDebitMandate_status_check"
  CHECK ("status" IN ('ACTIVE', 'REVOKED') AND (("status" = 'REVOKED') = ("revokedAt" IS NOT NULL)));
-- One active mandate per loan at a time.
CREATE UNIQUE INDEX "DirectDebitMandate_one_active" ON "DirectDebitMandate" ("loanAccountId") WHERE "status" = 'ACTIVE';
ALTER TABLE "AutoDebitAttempt" ADD CONSTRAINT "AutoDebitAttempt_status_check"
  CHECK ("status" IN ('PENDING', 'SUCCEEDED', 'FAILED', 'SUSPENSE') AND "attemptNo" >= 1 AND "amount" > 0
         AND ("status" <> 'SUCCEEDED' OR "financialEventId" IS NOT NULL)
         AND ("status" <> 'SUSPENSE' OR "unidentifiedPaymentId" IS NOT NULL)
         AND ("status" <> 'FAILED' OR "failureCode" IS NOT NULL));
ALTER TABLE "ChannelFile" ADD CONSTRAINT "ChannelFile_kind_check"
  CHECK (("kind" = 'SETTLEMENT' AND "channel" IN ('MOBILE', 'QR', 'WALLET', 'AGENT'))
         OR ("kind" = 'PAYROLL' AND "channel" = 'PAYROLL' AND "employer" IS NOT NULL AND "period" IS NOT NULL));
ALTER TABLE "ChannelFile" ADD CONSTRAINT "ChannelFile_counts_check"
  CHECK ("lineCount" > 0 AND "postedCount" + "suspenseCount" + "duplicateCount" = "lineCount");
-- Every line ends somewhere: on a loan, in suspense, or recognised as a repeat.
ALTER TABLE "ChannelFileLine" ADD CONSTRAINT "ChannelFileLine_outcome_check"
  CHECK ("amount" > 0 AND (
           ("outcome" = 'POSTED' AND "financialEventId" IS NOT NULL AND "loanAccountId" IS NOT NULL AND "dedupeKey" IS NOT NULL)
        OR ("outcome" = 'SUSPENSE' AND "unidentifiedPaymentId" IS NOT NULL AND "dedupeKey" IS NOT NULL)
        OR ("outcome" = 'DUPLICATE' AND "dedupeKey" IS NULL)));

-- An imported line is evidence of what the channel reported and what became
-- of it: it is never rewritten. Later matching of suspense is read from suspense.
CREATE OR REPLACE FUNCTION channel_file_line_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ChannelFileLine rows are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ChannelFileLine_immutable" BEFORE UPDATE ON "ChannelFileLine"
  FOR EACH ROW EXECUTE FUNCTION channel_file_line_immutable();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['PaymentChannelSettings','DirectDebitMandate','AutoDebitAttempt','ChannelFile','ChannelFileLine']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true))',
      t || '_tenant_isolation', t);
  END LOOP;
END $$;
