-- CreateTable
CREATE TABLE "TradeInvoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "debtorName" TEXT NOT NULL,
    "debtorKey" TEXT NOT NULL,
    "debtorReference" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "issueDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "advanceRate" DECIMAL(12,8) NOT NULL,
    "feeRatePerPeriod" DECIMAL(12,8) NOT NULL,
    "feePeriodDays" INTEGER NOT NULL,
    "feeBasis" TEXT NOT NULL,
    "recourseGraceDays" INTEGER NOT NULL,
    "advanceAmount" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "advanceDate" DATE,
    "advanceEventId" TEXT,
    "advanceOutstanding" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "feeRaised" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "feePaid" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "collectedFromDebtor" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "collectedFromBorrower" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "reserveHeld" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "reservePaid" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "recourseDate" DATE,
    "recourseAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "registeredBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "advanceRequestedBy" TEXT,
    "advanceApprovedBy" TEXT,
    "advanceReleasedBy" TEXT,
    "rejectionReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeInvoiceCollection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "feeRaised" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "toFee" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "toAdvance" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "toReserve" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "valueDate" DATE NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeInvoiceCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LetterOfCredit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "portfolioId" TEXT,
    "legalEntityId" TEXT,
    "productId" TEXT NOT NULL,
    "productVersionId" TEXT NOT NULL,
    "familyCode" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "beneficiaryName" TEXT NOT NULL,
    "beneficiaryBank" TEXT,
    "beneficiaryAccount" TEXT,
    "issueDate" DATE NOT NULL,
    "expiryDate" DATE NOT NULL,
    "terms" JSONB NOT NULL,
    "feeAmount" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "feeEventId" TEXT,
    "memoEventId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "drawnAmount" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "releasedAmount" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "requestedBy" TEXT NOT NULL,
    "issuedBy" TEXT,
    "issuedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectionReason" TEXT,
    "closedBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "closeReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LetterOfCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LcDrawing" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "letterOfCreditId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "documentsReference" TEXT NOT NULL,
    "numberOfInstalments" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "loanAccountId" TEXT,
    "eventId" TEXT,
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidBy" TEXT,
    "paidAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectionReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LcDrawing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Syndicate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "principal" DECIMAL(24,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "makerId" TEXT NOT NULL,
    "checkerId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "fundingEventId" TEXT,
    "fundedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Syndicate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyndicateParticipant" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "syndicateId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "lenderName" TEXT NOT NULL,
    "isAgent" BOOLEAN NOT NULL DEFAULT false,
    "share" DECIMAL(14,12) NOT NULL,
    "feeShare" DECIMAL(14,12) NOT NULL,
    "commitment" DECIMAL(24,4) NOT NULL,
    "funded" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "principalReturned" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "interestEarned" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "penaltyEarned" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "feesEarned" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "paidOut" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyndicateParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParticipationEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "financialEventId" TEXT NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParticipationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TradeInvoice_advanceEventId_key" ON "TradeInvoice"("advanceEventId");

-- CreateIndex
CREATE INDEX "TradeInvoice_tenantId_facilityId_status_idx" ON "TradeInvoice"("tenantId", "facilityId", "status");

-- CreateIndex
CREATE INDEX "TradeInvoice_tenantId_status_dueDate_idx" ON "TradeInvoice"("tenantId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "TradeInvoice_tenantId_id_key" ON "TradeInvoice"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TradeInvoice_tenantId_reference_key" ON "TradeInvoice"("tenantId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "TradeInvoice_tenantId_borrowerId_debtorKey_invoiceNumber_key" ON "TradeInvoice"("tenantId", "borrowerId", "debtorKey", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TradeInvoiceCollection_eventId_key" ON "TradeInvoiceCollection"("eventId");

-- CreateIndex
CREATE INDEX "TradeInvoiceCollection_tenantId_invoiceId_idx" ON "TradeInvoiceCollection"("tenantId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "LetterOfCredit_feeEventId_key" ON "LetterOfCredit"("feeEventId");

-- CreateIndex
CREATE UNIQUE INDEX "LetterOfCredit_memoEventId_key" ON "LetterOfCredit"("memoEventId");

-- CreateIndex
CREATE INDEX "LetterOfCredit_tenantId_status_idx" ON "LetterOfCredit"("tenantId", "status");

-- CreateIndex
CREATE INDEX "LetterOfCredit_tenantId_borrowerId_idx" ON "LetterOfCredit"("tenantId", "borrowerId");

-- CreateIndex
CREATE INDEX "LetterOfCredit_tenantId_branchId_idx" ON "LetterOfCredit"("tenantId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "LetterOfCredit_tenantId_id_key" ON "LetterOfCredit"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LetterOfCredit_tenantId_reference_key" ON "LetterOfCredit"("tenantId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "LcDrawing_loanAccountId_key" ON "LcDrawing"("loanAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "LcDrawing_eventId_key" ON "LcDrawing"("eventId");

-- CreateIndex
CREATE INDEX "LcDrawing_tenantId_letterOfCreditId_status_idx" ON "LcDrawing"("tenantId", "letterOfCreditId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LcDrawing_tenantId_id_key" ON "LcDrawing"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LcDrawing_letterOfCreditId_sequence_key" ON "LcDrawing"("letterOfCreditId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "Syndicate_loanAccountId_key" ON "Syndicate"("loanAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Syndicate_fundingEventId_key" ON "Syndicate"("fundingEventId");

-- CreateIndex
CREATE INDEX "Syndicate_tenantId_status_idx" ON "Syndicate"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Syndicate_tenantId_id_key" ON "Syndicate"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Syndicate_tenantId_loanAccountId_key" ON "Syndicate"("tenantId", "loanAccountId");

-- CreateIndex
CREATE INDEX "SyndicateParticipant_tenantId_loanAccountId_idx" ON "SyndicateParticipant"("tenantId", "loanAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "SyndicateParticipant_tenantId_id_key" ON "SyndicateParticipant"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SyndicateParticipant_syndicateId_lenderName_key" ON "SyndicateParticipant"("syndicateId", "lenderName");

-- CreateIndex
CREATE INDEX "ParticipationEntry_tenantId_loanAccountId_idx" ON "ParticipationEntry"("tenantId", "loanAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "ParticipationEntry_participantId_sourceEventId_kind_key" ON "ParticipationEntry"("participantId", "sourceEventId", "kind");

-- AddForeignKey
ALTER TABLE "TradeInvoice" ADD CONSTRAINT "TradeInvoice_tenantId_facilityId_fkey" FOREIGN KEY ("tenantId", "facilityId") REFERENCES "Facility"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeInvoiceCollection" ADD CONSTRAINT "TradeInvoiceCollection_tenantId_invoiceId_fkey" FOREIGN KEY ("tenantId", "invoiceId") REFERENCES "TradeInvoice"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LcDrawing" ADD CONSTRAINT "LcDrawing_tenantId_letterOfCreditId_fkey" FOREIGN KEY ("tenantId", "letterOfCreditId") REFERENCES "LetterOfCredit"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Syndicate" ADD CONSTRAINT "Syndicate_tenantId_loanAccountId_fkey" FOREIGN KEY ("tenantId", "loanAccountId") REFERENCES "LoanAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyndicateParticipant" ADD CONSTRAINT "SyndicateParticipant_tenantId_syndicateId_fkey" FOREIGN KEY ("tenantId", "syndicateId") REFERENCES "Syndicate"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticipationEntry" ADD CONSTRAINT "ParticipationEntry_tenantId_participantId_fkey" FOREIGN KEY ("tenantId", "participantId") REFERENCES "SyndicateParticipant"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;




-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for trade finance and syndication.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Invoice financing (LT-18, UC-67) ──────────────────────────────────────
ALTER TABLE "TradeInvoice" ADD CONSTRAINT "TradeInvoice_status_check"
  CHECK ("status" IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'ADVANCE_REQUESTED', 'ADVANCE_APPROVED', 'FUNDED', 'RECOURSE', 'SETTLED', 'CANCELLED'));
ALTER TABLE "TradeInvoice" ADD CONSTRAINT "TradeInvoice_amounts_check" CHECK (
  "amount" > 0 AND "dueDate" >= "issueDate"
  AND "advanceRate" > 0 AND "advanceRate" <= 1 AND "feeRatePerPeriod" >= 0 AND "feePeriodDays" >= 1 AND "recourseGraceDays" >= 0
  AND "advanceAmount" >= 0 AND "advanceAmount" <= "amount"
  AND "advanceOutstanding" >= 0 AND "advanceOutstanding" <= "advanceAmount"
  AND "feePaid" >= 0 AND "feePaid" <= "feeRaised"
  AND "collectedFromDebtor" >= 0 AND "collectedFromBorrower" >= 0
  AND "reservePaid" >= 0 AND "reservePaid" <= "reserveHeld");
ALTER TABLE "TradeInvoice" ADD CONSTRAINT "TradeInvoice_fee_basis_check" CHECK ("feeBasis" IN ('WHOLE_PERIODS', 'PRO_RATA'));
-- Money has moved once an invoice is funded: the event link is set and the invoice terms freeze.
ALTER TABLE "TradeInvoice" ADD CONSTRAINT "TradeInvoice_funded_check" CHECK (
  "status" NOT IN ('FUNDED', 'RECOURSE', 'SETTLED') OR ("advanceEventId" IS NOT NULL AND "advanceDate" IS NOT NULL));
CREATE OR REPLACE FUNCTION lending_trade_invoice_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."advanceEventId" IS NULL OR lending_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'lending: financed invoice % cannot be deleted', OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."advanceEventId" IS NOT NULL AND (
       NEW.amount IS DISTINCT FROM OLD.amount OR
       NEW."invoiceNumber" IS DISTINCT FROM OLD."invoiceNumber" OR
       NEW."debtorKey" IS DISTINCT FROM OLD."debtorKey" OR
       NEW."dueDate" IS DISTINCT FROM OLD."dueDate" OR
       NEW."advanceAmount" IS DISTINCT FROM OLD."advanceAmount" OR
       NEW."advanceDate" IS DISTINCT FROM OLD."advanceDate" OR
       NEW."advanceEventId" IS DISTINCT FROM OLD."advanceEventId" OR
       NEW."advanceRate" IS DISTINCT FROM OLD."advanceRate" OR
       NEW."feeRatePerPeriod" IS DISTINCT FROM OLD."feeRatePerPeriod" OR
       NEW."feePeriodDays" IS DISTINCT FROM OLD."feePeriodDays" OR
       NEW."facilityId" IS DISTINCT FROM OLD."facilityId"
     ) THEN
    RAISE EXCEPTION 'lending: invoice % is financed; its terms are frozen', OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "TradeInvoice_guard" BEFORE UPDATE OR DELETE ON "TradeInvoice"
  FOR EACH ROW EXECUTE FUNCTION lending_trade_invoice_guard();

ALTER TABLE "TradeInvoiceCollection" ADD CONSTRAINT "TradeInvoiceCollection_check" CHECK (
  "source" IN ('DEBTOR', 'BORROWER') AND "amount" > 0
  AND "toFee" >= 0 AND "toAdvance" >= 0 AND "toReserve" >= 0 AND "feeRaised" >= 0
  AND "toFee" + "toAdvance" + "toReserve" = "amount"
  AND ("source" = 'DEBTOR' OR "toReserve" = 0));
CREATE TRIGGER "TradeInvoiceCollection_append_only"
  BEFORE UPDATE OR DELETE ON "TradeInvoiceCollection"
  FOR EACH ROW EXECUTE FUNCTION lending_append_only();

-- ── Letters of credit (LT-19, UC-53) ──────────────────────────────────────
-- A letter of credit is not a loan until the bank pays under it, so its fee,
-- contingent memo, drawings and release are tenant-level money too.
ALTER TABLE "FinancialEvent" DROP CONSTRAINT "FinancialEvent_tenant_level_check";
ALTER TABLE "FinancialEvent" ADD CONSTRAINT "FinancialEvent_tenant_level_check"
  CHECK ("loanAccountId" IS NOT NULL OR "type" IN ('SUSPENSE_RECEIPT', 'SUSPENSE_REFUND', 'REVERSAL', 'LC_ISSUE', 'LC_FEE', 'LC_DRAWING', 'LC_RELEASE'));
ALTER TABLE "LetterOfCredit" ADD CONSTRAINT "LetterOfCredit_status_check"
  CHECK ("status" IN ('REQUESTED', 'ISSUED', 'PARTIALLY_DRAWN', 'FULLY_DRAWN', 'EXPIRED', 'CANCELLED', 'REJECTED'));
ALTER TABLE "LetterOfCredit" ADD CONSTRAINT "LetterOfCredit_amounts_check" CHECK (
  "amount" > 0 AND "expiryDate" > "issueDate" AND "feeAmount" >= 0
  AND "drawnAmount" >= 0 AND "releasedAmount" >= 0 AND "drawnAmount" + "releasedAmount" <= "amount");
-- Issued means the fee and the contingent memo were posted.
ALTER TABLE "LetterOfCredit" ADD CONSTRAINT "LetterOfCredit_issued_check" CHECK (
  "status" IN ('REQUESTED', 'REJECTED') OR "memoEventId" IS NOT NULL);
ALTER TABLE "LcDrawing" ADD CONSTRAINT "LcDrawing_check" CHECK (
  "status" IN ('REQUESTED', 'APPROVED', 'PAID', 'REJECTED') AND "amount" > 0 AND "numberOfInstalments" >= 1
  AND ("status" <> 'PAID' OR ("loanAccountId" IS NOT NULL AND "eventId" IS NOT NULL)));
CREATE OR REPLACE FUNCTION lending_lc_drawing_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'PAID' OR lending_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'lending: paid drawing % cannot be deleted', OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status = 'PAID' AND (to_jsonb(NEW) - 'version') IS DISTINCT FROM (to_jsonb(OLD) - 'version') THEN
    RAISE EXCEPTION 'lending: drawing % is paid and immutable', OLD.id USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "LcDrawing_guard" BEFORE UPDATE OR DELETE ON "LcDrawing"
  FOR EACH ROW EXECUTE FUNCTION lending_lc_drawing_guard();

-- ── Syndication (LT-24) ───────────────────────────────────────────────────
ALTER TABLE "Syndicate" ADD CONSTRAINT "Syndicate_check" CHECK (
  "status" IN ('DRAFT', 'APPROVED', 'FUNDED') AND "principal" > 0
  AND ("status" <> 'FUNDED' OR "fundingEventId" IS NOT NULL));
ALTER TABLE "SyndicateParticipant" ADD CONSTRAINT "SyndicateParticipant_check" CHECK (
  "share" > 0 AND "share" <= 1 AND "feeShare" >= 0 AND "feeShare" <= 1 AND "commitment" > 0
  AND "funded" >= 0 AND "funded" <= "commitment" AND "paidOut" >= 0);
-- At most one agent per syndicate: the tenant itself.
CREATE UNIQUE INDEX "SyndicateParticipant_one_agent" ON "SyndicateParticipant" ("syndicateId") WHERE "isAgent";
ALTER TABLE "ParticipationEntry" ADD CONSTRAINT "ParticipationEntry_kind_check"
  CHECK ("kind" IN ('FUNDING', 'PRINCIPAL', 'INTEREST', 'PENALTY', 'FEE', 'PAYOUT'));
CREATE TRIGGER "ParticipationEntry_append_only"
  BEFORE UPDATE OR DELETE ON "ParticipationEntry"
  FOR EACH ROW EXECUTE FUNCTION lending_append_only();

-- ── Tenant isolation ──────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['TradeInvoice','TradeInvoiceCollection','LetterOfCredit','LcDrawing','Syndicate','SyndicateParticipant','ParticipationEntry']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true)) WITH CHECK (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true))',
      t || '_tenant_isolation', t);
  END LOOP;
END $$;
