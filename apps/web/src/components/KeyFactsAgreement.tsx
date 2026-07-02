"use client";

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileSignature, Loader2, ShieldCheck, ScrollText } from 'lucide-react';
import { SignaturePad } from './SignaturePad';

type Kf = {
    currency: string; principal: number; netDisbursed: number;
    nominalAnnualRate: number; effectiveAnnualRate: number;
    totalInterest: number; totalFees: number; totalRepayable: number;
    totalCostOfCredit: number; installmentCount: number;
    averageInstallment: number; firstInstallment: number;
};
type Data = {
    organization: string | null; borrowerName: string; productName: string | null;
    penaltyPerDay: number; keyFacts: Kf; signed: boolean; signedAt: string | null; agreementHash: string | null;
};

async function pfetch(path: string, init?: RequestInit) {
    const res = await fetch(`/api/proxy${path}`, {
        ...init,
        headers: { 'X-Requested-With': 'XMLHttpRequest', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
}

/** Key Facts Statement + e-signature. `keyFactsPath`/`signPath` are relative to
 *  /api/proxy and differ for staff vs borrower callers. */
export function KeyFactsAgreement({ keyFactsPath, signPath }: { keyFactsPath: string; signPath: string }) {
    const t = useTranslations('Agreement');
    const [data, setData] = useState<Data | null>(null);
    const [loading, setLoading] = useState(true);
    const [name, setName] = useState('');
    const [drawn, setDrawn] = useState('');
    const [accepted, setAccepted] = useState(false);
    const [signing, setSigning] = useState(false);
    const [error, setError] = useState('');

    const load = useCallback(() => {
        setLoading(true);
        pfetch(keyFactsPath).then(setData).catch(() => setError(t('loadFailed'))).finally(() => setLoading(false));
    }, [keyFactsPath, t]);
    useEffect(load, [load]);

    const sign = async () => {
        setError('');
        if (!accepted) { setError(t('mustAccept')); return; }
        if (!name.trim() && !drawn) { setError(t('needSignature')); return; }
        setSigning(true);
        try {
            await pfetch(signPath, { method: 'POST', body: JSON.stringify({ acceptTerms: accepted, signatureName: name.trim() || undefined, signatureImage: drawn || undefined }) });
            load();
        } catch { setError(t('signFailed')); }
        finally { setSigning(false); }
    };

    if (loading) return (
        <div className="bg-white border border-border rounded-md p-4 flex items-center text-sm text-muted-foreground">
            <Loader2 className="animate-spin mr-2" size={15} /> {t('loading')}
        </div>
    );
    if (!data) return null;

    const kf = data.keyFacts;
    const money = (n: number) => `${kf.currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
        <div className="flex justify-between items-center py-1.5 border-b border-border/60 last:border-0">
            <span className="text-xs text-muted-foreground">{label}</span>
            <span className={strong ? 'text-sm font-bold text-foreground' : 'text-sm text-foreground'}>{value}</span>
        </div>
    );

    return (
        <div className="bg-white border border-border rounded-md">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                <ScrollText size={15} className="text-primary" />
                <h3 className="text-sm font-bold text-foreground">{t('title')}</h3>
            </div>

            <div className="px-4 py-3">
                <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 mb-3 flex items-center justify-between">
                    <span className="text-xs font-medium text-amber-800">{t('eir')}</span>
                    <span className="text-lg font-black text-amber-800">{kf.effectiveAnnualRate}%</span>
                </div>
                <Row label={t('principal')} value={money(kf.principal)} />
                <Row label={t('netDisbursed')} value={money(kf.netDisbursed)} />
                <Row label={t('nominalRate')} value={`${kf.nominalAnnualRate}%`} />
                <Row label={t('totalInterest')} value={money(kf.totalInterest)} />
                <Row label={t('totalFees')} value={money(kf.totalFees)} />
                <Row label={t('totalCost')} value={money(kf.totalCostOfCredit)} strong />
                <Row label={t('totalRepayable')} value={money(kf.totalRepayable)} strong />
                <Row label={t('installments')} value={`${kf.installmentCount} × ~${money(kf.averageInstallment)}`} />
                <Row label={t('penaltyPerDay')} value={money(data.penaltyPerDay)} />
            </div>

            {data.signed ? (
                <div className="mx-4 mb-4 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-3">
                    <p className="text-sm font-semibold text-emerald-800 flex items-center gap-1.5">
                        <ShieldCheck size={15} /> {t('signedOn', { date: data.signedAt ? new Date(data.signedAt).toLocaleString() : '' })}
                    </p>
                    <p className="text-[10px] font-mono text-emerald-700/70 mt-1 break-all">#{data.agreementHash}</p>
                </div>
            ) : (
                <div className="mx-4 mb-4 space-y-3 pt-1">
                    {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded px-3 py-2">{error}</p>}
                    <div>
                        <label className="block text-sm font-medium text-foreground mb-1">{t('typedName')}</label>
                        <input className="w-full h-9 px-3 border border-border rounded text-sm" placeholder={t('typedNamePlaceholder')}
                            value={name} onChange={e => setName(e.target.value)} />
                    </div>
                    <SignaturePad label={t('drawSignature')} onChange={setDrawn} />
                    <label className="flex items-start gap-2 text-sm text-foreground">
                        <input type="checkbox" className="mt-0.5" checked={accepted} onChange={e => setAccepted(e.target.checked)} />
                        <span>{t('acceptTerms')}</span>
                    </label>
                    <button onClick={sign} disabled={signing} className="btn-primary w-full justify-center">
                        {signing ? <Loader2 size={15} className="animate-spin" /> : <FileSignature size={15} />} {t('sign')}
                    </button>
                </div>
            )}
        </div>
    );
}
