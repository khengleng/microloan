-- RBAC hardening: canonical roles + branches + maker-checker + platform-scoped users

-- 1) Extend role enum safely
DO $$ BEGIN
  ALTER TYPE "Role" ADD VALUE 'TENANT_ADMIN';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "Role" ADD VALUE 'BRANCH_MANAGER';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "Role" ADD VALUE 'LOAN_OFFICER';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "Role" ADD VALUE 'CREDIT_OFFICER';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "Role" ADD VALUE 'APPROVER';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "Role" ADD VALUE 'ACCOUNTANT';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "Role" ADD VALUE 'AUDITOR';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "Role" ADD VALUE 'CUSTOMER_SUPPORT';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TYPE "Role" ADD VALUE 'BORROWER';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Branch table
CREATE TABLE IF NOT EXISTS "Branch" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "Branch"
    ADD CONSTRAINT "Branch_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Branch_tenantId_idx" ON "Branch"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "Branch_tenantId_name_key" ON "Branch"("tenantId", "name");

-- 3) User scope changes
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "User" ALTER COLUMN "tenantId" DROP NOT NULL;

ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_tenantId_fkey";
ALTER TABLE "User"
  ADD CONSTRAINT "User_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

DO $$ BEGIN
  ALTER TABLE "User"
    ADD CONSTRAINT "User_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "User_branchId_idx" ON "User"("branchId");

-- 4) Borrower scope changes
ALTER TABLE "Borrower" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
DO $$ BEGIN
  ALTER TABLE "Borrower"
    ADD CONSTRAINT "Borrower_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Borrower_tenantId_branchId_idx" ON "Borrower"("tenantId", "branchId");

-- 5) Loan scope and maker-checker fields
ALTER TABLE "Loan" ADD COLUMN IF NOT EXISTS "branchId" TEXT;
ALTER TABLE "Loan" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "Loan" ADD COLUMN IF NOT EXISTS "reviewedByUserId" TEXT;
ALTER TABLE "Loan" ADD COLUMN IF NOT EXISTS "disbursedByUserId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Loan"
    ADD CONSTRAINT "Loan_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Loan_tenantId_branchId_idx" ON "Loan"("tenantId", "branchId");
