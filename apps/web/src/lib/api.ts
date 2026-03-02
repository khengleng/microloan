import axios from 'axios';

/**
 * Axios instance for the NestJS API.
 * 
 * IMPORTANT: We now call our LOCAL Next.js proxy (/api/proxy).
 * This is because auth tokens are HttpOnly cookies on this domain.
 * The Next.js proxy will receive the cookie, extract the token,
 * and forward it to the NestJS API server-side.
 */
const api = axios.create({
    baseURL: '/api/proxy',
    headers: {
        'X-Requested-With': 'XMLHttpRequest',
    },
});

// Redirect to login automatically when the session expires (401)
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401 && typeof window !== 'undefined') {
            // Detect current locale from URL
            const segments = window.location.pathname.split('/');
            const locale = segments[1] || 'en';

            // Clear cookies server-side then redirect
            fetch('/api/auth/logout', { method: 'POST' }).finally(() => {
                window.location.href = `/${locale}/login`;
            });
        }
        return Promise.reject(error);
    },
);

export default api;
