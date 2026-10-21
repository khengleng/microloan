"use client";

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Gauge, CreditCard } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';

type Resource = 'users' | 'borrowers' | 'loanProducts' | 'loans';
interface TenantUsage {
    tenantId: string;
    name: string;
    status: string;
    plan: string;
    displayName: string;
    overLimit: boolean;
    items: { resource: Resource; used: number; limit: number | null }[];
}
interface WebhookEvent { id: string; type: string; tenantRef: string | null; detail: string; receivedAt: string }

const ORDER: Resource[] = ['loans', 'loanProducts', 'users', 'borrowers'];

/**
 * The platform operator's view of every organisation's use of its plan's
 * quotas (D-167): one row per organisation, red where it is over a limit
 * (after a downgrade — nothing is removed, only creating more is refused).
 */
export function PlatformPlanUsage() {
    const t = useTranslations('Tenants');
    const [rows, setRows] = useState<TenantUsage[] | null>(null);
    useEffect(() => {
        api.get<TenantUsage[]>('/tenants/plan-usage/list', { quiet: true }).then((r) => setRows(r.data), () => setRows(null));
    }, []);
    if (!rows) return null;
    return (
        <section className="glass rounded-[2rem] premium-shadow p-6 space-y-3">
            <div>
                <h2 className="text-sm font-black text-slate-900 flex items-center gap-2"><Gauge size={16} className="text-indigo-500" />{t('usageTitle')}</h2>
                <p className="text-[12px] text-slate-500 mt-1">{t('usageSubtitle')}</p>
            </div>
            {!rows.length ? <p className="text-[12px] text-slate-500">{t('usageEmpty')}</p> : (
                <div className="overflow-x-auto">
                    <table className="w-full text-[12px]">
                        <thead>
                            <tr className="text-left text-slate-500">
                                <th className="py-1.5 pr-3 font-semibold">{t('usageOrg')}</th>
                                <th className="py-1.5 pr-3 font-semibold">{t('usagePlan')}</th>
                                {ORDER.map((r) => <th key={r} className="py-1.5 pr-3 font-semibold text-right">{t(`usageResources.${r}`)}</th>)}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {rows.map((row) => (
                                <tr key={row.tenantId} className={row.overLimit ? 'bg-rose-50' : ''}>
                                    <td className="py-1.5 pr-3 font-medium text-slate-800">{row.name}</td>
                                    <td className="py-1.5 pr-3 text-slate-600">{row.displayName}</td>
                                    {ORDER.map((r) => {
                                        const i = row.items.find((x) => x.resource === r);
                                        const over = !!i && i.limit !== null && i.used > i.limit;
                                        return (
                                            <td key={r} className={`py-1.5 pr-3 text-right tabular-nums ${over ? 'text-rose-600 font-bold' : 'text-slate-700'}`}>
                                                {i ? `${i.used.toLocaleString()} / ${i.limit === null ? '∞' : i.limit.toLocaleString()}` : '—'}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}

/**
 * Stripe deliveries the platform did not apply on its own (D-166): a payment
 * for a suspended or erasure-pending organisation, an unknown plan or
 * customer. Shown only while one waits; each stays an operational alert
 * until marked reviewed.
 */
export function StripeEventsToReview() {
    const t = useTranslations('Tenants');
    const { showToast } = useToast();
    const [rows, setRows] = useState<WebhookEvent[]>([]);
    const [busy, setBusy] = useState<string | null>(null);
    const load = useCallback(() => {
        api.get<WebhookEvent[]>('/billing/webhook-events', { quiet: true }).then((r) => setRows(r.data), () => setRows([]));
    }, []);
    useEffect(() => { load(); }, [load]);
    if (!rows.length) return null;
    const review = async (id: string) => {
        setBusy(id);
        try {
            await api.post(`/billing/webhook-events/${id}/review`);
            showToast(t('webhookDone'), 'success');
            load();
        } catch {
            // The API's own message is already shown.
        } finally {
            setBusy(null);
        }
    };
    return (
        <section className="glass rounded-[2rem] premium-shadow p-6 space-y-3 border border-amber-200">
            <div>
                <h2 className="text-sm font-black text-slate-900 flex items-center gap-2"><CreditCard size={16} className="text-amber-500" />{t('webhookTitle')}</h2>
                <p className="text-[12px] text-slate-500 mt-1">{t('webhookSubtitle')}</p>
            </div>
            <ul className="divide-y divide-slate-100">
                {rows.map((e) => (
                    <li key={e.id} className="py-2 flex flex-wrap items-start justify-between gap-3 text-[12px]">
                        <div className="min-w-0">
                            <p className="font-mono text-[11px] text-slate-500">{e.id} · {e.type}</p>
                            <p className="text-slate-800 mt-0.5">{e.detail}</p>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                                {t('webhookReceived')}: {new Date(e.receivedAt).toLocaleString()}
                                {e.tenantRef ? ` · ${t('webhookOrg')}: ${e.tenantRef}` : ''}
                            </p>
                        </div>
                        <button
                            onClick={() => void review(e.id)}
                            disabled={busy === e.id}
                            className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50"
                        >
                            {t('webhookReviewed')}
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}
