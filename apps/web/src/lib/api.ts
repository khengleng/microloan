import axios from 'axios';

/**
 * Axios instance for the NestJS API.
 *
 * All requests go through the local Next.js proxy (/api/proxy).
 * Auth tokens are HttpOnly cookies forwarded server-side by the proxy.
 */
const api = axios.create({
    baseURL: '/api/proxy',
    headers: {
        'X-Requested-With': 'XMLHttpRequest',
    },
});

/**
 * User-friendly messages for common HTTP restriction codes.
 * The API always returns { message: string } in the body — we prefer
 * that over the generic fallback, but fall back gracefully.
 */
function friendlyMessage(status: number, apiMessage?: string): string | null {
    // Some errors the API already returns with a helpful message — use it directly.
    // For generic / vague ones, provide a better UX fallback.
    switch (status) {
        case 400:
            return apiMessage || 'The request contained invalid data. Please check your input and try again.';
        case 403: {
            // Quota exceeded messages come from the API and are very descriptive — use them.
            // Role-based 403s are generic — make them friendlier.
            if (apiMessage && apiMessage.length > 20) return apiMessage;
            return 'You don\'t have permission to do that. Contact your administrator if you believe this is a mistake.';
        }
        case 404:
            return apiMessage || 'The requested record could not be found.';
        case 409:
            return apiMessage || 'A conflict occurred — this record may already exist.';
        case 429:
            return 'Too many requests. Please slow down and try again in a moment.';
        case 500:
        case 502:
        case 504:
            return 'Something went wrong on our end. Please try again shortly.';
        case 503:
            // Billing / Stripe not configured — API returns a helpful message.
            return apiMessage || 'This service is temporarily unavailable. Please try again later.';
        // 401 is handled separately below (session expiry → redirect)
        default:
            return null;
    }
}

// ── Global response interceptor ───────────────────────────────────────────
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (typeof window === 'undefined') return Promise.reject(error);

        const status: number | undefined = error.response?.status;
        const apiMessage: string | undefined = error.response?.data?.message;

        // 401 — session expired or invalid token → redirect to login
        if (status === 401) {
            const segments = window.location.pathname.split('/');
            const locale = segments[1] || 'en';
            fetch('/api/auth/logout', { method: 'POST' }).finally(() => {
                window.location.href = `/${locale}/login`;
            });
            return Promise.reject(error);
        }

        // For all other restriction codes, fire a browser custom event so that
        // the <ApiErrorListener> component (mounted inside the React tree) can
        // pick it up and show a toast — without needing React context here.
        const message = status ? friendlyMessage(status, Array.isArray(apiMessage) ? apiMessage[0] : apiMessage) : null;
        if (message) {
            window.dispatchEvent(new CustomEvent('api:error', { detail: { message, status } }));
        }

        return Promise.reject(error);
    },
);

export default api;
