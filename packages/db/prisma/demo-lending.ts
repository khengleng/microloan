/**
 * Demo data for the configurable lending platform.
 *
 *   pnpm --filter @microloan/db exec tsx prisma/demo-lending.ts
 *
 * Creates "Demo Lending Co" with a user per lending role, scoped role
 * assignments, approval authorities, a holiday calendar, the five Phase 1
 * products already approved by a different checker and ACTIVE, and verified
 * borrowers. Idempotent: re-running reuses existing rows.
 *
 * Refuses to run against production unless DEMO_SEED_ALLOW=true.
 *
 * The lending catalogue (families, templates, permissions, flags) is
 * synchronised by the API on boot — start the API once before using the demo.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { lending } from '../../shared/src/index';

const prisma = new PrismaClient();

if (process.env.NODE_ENV === 'production' && process.env.DEMO_SEED_ALLOW !== 'true') {
  console.error('Refusing to seed demo data in production (set DEMO_SEED_ALLOW=true to override).');
  process.exit(1);
}

/**
 * The demo users' password: DEMO_PASSWORD, or a fresh random one printed at
 * the end — never a literal in the code. Users an earlier run created keep
 * the password they were created with.
 */
const PASSWORD = process.env.DEMO_PASSWORD?.trim() || `Demo-${randomBytes(12).toString('base64url')}`;
const PASSWORD_FROM_ENV = !!process.env.DEMO_PASSWORD?.trim();
/** Emails of the users this run created (and so gave PASSWORD). */
const created = new Set<string>();
const TENANT = 'Demo Lending Co';
/** Demo tenant's published USD/KHR rate (riel per dollar). Demo data only; real tenants enter their own under FX rates. */
const DEMO_USD_KHR_RATE = '4100';
/** The authenticator label, as the API names itself (PLATFORM_NAME). */
const ISSUER = encodeURIComponent((process.env.PLATFORM_NAME?.trim() || 'Magic Money').replace(/\s+/g, ''));
/** A fresh authenticator secret: 20 random bytes, base32 (RFC 4648), as authenticator apps expect. */
function newTotpSecret(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const b of randomBytes(20)) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += alphabet[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}

const USERS: { key: string; role: string; legacyRole: string; branch: 'HQ' | 'PNH' | 'REP' | null; scope: 'ALL' | 'BRANCH' }[] = [
  { key: 'admin', role: 'TENANT_ADMIN', legacyRole: 'TENANT_ADMIN', branch: null, scope: 'ALL' },
  { key: 'admin2', role: 'TENANT_ADMIN', legacyRole: 'TENANT_ADMIN', branch: null, scope: 'ALL' },
  { key: 'product.maker', role: 'PRODUCT_MAKER', legacyRole: 'LOAN_OFFICER', branch: 'HQ', scope: 'ALL' },
  { key: 'product.checker', role: 'PRODUCT_CHECKER', legacyRole: 'LOAN_OFFICER', branch: 'HQ', scope: 'ALL' },
  { key: 'officer.pnh', role: 'RELATIONSHIP_OFFICER', legacyRole: 'LOAN_OFFICER', branch: 'PNH', scope: 'BRANCH' },
  { key: 'officer.rep', role: 'RELATIONSHIP_OFFICER', legacyRole: 'LOAN_OFFICER', branch: 'REP', scope: 'BRANCH' },
  { key: 'analyst', role: 'CREDIT_ANALYST', legacyRole: 'LOAN_OFFICER', branch: 'HQ', scope: 'ALL' },
  { key: 'approver', role: 'CREDIT_APPROVER', legacyRole: 'LOAN_OFFICER', branch: 'HQ', scope: 'ALL' },
  { key: 'approver2', role: 'CREDIT_APPROVER', legacyRole: 'LOAN_OFFICER', branch: 'HQ', scope: 'ALL' },
  { key: 'ops.maker', role: 'LOAN_OPS_MAKER', legacyRole: 'LOAN_OFFICER', branch: 'HQ', scope: 'ALL' },
  { key: 'ops.checker', role: 'LOAN_OPS_CHECKER', legacyRole: 'LOAN_OFFICER', branch: 'HQ', scope: 'ALL' },
  { key: 'collections', role: 'COLLECTIONS_OFFICER', legacyRole: 'LOAN_OFFICER', branch: 'HQ', scope: 'ALL' },
  { key: 'finance', role: 'FINANCE_OFFICER', legacyRole: 'LOAN_OFFICER', branch: 'HQ', scope: 'ALL' },
  { key: 'committee', role: 'RESTRUCTURE_COMMITTEE', legacyRole: 'LOAN_OFFICER', branch: 'HQ', scope: 'ALL' },
  { key: 'risk', role: 'RISK_COMPLIANCE', legacyRole: 'LOAN_OFFICER', branch: 'HQ', scope: 'ALL' },
  { key: 'auditor', role: 'AUDITOR', legacyRole: 'LOAN_OFFICER', branch: 'HQ', scope: 'ALL' },
];

const AUTHORITIES: [string, string, string, string][] = [
  ['approver', 'credit_decision.approve', 'USD', '100000'],
  // The second approver and the ops checker also cover institutional
  // (interbank, sovereign, development) amounts.
  ['approver2', 'credit_decision.approve', 'USD', '100000000'],
  ['approver', 'credit_decision.approve', 'KHR', '400000000'],
  ['ops.checker', 'loan.disbursement.approve', 'USD', '100000000'],
  ['ops.checker', 'loan.writeoff.approve', 'USD', '50000'],
  ['approver', 'restructure.approve', 'USD', '100000'],
  ['committee', 'restructure.approve', 'USD', '500000'],
  ['committee', 'restructure.waive_charges', 'USD', '5000'],
  ['committee', 'restructure.forgive_principal', 'USD', '2000'],
];

const PRODUCTS: { template: string; code: string; name: string }[] = [
  { template: 'PERSONAL_INSTALMENT', code: 'PL-STD', name: 'Personal instalment loan' },
  { template: 'MICRO_INDIVIDUAL', code: 'MF-IND', name: 'Microenterprise loan' },
  { template: 'SME_TERM', code: 'SME-TERM', name: 'SME term loan' },
  { template: 'HOME_MORTGAGE', code: 'MTG-STD', name: 'Home mortgage' },
  { template: 'AGRI_CROP_SEASONAL', code: 'AG-CROP', name: 'Seasonal crop loan' },
];

async function main() {
  const families = await prisma.loanFamily.count();
  if (!families) throw new Error('The lending catalogue is empty. Start the API once (it synchronises the catalogue on boot), then re-run.');

  const tenant = (await prisma.tenant.findFirst({ where: { name: TENANT } })) ?? (await prisma.tenant.create({ data: { name: TENANT, status: 'ACTIVE', plan: 'ENTERPRISE' } }));
  const t = tenant.id;
  const branch = async (code: string, name: string) => (await prisma.branch.findFirst({ where: { tenantId: t, code } })) ?? prisma.branch.create({ data: { tenantId: t, code, name } });
  const branches = { HQ: await branch('HQ', 'Head Office'), PNH: await branch('PNH', 'Phnom Penh'), REP: await branch('REP', 'Siem Reap') };
  await prisma.tenantBusinessDate.upsert({ where: { tenantId: t }, create: { tenantId: t, businessDate: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`) }, update: {} });

  // System roles for the tenant (same definitions the API provisions).
  const roleIds: Record<string, string> = {};
  const { ROLE_DEFINITIONS } = await import('../../../apps/api/src/lending/policy/catalogue');
  for (const def of ROLE_DEFINITIONS) {
    const r = await prisma.accessRole.upsert({ where: { tenantId_code: { tenantId: t, code: def.code } }, create: { tenantId: t, code: def.code, name: def.name, description: def.description, isSystem: true }, update: {} });
    await prisma.rolePermission.createMany({ data: def.permissions.map((p: string) => ({ roleId: r.id, permissionCode: p })), skipDuplicates: true });
    roleIds[def.code] = r.id;
  }

  const hash = await bcrypt.hash(PASSWORD, 12);
  const users: Record<string, string> = {};
  for (const u of USERS) {
    const email = `${u.key}@demo-lending.test`;
    const user =
      (await prisma.user.findUnique({ where: { email } })) ??
      (created.add(email), await prisma.user.create({ data: { email, tenantId: t, role: u.legacyRole as never, branchId: u.branch ? branches[u.branch].id : null, passwordHash: hash } }));
    users[u.key] = user.id;
    const exists = await prisma.roleAssignment.findFirst({ where: { tenantId: t, userId: user.id, roleId: roleIds[u.role], status: 'ACTIVE' } });
    if (!exists && u.role !== 'TENANT_ADMIN') {
      await prisma.roleAssignment.create({
        data: { tenantId: t, userId: user.id, roleId: roleIds[u.role], allBranches: u.scope === 'ALL', branchIds: u.scope === 'BRANCH' && u.branch ? [branches[u.branch].id] : [], status: 'ACTIVE', requestedBy: 'demo-seed', approvedBy: 'demo-seed', reason: 'Demo data' },
      });
    }
  }
  for (const [key, permission, currency, max] of AUTHORITIES) {
    const exists = await prisma.approvalAuthority.findFirst({ where: { tenantId: t, userId: users[key], permission, currency, status: 'ACTIVE' } });
    if (!exists) await prisma.approvalAuthority.create({ data: { tenantId: t, userId: users[key], permission, currency, maxAmount: max, status: 'ACTIVE', requestedBy: 'demo-seed', approvedBy: 'demo-seed' } });
  }

  // Four all-round test accounts. Each holds every staff role across all
  // branches, high approval authorities, and an authenticator already set up,
  // so one tester can walk every scenario by switching accounts: the platform
  // never lets the same person create, recommend and approve the same thing
  // (an application needs three people; a large one a fourth).
  const { ACTIONS } = await import('../../../apps/api/src/lending/policy/actions');
  const { encryptField, decryptField } = await import('../../../apps/api/src/common/field-crypto');
  const qaSecrets: Record<string, string> = {};
  const authorityPermissions = [...new Set((ACTIONS as { approvalAuthority?: boolean; permission: string }[]).filter((x) => x.approvalAuthority).map((x) => x.permission))];
  for (const key of ['qa.maker', 'qa.checker', 'qa.approver', 'qa.approver2']) {
    const email = `${key}@demo-lending.test`;
    const user =
      (await prisma.user.findUnique({ where: { email } })) ??
      (created.add(email), await prisma.user.create({ data: { email, tenantId: t, role: 'TENANT_ADMIN' as never, branchId: null, passwordHash: hash } }));
    // Each environment gets its own random secret on first run; later runs keep it.
    const secret = (user.twoFactorSecret && decryptField(user.twoFactorSecret)) || newTotpSecret();
    qaSecrets[key] = secret;
    await prisma.user.update({ where: { id: user.id }, data: { branchId: null, twoFactorSecret: encryptField(secret), twoFactorEnabled: true } });
    users[key] = user.id;
    for (const def of ROLE_DEFINITIONS) {
      if (def.code === 'TENANT_ADMIN' || def.code === 'INTEGRATION_SERVICE') continue;
      const exists = await prisma.roleAssignment.findFirst({ where: { tenantId: t, userId: user.id, roleId: roleIds[def.code], status: 'ACTIVE' } });
      if (!exists)
        await prisma.roleAssignment.create({
          data: { tenantId: t, userId: user.id, roleId: roleIds[def.code], allBranches: true, branchIds: [], status: 'ACTIVE', requestedBy: 'demo-seed', approvedBy: 'demo-seed', reason: 'All-round QA account' },
        });
    }
    for (const permission of authorityPermissions)
      for (const [currency, max] of [['USD', '1000000000'], ['KHR', '4000000000000']] as const) {
        const exists = await prisma.approvalAuthority.findFirst({ where: { tenantId: t, userId: user.id, permission, currency, status: 'ACTIVE' } });
        if (!exists) await prisma.approvalAuthority.create({ data: { tenantId: t, userId: user.id, permission, currency, maxAmount: max, status: 'ACTIVE', requestedBy: 'demo-seed', approvedBy: 'demo-seed' } });
      }
  }

  const cal = await prisma.holidayCalendar.upsert({ where: { tenantId_code: { tenantId: t, code: 'KH' } }, create: { tenantId: t, code: 'KH', name: 'Cambodia', weekendDays: [6, 7] }, update: {} });
  for (const [date, name] of [['2026-01-01', 'International New Year'], ['2026-04-14', 'Khmer New Year'], ['2026-04-15', 'Khmer New Year'], ['2026-04-16', 'Khmer New Year'], ['2026-11-09', 'Independence Day']]) {
    await prisma.holiday.upsert({ where: { calendarId_date: { calendarId: cal.id, date: new Date(`${date}T00:00:00Z`) } }, create: { calendarId: cal.id, date: new Date(`${date}T00:00:00Z`), name }, update: {} });
  }

  // Products: drafted by the product maker, approved and activated by the product checker.
  // The five Phase 1 products first, then one product for every other loan type
  // whose capabilities are implemented, so every loan type can be tried.
  const all = [
    ...PRODUCTS,
    ...lending.PRODUCT_TEMPLATES.filter(
      (tpl) => !PRODUCTS.some((p) => p.template === tpl.code) && lending.templateAvailability(tpl).available,
    ).map((tpl) => ({ template: tpl.code, code: tpl.code.replace(/_/g, '-').slice(0, 30), name: tpl.name })),
  ];
  const skipped: string[] = [];
  // The interest-rate cap in force, as the API resolves it (DECISIONS D-105…D-110):
  // a demo product is only activated when its rates fit under it.
  const { operationalConfig } = await import('../../../apps/api/src/config/operational-config');
  const ceiling = lending.pctToFraction(operationalConfig().regulatoryMaxAnnualRatePct);
  const tenantCap = lending.pctToFraction(tenant.maxAnnualInterestRatePct?.toString());
  const capPolicy = lending.rateCapPolicyOf(lending.defaultTenantLendingSettings());
  for (const p of all) {
    if (await prisma.lendingProduct.findFirst({ where: { tenantId: t, code: p.code } })) continue;
    const template = lending.TEMPLATE_BY_CODE[p.template];
    const config = { ...template.defaultConfig, identity: { ...template.defaultConfig.identity, name: p.name } };
    const valid = lending.validateProductConfig(config);
    if (!valid.ok) {
      skipped.push(`${p.code} (invalid default configuration)`);
      continue;
    }
    const cap = lending.resolveRateCap({ regulatorCeiling: ceiling, tenantCap, productCap: valid.config.pricing.regulatoryCapAnnualRate });
    const capReport = lending.productRateCapReport(valid.config, cap, capPolicy, { asOf: new Date().toISOString().slice(0, 10) });
    if (capReport.findings.length) {
      skipped.push(`${p.code} (${capReport.findings.map((f) => f.message).join(' ')})`);
      continue;
    }
    const required = [...new Set([...lending.requiredCapabilitiesFor(valid.config), ...template.extraCapabilities])].sort();
    if (lending.missingCapabilities(required).length) {
      skipped.push(`${p.code} (needs ${lending.missingCapabilities(required).join(', ')})`);
      continue;
    }
    const product = await prisma.lendingProduct.create({ data: { tenantId: t, code: p.code, familyCode: template.familyCode, templateCode: template.code, name: p.name, createdBy: users['product.maker'] } });
    const now = new Date();
    const v = await prisma.productVersion.create({
      data: {
        tenantId: t,
        productId: product.id,
        version: 1,
        status: 'DRAFT',
        config: valid.config as never,
        configHash: createHash('sha256').update(lending.canonicalJson(valid.config)).digest('hex'),
        requiredCapabilities: required,
        engineVersion: lending.LENDING_ENGINE_VERSION,
        makerId: users['product.maker'],
        changeSummary: 'Demo product from template',
      },
    });
    await prisma.pricingConfiguration.create({ data: { tenantId: t, productVersionId: v.id, rateType: valid.config.attributes.rateType === 'FLOATING' ? 'FLOATING' : 'FIXED', interestMethod: valid.config.pricing.interestMethod, rateConvention: valid.config.pricing.rateConvention, accrualBasis: valid.config.pricing.accrualBasis, dayCount: valid.config.pricing.dayCount, defaultAnnualRate: valid.config.pricing.fixed?.defaultAnnualRate ?? null, payload: valid.config.pricing as never } });
    await prisma.repaymentConfiguration.create({ data: { tenantId: t, productVersionId: v.id, method: valid.config.repayment.method, frequency: valid.config.repayment.frequency, payload: valid.config.repayment as never } });
    await prisma.productVersion.update({
      where: { id: v.id },
      data: { status: 'ACTIVE', submittedAt: now, checkerId: users['product.checker'], approvedAt: now, activatedBy: users['product.checker'], activatedAt: now, effectiveFrom: new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`) },
    });
  }

  if (skipped.length) console.log(`Loan types not offered yet: ${skipped.join('; ')}`);

  // Demo only: switch on the loan types that ship off by default (credit
  // lines, overdrafts, staged drawdowns, invoice finance, letters of credit,
  // factoring, supply-chain finance, forfaiting, import / export loans,
  // syndication, group lending, floating rates, institutional lending,
  // income-contingent education loans, Murabaha). In a real organisation each
  // is a two-administrator change under Access & policy.
  for (const flagKey of [
    'lending.revolving.drawdown',
    'lending.facility.overdraft',
    'lending.facility.staged_drawdown',
    'lending.trade.invoice_finance',
    'lending.trade.letters_of_credit',
    'lending.trade.receivables_purchase',
    'lending.trade.documentary',
    'lending.syndication',
    'lending.project_finance',
    'lending.collateral.borrowing_base',
    'lending.group.joint_liability',
    'lending.pricing.floating_rate',
    'lending.institutional',
    'lending.education.income_contingent',
    'lending.islamic.murabaha',
  ]) {
    if (!(await prisma.featureFlag.findUnique({ where: { key: flagKey } }))) continue;
    if (await prisma.flagRule.findFirst({ where: { tenantId: t, flagKey, scopeType: 'TENANT', status: 'ACTIVE' } })) continue;
    await prisma.flagRule.create({ data: { tenantId: t, flagKey, scopeType: 'TENANT', enabled: true, status: 'ACTIVE' } });
  }

  // Borrowers (KYC verified, with affordability inputs).
  const borrowers = [
    { firstName: 'Sokha', lastName: 'Chan', branch: 'PNH', monthlyIncome: '1200', dob: '1988-03-14', occupation: 'Teacher' },
    { firstName: 'Dara', lastName: 'Pich', branch: 'PNH', monthlyIncome: '2500', dob: '1979-07-02', occupation: 'Shop owner' },
    { firstName: 'Srey', lastName: 'Mom', branch: 'REP', monthlyIncome: '900', dob: '1992-11-20', occupation: 'Farmer' },
    { firstName: 'Vanna', lastName: 'Keo', branch: 'PNH', monthlyIncome: '15000', dob: '1975-01-09', occupation: 'Business owner' },
  ] as const;
  for (const b of borrowers) {
    if (await prisma.borrower.findFirst({ where: { tenantId: t, firstName: b.firstName, lastName: b.lastName } })) continue;
    await prisma.borrower.create({ data: { tenantId: t, branchId: branches[b.branch].id, firstName: b.firstName, lastName: b.lastName, monthlyIncome: b.monthlyIncome, dateOfBirth: new Date(`${b.dob}T00:00:00Z`), occupation: b.occupation, kycStatus: 'VERIFIED' } });
  }

  await demoScoring(t, users);
  await demoImpairment(t, users);

  // Institutional counterparties, so the interbank, municipal, sovereign and
  // development loan types can be originated: each borrows through its own
  // borrower record, carries a rating and has an approved limit (proposed by
  // the analyst, approved by the second approver), inside a country limit.
  const reviewOn = new Date(`${new Date().getUTCFullYear() + 1}-12-31T00:00:00Z`);
  const COUNTERPARTIES = [
    { ref: 'CP-DEMO-BANK-A', name: 'Bank of Angkor', type: 'BANK', rating: 'A-', agency: 'S&P', limit: '5000000' },
    { ref: 'CP-DEMO-BANK-B', name: 'Mekong Commercial Bank', type: 'BANK', rating: 'BBB', agency: 'Fitch', limit: '3000000' },
    { ref: 'CP-DEMO-MUNI', name: 'Phnom Penh Capital Administration', type: 'MUNICIPALITY', rating: null, agency: '', limit: '2000000' },
    { ref: 'CP-DEMO-SOV', name: 'Ministry of Economy and Finance', type: 'SOVEREIGN', rating: 'B+', agency: "Moody's (B2)", limit: '50000000' },
    { ref: 'CP-DEMO-DEV', name: 'Rural Development Bank', type: 'DEVELOPMENT_INSTITUTION', rating: null, agency: '', limit: '10000000' },
  ] as const;
  for (const c of COUNTERPARTIES) {
    if (await prisma.counterparty.findFirst({ where: { tenantId: t, reference: c.ref } })) continue;
    const b =
      (await prisma.borrower.findFirst({ where: { tenantId: t, firstName: c.name, lastName: 'Institution' } })) ??
      (await prisma.borrower.create({ data: { tenantId: t, branchId: branches.PNH.id, firstName: c.name, lastName: 'Institution', occupation: 'Institution', kycStatus: 'VERIFIED' } }));
    const cp = await prisma.counterparty.create({
      data: { tenantId: t, reference: c.ref, name: c.name, type: c.type, countryCode: 'KH', borrowerId: b.id, rating: c.rating, ratingAgency: c.agency, ratedOn: c.rating ? new Date(`${new Date().getUTCFullYear()}-01-01T00:00:00Z`) : null, createdBy: users.analyst },
    });
    await prisma.exposureLimit.create({
      data: { tenantId: t, scope: 'COUNTERPARTY', counterpartyId: cp.id, currency: 'USD', amount: c.limit, reviewOn, status: 'ACTIVE', note: 'Demo limit', proposedBy: users.analyst, decidedBy: users.approver2, decidedAt: new Date() },
    });
  }
  if (!(await prisma.exposureLimit.findFirst({ where: { tenantId: t, scope: 'COUNTRY', countryCode: 'KH', status: 'ACTIVE' } })))
    await prisma.exposureLimit.create({
      data: { tenantId: t, scope: 'COUNTRY', countryCode: 'KH', currency: 'USD', amount: '80000000', reviewOn, status: 'ACTIVE', note: 'Demo country limit', proposedBy: users.analyst, decidedBy: users.approver2, decidedAt: new Date() },
    });
  await demoAml(t, users);
  await demoKhqr(t, users);
  await demoAdminMfaOptional(t, users);
  await prisma.tenant.update({ where: { id: t }, data: { authzVersion: { increment: 1 } } });

  console.log(`Demo tenant "${TENANT}" ready.`);
  console.log('  Scorecards STANDARD_RETAIL and THIN_FILE are in force; PL-STD runs THIN_FILE as a silent challenger, MF-IND scores thin-file borrowers on THIN_FILE.');
  console.log('  An impairment policy (NBC classes, REGULATORY mode) is in force: end of day provisions and month-end close is allowed.');
  console.log('  Srey Mom and Sokha Chan have consents (including to their credit report) and verified alternative data (Lending › customer › Alternative data & consent; Credit report).');
  console.log('  Admin 2FA: this demo organisation does not require tenant admins to use an authenticator (lending settings), so the QA accounts sign in with a password. Real organisations keep the requirement.');
  console.log('  KHQR: static repayment codes for USD and KHR are in force (demo Bakong account, not a real one); pending "I have paid" claims are added on the first two active loans (re-run the seed after booking loans); sample statement to import (dated the business date): packages/db/prisma/demo-files/out/khqr-statement-sample.csv.');
  console.log('  AML: every demo borrower is screened and cleared (LOW/MEDIUM risk); watch list DEMO_FICTIONAL holds two fictional names, and "Demo Exposed Official" has an open screening case (Risk & audit › AML & compliance).');
  if (created.size)
    console.log(`  ${created.size} user(s) created with password ${PASSWORD_FROM_ENV ? '$DEMO_PASSWORD' : PASSWORD}${PASSWORD_FROM_ENV ? '' : ' (generated for this run — note it now)'}.`);
  if (created.size < USERS.length + 4)
    console.log('  Users from an earlier run keep the password they were created with.');
  console.log('Users:');
  for (const u of USERS) console.log(`  ${u.key}@demo-lending.test  →  ${u.role}${u.scope === 'BRANCH' ? ` (branch ${u.branch})` : ''}`);
  console.log('\nAll-round QA accounts (every staff role, all branches, high limits, MFA already on):');
  for (const [key, secret] of Object.entries(qaSecrets))
    console.log(`  ${key}@demo-lending.test  →  authenticator secret ${secret}  (otpauth://totp/${ISSUER}:${key}%40demo-lending.test?secret=${secret}&issuer=${ISSUER})`);
  console.log('Approvals and executions require MFA: enrol TOTP for approver, approver2, ops.checker and committee in Settings first.');
}

/**
 * An impairment policy in force (DECISIONS D-010, D-116): without one no
 * loss allowance is posted and month-end close is refused while loans are
 * outstanding. The NBC classes in REGULATORY mode, proposed by finance and
 * approved by risk; end of day grades on the lending settings' short- and
 * long-term bands (D-114). Kept if the tenant already has one in force.
 */
async function demoImpairment(t: string, users: Record<string, string>) {
  if (await prisma.impairmentPolicy.findFirst({ where: { tenantId: t, status: 'ACTIVE' } })) return;
  const last = await prisma.impairmentPolicy.findFirst({ where: { tenantId: t }, orderBy: { version: 'desc' } });
  const settings: lending.ImpairmentPolicy = { mode: 'REGULATORY', classes: lending.NBC_SHORT_TERM_CLASSES };
  await prisma.impairmentPolicy.create({
    data: {
      tenantId: t,
      version: (last?.version ?? 0) + 1,
      settings: settings as never,
      status: 'ACTIVE',
      makerId: users.finance,
      checkerId: users.risk,
      decidedAt: new Date(),
      reason: 'Demo: NBC regulatory classes',
    },
  });
}

/**
 * Scoring and alternative data (DECISIONS D-075…D-081): the two scorecard
 * templates installed as the tenant's own scorecards and put in force by a
 * risk reviewer other than the analyst who drafted them; a silent challenger
 * on the personal loan and the thin-file switch on the microenterprise loan;
 * and, for two borrowers, consents with verified utility, telco and
 * cash-flow data backed by a filed (demo) document.
 */
async function demoScoring(t: string, users: Record<string, string>) {
  const canonical = (d: unknown) => createHash('sha256').update(lending.canonicalJson(d)).digest('hex');
  for (const tpl of lending.SCORECARD_TEMPLATES) {
    if (await prisma.scorecard.findFirst({ where: { tenantId: t, code: tpl.code } })) continue;
    const sc = await prisma.scorecard.create({ data: { tenantId: t, code: tpl.code, name: tpl.name, description: tpl.description, templateCode: tpl.code, createdBy: users.analyst } });
    const v = await prisma.scorecardVersion.create({
      data: { tenantId: t, scorecardId: sc.id, version: 1, definition: tpl.definition as never, definitionHash: canonical(tpl.definition), changeSummary: `Installed from template ${tpl.code}`, makerId: users.analyst },
    });
    // The database lets the status move one step at a time.
    const now = new Date();
    await prisma.scorecardVersion.update({ where: { id: v.id }, data: { status: 'SUBMITTED', submittedAt: now } });
    await prisma.scorecardVersion.update({ where: { id: v.id }, data: { status: 'APPROVED', checkerId: users.risk, approvedAt: now } });
    await prisma.scorecardVersion.update({ where: { id: v.id }, data: { status: 'ACTIVE', activatedBy: users.risk, activatedAt: now } });
  }

  // Product scoring: a new product version where the active one predates it.
  const scoringFor: Record<string, unknown> = {
    'PL-STD': { championCode: 'STANDARD_RETAIL', challengerCode: 'THIN_FILE' },
    'MF-IND': { thinFile: { enabled: true, scorecardCode: 'THIN_FILE', maxInternalHistoryMonths: 6 } },
  };
  for (const [code, scoring] of Object.entries(scoringFor)) {
    const product = await prisma.lendingProduct.findFirst({ where: { tenantId: t, code } });
    const active = product && (await prisma.productVersion.findFirst({ where: { tenantId: t, productId: product.id, status: 'ACTIVE' }, orderBy: { version: 'desc' } }));
    if (!product || !active) continue;
    const current = lending.validateProductConfig(active.config);
    if (!current.ok || JSON.stringify(current.config.scoring) === JSON.stringify(lending.productScoringSchema.parse(scoring))) continue;
    const next = lending.validateProductConfig({ ...current.config, scoring });
    if (!next.ok) continue;
    const latest = await prisma.productVersion.findFirst({ where: { tenantId: t, productId: product.id }, orderBy: { version: 'desc' } });
    const now = new Date();
    const v = await prisma.productVersion.create({
      data: {
        tenantId: t,
        productId: product.id,
        version: (latest?.version ?? 0) + 1,
        status: 'DRAFT',
        config: next.config as never,
        configHash: canonical(next.config),
        requiredCapabilities: active.requiredCapabilities,
        engineVersion: lending.LENDING_ENGINE_VERSION,
        makerId: users['product.maker'],
        changeSummary: 'Demo: scorecard strategy (challenger / thin-file scoring)',
      },
    });
    const pricing = await prisma.pricingConfiguration.findFirst({ where: { tenantId: t, productVersionId: active.id } });
    const repayment = await prisma.repaymentConfiguration.findFirst({ where: { tenantId: t, productVersionId: active.id } });
    if (pricing) await prisma.pricingConfiguration.create({ data: { ...pricing, id: undefined, productVersionId: v.id } as never });
    if (repayment) await prisma.repaymentConfiguration.create({ data: { ...repayment, id: undefined, productVersionId: v.id } as never });
    const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
    await prisma.productVersion.update({ where: { id: active.id }, data: { status: 'RETIRED', retiredAt: now, effectiveTo: today } });
    await prisma.productVersion.update({
      where: { id: v.id },
      data: { status: 'ACTIVE', submittedAt: now, checkerId: users['product.checker'], approvedAt: now, activatedBy: users['product.checker'], activatedAt: now, effectiveFrom: today },
    });
  }

  // Consents and verified alternative data for two thin-file borrowers.
  const { DocumentStorageService, libraryKey } = await import('../../../apps/api/src/lending/documents/document-storage');
  const storage = new DocumentStorageService().storage();
  const pdf = Buffer.from('%PDF-1.4\n% Demo document: stands in for a scanned statement in the demo tenant only.\n');
  const year = new Date().getUTCFullYear() - 1;
  // Demo only: the tenant's own published USD/KHR rate, as an administrator
  // would enter it under FX rates. Srey Mom's cash flow is observed in riel;
  // scoring converts it at this rate (D-079) — with no rate the cash-flow
  // variables would be missing. Effective from the end of the observed period.
  const fxFrom = new Date(`${year}-12-31T00:00:00Z`);
  if (!(await prisma.exchangeRate.findFirst({ where: { tenantId: t, fromCurrency: 'USD', toCurrency: 'KHR' } })))
    await prisma.exchangeRate.create({ data: { tenantId: t, fromCurrency: 'USD', toCurrency: 'KHR', rate: DEMO_USD_KHR_RATE, effectiveDate: fxFrom } });
  const file = async (borrowerId: string, typeCode: string, title: string, officer: string) => {
    const existing = await prisma.customerDocument.findFirst({ where: { tenantId: t, borrowerId, typeCode } });
    if (existing) return existing.id;
    const doc = await prisma.customerDocument.create({
      data: { tenantId: t, borrowerId, category: 'OTHER', typeCode, title, origin: 'STAFF', reviewStatus: 'ACCEPTED', createdBy: officer },
    });
    const key = libraryKey(t, borrowerId, doc.id, 1);
    await storage.put(key, pdf, 'application/pdf');
    await prisma.customerDocumentVersion.create({
      data: {
        tenantId: t,
        documentId: doc.id,
        version: 1,
        fileName: `${typeCode.toLowerCase()}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: pdf.length,
        sha256: createHash('sha256').update(pdf).digest('hex'),
        storageProvider: storage.provider,
        storageKey: key,
        uploadedBy: officer,
        uploaderType: 'USER',
        reviewStatus: 'ACCEPTED',
        reviewedBy: users.analyst,
        reviewedAt: new Date(),
      },
    });
    return doc.id;
  };
  const people = [
    {
      firstName: 'Srey',
      lastName: 'Mom',
      officer: users['officer.rep'],
      sources: ['INTERNAL_BEHAVIOUR', 'UTILITY_BILLS', 'TELCO_STATEMENT', 'BUSINESS_CASH_FLOW', 'CREDIT_REPORT'],
      records: [
        { kind: 'UTILITY_BILLS', typeCode: 'EDC_BILLS', title: 'EDC electricity bills (12 months)', data: { utility: 'ELECTRICITY', issuer: 'EDC', accountReference: 'EDC-SR-0412', monthsObserved: 12, monthsOnTime: 11 } },
        { kind: 'TELCO_STATEMENT', typeCode: 'TELCO_STATEMENT', title: 'Mobile top-up statement', data: { operator: 'Mobile operator', monthsObserved: 12, monthsWithTopUp: 12 } },
        { kind: 'BUSINESS_CASH_FLOW', typeCode: 'CASH_BOOK', title: 'Rice trading cash book', data: { method: 'SITE_VISIT', monthsObserved: 6, averageMonthlyInflow: '6000000', averageMonthlyOutflow: '4200000', currency: 'KHR' } },
      ],
    },
    {
      firstName: 'Sokha',
      lastName: 'Chan',
      officer: users['officer.pnh'],
      sources: ['UTILITY_BILLS', 'RENT_HISTORY', 'CREDIT_REPORT'],
      records: [
        { kind: 'UTILITY_BILLS', typeCode: 'WATER_BILLS', title: 'Water bills (12 months)', data: { utility: 'WATER', issuer: 'Phnom Penh Water Supply Authority', accountReference: 'W-SC-2231', monthsObserved: 12, monthsOnTime: 12 } },
        { kind: 'RENT_HISTORY', typeCode: 'RENT_RECEIPTS', title: 'Rent receipts', data: { landlord: 'Landlord (receipts on file)', monthsObserved: 12, monthsOnTime: 10 } },
      ],
    },
  ];
  const expires = new Date(Date.now() + 365 * 86_400_000);
  for (const p of people) {
    const b = await prisma.borrower.findFirst({ where: { tenantId: t, firstName: p.firstName, lastName: p.lastName } });
    if (!b) continue;
    const consents: Record<string, string> = {};
    for (const source of p.sources) {
      const g =
        (await prisma.altDataConsent.findFirst({ where: { tenantId: t, borrowerId: b.id, source, action: 'GRANT' }, orderBy: { createdAt: 'desc' } })) ??
        (await prisma.altDataConsent.create({
          data: { tenantId: t, borrowerId: b.id, action: 'GRANT', source, purpose: 'Credit assessment of loan applications', scope: 'Statements and history of the last 12 months', method: 'RECORDED_VERBAL', effectiveAt: new Date(), expiresAt: expires, recordedBy: p.officer },
        }));
      consents[source] = g.id;
    }
    for (const r of p.records) {
      if (await prisma.altDataRecord.findFirst({ where: { tenantId: t, borrowerId: b.id, kind: r.kind } })) continue;
      const documentId = await file(b.id, r.typeCode, r.title, p.officer);
      const rec = await prisma.altDataRecord.create({
        data: {
          tenantId: t,
          borrowerId: b.id,
          kind: r.kind,
          data: r.data as never,
          periodFrom: new Date(`${year}-01-01T00:00:00Z`),
          periodTo: new Date(`${year}-12-31T00:00:00Z`),
          documentId,
          consentId: consents[r.kind],
          note: 'Demo data',
          recordedBy: p.officer,
        },
      });
      await prisma.altDataRecord.update({ where: { id: rec.id }, data: { status: 'VERIFIED', verifiedBy: users.analyst, verifiedAt: new Date() } });
    }
  }
  await demoCreditHistory(t);
}

/**
 * Credit history for the in-house credit report (D-176): Sokha Chan repaid a
 * six-month loan on the original book about a year and a half ago (it sits
 * in the legacy loan archive), one instalment ten days late. Her credit
 * report shows it with its payment grid and a bureau score. Dates follow the
 * day the demo is seeded. Idempotent.
 */
async function demoCreditHistory(t: string) {
  const b = await prisma.borrower.findFirst({ where: { tenantId: t, firstName: 'Sokha', lastName: 'Chan' } });
  if (!b || (await prisma.loan.findFirst({ where: { tenantId: t, borrowerId: b.id } }))) return;
  const monthStart = (back: number) => {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 10));
  };
  const start = monthStart(20);
  const loan = await prisma.loan.create({
    data: { tenantId: t, borrowerId: b.id, branchId: b.branchId, principal: '600', annualInterestRate: '18', termMonths: 6, interestMethod: 'FLAT', startDate: start, status: 'CLOSED' },
  });
  for (let i = 1; i <= 6; i++) {
    const due = monthStart(20 - i);
    const paidOn = i === 3 ? new Date(due.getTime() + 10 * 86_400_000) : due;
    await prisma.repaymentSchedule.create({
      data: { loanId: loan.id, installmentNumber: i, dueDate: due, principalAmount: '100', interestAmount: '9', totalAmount: '109', outstandingPrincipal: String(600 - 100 * i), paidPrincipal: '100', paidInterest: '9', isPaid: true },
    });
    await prisma.repayment.create({ data: { tenantId: t, loanId: loan.id, amount: '109', principalPaid: '100', interestPaid: '9', date: paidOn } });
  }
}

/**
 * The demo organisation's QA accounts also hold the tenant-admin role and sign
 * in with a password only, so the demo puts in force a lending-settings version
 * (recorded by one admin, approved by the other) that turns off "tenant admins
 * must use an authenticator" (D-128) for this organisation only. Platform
 * super-admins and every other organisation keep the requirement. Idempotent:
 * nothing is written when the active version already has it off.
 */
async function demoAdminMfaOptional(t: string, users: Record<string, string>) {
  const active = await prisma.tenantLendingSettings.findFirst({ where: { tenantId: t, status: 'ACTIVE' }, orderBy: { version: 'desc' } });
  const current = lending.tenantLendingSettingsSchema.parse(active?.settings ?? {});
  if (!current.security.requireMfaForAdmins) return;
  const next = lending.tenantLendingSettingsSchema.parse({ ...current, security: { ...current.security, requireMfaForAdmins: false } });
  const last = await prisma.tenantLendingSettings.findFirst({ where: { tenantId: t }, orderBy: { version: 'desc' } });
  await prisma.$transaction([
    ...(active ? [prisma.tenantLendingSettings.update({ where: { id: active.id }, data: { status: 'RETIRED' } })] : []),
    prisma.tenantLendingSettings.create({
      data: { tenantId: t, version: (last?.version ?? 0) + 1, settings: next as never, status: 'ACTIVE', makerId: users.admin, checkerId: users.admin2, decidedAt: new Date(), reason: 'Demo: QA accounts sign in with a password only' },
    }),
  ]);
}

/**
 * AML/CFT (DECISIONS D-118…D-122): every demo borrower screened and cleared
 * by two people (the analyst records it, the risk reviewer approves) and
 * rated LOW or MEDIUM, so the demo journeys pass the lending gate; one
 * active watch-list version with two clearly fictional names; and a
 * fictional customer whose name matches one of them, with an open
 * screening case for compliance to disposition.
 */
async function demoAml(t: string, users: Record<string, string>) {
  const aml = lending.defaultTenantLendingSettings().aml;
  const today = new Date().toISOString().slice(0, 10);
  const borrowers = await prisma.borrower.findMany({ where: { tenantId: t, amlStatus: { not: 'CLEAR' }, NOT: { firstName: 'Demo', lastName: 'Exposed Official' } } });
  for (const b of borrowers) {
    // Dara Pich repays mostly in cash at the branch: cash intensive, MEDIUM.
    const cashShare = b.firstName === 'Dara' && b.lastName === 'Pich' ? '0.6' : null;
    const r = lending.rateCustomerRisk({ pep: false, nationality: 'KH', occupation: b.occupation, productFamilies: [], cashShare }, aml.risk);
    await prisma.approvalTask.create({
      data: { tenantId: t, subjectType: 'BORROWER', subjectId: b.id, action: 'AML_CLEAR', requiredPermission: 'aml.disposition', payload: { reason: 'Demo: screened, no match', from: b.amlStatus }, status: 'EXECUTED', makerId: users.analyst, decidedBy: users.risk, decidedAt: new Date() },
    });
    await prisma.borrower.update({
      where: { id: b.id },
      data: {
        amlStatus: 'CLEAR',
        amlStatusChangedAt: new Date(),
        amlStatusChangedBy: users.risk,
        amlScreenedAt: new Date(),
        nationality: 'KH',
        amlRiskRating: r.rating,
        amlRiskScore: r.score,
        amlRiskFactors: r.factors as never,
        amlRiskRatedAt: new Date(),
        amlNextReviewOn: new Date(`${lending.nextAmlReviewDate(today, r.rating, aml.risk.reviewMonths)}T00:00:00Z`),
      },
    });
  }

  const LIST = [
    { name: 'Fictional Sanctioned Person', entryType: 'SANCTION', aliases: ['Phantom Testname'], country: 'KP' },
    { name: 'Demo Exposed Official', entryType: 'PEP', aliases: [], country: 'KH' },
  ];
  let version = await prisma.amlWatchListVersion.findFirst({ where: { tenantId: t, listCode: 'DEMO_FICTIONAL' } });
  if (!version) {
    version = await prisma.amlWatchListVersion.create({
      data: { tenantId: t, listCode: 'DEMO_FICTIONAL', version: 1, name: 'Demo list (fictional names only)', fileName: 'demo-fictional.csv', fileHash: createHash('sha256').update(JSON.stringify(LIST)).digest('hex'), entryCount: LIST.length, status: 'ACTIVE', makerId: users.analyst, checkerId: users.risk, decidedAt: new Date() },
    });
    await prisma.amlWatchListEntry.createMany({
      data: LIST.map((e, i) => ({ tenantId: t, versionId: version!.id, entryType: e.entryType, name: e.name, normalizedName: lending.normalizeName(e.name, aml.screening.ignoredTitles), aliases: e.aliases, source: 'Demo list — fictional names', listDate: new Date(`${today}T00:00:00Z`), country: e.country, lineNo: i + 2 })),
    });
  }

  const pep =
    (await prisma.borrower.findFirst({ where: { tenantId: t, firstName: 'Demo', lastName: 'Exposed Official' } })) ??
    (await prisma.borrower.create({
      data: { tenantId: t, branchId: (await prisma.branch.findFirst({ where: { tenantId: t, code: 'PNH' } }))?.id ?? null, firstName: 'Demo', lastName: 'Exposed Official', occupation: 'Civil servant', nationality: 'KH', kycStatus: 'VERIFIED', amlScreenedAt: new Date() },
    }));
  if (!(await prisma.amlScreeningCase.findFirst({ where: { tenantId: t, borrowerId: pep.id } }))) {
    const entry = await prisma.amlWatchListEntry.findFirst({ where: { tenantId: t, versionId: version.id, entryType: 'PEP' } });
    const hit = { entryId: entry!.id, entryType: 'PEP', listCode: 'DEMO_FICTIONAL', versionId: version.id, listName: entry!.name, matchedName: entry!.name, normalizedListName: entry!.normalizedName, source: entry!.source, score: 1, method: 'TOKENS', dobMismatch: false };
    await prisma.amlScreeningCase.create({
      data: { tenantId: t, reference: 'AMLC-DEMO-0001', borrowerId: pep.id, trigger: 'CUSTOMER_CREATE', screenedName: lending.normalizeName('Demo Exposed Official', aml.screening.ignoredTitles), hits: [hit], topScore: '1.0000', topType: 'PEP', createdBy: users.analyst },
    });
  }
}

/**
 * Static KHQR repayment codes (D-160) — a DEMO Bakong account that is not
 * real, so no money can be sent to it — for USD and KHR, proposed by finance
 * and approved by risk; and, on the first two active loans (once some are
 * booked), a pending "I have paid" claim each, whose bank references are in
 * the sample statement (demo-files/khqr-statement-template.csv, written dated to demo-files/out/).
 */
const DEMO_KHQR_ACCOUNT = 'demo_not_a_real_account@demo';
async function demoKhqr(t: string, users: Record<string, string>) {
  const merchant = { bakongAccountId: DEMO_KHQR_ACCOUNT, merchantName: 'DEMO Lending Co (TEST)', merchantCity: 'Phnom Penh' };
  for (const currency of ['USD', 'KHR'] as const) {
    if (await prisma.khqrCode.findFirst({ where: { tenantId: t, branchId: null, currency, status: 'ACTIVE' } })) continue;
    await prisma.khqrCode.create({
      data: {
        tenantId: t,
        currency,
        source: 'GENERATED',
        ...merchant,
        merchantCategoryCode: '6012',
        payload: lending.buildStaticKhqrPayload(merchant, currency),
        bankName: 'Demo Bank (not real)',
        status: 'ACTIVE',
        makerId: users.finance,
        checkerId: users.risk,
        decidedAt: new Date(),
        reason: 'Demo data: a fictional Bakong account',
      },
    });
  }
  const loans = await prisma.loanAccount.findMany({ where: { tenantId: t, status: 'ACTIVE' }, orderBy: { createdAt: 'asc' }, take: 2 });
  const today = (await prisma.tenantBusinessDate.findUnique({ where: { tenantId: t } }))?.businessDate ?? new Date();
  // The sample statement, dated the business date so it can be imported as is.
  const day = today.toISOString().slice(0, 10);
  const dir = path.join(__dirname, 'demo-files');
  fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'out', 'khqr-statement-sample.csv'), fs.readFileSync(path.join(dir, 'khqr-statement-template.csv'), 'utf8').replaceAll('{{DATE}}', day));
  for (const [i, loan] of loans.entries()) {
    const bankRef = `DEMOKHQR00000${i + 1}`;
    if (await prisma.khqrReceipt.findFirst({ where: { tenantId: t, bankRefKey: bankRef, status: { not: 'REJECTED' } } })) continue;
    await prisma.khqrReceipt.create({
      data: {
        tenantId: t,
        reference: `QRR-DEMO-${i + 1}`,
        loanAccountId: loan.id,
        borrowerId: loan.borrowerId,
        branchId: loan.branchId,
        source: 'PORTAL_CLAIM',
        amount: loan.currency === 'KHR' ? '100000' : '25',
        currency: loan.currency,
        paidAt: today,
        valueDate: today,
        bankRef,
        bankRefKey: bankRef,
        payerName: 'Demo payer',
        remark: loan.reference,
        makerType: 'CUSTOMER',
        makerId: loan.borrowerId,
      },
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
