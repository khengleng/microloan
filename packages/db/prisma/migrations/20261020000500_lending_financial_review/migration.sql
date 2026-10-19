-- AlterTable
ALTER TABLE "LoanAccount" ADD COLUMN     "penaltyInSuspense" DECIMAL(24,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ScheduleInstalment" ADD COLUMN     "penaltyAccrued" DECIMAL(30,12) NOT NULL DEFAULT 0,
ADD COLUMN     "penaltyPosted" DECIMAL(24,4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PaymentAllocation" ADD COLUMN     "instalmentId" TEXT;

-- CreateTable
CREATE TABLE "PenaltyAccrual" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loanAccountId" TEXT NOT NULL,
    "instalmentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "toDate" DATE NOT NULL,
    "basis" DECIMAL(24,4) NOT NULL,
    "accrued" DECIMAL(30,12) NOT NULL,
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "rewoundByEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PenaltyAccrual_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PenaltyAccrual_tenantId_loanAccountId_instalmentId_status_idx" ON "PenaltyAccrual"("tenantId", "loanAccountId", "instalmentId", "status");

-- ═══════════════════════════════════════════════════════════════════════════
-- Financial review (DECISIONS D-133…D-137): cumulative penalty accrual,
-- penalty suspense on non-accrual loans, backdated repayments that rewind
-- penalties, and reversals tied to the exact schedule line paid.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "LoanAccount" ADD CONSTRAINT "LoanAccount_penalty_in_suspense_check"
  CHECK ("penaltyInSuspense" >= 0);
ALTER TABLE "ScheduleInstalment" ADD CONSTRAINT "ScheduleInstalment_penalty_accrual_check"
  CHECK ("penaltyAccrued" >= 0 AND "penaltyPosted" >= 0);

ALTER TABLE "PenaltyAccrual" ADD CONSTRAINT "PenaltyAccrual_enums_check"
  CHECK ("kind" IN ('DAILY', 'ONCE') AND "status" IN ('POSTED', 'REWOUND'));
ALTER TABLE "PenaltyAccrual" ADD CONSTRAINT "PenaltyAccrual_amounts_check"
  CHECK ("accrued" >= 0 AND "basis" >= 0 AND "fromDate" <= "toDate");
ALTER TABLE "PenaltyAccrual" ADD CONSTRAINT "PenaltyAccrual_rewound_check"
  CHECK (("status" = 'REWOUND') = ("rewoundByEventId" IS NOT NULL));
ALTER TABLE "PenaltyAccrual" ADD CONSTRAINT "PenaltyAccrual_tenantId_loanAccountId_fkey"
  FOREIGN KEY ("tenantId", "loanAccountId") REFERENCES "LoanAccount"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An assessment only moves between POSTED and REWOUND (a reversal of the
-- backdated repayment puts it back); nothing else about it changes, and rows
-- are deleted only by the opted-in tenant purge.
CREATE OR REPLACE FUNCTION lending_penalty_accrual_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF lending_purge_allowed() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'lending: PenaltyAccrual rows are never deleted'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.id = OLD.id AND NEW."tenantId" = OLD."tenantId" AND NEW."loanAccountId" = OLD."loanAccountId"
     AND NEW."instalmentId" = OLD."instalmentId" AND NEW.kind = OLD.kind
     AND NEW."fromDate" = OLD."fromDate" AND NEW."toDate" = OLD."toDate"
     AND NEW.basis = OLD.basis AND NEW.accrued = OLD.accrued AND NEW.suspended = OLD.suspended
     AND NEW."createdAt" = OLD."createdAt"
     AND ((OLD.status = 'POSTED' AND NEW.status = 'REWOUND')
       OR (OLD.status = 'REWOUND' AND NEW.status = 'POSTED')) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'lending: PenaltyAccrual % may only move between POSTED and REWOUND', OLD.id
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
CREATE TRIGGER "PenaltyAccrual_guard" BEFORE UPDATE OR DELETE ON "PenaltyAccrual"
  FOR EACH ROW EXECUTE FUNCTION lending_penalty_accrual_guard();

-- Row-level security: the second wall behind the Prisma tenant guard.
ALTER TABLE "PenaltyAccrual" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PenaltyAccrual" FORCE ROW LEVEL SECURITY;
CREATE POLICY "PenaltyAccrual_tenant_isolation" ON "PenaltyAccrual"
  USING (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK (coalesce(current_setting('app.tenant_id', true), '') = '' OR "tenantId" = current_setting('app.tenant_id', true));

-- Backfill PaymentAllocation."instalmentId" where the line is unambiguous:
-- exactly one line with that number on the loan at the latest agreement
-- version at or before the paying event's. Allocations are append-only, so
-- the guard is lifted for this one statement; rows it cannot place stay null
-- and their reversal falls back to the instalment number (DECISIONS D-137).
ALTER TABLE "PaymentAllocation" DISABLE TRIGGER "PaymentAllocation_append_only";
WITH candidates AS (
  SELECT pa.id AS allocation_id, si.id AS line_id, si."agreementVersion" AS version,
         max(si."agreementVersion") OVER (PARTITION BY pa.id) AS best,
         count(*) OVER (PARTITION BY pa.id, si."agreementVersion") AS at_version
    FROM "PaymentAllocation" pa
    JOIN "FinancialEvent" fe ON fe.id = pa."financialEventId" AND fe."tenantId" = pa."tenantId"
    JOIN "ScheduleInstalment" si ON si."tenantId" = pa."tenantId" AND si."loanAccountId" = pa."loanAccountId"
         AND si.number = pa."instalmentNumber" AND si."agreementVersion" <= fe."agreementVersion"
   WHERE pa."instalmentId" IS NULL
)
UPDATE "PaymentAllocation" pa SET "instalmentId" = c.line_id
  FROM candidates c
 WHERE c.allocation_id = pa.id AND c.version = c.best AND c.at_version = 1;
ALTER TABLE "PaymentAllocation" ENABLE TRIGGER "PaymentAllocation_append_only";
