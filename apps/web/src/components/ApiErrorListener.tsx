"use client";

import { useEffect } from 'react';
import { useToast } from '@/components/ui/toast';

/**
 * ApiErrorListener — mounts once inside the app layout.
 *
 * Listens for the `api:error` custom DOM event fired by the axios
 * interceptor in lib/api.ts and surfaces a user-friendly toast.
 *
 * This bridge is necessary because the axios interceptor lives outside
 * React context and cannot call hooks directly.
 */
export function ApiErrorListener() {
    const { showToast } = useToast();

    useEffect(() => {
        const handler = (e: Event) => {
            const { message } = (e as CustomEvent<{ message: string; status: number }>).detail;
            showToast(message, 'error');
        };

        window.addEventListener('api:error', handler);
        return () => window.removeEventListener('api:error', handler);
    }, [showToast]);

    return null;
}
