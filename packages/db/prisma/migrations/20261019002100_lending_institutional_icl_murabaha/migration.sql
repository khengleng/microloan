-- CreateTable
CREATE TABLE "Counterparty" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "borrowerId" TEXT,
    "legalIdentifier" TEXT NOT NULL DEFAULT '',
    "rating" TEXT,
    "ratingAgency" TEXT NOT NULL DEFAULT '',
    "ratedOn" DATE,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Counterparty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExposureLimit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "counterpartyId" TEXT,
    "countryCode" TEXT,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "reviewOn" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT NOT NULL DEFAULT '',
    "proposedBy" TEXT NOT NULL,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExposureLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncomeAssessment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "declaredAnnualIncome" DECIMAL(24,4) NOT NULL,
    "incomePeriod" TEXT NOT NULL DEFAULT '',
    "evidenceType" TEXT NOT NULL,
    "evidenceReference" TEXT NOT NULL,
    "documentId" TEXT,
    "annualRepayment" DECIMAL(24,4) NOT NULL,
    "periodicPayment" DECIMAL(24,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "effectiveDate" DATE,
    "nextReviewDate" DATE,
    "agreementVersion" INTEGER,
    "proposedBy" TEXT NOT NULL,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "comment" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncomeAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MurabahaContract" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "serialNumber" TEXT NOT NULL DEFAULT '',
    "supplierName" TEXT NOT NULL,
    "cost" DECIMAL(24,4) NOT NULL,
    "downPayment" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "profit" DECIMAL(24,4),
    "salePrice" DECIMAL(24,4),
    "ibraShare" DECIMAL(12,8),
    "deferredProfitBalance" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "ibraGranted" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'REGISTERED',
    "saleEventId" TEXT,
    "soldOn" DATE,
    "version" INTEGER NOT NULL DEFAULT 0,
    "registeredBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MurabahaContract_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Counterparty_tenantId_countryCode_idx" ON "Counterparty"("tenantId", "countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "Counterparty_tenantId_id_key" ON "Counterparty"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Counterparty_tenantId_reference_key" ON "Counterparty"("tenantId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "Counterparty_tenantId_borrowerId_key" ON "Counterparty"("tenantId", "borrowerId");

-- CreateIndex
CREATE INDEX "ExposureLimit_tenantId_scope_status_idx" ON "ExposureLimit"("tenantId", "scope", "status");

-- CreateIndex
CREATE INDEX "ExposureLimit_tenantId_counterpartyId_idx" ON "ExposureLimit"("tenantId", "counterpartyId");

-- CreateIndex
CREATE INDEX "ExposureLimit_tenantId_countryCode_idx" ON "ExposureLimit"("tenantId", "countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "ExposureLimit_tenantId_id_key" ON "ExposureLimit"("tenantId", "id");

-- CreateIndex
CREATE INDEX "IncomeAssessment_tenantId_status_idx" ON "IncomeAssessment"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IncomeAssessment_tenantId_id_key" ON "IncomeAssessment"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "IncomeAssessment_tenantId_loanAccountId_sequence_key" ON "IncomeAssessment"("tenantId", "loanAccountId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "MurabahaContract_loanAccountId_key" ON "MurabahaContract"("loanAccountId");

-- CreateIndex
CREATE INDEX "MurabahaContract_tenantId_status_idx" ON "MurabahaContract"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MurabahaContract_tenantId_id_key" ON "MurabahaContract"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MurabahaContract_tenantId_loanAccountId_key" ON "MurabahaContract"("tenantId", "loanAccountId");

-- AddForeignKey
ALTER TABLE "ExposureLimit" ADD CONSTRAINT "ExposureLimit_tenantId_counterpartyId_fkey" FOREIGN KEY ("tenantId", "counterpartyId") REFERENCES "Counterparty"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomeAssessment" ADD CONSTRAINT "IncomeAssessment_tenantId_loanAccountId_fkey" FOREIGN KEY ("tenantId", "loanAccountId") REFERENCES "LoanAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MurabahaContract" ADD CONSTRAINT "MurabahaContract_tenantId_loanAccountId_fkey" FOREIGN KEY ("tenantId", "loanAccountId") REFERENCES "LoanAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for institutional lending, income-contingent repayment and Murabaha.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE "Counterparty" ADD CONSTRAINT "Counterparty_type_check"
  CHECK ("type" IN ('BANK', 'MUNICIPALITY', 'SOVEREIGN', 'DEVELOPMENT_INSTITUTION'));
ALTER TABLE "Counterparty" ADD CONSTRAINT "Counterparty_status_check"
  CHECK ("status" IN ('ACTIVE', 'SUSPENDED'));
ALTER TABLE "Counterparty" ADD CONSTRAINT "Counterparty_country_check"
  CHECK ("countryCode" ~ '^[A-Z]{2}$');
ALTER TABLE "Counterparty" ADD CONSTRAINT "Counterparty_rating_check"
  CHECK ("rating" IS NULL OR "rating" IN ('AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-',
    'BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'CCC+', 'CCC', 'CCC-', 'CC', 'C', 'D'));

ALTER TABLE "ExposureLimit" ADD CONSTRAINT "ExposureLimit_scope_check"
  CHECK (("scope" = 'COUNTERPARTY' AND "counterpartyId" IS NOT NULL AND "countryCode" IS NULL)
      OR ("scope" = 'COUNTRY' AND "countryCode" IS NOT NULL AND "counterpartyId" IS NULL));
ALTER TABLE "ExposureLimit" ADD CONSTRAINT "ExposureLimit_status_check"
  CHECK ("status" IN ('PENDING', 'ACTIVE', 'REJECTED', 'SUPERSEDED'));
ALTER TABLE "ExposureLimit" ADD CONSTRAINT "ExposureLimit_amount_check"
  CHECK ("amount" > 0);
ALTER TABLE "ExposureLimit" ADD CONSTRAINT "ExposureLimit_currency_check"
  CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "ExposureLimit" ADD CONSTRAINT "ExposureLimit_country_check"
  CHECK ("countryCode" IS NULL OR "countryCode" ~ '^[A-Z]{2}$');
-- Maker-checker: a limit is never approved (or rejected) by the person who proposed it.
ALTER TABLE "ExposureLimit" ADD CONSTRAINT "ExposureLimit_maker_checker_check"
  CHECK ("decidedBy" IS NULL OR "decidedBy" <> "proposedBy");
ALTER TABLE "ExposureLimit" ADD CONSTRAINT "ExposureLimit_decided_check"
  CHECK ("status" = 'PENDING' OR "decidedBy" IS NOT NULL);

ALTER TABLE "IncomeAssessment" ADD CONSTRAINT "IncomeAssessment_status_check"
  CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'));
ALTER TABLE "IncomeAssessment" ADD CONSTRAINT "IncomeAssessment_reason_check"
  CHECK ("reason" IN ('ORIGINATION', 'ANNUAL', 'CHANGE_OF_CIRCUMSTANCES'));
ALTER TABLE "IncomeAssessment" ADD CONSTRAINT "IncomeAssessment_evidence_check"
  CHECK ("evidenceType" IN ('APPLICATION', 'PAYSLIP', 'TAX_RETURN', 'EMPLOYER_LETTER', 'BENEFITS_STATEMENT', 'NO_INCOME_DECLARATION', 'OTHER')
    AND length("evidenceReference") >= 2);
ALTER TABLE "IncomeAssessment" ADD CONSTRAINT "IncomeAssessment_amounts_check"
  CHECK ("declaredAnnualIncome" >= 0 AND "annualRepayment" >= 0 AND "periodicPayment" >= 0);
-- Maker-checker: only the income declared at origination (already approved
-- with the credit decision) is recorded without a second person.
ALTER TABLE "IncomeAssessment" ADD CONSTRAINT "IncomeAssessment_maker_checker_check"
  CHECK ("reason" = 'ORIGINATION' OR "decidedBy" IS NULL OR "decidedBy" <> "proposedBy");
ALTER TABLE "IncomeAssessment" ADD CONSTRAINT "IncomeAssessment_approved_check"
  CHECK ("status" <> 'APPROVED' OR ("decidedBy" IS NOT NULL AND "effectiveDate" IS NOT NULL));

ALTER TABLE "MurabahaContract" ADD CONSTRAINT "MurabahaContract_status_check"
  CHECK ("status" IN ('REGISTERED', 'SOLD', 'ENDED'));
ALTER TABLE "MurabahaContract" ADD CONSTRAINT "MurabahaContract_amounts_check"
  CHECK ("cost" > 0 AND "downPayment" >= 0 AND "downPayment" < "cost"
    AND "deferredProfitBalance" >= 0 AND "ibraGranted" >= 0
    AND ("profit" IS NULL OR "profit" >= 0));
-- The sale price disclosed is exactly cost plus profit.
ALTER TABLE "MurabahaContract" ADD CONSTRAINT "MurabahaContract_sale_price_check"
  CHECK (("profit" IS NULL AND "salePrice" IS NULL) OR "salePrice" = "cost" + "profit");
ALTER TABLE "MurabahaContract" ADD CONSTRAINT "MurabahaContract_ibra_check"
  CHECK ("ibraShare" IS NULL OR ("ibraShare" >= 0 AND "ibraShare" <= 1));
ALTER TABLE "MurabahaContract" ADD CONSTRAINT "MurabahaContract_sold_check"
  CHECK ("status" = 'REGISTERED' OR ("profit" IS NOT NULL AND "saleEventId" IS NOT NULL));

ALTER TABLE "Counterparty" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Counterparty" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Counterparty_tenant_isolation" ON "Counterparty"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "ExposureLimit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExposureLimit" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ExposureLimit_tenant_isolation" ON "ExposureLimit"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "IncomeAssessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IncomeAssessment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "IncomeAssessment_tenant_isolation" ON "IncomeAssessment"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
ALTER TABLE "MurabahaContract" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MurabahaContract" FORCE ROW LEVEL SECURITY;
CREATE POLICY "MurabahaContract_tenant_isolation" ON "MurabahaContract"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));
