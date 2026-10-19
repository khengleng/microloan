import createNextIntlPlugin from 'next-intl/plugin';
const withNextIntl = createNextIntlPlugin('./src/i18n.ts');

const isDev = process.env.NODE_ENV !== 'production';

/*
 * Content-Security-Policy.
 *
 * The browser only ever talks to this origin (the API is reached through the
 * /api/proxy route handlers), plus two optional third parties:
 *   - Google Identity Services (src/components/auth/google-sign-in-button.tsx):
 *     script, button iframe, styles and FedCM/XHR all live on accounts.google.com.
 *   - Microsoft Clarity (src/lib/clarity.ts): the tag on www.clarity.ms loads
 *     scripts.clarity.ms and beacons to *.clarity.ms (and c.bing.com).
 *
 * script-src keeps 'unsafe-inline' because Next's App Router injects inline
 * bootstrap/flight scripts and we do not issue per-request nonces. React's dev
 * build needs 'unsafe-eval'; it is only added outside production.
 * img-src allows data:/blob:/https: for KYC uploads (data URIs), KHQR codes,
 * export previews (blob:) and images referenced from the help guide.
 */
const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://accounts.google.com https://www.clarity.ms https://*.clarity.ms`,
    "style-src 'self' 'unsafe-inline' https://accounts.google.com",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://accounts.google.com https://*.clarity.ms https://c.bing.com",
    'frame-src https://accounts.google.com',
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
].join('; ');

const securityHeaders = [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
    transpilePackages: ['@microloan/shared'],
    poweredByHeader: false,
    async headers() {
        return [{ source: '/:path*', headers: securityHeaders }];
    },
};

export default withNextIntl(nextConfig);
