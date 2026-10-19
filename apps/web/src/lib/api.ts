import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { renewSession } from '@/lib/session-refresh';
import { canStepUp, requestStepUp } from '@/lib/step-up';

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

declare module 'axios' {
    interface AxiosRequestConfig {
        /** The caller shows its own message for 4xx answers: skip the global toast. */
        quiet?: boolean;
    }
}

type SessionConfig = InternalAxiosRequestConfig & { _sentAt?: number; _retried?: boolean; _steppedUp?: boolean };

/**
 * The account must set up an authenticator first: send the browser to
 * My account (where enrolment is) unless it is already there.
 */
function goToEnrolment() {
    const parts = window.location.pathname.split('/');
    const locale = parts[1] || 'en';
    if (parts[2] === 'account') return;
    window.location.href = `/${locale}/account?enrol=1`;
}

/**
 * Sign-in flows that answer 401 for a wrong password or code. They run with
 * no session to renew, and a 401 from them must reach the form — never a
 * refresh or a bounce to the login page.
 */
const SIGN_IN_FLOW = /^\/?auth\/(login|refresh|logout|forgot-password|reset-password|mfa\/authenticate|register-tenant|google)(\/|\?|$)/;

// Remember when each request left, so a tab that waited for another tab's
// refresh can tell whether its own request already used the new cookie.
api.interceptors.request.use((config) => {
    (config as SessionConfig)._sentAt = Date.now();
    return config;
});

/** End this device's session (revoking its refresh token) and go to Sign in. */
export function signOut(locale?: string) {
    const target = locale || window.location.pathname.split('/')[1] || 'en';
    return fetch('/api/auth/logout', { method: 'POST' }).finally(() => {
        window.location.href = `/${target}/login`;
    });
}

function signOutAndRedirect() {
    void signOut();
}

// ── Global response interceptor ───────────────────────────────────────────
api.interceptors.response.use(
    (response) => response,
    async (error: AxiosError<{ message?: string | string[]; code?: string }>) => {
        if (typeof window === 'undefined') return Promise.reject(error);

        const status: number | undefined = error.response?.status;
        const rawMessage = error.response?.data?.message;
        const apiMessage: string | undefined = Array.isArray(rawMessage) ? rawMessage[0] : rawMessage;
        const config = error.config as SessionConfig | undefined;

        // 401 — the access token lapsed or was refused. Renew the session once
        // (silently, serialised across tabs) and replay the request; only when
        // the session cannot be renewed does the person go back to Sign in.
        if (status === 401) {
            if (config && SIGN_IN_FLOW.test(config.url ?? '')) return Promise.reject(error);
            if (config && !config._retried) {
                const outcome = await renewSession(config._sentAt ?? 0);
                if (outcome === 'refreshed') {
                    config._retried = true;
                    return api.request(config);
                }
                // The API could not be reached: keep the person where they are.
                if (outcome === 'unavailable') return Promise.reject(error);
            }
            signOutAndRedirect();
            return Promise.reject(error);
        }

        const code = error.response?.data?.code;

        // The role must use an authenticator and has none yet: everything but
        // enrolment is refused until it is set up. No toast — go to My account.
        if (status === 403 && code === 'MFA_ENROLMENT_REQUIRED') {
            goToEnrolment();
            return Promise.reject(error);
        }

        // The action needs a recent authenticator code: ask for one (one
        // prompt shared by concurrent requests) and replay the request once.
        // Cancelling rejects quietly.
        if (status === 403 && code === 'MFA_STEP_UP_REQUIRED' && config && !config._steppedUp && canStepUp()) {
            if (await requestStepUp(apiMessage)) {
                config._steppedUp = true;
                return api.request(config);
            }
            return Promise.reject(Object.assign(error, { stepUpCancelled: true }));
        }

        // For all other restriction codes, fire a browser custom event so that
        // the <ApiErrorListener> component (mounted inside the React tree) can
        // pick it up and show a toast — without needing React context here.
        const quiet = !!config?.quiet && !!status && status < 500;
        const message = status && !quiet ? friendlyMessage(status, apiMessage) : null;
        if (message) {
            window.dispatchEvent(new CustomEvent('api:error', { detail: { message, status } }));
        }

        return Promise.reject(error);
    },
);

export default api;
