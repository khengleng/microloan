"use client";

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Download, FileText, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

/* Borrower portal (D-123): the key facts statement of an approved loan, accepted before the contract. */

interface PortalStatement {
    id: string; version: number; status: 'ISSUED' | 'ACCEPTED'; termsHash: string; applicationReference: string;
    documentIds: Record<string, string>; issuedOn: string; acceptedAt: string | null;
    facts: {
        currency: string; principal: string;
        rates: { nominalAnnualRatePct: string | null; effectiveAnnualRatePct: string | null };
        totals: { costOfCredit: string | null; repayable: string | null };
    };
    coolingOff: { days: number };
}

async function call<T>(path: string, body?: unknown, fallback?: (status: number) => string): Promise<T> {
    const res = await fetch(`/api/proxy${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
        const m = data?.message;
        throw new Error(typeof m === 'string' ? m : typeof m?.message === 'string' ? m.message : fallback ? fallback(res.status) : `Something went wrong (${res.status}).`);
    }
    return data as T;
}

export function PortalKeyFactsSection() {
    const t = useTranslations('LendingPortal.keyFacts');
    const [items, setItems] = useState<PortalStatement[] | null>(null);
    const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');

    const load = useCallback(() => {
        call<PortalStatement[]>('/lending/portal/key-facts').then(setItems).catch(() => setItems([]));
    }, []);
    useEffect(() => { load(); }, [load]);

    const accept = async (s: PortalStatement) => {
        setBusy(s.id);
        setError('');
        try {
            await call(`/lending/portal/key-facts/${s.id}/accept`, { termsHash: s.termsHash }, (status) => t('somethingWrong', { status }));
            load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy('');
        }
    };

    if (!items || items.length === 0) return null;
    return (
        <section className="bg-white border border-border rounded-md p-4 space-y-3">
            <h2 className="text-sm font-bold text-foreground flex items-center gap-2"><FileText size={15} /> {t('title')}</h2>
            <p className="text-xs text-muted-foreground">{t('intro')}</p>
            {items.map((s) => (
                <div key={s.id} className="border border-border rounded p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold">{t('statement', { reference: s.applicationReference, version: s.version })}</p>
                        {s.status === 'ACCEPTED' && <span className="text-xs font-semibold text-emerald-700 flex items-center gap-1"><CheckCircle2 size={13} /> {t('accepted')}</span>}
                    </div>
                    <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        <div><dt className="text-muted-foreground">{t('principal')}</dt><dd className="font-semibold">{s.facts.principal} {s.facts.currency}</dd></div>
                        <div><dt className="text-muted-foreground">{t('effective')}</dt><dd className="font-semibold">{s.facts.rates.effectiveAnnualRatePct ? `${s.facts.rates.effectiveAnnualRatePct}%` : '—'}</dd></div>
                        <div><dt className="text-muted-foreground">{t('costOfCredit')}</dt><dd className="font-semibold">{s.facts.totals.costOfCredit ? `${s.facts.totals.costOfCredit} ${s.facts.currency}` : '—'}</dd></div>
                        <div><dt className="text-muted-foreground">{t('repayable')}</dt><dd className="font-semibold">{s.facts.totals.repayable ? `${s.facts.totals.repayable} ${s.facts.currency}` : '—'}</dd></div>
                    </dl>
                    <div className="flex flex-wrap gap-3">
                        {(['km', 'en'] as const).filter((l) => s.documentIds[l]).map((l) => (
                            <a key={l} href={`/api/proxy/borrower/my-documents/${s.documentIds[l]}/download`} className="text-xs font-semibold text-primary flex items-center gap-1"><Download size={13} /> {t(`read.${l}`)}</a>
                        ))}
                    </div>
                    {s.coolingOff.days > 0 && <p className="text-xs text-muted-foreground">{t('coolingOff', { days: s.coolingOff.days })}</p>}
                    {s.status === 'ISSUED' && (
                        <div className="space-y-2">
                            <label className="flex items-start gap-2 text-xs">
                                <input type="checkbox" checked={!!confirmed[s.id]} onChange={(e) => setConfirmed((c) => ({ ...c, [s.id]: e.target.checked }))} className="mt-0.5" />
                                <span>{t('confirm')}</span>
                            </label>
                            <button
                                type="button"
                                disabled={!confirmed[s.id] || busy === s.id}
                                onClick={() => accept(s)}
                                className="text-xs font-semibold px-3 py-1.5 rounded bg-primary text-white disabled:opacity-50 flex items-center gap-1"
                            >
                                {busy === s.id && <Loader2 size={13} className="animate-spin" />} {t('accept')}
                            </button>
                        </div>
                    )}
                </div>
            ))}
            {error && <p className="text-xs text-red-600">{error}</p>}
        </section>
    );
}
