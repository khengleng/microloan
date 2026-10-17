"use client";

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowRight, Archive } from 'lucide-react';
import api from '@/lib/api';

export interface LegacyStatus { readonly: boolean; source: string; message: string }

/**
 * Whether the tenant's legacy loan book is closed to new business
 * (flag `lending.legacy_loans.readonly`). While unknown it reports not
 * read-only; the API refuses new legacy loans regardless of what the page shows.
 */
export function useLegacyStatus(): LegacyStatus | null {
    const [status, setStatus] = useState<LegacyStatus | null>(null);
    useEffect(() => {
        let cancelled = false;
        api.get<LegacyStatus>('/loans/legacy-status').then(
            (r) => { if (!cancelled) setStatus(r.data); },
            () => { if (!cancelled) setStatus(null); },
        );
        return () => { cancelled = true; };
    }, []);
    return status;
}

/** Shown on legacy loan screens when the legacy book is read-only. */
export function LegacyReadonlyBanner({ status }: { status: LegacyStatus | null }) {
    const { locale } = useParams();
    if (!status?.readonly) return null;
    return (
        <div className="border border-amber-200 bg-amber-50 rounded-md px-4 py-3 text-[13px] text-amber-900 flex flex-col sm:flex-row sm:items-center gap-3 justify-between" role="status">
            <div className="flex items-start gap-2">
                <Archive size={16} className="mt-0.5 shrink-0" />
                <div>
                    <p className="font-bold">Legacy loans are read-only</p>
                    <p>New loans and disbursements are made in the lending platform. Repayments and payoff of existing legacy loans continue here; running loans can be moved across with a loan-book migration.</p>
                </div>
            </div>
            <div className="flex gap-2 shrink-0">
                <Link href={`/${locale}/lending/applications`} className="inline-flex items-center gap-1 rounded bg-[#635BFF] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#5D55EF]">
                    New application <ArrowRight size={12} />
                </Link>
                <Link href={`/${locale}/lending/migration`} className="inline-flex items-center gap-1 rounded border border-amber-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-amber-900 hover:bg-amber-100">
                    Migrate loans
                </Link>
            </div>
        </div>
    );
}
