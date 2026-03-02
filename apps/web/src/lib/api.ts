import axios from 'axios';

/**
 * Axios instance for the NestJS API.
 *
 * Tokens are stored in HttpOnly cookies (set server-side by /api/auth/login).
 * The browser sends them automatically — we never read them from JS.
 * `withCredentials: true` is required for cross-origin requests to include cookies.
 */
const api = axios.create({
    baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/v1',
    withCredentials: true, // send HttpOnly cookies on every request
    headers: {
        'X-Requested-With': 'XMLHttpRequest',
    },
});

// Redirect to login automatically when the session expires (401)
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401 && typeof window !== 'undefined') {
            // Clear cookies server-side then redirect
            fetch('/api/auth/logout', { method: 'POST' }).finally(() => {
                window.location.href = '/en/login';
            });
        }
        return Promise.reject(error);
    },
);

export default api;
