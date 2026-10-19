import { renewSession, rotateSessionWith } from '@/lib/session-refresh';

/**
 * Authenticator step-up, bridged between the axios interceptor (outside
 * React) and the <StepUpModal/> mounted in the app shell.
 *
 * Sensitive actions answer 403 { code: 'MFA_STEP_UP_REQUIRED' } when the
 * session has no authenticator code from the last few minutes. The
 * interceptor asks here for a code; the modal collects it, the Next route
 * /api/auth/step-up trades it for fresh HttpOnly session cookies, and the
 * original request is replayed once. Concurrent requests share one prompt.
 */

/** Shows the prompt; resolves true once a code was accepted, false on cancel. */
type StepUpHandler = (message?: string) => Promise<boolean>;

let handler: StepUpHandler | null = null;
let pending: Promise<boolean> | null = null;

/** Mounted by <StepUpModal/>; returns the unregister function. */
export function registerStepUpHandler(fn: StepUpHandler): () => void {
    handler = fn;
    return () => {
        if (handler === fn) handler = null;
    };
}

/** Whether a prompt can be shown on this page. */
export function canStepUp(): boolean {
    return handler !== null;
}

/**
 * Ask the person for an authenticator code. Every caller that asks while a
 * prompt is open shares it (and its outcome). Resolves false without a prompt
 * when none is mounted.
 */
export function requestStepUp(message?: string): Promise<boolean> {
    if (pending) return pending;
    if (!handler) return Promise.resolve(false);
    pending = handler(message).finally(() => {
        pending = null;
    });
    return pending;
}

export type StepUpResult = { ok: true } | { ok: false; status: number; message: string };

function messageOf(data: unknown): string {
    const raw = (data as { message?: string | string[] } | null)?.message;
    return Array.isArray(raw) ? raw.join(' ') : raw || '';
}

/**
 * POST a 6-digit code to one of the Next routes that verify it at the API and
 * write the new session cookies server-side (/api/auth/step-up,
 * /api/auth/mfa/enable). No token ever reaches this code. A lapsed access
 * token is renewed once first.
 */
export async function postSessionCode(path: string, code: string): Promise<StepUpResult> {
    const call = () =>
        rotateSessionWith(() =>
            fetch(path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                credentials: 'same-origin',
                body: JSON.stringify({ code }),
            }),
        );
    try {
        const sentAt = Date.now();
        let res = await call();
        if (res.status === 401 && (await renewSession(sentAt)) === 'refreshed') res = await call();
        if (res.ok) return { ok: true };
        const data = await res.json().catch(() => null);
        return { ok: false, status: res.status, message: messageOf(data) };
    } catch {
        return { ok: false, status: 0, message: '' };
    }
}

/** Trade an authenticator code for a fresh MFA session (step-up). */
export function submitStepUpCode(code: string): Promise<StepUpResult> {
    return postSessionCode('/api/auth/step-up', code);
}
