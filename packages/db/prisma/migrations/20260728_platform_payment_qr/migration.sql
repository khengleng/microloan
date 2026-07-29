-- The platform operator's own KHQR merchant profile, digested from a QR they
-- upload in the SUPERADMIN panel. Replaces the KHQR_* environment variables as
-- the source of truth for minting signup payment codes (the env vars remain a
-- fallback so existing deployments keep working).
--
-- Platform-scoped on purpose: no tenantId, because it belongs to the operator
-- rather than any tenant. The Prisma tenant guard lists it in
-- PLATFORM_ONLY_MODELS so tenant principals are denied it outright instead of
-- it falling outside the wall by omission.

CREATE TABLE "PlatformPaymentQr" (
    "id"                   TEXT NOT NULL,
    "bakongAccountId"      TEXT NOT NULL,
    "merchantName"         TEXT NOT NULL,
    "merchantCity"         TEXT NOT NULL,
    "merchantCategoryCode" TEXT NOT NULL DEFAULT '6012',
    -- The exact uploaded payload, kept verbatim so a future parser change can
    -- re-derive the merchant details without asking the operator to re-upload.
    "sourcePayload"        TEXT NOT NULL,
    -- IMAGE or PAYLOAD
    "sourceType"           TEXT NOT NULL,
    "isActive"             BOOLEAN NOT NULL DEFAULT true,
    "uploadedByUserId"     TEXT,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformPaymentQr_pkey" PRIMARY KEY ("id")
);

-- Reads always want "the current one", newest first.
CREATE INDEX "PlatformPaymentQr_isActive_createdAt_idx"
    ON "PlatformPaymentQr"("isActive", "createdAt");
