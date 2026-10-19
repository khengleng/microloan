"use client";

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, Archive } from 'lucide-react';
import api from '@/lib/api';

export interface LegacyStatus { readonly: boolean; source: string; message: string; frozenOperations?: string[] }

/** One request per page view for every control that asks (reused for 30 s). */
let shared: { at: number; promise: Promise<LegacyStatus | null> } | null = null;
function loadLegacyStatus(): Promise<LegacyStatus | null> {
    if (!shared || Date.now() - shared.at > 30_000) {
        shared = {
            at: Date.now(),
            promise: api.get<LegacyStatus>('/loans/legacy-status').then((r) => r.data, () => null),
        };
    }
    return shared.promise;
}

/**
 * Whether the tenant's original (legacy) loan module is read-only
 * (flag `lending.legacy_loans.readonly`, on by default — D-097). While unknown
 * it is null; the API refuses legacy money operations regardless of what the
 * page shows.
 */
export function useLegacyStatus(): LegacyStatus | null {
    const [status, setStatus] = useState<LegacyStatus | null>(null);
    useEffect(() => {
        let cancelled = false;
        loadLegacyStatus().then((s) => { if (!cancelled) setStatus(s); });
        return () => { cancelled = true; };
    }, []);
    return status;
}

/**
 * True unless the legacy book is known to be open: money controls stay hidden
 * until the status has loaded, so a frozen book never flashes a button.
 */
export function useLegacyFrozen(): boolean {
    const s = useLegacyStatus();
    return s === null || s.readonly;
}

/** Shown on legacy loan screens when the legacy book is read-only. */
export function LegacyReadonlyBanner({ status }: { status: LegacyStatus | null }) {
    const { locale } = useParams();
    const t = useTranslations('LegacyFreeze');
    if (!status?.readonly) return null;
    return (
        <div className="border border-amber-200 bg-amber-50 rounded-md px-4 py-3 text-[13px] text-amber-900 flex flex-col sm:flex-row sm:items-center gap-3 justify-between" role="status">
            <div className="flex items-start gap-2">
                <Archive size={16} className="mt-0.5 shrink-0" />
                <div>
                    <p className="font-bold">{t('title')}</p>
                    <p>{t('body')}</p>
                </div>
            </div>
            <div className="flex gap-2 shrink-0 flex-wrap">
                <Link href={`/${locale}/lending/loans`} className="inline-flex items-center gap-1 rounded bg-[#635BFF] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#5D55EF]">
                    {t('lendingLoans')} <ArrowRight size={12} />
                </Link>
                <Link href={`/${locale}/lending/migration`} className="inline-flex items-center gap-1 rounded border border-amber-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-amber-900 hover:bg-amber-100">
                    {t('migrate')}
                </Link>
                <Link href={`/${locale}/lending/applications`} className="inline-flex items-center gap-1 rounded border border-amber-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-amber-900 hover:bg-amber-100">
                    {t('newApplication')}
                </Link>
            </div>
        </div>
    );
}
