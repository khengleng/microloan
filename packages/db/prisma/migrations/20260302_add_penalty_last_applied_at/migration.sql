-- Add idempotency guard for daily penalty cron job
-- Ensures penalties are applied at most once per calendar day per schedule

ALTER TABLE "RepaymentSchedule" ADD COLUMN "penaltyLastAppliedAt" TIMESTAMP(3);
