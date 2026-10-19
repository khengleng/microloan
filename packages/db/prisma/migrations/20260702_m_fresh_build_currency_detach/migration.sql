-- Fresh-build compatibility (2 of 3); see 20260702_a_fresh_build_currency_type.
-- Acts only while 20260702_multicurrency_gl_provisioning_cbc has not run yet
-- (its "LedgerAccountType" enum is missing): the early "Currency" enum is
-- renamed out of the way so that migration's CREATE TYPE succeeds. On any
-- database that already has the multicurrency migration this is a no-op.

DO $$
BEGIN
  IF to_regtype('public."LedgerAccountType"') IS NULL
     AND to_regtype('public."Currency"') IS NOT NULL
     AND to_regtype('public."Currency_fresh_build"') IS NULL THEN
    ALTER TYPE "Currency" RENAME TO "Currency_fresh_build";
  END IF;
END $$;
