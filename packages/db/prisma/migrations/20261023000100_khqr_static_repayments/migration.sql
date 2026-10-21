-- Repayments to the lender's static KHQR code: the codes (maker-checker) and
-- the receipts people say were paid to them (DECISIONS D-160…D-165).

-- CreateTable
CREATE TABLE "KhqrCode" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "currency" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "bakongAccountId" TEXT NOT NULL,
    "merchantName" TEXT NOT NULL,
    "merchantCity" TEXT NOT NULL,
    "merchantCategoryCode" TEXT NOT NULL DEFAULT '6012',
    "payload" TEXT,
    "imageData" TEXT,
    "bankName" TEXT,
    "accountNumber" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "makerId" TEXT NOT NULL,
    "checkerId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KhqrCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KhqrReceipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "branchId" TEXT,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(24,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "valueDate" DATE NOT NULL,
    "bankRef" TEXT NOT NULL,
    "bankRefKey" TEXT NOT NULL,
    "payerName" TEXT,
    "payerAccount" TEXT,
    "remark" TEXT NOT NULL DEFAULT '',
    "screenshotDocumentId" TEXT,
    "statementLineId" TEXT,
    "unidentifiedPaymentId" TEXT,
    "makerType" TEXT NOT NULL,
    "makerId" TEXT NOT NULL,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT NOT NULL DEFAULT '',
    "financialEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KhqrReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KhqrCode_tenantId_status_idx" ON "KhqrCode"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "KhqrCode_tenantId_id_key" ON "KhqrCode"("tenantId", "id");

-- CreateIndex
CREATE INDEX "KhqrReceipt_tenantId_status_createdAt_idx" ON "KhqrReceipt"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "KhqrReceipt_tenantId_loanAccountId_idx" ON "KhqrReceipt"("tenantId", "loanAccountId");

-- CreateIndex
CREATE INDEX "KhqrReceipt_tenantId_borrowerId_status_idx" ON "KhqrReceipt"("tenantId", "borrowerId", "status");

-- CreateIndex
CREATE INDEX "KhqrReceipt_tenantId_bankRefKey_idx" ON "KhqrReceipt"("tenantId", "bankRefKey");

-- CreateIndex
CREATE UNIQUE INDEX "KhqrReceipt_tenantId_reference_key" ON "KhqrReceipt"("tenantId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "KhqrReceipt_tenantId_id_key" ON "KhqrReceipt"("tenantId", "id");

-- ═══════════════════════════════════════════════════════════════════════════
-- Invariants and the tenant wall.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "KhqrCode" ADD CONSTRAINT "KhqrCode_status_check"
  CHECK ("status" IN ('PENDING', 'ACTIVE', 'REJECTED', 'RETIRED'));
ALTER TABLE "KhqrCode" ADD CONSTRAINT "KhqrCode_currency_check"
  CHECK ("currency" IN ('USD', 'KHR'));
ALTER TABLE "KhqrCode" ADD CONSTRAINT "KhqrCode_source_check"
  CHECK ("source" IN ('GENERATED', 'UPLOADED_PAYLOAD', 'UPLOADED_IMAGE'));
-- A repayment code is static: EMVCo format 01, point of initiation 11
-- ("000201" "010211"), and it carries no transaction amount. An undecodable
-- uploaded image is kept as the image itself.
ALTER TABLE "KhqrCode" ADD CONSTRAINT "KhqrCode_static_check"
  CHECK (
    ("source" = 'UPLOADED_IMAGE' AND "payload" IS NULL AND "imageData" IS NOT NULL)
    OR ("source" <> 'UPLOADED_IMAGE' AND "payload" IS NOT NULL AND "payload" LIKE '000201010211%')
  );
ALTER TABLE "KhqrCode" ADD CONSTRAINT "KhqrCode_decided_check"
  CHECK (("status" = 'PENDING') = ("decidedAt" IS NULL)
         AND ("checkerId" IS NULL OR "checkerId" <> "makerId"));
ALTER TABLE "KhqrCode" ADD CONSTRAINT "KhqrCode_text_check"
  CHECK (length("bakongAccountId") BETWEEN 3 AND 64 AND length("merchantName") BETWEEN 1 AND 25
         AND length("merchantCity") BETWEEN 1 AND 15
         AND ("imageData" IS NULL OR length("imageData") <= 3000000));
-- One code in force, and one proposal waiting, per lender or branch and currency.
CREATE UNIQUE INDEX "KhqrCode_one_active"
  ON "KhqrCode" ("tenantId", coalesce("branchId", ''), "currency") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "KhqrCode_one_pending"
  ON "KhqrCode" ("tenantId", coalesce("branchId", ''), "currency") WHERE "status" = 'PENDING';

ALTER TABLE "KhqrReceipt" ADD CONSTRAINT "KhqrReceipt_status_check"
  CHECK ("status" IN ('PENDING', 'POSTED', 'REJECTED'));
ALTER TABLE "KhqrReceipt" ADD CONSTRAINT "KhqrReceipt_source_check"
  CHECK ("source" IN ('PORTAL_CLAIM', 'STAFF', 'STATEMENT'));
ALTER TABLE "KhqrReceipt" ADD CONSTRAINT "KhqrReceipt_maker_check"
  CHECK ("makerType" IN ('CUSTOMER', 'STAFF', 'SYSTEM')
         AND ("decidedBy" IS NULL OR "decidedBy" <> "makerId"));
ALTER TABLE "KhqrReceipt" ADD CONSTRAINT "KhqrReceipt_amount_check"
  CHECK ("amount" > 0);
ALTER TABLE "KhqrReceipt" ADD CONSTRAINT "KhqrReceipt_posted_check"
  CHECK (("status" = 'POSTED') = ("financialEventId" IS NOT NULL)
         AND ("status" = 'PENDING') = ("decidedAt" IS NULL));
ALTER TABLE "KhqrReceipt" ADD CONSTRAINT "KhqrReceipt_text_check"
  CHECK (length("bankRefKey") BETWEEN 6 AND 100 AND "bankRefKey" ~ '^[0-9A-Z]+$'
         AND length("bankRef") <= 120 AND length("remark") <= 500 AND length("decisionNote") <= 500);
-- One bank transfer, one receipt: a reference may be recorded again only
-- after the earlier receipt was rejected (DECISIONS D-164).
CREATE UNIQUE INDEX "KhqrReceipt_one_per_bank_ref"
  ON "KhqrReceipt" ("tenantId", "bankRefKey") WHERE "status" <> 'REJECTED';
CREATE UNIQUE INDEX "KhqrReceipt_financialEventId_key"
  ON "KhqrReceipt" ("financialEventId") WHERE "financialEventId" IS NOT NULL;

-- Bank / Bakong merchant statements are imported as channel files of their own kind.
ALTER TABLE "ChannelFile" DROP CONSTRAINT "ChannelFile_kind_check";
ALTER TABLE "ChannelFile" ADD CONSTRAINT "ChannelFile_kind_check"
  CHECK (("kind" = 'SETTLEMENT' AND "channel" IN ('MOBILE', 'QR', 'WALLET', 'AGENT'))
         OR ("kind" = 'PAYROLL' AND "channel" = 'PAYROLL' AND "employer" IS NOT NULL AND "period" IS NOT NULL)
         OR ("kind" = 'KHQR_STATEMENT' AND "channel" = 'KHQR'));

-- Strict tenant wall (docs/security/RLS.md).
ALTER TABLE "KhqrCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KhqrCode" FORCE ROW LEVEL SECURITY;
CREATE POLICY "KhqrCode_tenant_wall" ON "KhqrCode"
  USING (current_setting('app.system', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.system', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "KhqrReceipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KhqrReceipt" FORCE ROW LEVEL SECURITY;
CREATE POLICY "KhqrReceipt_tenant_wall" ON "KhqrReceipt"
  USING (current_setting('app.system', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (current_setting('app.system', true) = 'on' OR "tenantId" = current_setting('app.tenant_id', true));
