"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ListChecks } from 'lucide-react';
import api from '@/lib/api';

interface Entry {
    tenantId: string;
    progress: { percent: number; done: number; total: number; complete: boolean } | null;
    open: { key: string; status: string }[];
}

/** Each organisation's go-live setup progress (GET /platform/setup-progress, D-171), by tenant id. */
export function usePlatformSetupProgress(): Map<string, Entry> {
    const [byTenant, setByTenant] = useState<Map<string, Entry>>(new Map());
    useEffect(() => {
        let cancelled = false;
        api.get<{ tenants: Entry[] }>('/platform/setup-progress').then(
            (r) => { if (!cancelled) setByTenant(new Map(r.data.tenants.map((e) => [e.tenantId, e]))); },
            () => undefined,
        );
        return () => { cancelled = true; };
    }, []);
    return byTenant;
}

/** An organisation card's go-live setup line: percentage, bar and the open item count. */
export function SetupProgressBadge({ entry }: { entry: Entry | undefined }) {
    const t = useTranslations('GoLiveSetup.platform');
    if (!entry?.progress) return null;
    const p = entry.progress;
    return (
        <div data-testid="tenant-setup-progress" className="mt-4 px-1">
            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-400">
                <span className="flex items-center gap-1.5"><ListChecks size={10} /> {t('label')}</span>
                <span className={p.complete ? 'text-emerald-600' : 'text-slate-600'}>
                    {p.complete ? t('complete') : t('percent', { percent: p.percent, open: entry.open.length })}
                </span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full ${p.complete ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${p.percent}%` }} />
            </div>
        </div>
    );
}
