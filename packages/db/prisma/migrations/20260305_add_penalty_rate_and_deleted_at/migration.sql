-- Fix 5: Add configurable penalty rate to Tenant (platform-wide default)
ALTER TABLE "Tenant" ADD COLUMN "penaltyRatePerDay" DECIMAL(8,2) NOT NULL DEFAULT 10.00;

-- Fix 5: Add per-product penalty override to LoanProduct (null = use tenant default)
ALTER TABLE "LoanProduct" ADD COLUMN "penaltyRatePerDay" DECIMAL(8,2);

-- Fix 9: GDPR soft-delete marker on Tenant
ALTER TABLE "Tenant" ADD COLUMN "deletedAt" TIMESTAMP(3);
