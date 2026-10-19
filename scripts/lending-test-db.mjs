#!/usr/bin/env node
/**
 * Prepare a throwaway database for the lending integration tests (CI and local).
 *
 *   LENDING_TEST_DATABASE_URL=<connection string> node scripts/lending-test-db.mjs
 *
 * The migration history cannot build a database from scratch (see
 * DEPLOYMENT.md), so this pushes the current Prisma schema and then applies
 * the database-level invariants — immutability triggers, the balanced-journal
 * constraint trigger, CHECK constraints and row-level security — taken
 * verbatim from the lending migration, so tests run against the same rules
 * production enforces.
 *
 * Destructive: it resets the target database. It refuses to run unless the
 * database name contains "test" or "ci".
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const url = process.env.LENDING_TEST_DATABASE_URL;
if (!url) {
  console.error('Set LENDING_TEST_DATABASE_URL to a throwaway PostgreSQL database.');
  process.exit(1);
}
const dbName = new URL(url).pathname.replace(/^\//, '');
if (!/(test|ci)/i.test(dbName)) {
  console.error(`Refusing to reset database "${dbName}": its name must contain "test" or "ci".`);
  process.exit(1);
}

const env = { ...process.env, DATABASE_URL: url };
const run = (cmd) => execSync(cmd, { env, stdio: 'inherit' });

run('pnpm --filter @microloan/db exec prisma db push --skip-generate --force-reset --accept-data-loss');

/**
 * Each lending migration ends with an invariant section introduced by a
 * banner. `db push` builds the tables but applies none of it, so the sections
 * are re-applied here in migration order.
 */
const INVARIANT_SECTIONS = [
  ['20261016_lending_platform_phase1', '-- Database-level invariants for the lending platform.'],
  ['20261017_lending_facilities_phase2', '-- Database-level invariants for lending facilities.'],
  ['20261017_lending_rate_resets', '-- Database-level invariants for rate resets.'],
  ['20261017_lending_group_liability', '-- Database-level invariants for group lending.'],
  ['20261017_lending_relief_refinance', '-- Database-level invariants for relief and refinancing.'],
  ['20261018000001_lending_policies_advance_nonaccrual', '-- Database-level invariants for loan policies, advances and non-accrual.'],
  ['20261018000002_lending_rls_all_tables', '-- Database-level invariants for tenant isolation of the remaining tables.'],
  ['20261018000004_lending_suspense_refunds', '-- Database-level invariants for unidentified payments and refunds.'],
  ['20261018000005_lending_impairment', '-- Database-level invariants for impairment.'],
  ['20261018000006_lending_collateral_servicing', '-- Database-level invariants for collateral servicing.'],
  ['20261019000500_lending_down_payment_payees', '-- Database-level invariants for down payments and payees.'],
  ['20261019000600_lending_payoff_quotes', '-- Database-level invariants for payoff letters.'],
  ['20261019000700_lending_collections_work', '-- Database-level invariants for collections work, guarantor demands and set-off.'],
  ['20261019000800_lending_facility_renewal', '-- Database-level invariants for facility renewal.'],
  ['20261019000900_lending_covenants', '-- Database-level invariants for covenants.'],
  ['20261019001100_lending_deferred_accrual', '-- Database-level invariants for deferred accrual.'],
  ['20261019000100_lending_recovery', '-- Database-level invariants for recovery workflows.'],
  ['20261019000300_lending_payment_channels', '-- Database-level invariants for payment channels.'],
  ['20261019000400_customer_documents', '-- Database-level invariants for customer documents.'],
  ['20261019000200_lending_trade_syndication', '-- Database-level invariants for trade finance and syndication.'],
  ['20261019001000_lending_cards_bnpl_lease', '-- Database-level invariants for cards, BNPL and leases.'],
  ['20261019001200_lending_period_close', '-- Database-level invariants for period close.'],
  ['20261019001300_lending_loan_migration', '-- Database-level invariants for loan-book migration.'],
  ['20261019001500_lending_regulatory_returns', '-- Database-level invariants for regulatory returns.'],
  ['20261019001700_tenant_webhooks', '-- Database-level invariants for tenant webhooks.'],
  ['20261019001900_trade_receivables_documentary', '-- Database-level invariants for bought receivables and documentary trade loans.'],
  ['20261019002000_lending_project_finance_borrowing_base', '-- Database-level invariants for project finance and borrowing bases.'],
  ['20261019002100_lending_institutional_icl_murabaha', '-- Database-level invariants for institutional lending, income-contingent repayment and Murabaha.'],
  ['20261019002200_tenant_settings_job_claims', '-- Database-level invariants for tenant lending settings and job claims.'],
  ['20261019002300_lending_scorecards', '-- Database-level invariants for scorecards and score evaluations.'],
  ['20261019002400_lending_alternative_data', '-- Database-level invariants for alternative data and consent.'],
  ['20261019003000_learning_progress', '-- Database-level invariants for Learning centre progress.'],
  ['20261019003200_lending_rate_cap', '-- Database-level invariants for the interest-rate cap.'],
];

for (const [dir, marker] of INVARIANT_SECTIONS) {
  const migration = fs.readFileSync(`packages/db/prisma/migrations/${dir}/migration.sql`, 'utf8');
  const at = migration.indexOf(marker);
  if (at < 0) throw new Error(`Invariant section not found in ${dir}.`);
  const start = migration.lastIndexOf('-- ═', at);
  const file = path.join(os.tmpdir(), `lending-invariants-${process.pid}-${dir}.sql`);
  fs.writeFileSync(file, migration.slice(start));
  run(`pnpm --filter @microloan/db exec prisma db execute --file ${file}`);
  fs.unlinkSync(file);
}
/**
 * The suites connect as a role that row-level security applies to: a
 * superuser or BYPASSRLS role skips every policy, so testing as the owner
 * would never exercise the database tenant wall.
 */
const appRole = 'lending_app_test';
const roleSql = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${appRole}') THEN
    CREATE ROLE ${appRole} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '${appRole}';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO ${appRole};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${appRole};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${appRole};
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${appRole};
`;
const roleFile = path.join(os.tmpdir(), `lending-app-role-${process.pid}.sql`);
fs.writeFileSync(roleFile, roleSql);
run(`pnpm --filter @microloan/db exec prisma db execute --file ${roleFile}`);
fs.unlinkSync(roleFile);
console.log(`Lending test database "${dbName}" is ready (app role: ${appRole}).`);
