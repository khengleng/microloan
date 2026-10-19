/**
 * The API base URL for the web app's server-side route handlers (login,
 * MFA, Google sign-in, borrower OTP and the /api/proxy pass-through).
 *
 * Prefers the server-only API_URL (kept out of the browser bundle so the
 * internal hostname is not shipped to clients), then NEXT_PUBLIC_API_URL.
 * Production must set one of them; only a development server falls back to
 * the API's local default port.
 */
export function apiBaseUrl(): string {
    const url = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL;
    if (url && url.trim()) return url.trim();
    if (process.env.NODE_ENV === 'production') {
        throw new Error('API_URL (or NEXT_PUBLIC_API_URL) is required in production.');
    }
    return 'http://localhost:3001/v1';
}
