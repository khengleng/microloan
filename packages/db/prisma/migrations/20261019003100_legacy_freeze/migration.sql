-- AlterTable
ALTER TABLE "Repayment" ADD COLUMN     "allocation" JSONB;

-- D-097: the original loan module is read-only by default. The catalogue
-- synchronisation creates a flag with its code default but never changes the
-- default of a flag that already exists, so existing databases are moved here.
-- A tenant that has a TENANT rule for the flag keeps it.
UPDATE "FeatureFlag"
SET "defaultEnabled" = true
WHERE "key" = 'lending.legacy_loans.readonly';
