"use client";

import { useWorkspace } from '@/lib/workspace';
import { todayIso } from './format';

/**
 * The organisation's business date (YYYY-MM-DD) from GET /me/access — the date
 * every posting, value-date check and expiry is measured against. Falls back to
 * the browser's date only until access has loaded (or for users without
 * lending access), so forms never default to a date the server would refuse.
 */
export function useBusinessDate(): string {
    const { access } = useWorkspace();
    return access?.businessDate ?? todayIso();
}

/** YYYY-MM-DD plus `days` calendar days (negative to go back), in UTC to avoid DST drift. */
export function addDaysIso(date: string, days: number): string {
    const [y, m, d] = date.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + days));
    const p = (n: number) => String(n).padStart(2, '0');
    return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
}
