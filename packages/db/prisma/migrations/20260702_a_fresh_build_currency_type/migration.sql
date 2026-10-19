-- Fresh-build compatibility (1 of 3). A no-op on databases that already have
-- the 20260702 migrations; existing databases mark it applied with
-- scripts/mark-baseline-applied.mjs.
--
-- 20260702_collections_ptp uses the "Currency" enum, which
-- 20260702_multicurrency_gl_provisioning_cbc creates. Migrations apply in
-- name order and "collections" sorts before "multicurrency", so a build from
-- empty failed there. This creates the enum early under its final name;
-- 20260702_m_fresh_build_currency_detach moves it aside before the
-- multicurrency migration creates its own, and
-- 20260702_n_fresh_build_currency_reattach points PromiseToPay at that one.

DO $$
BEGIN
  IF to_regtype('public."Currency"') IS NULL THEN
    CREATE TYPE "Currency" AS ENUM ('USD', 'KHR');
  END IF;
END $$;

-- The default production reached through `db push` after
-- 20260424_rbac_hardening_model added the role. Same value as schema.prisma,
-- so setting it again on an existing database changes nothing.
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'LOAN_OFFICER';
