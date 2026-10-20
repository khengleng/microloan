"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import api from '@/lib/api';
import { useAlertTitle, type OperationalAlert } from '@/components/lending/operations/OperationalAlertsCard';

interface PlatformAlerts {
    open: (OperationalAlert & { tenant: { id: string; name: string } | null })[];
    emailConfigured: boolean;
    recipients: number;
    checkIntervalMinutes: number;
}

const when = (iso: string) => new Date(iso).toLocaleString();

/**
 * Every open operational alert, the platform's and each organisation's
 * (D-150), on the platform operator's home. Says when alerts are not being
 * e-mailed (no ALERT_EMAIL_TO or no RESEND_API_KEY).
 */
export function PlatformOperationalAlerts() {
    const t = useTranslations('OpsAlerts');
    const title = useAlertTitle();
    const [data, setData] = useState<PlatformAlerts | null>(null);
    useEffect(() => {
        api.get<PlatformAlerts>('/platform/operational-alerts', { quiet: true }).then(
            (r) => setData(r.data),
            () => setData(null),
        );
    }, []);
    if (!data) return null;
    const notEmailed = !data.emailConfigured || data.recipients === 0;
    return (
        <section className="glass rounded-[2rem] premium-shadow p-6 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
                    {data.open.length ? <AlertTriangle size={16} className="text-rose-500" /> : <CheckCircle2 size={16} className="text-emerald-500" />}
                    {data.open.length ? t('platformTitle', { count: data.open.length }) : t('platformNone')}
                </h2>
                <span className="text-[11px] font-medium text-slate-400">{t('checkedEvery', { minutes: data.checkIntervalMinutes })}</span>
            </div>
            {notEmailed && (
                <p className="text-[12px] font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                    {!data.emailConfigured ? t('noProvider') : t('noRecipients')}
                </p>
            )}
            {data.open.length > 0 && (
                <ul className="divide-y divide-slate-100">
                    {data.open.map((a) => (
                        <li key={a.id} className="py-2.5 flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3">
                            <span className={`shrink-0 self-start text-[10px] font-black px-2 py-0.5 rounded-full ${a.severity === 'CRITICAL' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800'}`}>
                                {t(`severity.${a.severity}`)}
                            </span>
                            <div className="min-w-0 flex-1">
                                <p className="text-[13px] font-bold text-slate-900">
                                    {title(a.key)} · <span className="font-medium text-slate-600">{a.tenant?.name ?? t('platformScope')}</span>
                                </p>
                                <p className="text-[12px] text-slate-600 break-words">{a.summary}</p>
                                <p className="text-[11px] text-slate-400">{t('since', { at: when(a.openedAt) })}</p>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
