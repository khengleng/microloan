import { GUIDE_SLUGS } from '@/generated/user-guide-slugs';

/**
 * Links into the in-app user guide (/[locale]/help), built from
 * docs/user-guide by scripts/generate-user-guide.mjs.
 *
 * Chapters are named by their file name without ".md". A chapter that was
 * renumbered ("scorecards-and-alternative-data" → "24-scorecards-…") is still
 * found by its unnumbered name; one that no longer exists falls back to the
 * contents page, so a stale link never leads nowhere.
 */
export interface HelpTarget {
    chapter: string;
    anchor?: string;
}

const unnumbered = (slug: string) => slug.replace(/^\d+-/, '');

/** The chapter's current slug, or null when the guide has no such chapter. */
export function resolveGuideSlug(chapter: string, slugs: readonly string[] = GUIDE_SLUGS): string | null {
    if (slugs.includes(chapter)) return chapter;
    const bare = unnumbered(chapter);
    return slugs.find((s) => unnumbered(s) === bare) ?? null;
}

/** Locale-aware href to a chapter (and section), or to the contents page. */
export function guideHref(locale: string, target?: HelpTarget | null): string {
    const base = `/${locale}/help`;
    if (!target) return base;
    const slug = resolveGuideSlug(target.chapter);
    if (!slug) return base;
    return `${base}/${slug}${target.anchor ? `#${target.anchor}` : ''}`;
}

/**
 * Contextual help for workspace pages, by path (after the locale). The longest
 * matching prefix wins; anchors are GitHub-style heading ids in the chapter.
 */
export const HELP_BY_PATH: Readonly<Record<string, HelpTarget>> = {
    '/lending': { chapter: '04-products-and-policies', anchor: '1-key-ideas-before-you-start' },
    '/lending/catalogue': { chapter: '04-products-and-policies', anchor: '3-browse-the-catalogue' },
    '/lending/products': { chapter: '04-products-and-policies', anchor: '4-create-a-new-product' },
    '/lending/products/': { chapter: '04-products-and-policies', anchor: '6-the-product-version-page' },
    '/lending/policies': { chapter: '04-products-and-policies', anchor: '9-work-with-the-policy-library' },
    '/lending/workflows': { chapter: '04-products-and-policies', anchor: '10-workflows' },
    '/lending/simulator': { chapter: '04-products-and-policies', anchor: '11-pricing-and-repayment-simulator' },
    '/lending/scorecards': { chapter: 'scorecards-and-alternative-data' },
    '/lending/scorecard-monitoring': { chapter: 'scorecards-and-alternative-data' },
    '/lending/applications': { chapter: '05-applications-and-credit-decisions', anchor: 'the-application-pipeline' },
    '/lending/applications/': { chapter: '05-applications-and-credit-decisions', anchor: 'the-application-page' },
    '/lending/customers': { chapter: '03-customers-and-documents' },
    '/lending/documents': { chapter: '03-customers-and-documents', anchor: 'the-customer-document-library' },
    '/lending/groups': { chapter: '10-group-lending' },
    '/lending/loans': { chapter: '07-repayments-and-payments', anchor: '1-finding-a-loan-account' },
    '/lending/loans/': { chapter: '07-repayments-and-payments', anchor: '10-related-tasks-on-the-loan-screen' },
    '/lending/facilities': { chapter: '09-facilities' },
    '/lending/cards': { chapter: '12-specialised-products' },
    '/lending/trade': { chapter: '12-specialised-products' },
    '/lending/syndication': { chapter: '12-specialised-products' },
    '/lending/counterparties': { chapter: '12-specialised-products' },
    '/lending/income-contingent': { chapter: '12-specialised-products' },
    '/lending/collections': { chapter: '11-collections-and-recovery', anchor: '2-the-collections-page' },
    '/lending/recovery': { chapter: '11-collections-and-recovery', anchor: '5-recovery-repossession-pawn-credit-insurance-and-debt-sale' },
    '/lending/suspense': { chapter: '07-repayments-and-payments', anchor: '7-unidentified-payments-suspense' },
    '/lending/payment-channels': { chapter: '07-repayments-and-payments', anchor: '8-payment-channels' },
    '/lending/qr-repayments': { chapter: '07-repayments-and-payments', anchor: '9-repayment-by-khqr' },
    '/lending/restructures': { chapter: '08-servicing-changes' },
    '/lending/relief': { chapter: '08-servicing-changes' },
    '/lending/accounting': { chapter: '14-accounting-and-period-close', anchor: 'ledger--reconciliation' },
    '/lending/close': { chapter: '14-accounting-and-period-close', anchor: 'period-close-month-end-and-year-end' },
    '/lending/combined-ledger': { chapter: '14-accounting-and-period-close', anchor: 'combined-ledger' },
    '/lending/operations': { chapter: '14-accounting-and-period-close', anchor: 'end-of-day-and-the-business-date' },
    '/lending/regulatory': { chapter: '15-reports-and-regulatory-returns' },
    '/lending/migration': { chapter: '16-loan-book-migration' },
    '/lending/webhooks': { chapter: '17-webhooks-and-integrations', anchor: '1-webhooks' },
    '/lending/aml': { chapter: '26-aml-and-compliance' },
    '/lending/audit': { chapter: '19-audit-trail', anchor: '1-audit-trail-risk--audit--audit-trail' },
    '/lending/setup': { chapter: '27-go-live-setup' },
    '/lending/access': { chapter: '18-tenant-administration', anchor: '6-access--policy-risk--audit--access--policy' },
    '/lending/legacy-archive': { chapter: '21-legacy-archive-and-migration', anchor: '2-the-legacy-loan-archive' },
    '/reports': { chapter: '15-reports-and-regulatory-returns', anchor: 'reports' },
    '/kpi': { chapter: '15-reports-and-regulatory-returns', anchor: 'performance' },
    '/dashboard': { chapter: '15-reports-and-regulatory-returns', anchor: 'kpi-dashboard' },
    '/settings': { chapter: '18-tenant-administration', anchor: '4-settings-administration--settings' },
    '/users': { chapter: '18-tenant-administration', anchor: '3-team-members-administration--team-members' },
    '/audit': { chapter: '19-audit-trail', anchor: '2-audit-log-risk--audit--audit-log' },
};

/** Help for a page path without the locale ("/lending/loans/abc"), if any. */
export function helpForPath(path: string): HelpTarget | null {
    let best: string | null = null;
    for (const prefix of Object.keys(HELP_BY_PATH)) {
        const matches = prefix.endsWith('/') ? path.startsWith(prefix) && path.length > prefix.length : path === prefix || path.startsWith(`${prefix}/`);
        if (matches && (!best || prefix.length > best.length)) best = prefix;
    }
    return best ? HELP_BY_PATH[best] : null;
}
