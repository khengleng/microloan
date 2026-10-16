"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import api from '@/lib/api';

export interface BlockedBy { layer: string; message: string }
export interface Issue { path: string; message: string }

/** Normalized API error: `{ message, code?, blockedBy?, issues? }` plus anything else the server sent. */
export interface ApiErrorInfo {
    status?: number;
    message: string;
    code?: string;
    blockedBy?: BlockedBy[];
    issues?: Issue[];
    body?: Record<string, unknown>;
}

export function toApiError(e: unknown): ApiErrorInfo {
    const err = e as { response?: { status?: number; data?: unknown }; message?: string };
    const status = err?.response?.status;
    const data = err?.response?.data;
    if (data && typeof data === 'object') {
        const d = data as Record<string, unknown>;
        // Nest wraps HttpException bodies; some errors nest the payload under `message`.
        const inner = d.message && typeof d.message === 'object' && !Array.isArray(d.message) ? (d.message as Record<string, unknown>) : d;
        const rawMsg = inner.message ?? d.message ?? d.error;
        const message = Array.isArray(rawMsg) ? rawMsg.join('; ') : typeof rawMsg === 'string' ? rawMsg : `Request failed${status ? ` (${status})` : ''}`;
        return {
            status,
            message,
            code: (inner.code ?? d.code) as string | undefined,
            blockedBy: (inner.blockedBy ?? d.blockedBy) as BlockedBy[] | undefined,
            issues: (inner.issues ?? d.issues) as Issue[] | undefined,
            body: { ...d, ...inner },
        };
    }
    return { status, message: err?.message || 'Request failed' };
}

/**
 * Fetch a GET endpoint. `url = null` skips the request.
 * Loading state is derived (no synchronous setState inside the effect).
 */
export function useApi<T>(url: string | null) {
    const [version, setVersion] = useState(0);
    const [state, setState] = useState<{ key: string | null; data?: T; error?: ApiErrorInfo }>({ key: null });
    const key = url === null ? null : `${url}#${version}`;

    useEffect(() => {
        if (url === null) return;
        let cancelled = false;
        const k = `${url}#${version}`;
        api.get<T>(url).then(
            (r) => { if (!cancelled) setState({ key: k, data: r.data }); },
            (e) => { if (!cancelled) setState((s) => ({ key: k, data: s.data, error: toApiError(e) })); },
        );
        return () => { cancelled = true; };
    }, [url, version]);

    const reload = useCallback(() => setVersion((v) => v + 1), []);
    const settled = state.key === key;
    return {
        data: state.data,
        error: settled ? state.error : undefined,
        loading: url !== null && !settled,
        reload,
    };
}

/** Run mutations with a busy flag and an inline error (toasts are also raised by the axios interceptor). */
export function useAction() {
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<ApiErrorInfo | null>(null);
    const run = useCallback(async <R,>(name: string, fn: () => Promise<R>): Promise<R | undefined> => {
        setBusy(name);
        setError(null);
        try {
            return await fn();
        } catch (e) {
            setError(toApiError(e));
            return undefined;
        } finally {
            setBusy(null);
        }
    }, []);
    const clearError = useCallback(() => setError(null), []);
    return { busy, error, run, clearError };
}

/**
 * Idempotency keys for money-moving POSTs. The same payload retried after a
 * failure reuses its key (so the server de-duplicates); a different payload,
 * or a new action after success, gets a fresh key.
 */
export function useIdempotencyKey() {
    const ref = useRef<{ payload: string; key: string } | null>(null);
    const keyFor = useCallback((payload: unknown): string => {
        const p = JSON.stringify(payload ?? null);
        if (!ref.current || ref.current.payload !== p) {
            ref.current = { payload: p, key: crypto.randomUUID() };
        }
        return ref.current.key;
    }, []);
    const reset = useCallback(() => { ref.current = null; }, []);
    return { keyFor, reset };
}

export function idem(key: string) {
    return { headers: { 'Idempotency-Key': key } };
}

/** Remove '' / undefined / null values and empty objects so strict API schemas accept the body. */
export function clean<T>(value: T): T {
    if (Array.isArray(value)) return value.map((v) => clean(v)) as unknown as T;
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (v === '' || v === undefined || v === null) continue;
            const c = clean(v);
            if (c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length === 0) continue;
            out[k] = c;
        }
        return out as T;
    }
    return value;
}

/** Build a query string from a params object, skipping empty values. */
export function qs(params: Record<string, string | number | undefined | null>): string {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
    }
    const s = p.toString();
    return s ? `?${s}` : '';
}

export type Capabilities = Record<string, { allowed: boolean; blockedBy: BlockedBy[] }>;

/** Capability map for one resource. Server enforcement remains authoritative. */
export function useCapabilities(resourceType: 'APPLICATION' | 'LOAN_ACCOUNT' | 'PRODUCT_VERSION', id: string | null) {
    const { data, reload } = useApi<Capabilities>(id ? `/lending/access/capabilities/${resourceType}/${id}` : null);
    const can = useCallback((action: string): { allowed: boolean; reason?: string } => {
        const c = data?.[action];
        if (!c) return { allowed: true };
        return { allowed: c.allowed, reason: c.allowed ? undefined : c.blockedBy.map((b) => `${b.layer}: ${b.message}`).join('\n') };
    }, [data]);
    return { caps: data, can, reload };
}
