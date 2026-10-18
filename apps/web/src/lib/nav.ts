import type { LucideIcon } from 'lucide-react';
import {
    AlertTriangle, BarChart2, BookOpenCheck, Boxes, Building, Calculator, CalendarCheck, ClipboardList, Coins,
    CreditCard, FileStack, FileText, Gauge, Home, KeyRound, Landmark, Layers, LayoutDashboard, LibraryBig, LifeBuoy,
    Network, PiggyBank, QrCode, Receipt, ScrollText, Settings, Shield, ShieldCheck, Ship, Siren, SlidersHorizontal,
    Umbrella, UserCog, Users, UsersRound, Wallet, Workflow, Wrench, Banknote, HandCoins, FileCheck2, Scale, DatabaseZap, Webhook,
    Globe2, GraduationCap, LineChart, CircleHelp,
} from 'lucide-react';

/**
 * The workspace menu. An item appears when the person holds any of its
 * lending permissions (from GET /me/access), any of its legacy permissions
 * (the original screens' own API checks), or — for screens that were gated by
 * role name before — one of the legacy roles that saw it, so nobody loses a
 * page they had. A section appears when any of its items does.
 */
export interface NavItem {
    /** Translation key under Workspace.nav. */
    key: string;
    href: string;
    icon: LucideIcon;
    /** Shown to every signed-in tenant user. */
    everyone?: boolean;
    lending?: string[];
    legacy?: string[];
    legacyRoles?: string[];
    /** Queue codes from GET /me/work whose counts make the badge. */
    queues?: string[];
}

export interface NavSection {
    /** Translation key under Workspace.sections. */
    key: string;
    items: NavItem[];
}

const LEGACY_ADMIN = ['ADMIN', 'SUPERADMIN'];
const LEGACY_FINANCE = ['FINANCE', ...LEGACY_ADMIN];

export const NAV: NavSection[] = [
    {
        key: 'work',
        items: [
            { key: 'home', href: '/home', icon: Home, everyone: true },
            { key: 'kpiDashboard', href: '/dashboard', icon: LayoutDashboard, legacy: ['CUSTOMER_VIEW'], legacyRoles: [...LEGACY_FINANCE, 'SALES'] },
            { key: 'help', href: '/help', icon: CircleHelp, everyone: true },
        ],
    },
    {
        key: 'customers',
        items: [
            { key: 'borrowers', href: '/borrowers', icon: Users, legacy: ['CUSTOMER_VIEW'], legacyRoles: [...LEGACY_FINANCE, 'SALES'] },
            { key: 'groups', href: '/lending/groups', icon: UsersRound, lending: ['borrower_group.read'] },
            { key: 'documents', href: '/lending/documents', icon: FileStack, lending: ['document.read', 'document.review', 'document.manage'], queues: ['DOCUMENTS_TO_REVIEW'] },
        ],
    },
    {
        key: 'origination',
        items: [
            {
                key: 'applications', href: '/lending/applications', icon: ClipboardList, lending: ['loan_application.read'],
                queues: ['APPLICATIONS_DRAFT', 'APPLICATIONS_TO_RECOMMEND', 'APPLICATIONS_TO_APPROVE', 'APPLICATIONS_TO_BOOK'],
            },
            {
                key: 'legacyLoans', href: '/loans', icon: FileText,
                legacy: ['LOAN_APPLICATION_CREATE', 'LOAN_APPLICATION_REVIEW', 'LOAN_APPROVE', 'LOAN_DISBURSE', 'CUSTOMER_VIEW'],
                legacyRoles: [...LEGACY_FINANCE, 'SALES'],
            },
        ],
    },
    {
        key: 'loans',
        items: [
            {
                key: 'loanAccounts', href: '/lending/loans', icon: Wallet, lending: ['loan.read'],
                queues: ['DISBURSEMENTS_TO_PREPARE', 'DISBURSEMENTS_TO_APPROVE', 'DISBURSEMENTS_TO_EXECUTE', 'WRITE_OFFS_TO_APPROVE', 'FEE_WAIVERS_TO_APPROVE', 'COLLATERAL_RELEASES_TO_APPROVE', 'COVENANTS_OVERDUE', 'OTHER_APPROVALS'],
            },
            { key: 'facilities', href: '/lending/facilities', icon: Landmark, lending: ['facility.read'], queues: ['DRAWDOWNS_TO_APPROVE', 'DRAWDOWNS_TO_RELEASE', 'FACILITY_LIMITS_TO_APPROVE'] },
            { key: 'cards', href: '/lending/cards', icon: CreditCard, lending: ['facility.read'] },
            {
                key: 'trade', href: '/lending/trade', icon: Ship, lending: ['trade.lc.read', 'trade.invoice.manage', 'trade.invoice.approve'],
                queues: ['TRADE_INVOICES_TO_APPROVE', 'LETTERS_OF_CREDIT_TO_ISSUE', 'PAYOUTS_TO_APPROVE'],
            },
            { key: 'syndication', href: '/lending/syndication', icon: Network, lending: ['syndication.manage', 'syndication.approve'], queues: ['SYNDICATES_TO_APPROVE'] },
            { key: 'counterparties', href: '/lending/counterparties', icon: Globe2, lending: ['credit_decision.recommend', 'credit_decision.approve'] },
            { key: 'incomeAssessments', href: '/lending/income-contingent', icon: GraduationCap, lending: ['loan.rate_reset.apply', 'loan.repayment.reverse'] },
            { key: 'repayments', href: '/repayments', icon: Receipt, legacy: ['LOAN_REPAYMENT_POST'], legacyRoles: LEGACY_FINANCE },
        ],
    },
    {
        key: 'collections',
        items: [
            { key: 'collections', href: '/lending/collections', icon: Siren, lending: ['loan.repayment.post', 'restructure.monitor', 'loan.recovery.post'], queues: ['COLLECTION_TASKS', 'SET_OFFS_TO_APPROVE'] },
            { key: 'legacyCollections', href: '/collections', icon: AlertTriangle, legacy: ['LOAN_REPAYMENT_POST'], legacyRoles: LEGACY_FINANCE },
            {
                key: 'restructures', href: '/lending/restructures', icon: LifeBuoy,
                lending: ['restructure.request', 'restructure.assess', 'restructure.propose', 'restructure.approve', 'restructure.execute', 'restructure.monitor'],
                queues: ['RESTRUCTURES_TO_ASSESS', 'RESTRUCTURES_TO_PROPOSE', 'RESTRUCTURES_TO_APPROVE', 'RESTRUCTURE_ACCEPTANCES', 'RESTRUCTURES_TO_EXECUTE', 'RESTRUCTURE_MONITORING'],
            },
            { key: 'relief', href: '/lending/relief', icon: Umbrella, lending: ['payment_holiday.read'], queues: ['HOLIDAY_PROGRAMMES_TO_PUBLISH'] },
            { key: 'recovery', href: '/lending/recovery', icon: HandCoins, lending: ['loan.recovery.post', 'loan.writeoff.propose', 'loan.writeoff.approve'], queues: ['RECOVERY_TO_APPROVE'] },
            { key: 'suspense', href: '/lending/suspense', icon: PiggyBank, lending: ['loan.repayment.post', 'loan.repayment.reverse'], queues: ['UNIDENTIFIED_PAYMENTS', 'REFUNDS_TO_APPROVE'] },
            { key: 'paymentChannels', href: '/lending/payment-channels', icon: Banknote, lending: ['loan.repayment.post', 'rate_observation.manage'] },
        ],
    },
    {
        key: 'finance',
        items: [
            { key: 'ledger', href: '/lending/accounting', icon: BookOpenCheck, lending: ['accounting.read'] },
            { key: 'periodClose', href: '/lending/close', icon: CalendarCheck, lending: ['accounting.period.close', 'accounting.period.approve'], queues: ['PERIODS_TO_APPROVE'] },
            { key: 'regulatoryReturns', href: '/lending/regulatory', icon: FileCheck2, lending: ['regulatory.prepare', 'regulatory.submit', 'accounting.read'], queues: ['RETURNS_TO_SUBMIT'] },
            { key: 'combinedLedger', href: '/lending/combined-ledger', icon: Scale, lending: ['accounting.read'] },
            { key: 'migration', href: '/lending/migration', icon: DatabaseZap, lending: ['loan.migration.manage', 'loan.migration.approve'], queues: ['MIGRATIONS_TO_APPROVE'] },
            { key: 'webhooks', href: '/lending/webhooks', icon: Webhook, lending: ['access_policy.read'] },
            {
                key: 'operations', href: '/lending/operations', icon: Wrench,
                lending: ['servicing.batch.run', 'business_date.manage', 'rate_observation.manage', 'impairment.manage', 'impairment.approve'],
                queues: ['IMPAIRMENT_TO_APPROVE'],
            },
            { key: 'legacyAccounting', href: '/accounting', icon: Landmark, legacy: ['LEDGER_VIEW'], legacyRoles: LEGACY_FINANCE },
            { key: 'provisioning', href: '/provisioning', icon: ShieldCheck, legacy: ['PROVISION_VIEW'], legacyRoles: LEGACY_FINANCE },
            { key: 'fxRates', href: '/fx', icon: Coins, legacy: ['FX_VIEW'], legacyRoles: LEGACY_FINANCE },
            { key: 'reports', href: '/reports', icon: BarChart2, legacy: ['LEDGER_VIEW'], legacyRoles: LEGACY_FINANCE },
            { key: 'kpi', href: '/kpi', icon: Gauge, legacy: ['LEDGER_VIEW'], legacyRoles: LEGACY_FINANCE },
        ],
    },
    {
        key: 'products',
        items: [
            {
                key: 'lendingProducts', href: '/lending/products', icon: Boxes, lending: ['loan_product.create', 'loan_product.approve', 'loan_product.activate'],
                queues: ['PRODUCT_VERSIONS_TO_REVIEW', 'PRODUCT_VERSIONS_TO_ACTIVATE', 'PRODUCT_DRAFTS'],
            },
            { key: 'policies', href: '/lending/policies', icon: ScrollText, lending: ['loan_product.create', 'loan_product.approve'] },
            { key: 'scorecards', href: '/lending/scorecards', icon: Gauge, lending: ['scorecard.read', 'scorecard.manage', 'scorecard.approve', 'access_policy.read'] },
            { key: 'scorecardMonitoring', href: '/lending/scorecard-monitoring', icon: LineChart, lending: ['scorecard.read'] },
            { key: 'catalogue', href: '/lending/catalogue', icon: LibraryBig, lending: ['loan_product.create', 'loan_product.approve'] },
            { key: 'workflows', href: '/lending/workflows', icon: Workflow, lending: ['workflow.manage', 'workflow.approve'], queues: ['WORKFLOWS_TO_APPROVE'] },
            { key: 'simulator', href: '/lending/simulator', icon: Calculator, lending: ['loan_product.read'] },
            { key: 'legacyProducts', href: '/products', icon: SlidersHorizontal, legacy: ['CONFIG_UPDATE', 'LOAN_APPLICATION_CREATE', 'CUSTOMER_VIEW'], legacyRoles: [...LEGACY_FINANCE, 'SALES'] },
        ],
    },
    {
        key: 'risk',
        items: [
            { key: 'auditTrail', href: '/lending/audit', icon: ScrollText, lending: ['audit.read'] },
            { key: 'legacyAudit', href: '/audit', icon: Shield, legacy: ['AUDIT_VIEW'], legacyRoles: LEGACY_ADMIN },
            {
                key: 'access', href: '/lending/access', icon: KeyRound, lending: ['access_policy.read'],
                queues: ['ACCESS_TO_APPROVE', 'FLAGS_TO_APPROVE'],
            },
        ],
    },
    {
        key: 'administration',
        items: [
            { key: 'team', href: '/users', icon: UserCog, legacy: ['USER_CREATE'], legacyRoles: LEGACY_ADMIN },
            { key: 'settings', href: '/settings', icon: Settings, legacy: ['CONFIG_UPDATE'], legacyRoles: LEGACY_ADMIN },
        ],
    },
];

export const PLATFORM_NAV: NavSection[] = [
    {
        key: 'platform',
        items: [
            { key: 'home', href: '/home', icon: Home, everyone: true },
            { key: 'organisations', href: '/tenants', icon: Building, everyone: true, queues: ['ORGANISATIONS_PENDING'] },
            { key: 'planPayments', href: '/platform-payments', icon: QrCode, everyone: true, queues: ['PLAN_PAYMENTS_TO_CONFIRM'] },
            { key: 'plans', href: '/plan-tiers', icon: Layers, everyone: true },
            { key: 'platformCatalogue', href: '/lending/catalogue', icon: LibraryBig, lending: ['loan_product.read'] },
            { key: 'platformFlags', href: '/platform-flags', icon: SlidersHorizontal, lending: ['feature_flag.read'] },
            { key: 'help', href: '/help', icon: CircleHelp, everyone: true },
        ],
    },
    {
        key: 'governance',
        items: [
            { key: 'platformTeam', href: '/users', icon: UserCog, legacyRoles: LEGACY_ADMIN },
            { key: 'legacyAudit', href: '/audit', icon: Shield, legacyRoles: LEGACY_ADMIN },
            { key: 'settings', href: '/settings', icon: Settings, legacyRoles: LEGACY_ADMIN },
        ],
    },
];

export interface NavSubject {
    can: (permission: string) => boolean;
    legacyCan: (permission: string) => boolean;
    legacyRole: string | null;
}

export function itemVisible(item: NavItem, s: NavSubject): boolean {
    if (item.everyone) return true;
    if (item.lending?.some((p) => s.can(p))) return true;
    if (item.legacy?.some((p) => s.legacyCan(p))) return true;
    return !!s.legacyRole && !!item.legacyRoles?.includes(s.legacyRole);
}

export function visibleNav(sections: NavSection[], s: NavSubject): NavSection[] {
    return sections
        .map((sec) => ({ ...sec, items: sec.items.filter((i) => itemVisible(i, s)) }))
        .filter((sec) => sec.items.length > 0);
}

/** The menu's translation key for a page, if it is in the menu. */
export function navKeyFor(href: string): string | null {
    for (const sec of NAV) for (const i of sec.items) if (i.href === href) return i.key;
    return null;
}

/** Is the page at `href` part of this person's menu? (Lending sub-tabs reuse the menu rules.) */
export function hrefVisible(href: string, s: NavSubject): boolean {
    for (const sec of NAV) for (const i of sec.items) if (i.href === href) return itemVisible(i, s);
    return false;
}
