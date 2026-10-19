-- Baseline: the schema that existed before the first migration in this
-- directory (20260302_add_penalty_last_applied_at). Until 2026-03 the
-- database was built with `prisma db push`, so no migration ever created
-- these tables; every later migration assumes them. With this file,
-- `prisma migrate deploy` builds a database from empty (DR, staging, CI).
--
-- EXISTING DATABASES DO NOT RUN THIS. Mark it applied instead:
--   node scripts/mark-baseline-applied.mjs        (see DEPLOYMENT.md)
-- As a second line of defence the whole script is a no-op when the "User"
-- table already exists, so running it by mistake on a populated database
-- changes nothing.
--
-- Content: the Prisma schema at commit 5ed06d3 (2026-03-02) minus
-- RepaymentSchedule."penaltyLastAppliedAt" (added by 20260302), with the
-- foreign-key actions and indexes in the state production reached through
-- `db push` (ON DELETE CASCADE on the tenant/loan/borrower/product links, no
-- "Loan_tenantId_idx"), so a fresh build ends with no drift. Do not edit
-- after release: Prisma refuses to deploy when an applied migration's
-- checksum changes.

DO $baseline$
BEGIN
  IF to_regclass('public."User"') IS NOT NULL THEN
    RAISE NOTICE 'baseline: "User" exists (database predates this file); nothing to do';
    RETURN;
  END IF;

  -- CreateEnum
  BEGIN
    CREATE TYPE "Role" AS ENUM ('SUPERADMIN', 'ADMIN', 'OPERATOR', 'FINANCE', 'SALES', 'CX');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- CreateEnum
  BEGIN
    CREATE TYPE "LoanStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'DISBURSED', 'CLOSED', 'DEFAULTED');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- CreateEnum
  BEGIN
    CREATE TYPE "InterestMethod" AS ENUM ('FLAT', 'REDUCING_BALANCE');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- CreateTable
  CREATE TABLE IF NOT EXISTS "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "telegramBotToken" TEXT,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
  );

  -- CreateTable
  CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "twoFactorSecret" TEXT,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "role" "Role" NOT NULL DEFAULT 'OPERATOR',
    "telegramChatId" TEXT,
    "loginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
  );

  -- CreateTable
  CREATE TABLE IF NOT EXISTS "Borrower" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "idNumber" TEXT,
    "telegramChatId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Borrower_pkey" PRIMARY KEY ("id")
  );

  -- CreateTable
  CREATE TABLE IF NOT EXISTS "LoanProduct" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "interestMethod" "InterestMethod" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanProduct_pkey" PRIMARY KEY ("id")
  );

  -- CreateTable
  CREATE TABLE IF NOT EXISTS "LoanPolicy" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "creditRating" TEXT NOT NULL,
    "interestRate" DECIMAL(5,2) NOT NULL,
    "minTermMonths" INTEGER,
    "maxTermMonths" INTEGER,
    "minPrincipal" DECIMAL(10,2),
    "maxPrincipal" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanPolicy_pkey" PRIMARY KEY ("id")
  );

  -- CreateTable
  CREATE TABLE IF NOT EXISTS "Loan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "borrowerId" TEXT NOT NULL,
    "productId" TEXT,
    "creditRatingApplied" TEXT,
    "status" "LoanStatus" NOT NULL DEFAULT 'PENDING',
    "principal" DECIMAL(10,2) NOT NULL,
    "annualInterestRate" DECIMAL(5,2) NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "interestMethod" "InterestMethod" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
  );

  -- CreateTable
  CREATE TABLE IF NOT EXISTS "Collateral" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "value" DECIMAL(10,2) NOT NULL,
    "idNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Collateral_pkey" PRIMARY KEY ("id")
  );

  -- CreateTable
  CREATE TABLE IF NOT EXISTS "Guarantor" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "idNumber" TEXT,
    "relation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Guarantor_pkey" PRIMARY KEY ("id")
  );

  -- CreateTable
  CREATE TABLE IF NOT EXISTS "LoanInteraction" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "notes" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'NOTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanInteraction_pkey" PRIMARY KEY ("id")
  );

  -- CreateTable
  CREATE TABLE IF NOT EXISTS "RepaymentSchedule" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "installmentNumber" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "principalAmount" DECIMAL(10,2) NOT NULL,
    "interestAmount" DECIMAL(10,2) NOT NULL,
    "penaltyAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "outstandingPrincipal" DECIMAL(10,2) NOT NULL,
    "paidPrincipal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "paidInterest" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "paidPenalty" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepaymentSchedule_pkey" PRIMARY KEY ("id")
  );

  -- CreateTable
  CREATE TABLE IF NOT EXISTS "Repayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "principalPaid" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "interestPaid" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "penaltyPaid" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repayment_pkey" PRIMARY KEY ("id")
  );

  -- CreateTable
  CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
  );

  -- CreateTable
  CREATE TABLE IF NOT EXISTS "Document" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
  );

  -- CreateIndex
  CREATE UNIQUE INDEX IF NOT EXISTS "Tenant_telegramBotToken_key" ON "Tenant"("telegramBotToken");

  -- CreateIndex
  CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");

  -- CreateIndex
  CREATE INDEX IF NOT EXISTS "User_tenantId_idx" ON "User"("tenantId");

  -- CreateIndex
  CREATE INDEX IF NOT EXISTS "User_email_idx" ON "User"("email");

  -- CreateIndex
  CREATE UNIQUE INDEX IF NOT EXISTS "Borrower_idNumber_key" ON "Borrower"("idNumber");

  -- CreateIndex
  CREATE INDEX IF NOT EXISTS "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

  -- CreateIndex
  CREATE INDEX IF NOT EXISTS "AuditLog_tenantId_action_idx" ON "AuditLog"("tenantId", "action");

  -- CreateIndex
  CREATE INDEX IF NOT EXISTS "AuditLog_userId_idx" ON "AuditLog"("userId");

  -- AddForeignKey
  BEGIN
    ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- AddForeignKey
  BEGIN
    ALTER TABLE "Borrower" ADD CONSTRAINT "Borrower_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- AddForeignKey
  BEGIN
    ALTER TABLE "LoanProduct" ADD CONSTRAINT "LoanProduct_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- AddForeignKey
  BEGIN
    ALTER TABLE "LoanPolicy" ADD CONSTRAINT "LoanPolicy_productId_fkey" FOREIGN KEY ("productId") REFERENCES "LoanProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- AddForeignKey
  BEGIN
    ALTER TABLE "Loan" ADD CONSTRAINT "Loan_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- AddForeignKey
  BEGIN
    ALTER TABLE "Loan" ADD CONSTRAINT "Loan_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- AddForeignKey
  BEGIN
    ALTER TABLE "Loan" ADD CONSTRAINT "Loan_productId_fkey" FOREIGN KEY ("productId") REFERENCES "LoanProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- AddForeignKey
  BEGIN
    ALTER TABLE "Collateral" ADD CONSTRAINT "Collateral_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- AddForeignKey
  BEGIN
    ALTER TABLE "Guarantor" ADD CONSTRAINT "Guarantor_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- AddForeignKey
  BEGIN
    ALTER TABLE "LoanInteraction" ADD CONSTRAINT "LoanInteraction_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- AddForeignKey
  BEGIN
    ALTER TABLE "RepaymentSchedule" ADD CONSTRAINT "RepaymentSchedule_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- AddForeignKey
  BEGIN
    ALTER TABLE "Repayment" ADD CONSTRAINT "Repayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- AddForeignKey
  BEGIN
    ALTER TABLE "Repayment" ADD CONSTRAINT "Repayment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- AddForeignKey
  BEGIN
    ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- AddForeignKey
  BEGIN
    ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- AddForeignKey
  BEGIN
    ALTER TABLE "Document" ADD CONSTRAINT "Document_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- AddForeignKey
  BEGIN
    ALTER TABLE "Document" ADD CONSTRAINT "Document_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END
$baseline$;
