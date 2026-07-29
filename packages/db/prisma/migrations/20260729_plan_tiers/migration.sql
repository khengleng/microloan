-- Subscription tiers become platform-owner configuration.
--
-- Before this migration a tier was a hardcoded union: quotas lived in
-- `apps/api/src/common/plan-limits.ts` and prices in `PLAN_PRICE_*` environment
-- variables. Adding a tier or changing a price meant a deploy. They are rows
-- now, managed from the SUPERADMIN panel.
--
-- Platform-scoped: no tenantId. The Prisma tenant guard classifies it as a
-- platform *catalogue* — readable by tenant principals (the quota guard reads
-- the caller's own ceilings on every quota-checked write) but writable only by
-- the platform.

CREATE TABLE "PlanTier" (
    "id"              TEXT NOT NULL,
    -- Stable key, stored on "Tenant"."plan" and "PlanPayment"."plan". Those
    -- columns hold the name rather than a foreign key, so the name is treated
    -- as immutable by the application; "displayName" is the editable label.
    "name"            TEXT NOT NULL,
    "displayName"     TEXT NOT NULL,
    "description"     TEXT,
    "priceAmount"     DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency"        "Currency" NOT NULL DEFAULT 'USD',
    -- NULL means unlimited, rather than a magic large integer. A sentinel like
    -- 9007199254740991 round-trips badly through JSON and a UI number input,
    -- and a forgotten field would read as a quota of zero.
    "maxUsers"        INTEGER,
    "maxBorrowers"    INTEGER,
    "maxLoanProducts" INTEGER,
    "maxLoans"        INTEGER,
    "sortOrder"       INTEGER NOT NULL DEFAULT 0,
    -- Whether the tier can be chosen at signup. A retired tier keeps serving
    -- quota ceilings to tenants already on it: retiring must never silently
    -- demote a paying customer to FREE limits.
    "isActive"        BOOLEAN NOT NULL DEFAULT true,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanTier_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlanTier_name_key" ON "PlanTier"("name");

-- The signup catalogue query: active tiers in display order.
CREATE INDEX "PlanTier_isActive_sortOrder_idx" ON "PlanTier"("isActive", "sortOrder");

-- Seed the four tiers that were previously hardcoded, with their existing
-- quotas and default prices, so an existing deployment behaves identically the
-- moment this lands. ENTERPRISE's unlimited quotas become NULL.
--
-- NOTE FOR OPERATORS: if this deployment overrode prices with PLAN_PRICE_BASIC
-- / PLAN_PRICE_PROFESSIONAL / PLAN_PRICE_ENTERPRISE / PLAN_PRICE_CURRENCY, SQL
-- cannot read those, so the code defaults are seeded here and the env vars are
-- no longer consulted. Re-enter the real prices under Platform → Subscription
-- Plans after deploying. The API logs a warning at boot if it finds those
-- variables still set.
INSERT INTO "PlanTier" (
    "id", "name", "displayName", "description",
    "priceAmount", "currency",
    "maxUsers", "maxBorrowers", "maxLoanProducts", "maxLoans",
    "sortOrder", "isActive", "createdAt", "updatedAt"
) VALUES
    (gen_random_uuid(), 'FREE', 'Free', 'Evaluate the platform with a small portfolio.',
     0, 'USD', 3, 50, 2, 100, 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'BASIC', 'Basic', 'A single branch getting started.',
     49, 'USD', 10, 500, 5, 1000, 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'PROFESSIONAL', 'Professional', 'Multi-branch operations with a growing book.',
     149, 'USD', 25, 2500, 15, 5000, 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (gen_random_uuid(), 'ENTERPRISE', 'Enterprise', 'Unlimited scale, for institutions.',
     499, 'USD', NULL, NULL, NULL, NULL, 40, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Any tier name already in use by a tenant but not seeded above (a hand-edited
-- "Tenant"."plan", or a plan from an older build) is materialised as a retired
-- tier with FREE-equivalent quotas. Without this those tenants would resolve to
-- no tier at all; with it they keep working and the operator can see and
-- reprice them instead of discovering the gap through a support ticket.
INSERT INTO "PlanTier" (
    "id", "name", "displayName", "description",
    "priceAmount", "currency",
    "maxUsers", "maxBorrowers", "maxLoanProducts", "maxLoans",
    "sortOrder", "isActive", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid(), t."plan", t."plan",
    'Recovered during the plan-tier migration: this name was in use by at least one organization but was not a known tier. Review its price and quotas.',
    0, 'USD', 3, 50, 2, 100,
    900, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "plan" FROM "Tenant" WHERE "plan" IS NOT NULL) AS t
WHERE t."plan" NOT IN ('FREE', 'BASIC', 'PROFESSIONAL', 'ENTERPRISE');
