"use client";

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ui/toast';
import type { ApiErrorEventDetail } from '@/lib/api';

/**
 * ApiErrorListener — mounts once inside the app layout.
 *
 * Listens for the `api:error` custom DOM event fired by the axios
 * interceptor in lib/api.ts and surfaces a user-friendly toast.
 *
 * This bridge is necessary because the axios interceptor lives outside
 * React context and cannot call hooks directly. The interceptor sends either
 * the API's own message or a key under `Errors.api`, translated here.
 */
export function ApiErrorListener() {
    const { showToast } = useToast();
    const t = useTranslations('Errors.api');

    useEffect(() => {
        const handler = (e: Event) => {
            const { message, messageKey } = (e as CustomEvent<ApiErrorEventDetail>).detail;
            const text = message ?? (messageKey ? t(messageKey) : null);
            if (text) showToast(text, 'error');
        };

        window.addEventListener('api:error', handler);
        return () => window.removeEventListener('api:error', handler);
    }, [showToast, t]);

    return null;
}
