"use client";

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import { CreditCard, Loader2, ShieldCheck, Zap } from 'lucide-react';
import api from '@/lib/api';

/**
 * Plan changes for the tenant admin.
 *
 * This block previously offered a Stripe checkout that is not configured on
 * this deployment, so it rendered "online billing coming soon" permanently —
 * while the KHQR gate worked fine at signup. An admin who wanted to upgrade had
 * no route at all.
 *
 * It talks to /billing/plan-change, which reuses the signup payment machinery:
 * the same PlanPayment row, the same minted KHQR, the same SUPERADMIN
 * confirmation. The workspace stays ACTIVE throughout — upgrading must not take
 * away a system the customer is already using.
 */

type Tier = {
    name: string;
    displayName: string;
    description?: string | null;
    amount: number;
    currency: string;
    limits: { maxUsers: number | null; maxBorrowers: number | null };
};

type Pending = {
    reference: string;
    plan: string;
    amount: string;
    currency: string;
    expiresAt: string;
    qrImage: string;
};

type Options = {
    currentPlan: string;
    khqrConfigured: boolean;
    options: Tier[];
    pending: Pending | null;
};

export function PlanChangeCard() {
    const t = useTranslations('Settings');
    const [data, setData] = useState<Options | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const load = useCallback(async () => {
        const res = await api.get<Options>('/billing/plan-change');
        setData(res.data);
    }, []);

    useEffect(() => {
        void load().catch(() => setData(null));
    }, [load]);

    const choose = async (plan: string) => {
        setBusy(true);
        setError('');
        try {
            await api.post('/billing/plan-change', { plan });
            await load();
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { message?: string } } })
                ?.response?.data?.message;
            setError(msg || t('planChangeError'));
        } finally {
            setBusy(false);
        }
    };

    const cancel = async () => {
        setBusy(true);
        try {
            await api.delete('/billing/plan-change');
            await load();
        } finally {
            setBusy(false);
        }
    };

    const quota = (n: number | null) => (n === null ? '∞' : n.toLocaleString());

    return (
        <div className="bg-primary text-primary-foreground border border-primary rounded-md">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-white/20">
                <CreditCard size={16} />
                <div>
                    <h3 className="text-sm font-bold">{t('subscription')}</h3>
                    <p className="text-xs text-primary-foreground/70">{t('subscriptionDesc')}</p>
                </div>
            </div>

            <div className="px-5 py-4">
                <p className="text-xs text-primary-foreground/60 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                    <Zap size={12} /> {t('currentPlan')}
                </p>
                <p className="text-2xl font-bold">{data?.currentPlan ?? '—'}</p>
            </div>

            {/* ── A payment is already in flight ─────────────────────────── */}
            {data?.pending ? (
                <div className="px-5 pb-5">
                    <div className="rounded-lg bg-white/10 border border-white/20 p-4">
                        <div className="flex flex-col sm:flex-row gap-4">
                            <Image
                                src={data.pending.qrImage}
                                alt=""
                                width={132}
                                height={132}
                                unoptimized
                                className="rounded bg-white p-1.5 shrink-0 self-start"
                            />
                            <div className="min-w-0 text-[12px]">
                                <p className="font-bold text-[14px]">{data.pending.plan}</p>
                                <p className="text-primary-foreground/80 mt-0.5">
                                    {t('amountDue')}: {data.pending.currency} {data.pending.amount}
                                </p>
                                <p className="text-primary-foreground/60 mt-1.5">{t('scanToPay')}</p>
                                <p className="text-primary-foreground/80 mt-2">
                                    {t('reference')}:{' '}
                                    <code className="font-mono">{data.pending.reference}</code>
                                </p>
                                <p className="text-primary-foreground/60 mt-0.5">
                                    {t('expires')}: {new Date(data.pending.expiresAt).toLocaleString()}
                                </p>
                            </div>
                        </div>
                        <p className="mt-3 flex items-start gap-1.5 text-[11px] text-primary-foreground/70">
                            <ShieldCheck size={12} className="mt-0.5 shrink-0" />
                            {t('awaitingConfirmation')}
                        </p>
                        <button
                            onClick={() => void cancel()}
                            disabled={busy}
                            className="mt-3 text-[11px] font-medium text-white/70 underline underline-offset-2 hover:text-white disabled:opacity-50"
                        >
                            {t('cancelRequest')}
                        </button>
                    </div>
                </div>
            ) : (
                /* ── Choose a plan ──────────────────────────────────────── */
                <div className="px-5 pb-5">
                    {data && !data.khqrConfigured ? (
                        <p className="flex items-start gap-1.5 text-[12px] text-primary-foreground/70">
                            <ShieldCheck size={12} className="mt-0.5 shrink-0" />
                            {t('planChangeUnavailable')}
                        </p>
                    ) : (
                        <>
                            <p className="text-[12px] text-primary-foreground/70 mb-3">
                                {t('planChangeLead')}
                            </p>
                            <div className="grid gap-2 sm:grid-cols-2">
                                {(data?.options ?? []).map(o => (
                                    <div
                                        key={o.name}
                                        className="flex items-center justify-between gap-3 rounded-lg bg-white/10 border border-white/20 px-3 py-2.5"
                                    >
                                        <div className="min-w-0">
                                            <p className="text-[13px] font-semibold truncate">
                                                {o.displayName}
                                            </p>
                                            <p className="text-[11px] text-primary-foreground/70">
                                                {quota(o.limits.maxUsers)} / {quota(o.limits.maxBorrowers)}
                                                {' · '}
                                                {o.currency} {o.amount}
                                            </p>
                                        </div>
                                        <button
                                            onClick={() => void choose(o.name)}
                                            disabled={busy}
                                            className="shrink-0 rounded bg-white px-3 py-1.5 text-[12px] font-bold text-primary transition-opacity hover:opacity-90 disabled:opacity-50"
                                        >
                                            {busy ? <Loader2 size={12} className="animate-spin" /> : t('choosePlan')}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}

                    {error && (
                        <p className="mt-3 rounded border border-white/30 bg-white/10 px-3 py-2 text-[12px]">
                            {error}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
