-- Fresh-build compatibility (3 of 3); see 20260702_a_fresh_build_currency_type.
-- Moves PromiseToPay."currency" onto the "Currency" enum created by
-- 20260702_multicurrency_gl_provisioning_cbc and drops the early copy. A
-- no-op wherever "Currency_fresh_build" does not exist (every database built
-- before this file).

DO $$
BEGIN
  IF to_regtype('public."Currency_fresh_build"') IS NOT NULL THEN
    ALTER TABLE "PromiseToPay" ALTER COLUMN "currency" DROP DEFAULT;
    ALTER TABLE "PromiseToPay"
      ALTER COLUMN "currency" TYPE "Currency" USING ("currency"::text::"Currency");
    ALTER TABLE "PromiseToPay" ALTER COLUMN "currency" SET DEFAULT 'USD';
    DROP TYPE "Currency_fresh_build";
  END IF;
END $$;
