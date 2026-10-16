-- ═══════════════════════════════════════════════════════════════════════════
-- Group lending and joint liability (Phase 2).
--
-- Fully additive. BorrowerGroup and GroupMembership shipped in Phase 1 as
-- structure only; every column added here is nullable or defaulted, so the
-- migration is safe whether or not they hold rows.
--
-- LoanGroupMember stores `liableFor` rather than deriving it: under
-- GROUP_JOINT a member is liable for the whole principal, not their share,
-- and that difference is the legal substance of a solidarity group. It is
-- recorded at booking as part of the contract, not recomputed from a flag
-- that a later configuration edit could change.
-- ═══════════════════════════════════════════════════════════════════════════

-- AlterTable
ALTER TABLE "BorrowerGroup" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "formedOn" DATE,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'FORMING',
ADD COLUMN     "updatedAt" TIMESTAMP(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "GroupMembership" ADD COLUMN     "exitReason" TEXT,
ADD COLUMN     "exitSettlement" DECIMAL(24,4),
ADD COLUMN     "joinedOn" DATE,
ADD COLUMN     "leftOn" DATE;

-- CreateTable
CREATE TABLE "LoanGroupMember" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "liability" TEXT NOT NULL,
    "shareAmount" DECIMAL(24,4) NOT NULL,
    "shareFraction" DECIMAL(18,10) NOT NULL,
    "liableFor" DECIMAL(24,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupContribution" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "financialEventId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "amount" DECIMAL(24,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupContribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoanGroupMember_tenantId_loanAccountId_idx" ON "LoanGroupMember"("tenantId", "loanAccountId");

-- CreateIndex
CREATE INDEX "LoanGroupMember_tenantId_borrowerId_idx" ON "LoanGroupMember"("tenantId", "borrowerId");

-- CreateIndex
CREATE UNIQUE INDEX "LoanGroupMember_loanAccountId_borrowerId_key" ON "LoanGroupMember"("loanAccountId", "borrowerId");

-- CreateIndex
CREATE UNIQUE INDEX "LoanGroupMember_tenantId_id_key" ON "LoanGroupMember"("tenantId", "id");

-- CreateIndex
CREATE INDEX "GroupContribution_tenantId_loanAccountId_idx" ON "GroupContribution"("tenantId", "loanAccountId");

-- CreateIndex
CREATE INDEX "GroupContribution_tenantId_financialEventId_idx" ON "GroupContribution"("tenantId", "financialEventId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupContribution_tenantId_id_key" ON "GroupContribution"("tenantId", "id");

-- CreateIndex
CREATE INDEX "BorrowerGroup_tenantId_status_idx" ON "BorrowerGroup"("tenantId", "status");

-- CreateIndex
CREATE INDEX "GroupMembership_tenantId_borrowerId_idx" ON "GroupMembership"("tenantId", "borrowerId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMembership_tenantId_id_key" ON "GroupMembership"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "LoanGroupMember" ADD CONSTRAINT "LoanGroupMember_tenantId_groupId_fkey" FOREIGN KEY ("tenantId", "groupId") REFERENCES "BorrowerGroup"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- An application for a group loan names the group; the borrower on it is the
-- group's leader, who signs. Nullable, so individual lending is untouched.
ALTER TABLE "Application" ADD COLUMN "groupId" TEXT;
CREATE INDEX "Application_tenantId_groupId_idx" ON "Application"("tenantId", "groupId");

-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for group lending.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs, so tests run against the same rules
-- production enforces. Keep it to constraints, triggers and policies — no
-- table or index DDL, which `prisma db push` has already created there.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "BorrowerGroup" ADD CONSTRAINT "BorrowerGroup_status_check"
  CHECK ("status" IN ('FORMING', 'ACTIVE', 'DORMANT', 'DISBANDED'));
ALTER TABLE "GroupMembership" ADD CONSTRAINT "GroupMembership_role_check"
  CHECK ("role" IN ('LEADER', 'MEMBER'));
-- A member cannot have left before they joined.
ALTER TABLE "GroupMembership" ADD CONSTRAINT "GroupMembership_dates_check"
  CHECK ("leftOn" IS NULL OR "joinedOn" IS NULL OR "leftOn" >= "joinedOn");

ALTER TABLE "LoanGroupMember" ADD CONSTRAINT "LoanGroupMember_liability_check"
  CHECK ("liability" IN ('GROUP_JOINT', 'GROUP_INDIVIDUAL'));
ALTER TABLE "LoanGroupMember" ADD CONSTRAINT "LoanGroupMember_amounts_check"
  CHECK ("shareAmount" > 0 AND "shareFraction" > 0 AND "liableFor" >= "shareAmount");
-- Joint liability means the whole loan, never a share of it. A row claiming
-- GROUP_JOINT while exposing less than the share would be a contradiction.
ALTER TABLE "LoanGroupMember" ADD CONSTRAINT "LoanGroupMember_joint_check"
  CHECK ("liability" <> 'GROUP_INDIVIDUAL' OR "liableFor" = "shareAmount");

ALTER TABLE "GroupContribution" ADD CONSTRAINT "GroupContribution_amount_check"
  CHECK (amount > 0);

-- The loan binding and the contribution record are both part of the history
-- of what the group agreed and paid, so neither is editable.
-- lending_append_only() is created by the Phase 1 migration.
CREATE TRIGGER "LoanGroupMember_append_only"
  BEFORE UPDATE OR DELETE ON "LoanGroupMember"
  FOR EACH ROW EXECUTE FUNCTION lending_append_only();
CREATE TRIGGER "GroupContribution_append_only"
  BEFORE UPDATE OR DELETE ON "GroupContribution"
  FOR EACH ROW EXECUTE FUNCTION lending_append_only();

-- Row-level security: the second wall behind the Prisma tenant guard.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['BorrowerGroup','GroupMembership','LoanGroupMember','GroupContribution']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true)) '
      || 'WITH CHECK (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true))',
      t || '_tenant_isolation', t);
  END LOOP;
END $$;
