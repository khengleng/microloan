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
};

export function GoogleSignInButton({
    onCredential,
    text = 'continue_with',
    disabled = false,
    onUnavailable,
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
                window.google.accounts.id.initialize({
                    client_id: clientId,
                    callback: handleCredential,
                    ux_mode: 'popup',
                });
                containerRef.current.innerHTML = '';
                window.google.accounts.id.renderButton(containerRef.current, {
                    theme: 'outline',
                    size: 'large',
                    width: 320,
                    text,
                    shape: 'rectangular',
                    logo_alignment: 'center',
                });
                setStatus('ready');
            })
            .catch(() => {
                if (!cancelled) setStatus('unavailable');
            });

        return () => {
            cancelled = true;
        };
    }, [clientId, handleCredential, text]);

    if (status === 'unavailable') return null;

    return (
        <div className="space-y-2">
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
