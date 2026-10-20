-- No table or column changes. Indexes on the foreign keys row-level security
-- and the core screens reach a loan's children by, then the strict tenant
-- wall: the row-level-security policies are replaced with strict ones and
-- extended to every remaining tenant-owned table (DECISIONS D-141…D-143,
-- docs/security/RLS.md).

-- CreateIndex
CREATE INDEX "Collateral_loanId_idx" ON "Collateral"("loanId");

-- CreateIndex
CREATE INDEX "Guarantor_loanId_idx" ON "Guarantor"("loanId");

-- CreateIndex
CREATE INDEX "LoanInteraction_loanId_idx" ON "LoanInteraction"("loanId");

-- CreateIndex
CREATE INDEX "RepaymentSchedule_loanId_idx" ON "RepaymentSchedule"("loanId");

-- CreateIndex
CREATE INDEX "Document_tenantId_idx" ON "Document"("tenantId");

-- CreateIndex
CREATE INDEX "Document_loanId_idx" ON "Document"("loanId");

-- ═══════════════════════════════════════════════════════════════════════════
-- The strict database tenant wall.
--
-- Until now a lending table admitted EVERY row when `app.tenant_id` was not
-- set, and the core tables (Borrower, Loan, User, AuditLog, …) had no
-- row-level security at all. From here a row is visible or writable only when
--
--   app.system   = 'on'            a declared system or platform path, or
--   app.tenant_id = the row's tenant
--
-- and in no other case: a connection that declares nothing sees no
-- tenant-owned row. The api declares both settings with
-- set_config(…, is_local => true) inside a transaction for every query
-- (apps/api/src/prisma/db-tenant-context.ts), so they never outlive it on a
-- pooled connection.
--
-- Rows whose tenantId is NULL (platform users, platform audit entries) are
-- visible only in system context: NULL never equals a tenant id.
--
-- Note: PostgreSQL does not apply these policies to a superuser or a
-- BYPASSRLS role. FORCE makes them apply to a non-superuser table owner, so
-- a later migration that reads or changes rows of these tables as such an
-- owner must first run  SELECT set_config('app.system', 'on', true);
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t text;
  pol record;
  sys constant text := $q$current_setting('app.system', true) = 'on'$q$;
  own constant text := $q$"tenantId" = current_setting('app.tenant_id', true)$q$;
  child record;
BEGIN
  -- 1. Every table with its own tenantId column (nullable or not), except the
  --    platform's tenant archives, which no tenant may read.
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenantId' AND NOT a.attisdropped
     WHERE c.relkind = 'r' AND c.relname <> 'TenantArchive'
     ORDER BY 1
  LOOP
    FOR pol IN SELECT polname FROM pg_policy WHERE polrelid = format('%I', t)::regclass LOOP
      EXECUTE format('DROP POLICY %I ON %I', pol.polname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (%s OR %s) WITH CHECK (%s OR %s)',
      t || '_tenant_wall', t, sys, own, sys, own);
  END LOOP;

  -- 2. The tenant row itself: a tenant sees its own organisation only.
  EXECUTE 'ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "Tenant" FORCE ROW LEVEL SECURITY';
  DROP POLICY IF EXISTS "Tenant_tenant_wall" ON "Tenant";
  EXECUTE format('CREATE POLICY "Tenant_tenant_wall" ON "Tenant" USING (%s OR id = current_setting(''app.tenant_id'', true)) WITH CHECK (%s OR id = current_setting(''app.tenant_id'', true))',
    sys, sys);

  -- 3. Tables without a tenantId reach their tenant through their parent.
  FOR child IN
    SELECT * FROM (VALUES
      ('RepaymentSchedule', 'loanId', 'Loan'),
      ('Collateral', 'loanId', 'Loan'),
      ('Guarantor', 'loanId', 'Loan'),
      ('LoanInteraction', 'loanId', 'Loan'),
      ('JournalLine', 'entryId', 'JournalEntry'),
      ('LoanProvision', 'runId', 'ProvisionRun'),
      ('LoanPolicy', 'productId', 'LoanProduct'),
      ('RolePermission', 'roleId', 'AccessRole'),
      ('Holiday', 'calendarId', 'HolidayCalendar'),
      ('RefreshToken', 'userId', 'User'),
      ('PasswordResetToken', 'userId', 'User'),
      ('MfaChallenge', 'userId', 'User'),
      ('FederatedIdentity', 'userId', 'User')
    ) AS v(tbl, fk, parent)
  LOOP
    FOR pol IN SELECT polname FROM pg_policy WHERE polrelid = format('%I', child.tbl)::regclass LOOP
      EXECUTE format('DROP POLICY %I ON %I', pol.polname, child.tbl);
    END LOOP;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', child.tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', child.tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (%s OR EXISTS (SELECT 1 FROM %I p WHERE p.id = %I.%I AND p."tenantId" = current_setting(''app.tenant_id'', true))) '
      || 'WITH CHECK (%s OR EXISTS (SELECT 1 FROM %I p WHERE p.id = %I.%I AND p."tenantId" = current_setting(''app.tenant_id'', true)))',
      child.tbl || '_tenant_wall', child.tbl,
      sys, child.parent, child.tbl, child.fk,
      sys, child.parent, child.tbl, child.fk);
  END LOOP;

  -- 4. Platform-owned configuration: system or platform context only.
  FOREACH t IN ARRAY ARRAY['PlatformApproval', 'TenantArchive', 'PlatformPaymentQr'] LOOP
    FOR pol IN SELECT polname FROM pg_policy WHERE polrelid = format('%I', t)::regclass LOOP
      EXECUTE format('DROP POLICY %I ON %I', pol.polname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (%s) WITH CHECK (%s)',
      t || '_platform_only', t, sys, sys);
  END LOOP;

  -- 5. No policy anywhere may still admit rows when nothing is declared.
  IF EXISTS (
    SELECT 1 FROM pg_policy p
     WHERE pg_get_expr(p.polqual, p.polrelid) LIKE '%COALESCE(current_setting(''app.tenant_id''%'
  ) THEN
    RAISE EXCEPTION 'a permissive "no tenant declared" policy survived';
  END IF;
END $$;
