-- Runtime database role for the api (row-level security applies to it).
--
-- The api connects as a NOSUPERUSER NOBYPASSRLS role that does not own the
-- tables (DATABASE_URL); migrations run as the owner (MIGRATION_DATABASE_URL).
-- PostgreSQL skips every row-level-security policy for a superuser, a
-- BYPASSRLS role and the table owner, so connecting as the owner would switch
-- the database tenant wall off. See DEPLOYMENT.md -> "Database roles".
--
-- What this does, idempotently (safe to re-run at any time):
--   1. creates the role if it is missing (LOGIN NOSUPERUSER NOBYPASSRLS
--      NOCREATEDB NOCREATEROLE) and re-asserts those attributes if it exists;
--      sets the password when one is given;
--   2. grants it what the api needs on every existing table, sequence and
--      function in schema public;
--   3. ALTER DEFAULT PRIVILEGES for the migration owner, so every table,
--      sequence and function a later migration creates is granted to the
--      role automatically. Without this, a migration that adds a table
--      deploys fine and the api then fails with "permission denied" on it;
--   4. keeps the role away from Prisma's _prisma_migrations bookkeeping.
--
-- Run it as the migration owner (the role that runs `prisma migrate deploy`),
-- with psql, against the application database:
--
--   psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -v app_role=lending_app \
--     -v owner_role=postgres \
--     -v app_password="$LENDING_APP_PASSWORD" \
--     -f ops/db/app-role.sql
--
-- app_password may be empty (-v app_password=) when the role already exists
-- and its password should stay as it is. Supply it from a secret store or an
-- environment variable, never on a command line that lands in shell history
-- and never in this file. owner_role must be the role that creates the
-- tables (current_user when you connect with MIGRATION_DATABASE_URL); you must
-- be that role or a member of it.
--
-- scripts/lending-test-db.mjs runs this same file (with the psql variables
-- substituted) before it builds the test schema, so CI exercises exactly this
-- arrangement.

\set ON_ERROR_STOP on

-- Hand the psql variables to the DO block (psql does not interpolate inside
-- dollar quotes). SET prints nothing, so the password is never echoed.
SET microloan.app_role = :'app_role';
SET microloan.owner_role = :'owner_role';
SET microloan.app_password = :'app_password';

DO $app_role$
DECLARE
  app   text := current_setting('microloan.app_role');
  owner text := current_setting('microloan.owner_role');
  pw    text := current_setting('microloan.app_password');
BEGIN
  IF app IS NULL OR app = '' OR owner IS NULL OR owner = '' THEN
    RAISE EXCEPTION 'app_role and owner_role must be set (-v app_role=... -v owner_role=...)';
  END IF;
  IF app = owner THEN
    RAISE EXCEPTION 'app_role must not be the table owner: row-level security does not apply to the owner';
  END IF;

  -- 1. The role.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app) THEN
    IF pw IS NULL OR pw = '' THEN
      RAISE EXCEPTION 'role % does not exist: supply -v app_password=... to create it', app;
    END IF;
    EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', app, pw);
    RAISE NOTICE 'created role %', app;
  ELSE
    EXECUTE format('ALTER ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION', app);
    IF pw IS NOT NULL AND pw <> '' THEN
      EXECUTE format('ALTER ROLE %I PASSWORD %L', app, pw);
      RAISE NOTICE 'updated password of role %', app;
    END IF;
  END IF;

  -- 2. Existing objects.
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), app);
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', app);
  EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', app);
  EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', app);
  EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO %I', app);

  -- 3. Objects future migrations create (as the owner).
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', owner, app);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', owner, app);
  EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO %I', owner, app);

  -- 4. Migration bookkeeping is the owner's business.
  IF to_regclass('public."_prisma_migrations"') IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON TABLE public."_prisma_migrations" FROM %I', app);
  END IF;
END
$app_role$;

-- Do not leave the password in the session settings.
RESET microloan.app_password;

-- Verification: the role must not bypass row-level security.
SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
  FROM pg_roles WHERE rolname = current_setting('microloan.app_role');
