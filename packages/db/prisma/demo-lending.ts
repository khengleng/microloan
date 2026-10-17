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
import { createHash } from 'node:crypto';
import { lending } from '../../shared/src/index';

const prisma = new PrismaClient();

if (process.env.NODE_ENV === 'production' && process.env.DEMO_SEED_ALLOW !== 'true') {
  console.error('Refusing to seed demo data in production (set DEMO_SEED_ALLOW=true to override).');
  process.exit(1);
}

const PASSWORD = process.env.DEMO_PASSWORD || 'Demo#Lending2026';
const TENANT = 'Demo Lending Co';

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
    const user = (await prisma.user.findUnique({ where: { email } })) ?? (await prisma.user.create({ data: { email, tenantId: t, role: u.legacyRole as never, branchId: u.branch ? branches[u.branch].id : null, passwordHash: hash } }));
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
  for (const p of all) {
    if (await prisma.lendingProduct.findFirst({ where: { tenantId: t, code: p.code } })) continue;
    const template = lending.TEMPLATE_BY_CODE[p.template];
    const config = { ...template.defaultConfig, identity: { ...template.defaultConfig.identity, name: p.name } };
    const valid = lending.validateProductConfig(config);
    if (!valid.ok) {
      skipped.push(`${p.code} (invalid default configuration)`);
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
  await prisma.tenant.update({ where: { id: t }, data: { authzVersion: { increment: 1 } } });

  console.log(`Demo tenant "${TENANT}" ready. Users (password ${process.env.DEMO_PASSWORD ? '$DEMO_PASSWORD' : PASSWORD}):`);
  for (const u of USERS) console.log(`  ${u.key}@demo-lending.test  →  ${u.role}${u.scope === 'BRANCH' ? ` (branch ${u.branch})` : ''}`);
  console.log('Approvals and executions require MFA: enrol TOTP for approver, approver2, ops.checker and committee in Settings first.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
