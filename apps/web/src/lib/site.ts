/**
 * Who operates this deployment, as the public pages (terms, privacy, refund
 * policy, pricing) name it. Every value comes from the environment
 * (NEXT_PUBLIC_*, inlined at build time, documented in .env.example); the
 * defaults are the original operator's details, so a deployment that sets
 * nothing shows exactly what it showed before these were configurable.
 *
 * This is the one place those details may appear in the web app
 * (scripts/config-audit.mjs allows them here and nowhere else).
 */
function env(value: string | undefined, fallback: string): string {
    return value && value.trim() ? value.trim() : fallback;
}

const contactDomain = env(process.env.NEXT_PUBLIC_CONTACT_EMAIL_DOMAIN, 'dbankcambodia.com');

export const site = {
    /** The legal entity that provides the platform. */
    operatorName: env(process.env.NEXT_PUBLIC_OPERATOR_NAME, 'DBank Cambodia'),
    /** The platform's product name on the legal pages. */
    productName: env(process.env.NEXT_PUBLIC_PRODUCT_NAME, 'MicroLoan'),
    contact: {
        support: env(process.env.NEXT_PUBLIC_SUPPORT_EMAIL, `support@${contactDomain}`),
        privacy: env(process.env.NEXT_PUBLIC_PRIVACY_EMAIL, `privacy@${contactDomain}`),
        billing: env(process.env.NEXT_PUBLIC_BILLING_EMAIL, `billing@${contactDomain}`),
        sales: env(process.env.NEXT_PUBLIC_SALES_EMAIL, `sales@${contactDomain}`),
    },
};
