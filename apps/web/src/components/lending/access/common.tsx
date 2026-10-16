"use client";

import { useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import type { AccessOverview, LendingUser, Permission } from '../types';
import { Checkbox } from '../ui';

export interface TabProps {
    data: AccessOverview;
    reload: () => void;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MONEY_RE = /^\d+(\.\d{1,4})?$/;

/** Current signed-in user id (for maker-checker hints; the server remains authoritative). */
export function useMyId(): string | null {
    return useAuth().user?.sub ?? null;
}

/** Returns a resolver from user id → email (falls back to a shortened id). */
export function useUserName(users: LendingUser[]) {
    const map = useMemo(() => new Map(users.map((u) => [u.id, u.email])), [users]);
    return (id: string | null | undefined): string => {
        if (!id) return '—';
        return map.get(id) ?? `${id.slice(0, 8)}…`;
    };
}

export function userOptions(users: LendingUser[]) {
    return users
        .filter((u) => u.isActive)
        .map((u) => ({ value: u.id, label: `${u.email} (${u.role})` }));
}

/** "a, b , c" → ["a","b","c"] */
export function splitList(text: string): string[] {
    return text.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Parse a comma-separated UUID list; returns ids and the invalid tokens. */
export function parseUuidList(text: string): { ids: string[]; invalid: string[] } {
    const parts = splitList(text);
    return { ids: parts.filter((p) => UUID_RE.test(p)), invalid: parts.filter((p) => !UUID_RE.test(p)) };
}

export function groupByCategory(permissions: Permission[]): [string, Permission[]][] {
    const m = new Map<string, Permission[]>();
    for (const p of permissions) {
        const list = m.get(p.category) ?? [];
        list.push(p);
        m.set(p.category, list);
    }
    return [...m.entries()];
}

export function FinancialMark() {
    return <span title="Financial permission" className="ml-1 text-[10px] font-bold px-1 rounded bg-amber-100 text-amber-800">$</span>;
}

/** Grouped permission checkboxes. */
export function PermissionPicker({ permissions, value, onChange, max }: {
    permissions: Permission[]; value: string[]; onChange: (v: string[]) => void; max?: number;
}) {
    const groups = groupByCategory(permissions);
    const selected = new Set(value);
    const toggle = (code: string, on: boolean) => {
        const next = new Set(selected);
        if (on) next.add(code); else next.delete(code);
        onChange(permissions.map((p) => p.code).filter((c) => next.has(c)));
    };
    const full = max !== undefined && value.length >= max;
    return (
        <div className="space-y-3 max-h-80 overflow-auto border border-[#E3E8EE] rounded p-3 bg-[#FCFDFE]">
            <p className="text-[11px] text-[#697386]">{value.length} selected{max !== undefined ? ` (max ${max})` : ''}</p>
            {groups.map(([cat, perms]) => {
                const allOn = perms.every((p) => selected.has(p.code));
                return (
                    <div key={cat}>
                        <div className="flex items-center justify-between">
                            <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">{cat}</p>
                            <button
                                type="button"
                                className="text-[11px] text-[#635BFF] hover:underline"
                                onClick={() => {
                                    const next = new Set(selected);
                                    for (const p of perms) { if (allOn) next.delete(p.code); else next.add(p.code); }
                                    const codes = permissions.map((p) => p.code).filter((c) => next.has(c));
                                    onChange(max !== undefined ? codes.slice(0, max) : codes);
                                }}
                            >
                                {allOn ? 'clear' : 'all'}
                            </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-1">
                            {perms.map((p) => (
                                <span key={p.code} title={p.description}>
                                    <Checkbox
                                        checked={selected.has(p.code)}
                                        disabled={full && !selected.has(p.code)}
                                        onChange={(on) => toggle(p.code, on)}
                                        label={<span className="font-mono text-[12px]">{p.code}{p.financial && <FinancialMark />}</span>}
                                    />
                                </span>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

export function Chip({ children, onRemove, tone = 'default' }: { children: React.ReactNode; onRemove?: () => void; tone?: 'default' | 'accent' }) {
    const cls = tone === 'accent' ? 'bg-[#F0F5FF] border-[#C9D7FF] text-[#4B45C6]' : 'bg-slate-50 border-[#E3E8EE] text-[#3C4257]';
    return (
        <span className={`inline-flex items-center gap-1 border rounded px-1.5 py-0.5 text-[11px] font-mono ${cls}`}>
            {children}
            {onRemove && <button type="button" onClick={onRemove} className="text-[#697386] hover:text-red-600" aria-label="remove">×</button>}
        </span>
    );
}
