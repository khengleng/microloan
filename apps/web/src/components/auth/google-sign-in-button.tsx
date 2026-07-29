"use client";

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Google Identity Services button.
 *
 * Renders nothing at all when the API reports no Google client id, so a
 * deployment without Google configured shows no dead button. The client id is
 * fetched from /auth/providers rather than baked in as a NEXT_PUBLIC_* var,
 * keeping one source of truth with the backend.
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client';

type GoogleCredentialResponse = { credential?: string };

declare global {
    interface Window {
        google?: {
            accounts: {
                id: {
                    initialize: (config: {
                        client_id: string;
                        callback: (response: GoogleCredentialResponse) => void;
                        ux_mode?: 'popup' | 'redirect';
                    }) => void;
                    renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
                };
            };
        };
    }
}

let scriptPromise: Promise<void> | null = null;

/**
 * GIS state is global to the page, not per component.
 *
 * `google.accounts.id.initialize()` registers ONE client id and ONE callback
 * for the whole document. Calling it per mount produced
 * "initialize() is called multiple times ... only the last initialized
 * instance will be used" in the console — and the warning understates it: with
 * two buttons mounted, one of them silently ends up wired to the other's
 * handler.
 *
 * So initialize runs once per client id with a stable dispatcher, and whichever
 * button is currently mounted registers itself as the recipient.
 */
let initializedClientId: string | null = null;
let activeHandler: ((r: GoogleCredentialResponse) => void) | null = null;

/** Load the GIS library once per page, no matter how many buttons mount. */
function loadGis(): Promise<void> {
    if (typeof window === 'undefined') return Promise.resolve();
    if (window.google?.accounts?.id) return Promise.resolve();
    scriptPromise ??= new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`);
        if (existing) {
            existing.addEventListener('load', () => resolve());
            existing.addEventListener('error', () => reject(new Error('load failed')));
            return;
        }
        const script = document.createElement('script');
        script.src = GIS_SRC;
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Could not load Google sign-in.'));
        document.head.appendChild(script);
    });
    return scriptPromise;
}

export type GoogleSignInButtonProps = {
    /** Receives the Google ID token. Throw to surface an error to the user. */
    onCredential: (idToken: string) => Promise<void> | void;
    text?: 'signin_with' | 'signup_with' | 'continue_with';
    disabled?: boolean;
    onUnavailable?: () => void;
    /**
     * BCP-47 language for Google's own button label, e.g. "en" or "km".
     *
     * Without this GIS picks the *browser's* language, which produced a Khmer
     * button sitting under an English form on /en/login. The page's locale is
     * the only thing that should decide this.
     */
    locale?: string;
    /**
     * Rule and label rendered above the button, e.g. "or".
     *
     * Lives here rather than in the page because this component renders
     * nothing when Google is unconfigured — a divider owned by the page would
     * be left stranded above empty space.
     */
    dividerLabel?: string;
};

export function GoogleSignInButton({
    onCredential,
    text = 'continue_with',
    disabled = false,
    onUnavailable,
    locale,
    dividerLabel,
}: GoogleSignInButtonProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [clientId, setClientId] = useState<string | null>(null);
    const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
    const [error, setError] = useState('');

    // Keep the latest callback without re-initialising GIS on every render.
    const handlerRef = useRef(onCredential);
    handlerRef.current = onCredential;

    useEffect(() => {
        let cancelled = false;
        fetch('/api/proxy/auth/providers')
            .then((r) => (r.ok ? r.json() : { enabled: false }))
            .then((data: { enabled?: boolean; clientId?: string | null }) => {
                if (cancelled) return;
                if (data?.enabled && data.clientId) {
                    setClientId(data.clientId);
                } else {
                    setStatus('unavailable');
                    onUnavailable?.();
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setStatus('unavailable');
                    onUnavailable?.();
                }
            });
        return () => {
            cancelled = true;
        };
        // onUnavailable is intentionally excluded: it is a render-stable
        // notifier and including it would re-run the provider probe.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleCredential = useCallback((response: GoogleCredentialResponse) => {
        if (!response.credential) {
            setError('Google did not return a credential. Try again.');
            return;
        }
        setError('');
        void Promise.resolve(handlerRef.current(response.credential)).catch((err: unknown) => {
            setError(err instanceof Error ? err.message : 'Google sign-in failed.');
        });
    }, []);

    useEffect(() => {
        if (!clientId || !containerRef.current) return;
        let cancelled = false;

        loadGis()
            .then(() => {
                if (cancelled || !containerRef.current || !window.google) return;
                activeHandler = handleCredential;
                if (initializedClientId !== clientId) {
                    window.google.accounts.id.initialize({
                        client_id: clientId,
                        // Dispatch, so re-initialising is never needed just to
                        // change which button receives the credential.
                        callback: (r: GoogleCredentialResponse) => activeHandler?.(r),
                        ux_mode: 'popup',
                    });
                    initializedClientId = clientId;
                }
                containerRef.current.innerHTML = '';
                // GIS renders a fixed-width iframe, so a hardcoded 320 sat
                // narrower than the submit button above it on wide cards and
                // overflowed narrow ones. Match the container instead; 400 is
                // Google's documented maximum.
                const available = containerRef.current.offsetWidth;
                window.google.accounts.id.renderButton(containerRef.current, {
                    theme: 'outline',
                    size: 'large',
                    width: Math.min(400, Math.max(200, available || 320)),
                    text,
                    shape: 'rectangular',
                    logo_alignment: 'center',
                    // Undefined lets GIS fall back to the browser language,
                    // which is the bug this replaces — callers pass the page
                    // locale.
                    locale,
                });
                setStatus('ready');
            })
            .catch(() => {
                if (!cancelled) setStatus('unavailable');
            });

        return () => {
            cancelled = true;
            // Leave the dispatcher pointing at nothing rather than at a
            // component that has gone away.
            if (activeHandler === handleCredential) activeHandler = null;
        };
    }, [clientId, handleCredential, text, locale]);

    if (status === 'unavailable') return null;

    return (
        <div className="space-y-2">
            {dividerLabel && (
                <div className="flex items-center gap-3 pt-1 pb-2" aria-hidden>
                    <span className="h-px flex-1 bg-border" />
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {dividerLabel}
                    </span>
                    <span className="h-px flex-1 bg-border" />
                </div>
            )}
            <div
                ref={containerRef}
                aria-busy={status === 'loading'}
                className={disabled ? 'pointer-events-none opacity-50' : undefined}
            />
            {status === 'loading' && (
                <div className="h-10 rounded border border-border bg-secondary animate-pulse" />
            )}
            {error && (
                <div className="text-[12px] text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2 rounded">
                    {error}
                </div>
            )}
        </div>
    );
}
