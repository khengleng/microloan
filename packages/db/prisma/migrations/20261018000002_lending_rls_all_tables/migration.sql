-- No table or column changes: this migration only extends the database tenant
-- wall to every tenant-owned lending, access and configuration table that did
-- not yet have row-level security.

-- ═══════════════════════════════════════════════════════════════════════════
-- Database-level invariants for tenant isolation of the remaining tables.
--
-- Everything below this banner is re-applied verbatim to the integration-test
-- database by scripts/lending-test-db.mjs. Keep it to constraints, triggers and
-- policies — no table or index DDL, which `prisma db push` has already created.
-- ═══════════════════════════════════════════════════════════════════════════
-- Same policy as the earlier lending tables: inside a tenant transaction
-- (app.tenant_id set) only that tenant's rows exist. Note: PostgreSQL does not
-- apply these policies to a superuser or BYPASSRLS role; the API logs an error
-- at startup when it connects as one.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'CreditDecision','ApplicationDocument','ApprovalTask','ConditionPrecedent',
    'CollateralAsset','Valuation','CollateralPledge','Guarantee',
    'RestructureEvidence','AffordabilityAssessment','RestructureApproval',
    'RestructureAcceptance','RestructureCondition','RestructureReviewTask',
    'AffordabilityPolicy','LendingProduct','ProductVersion',
    'PricingConfiguration','RepaymentConfiguration','RateObservation',
    'Portfolio','LegalEntity','TenantBusinessDate','HolidayCalendar',
    'AccessRole','RoleAssignment','Delegation','ApprovalAuthority',
    'AccessPolicy','PolicyVersion','FlagRule','FlagChangeApproval',
    'CohortMembership','ServiceAccount','WorkflowVersion','OutboxMessage'
  ]
  LOOP
    IF to_regclass(format('%I', t)) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true)) '
      || 'WITH CHECK (coalesce(current_setting(''app.tenant_id'', true), '''') = '''' OR "tenantId" = current_setting(''app.tenant_id'', true))',
      t || '_tenant_isolation', t);
  END LOOP;
END $$;
