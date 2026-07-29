-- Federated (Google) sign-in for staff accounts, plus the payment gate on
-- self-serve workspace signup.
--
-- Three changes, in dependency order:
--   1. User.passwordHash becomes optional — a Google-created account has no
--      local password. Existing rows are unaffected.
--   2. FederatedIdentity links a provider subject to a User.
--   3. PlanPayment holds the KHQR payment a new paid workspace must settle
--      before a SUPERADMIN can activate it.

-- 1. Password becomes optional -----------------------------------------------
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- 2. Federated identities ----------------------------------------------------
CREATE TABLE "FederatedIdentity" (
    "id"                TEXT NOT NULL,
    "userId"            TEXT NOT NULL,
    "provider"          TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "email"             TEXT NOT NULL,
    "lastLoginAt"       TIMESTAMP(3),
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FederatedIdentity_pkey" PRIMARY KEY ("id")
);

-- One provider account maps to exactly one local user. This is the constraint
-- that stops two accounts claiming the same Google identity.
CREATE UNIQUE INDEX "FederatedIdentity_provider_providerAccountId_key"
    ON "FederatedIdentity"("provider", "providerAccountId");
CREATE INDEX "FederatedIdentity_userId_idx" ON "FederatedIdentity"("userId");

ALTER TABLE "FederatedIdentity"
    ADD CONSTRAINT "FederatedIdentity_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Plan payments -----------------------------------------------------------
CREATE TABLE "PlanPayment" (
    "id"                TEXT NOT NULL,
    "tenantId"          TEXT NOT NULL,
    "plan"              TEXT NOT NULL,
    "amount"            DECIMAL(12,2) NOT NULL,
    "currency"          "Currency" NOT NULL DEFAULT 'USD',
    "reference"         TEXT NOT NULL,
    "qrPayload"         TEXT NOT NULL,
    "status"            TEXT NOT NULL DEFAULT 'PENDING',
    "confirmedByUserId" TEXT,
    "confirmedAt"       TIMESTAMP(3),
    "rejectedReason"    TEXT,
    "expiresAt"         TIMESTAMP(3) NOT NULL,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanPayment_pkey" PRIMARY KEY ("id")
);

-- `reference` is the public handle an unauthenticated applicant uses to
-- re-open their QR, so it must be unique as well as unguessable.
CREATE UNIQUE INDEX "PlanPayment_reference_key" ON "PlanPayment"("reference");
CREATE INDEX "PlanPayment_tenantId_status_idx" ON "PlanPayment"("tenantId", "status");
CREATE INDEX "PlanPayment_status_createdAt_idx" ON "PlanPayment"("status", "createdAt");

ALTER TABLE "PlanPayment"
    ADD CONSTRAINT "PlanPayment_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
