-- Encrypt-at-rest for Borrower PII (idNumber, phone, email, address) + blind indexes.
-- Adds deterministic-hash columns for exact-match lookup / uniqueness and moves
-- the national-ID uniqueness from GLOBAL to per-tenant (fixes cross-tenant leak).
ALTER TABLE "Borrower" ADD COLUMN "idNumberHash" TEXT;
ALTER TABLE "Borrower" ADD COLUMN "phoneHash" TEXT;

-- Drop the former global unique on the (soon-to-be encrypted) idNumber.
DROP INDEX IF EXISTS "Borrower_idNumber_key";

-- Per-tenant uniqueness over the blind index (NULLs allowed → borrowers without
-- an ID are unaffected). Populated by the backfill.
CREATE UNIQUE INDEX "Borrower_tenantId_idNumberHash_key" ON "Borrower"("tenantId", "idNumberHash");
CREATE INDEX "Borrower_phoneHash_idx" ON "Borrower"("phoneHash");
