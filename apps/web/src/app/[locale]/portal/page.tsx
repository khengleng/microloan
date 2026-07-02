"use client";

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import {
    Loader2, LogOut, FileText, QrCode, ShieldCheck, ShieldAlert,
    ShieldQuestion, Upload, Wallet, CalendarClock,
} from 'lucide-react';
import { KeyFactsAgreement } from '@/components/KeyFactsAgreement';

type Me = { firstName: string; lastName: string; organization: string | null; kycStatus: string };
type Loan = {
    id: string; principal: number; status: string; currency: string;
    outstanding: number; nextDueDate: string | null; nextDueAmount: number | null;
};
type Qr = { label: string; bankName?: string; accountName?: string; accountNumber?: string; qrRendered?: string | null } | null;
type Kyc = { kycStatus: string; documents: { id: string; type: string; createdAt: string }[] };

async function pget(path: string) {
    const res = await fetch(`/api/proxy${path}`, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    if (res.status === 401) throw { unauth: true };
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
}

const KYC_DOC_TYPES = ['NATIONAL_ID_FRONT', 'NATIONAL_ID_BACK', 'SELFIE', 'PROOF_OF_ADDRESS'];

export default function BorrowerPortalPage() {
    const t = useTranslations('Portal');
    const { locale } = useParams();
    const router = useRouter();
    const [me, setMe] = useState<Me | null>(null);
    const [loans, setLoans] = useState<Loan[]>([]);
    const [qr, setQr] = useState<Qr>(null);
    const [kyc, setKyc] = useState<Kyc | null>(null);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState('');

    const toLogin = useCallback(() => router.push(`/${locale}/portal/login`), [router, locale]);

    const loadKyc = useCallback(() => { pget('/borrower/kyc').then(setKyc).catch(() => {}); }, []);

    useEffect(() => {
        Promise.all([
            pget('/borrower/me').then(setMe),
            pget('/borrower/loans').then(setLoans),
            pget('/borrower/payment-qr').then(setQr).catch(() => setQr(null)),
            pget('/borrower/kyc').then(setKyc).catch(() => {}),
        ])
            .catch((e) => { if (e?.unauth) toLogin(); })
            .finally(() => setLoading(false));
    }, [toLogin]);

    const logout = async () => {
        await fetch('/api/borrower/logout', { method: 'POST' });
        toLogin();
    };

    const uploadDoc = (type: string, file?: File) => {
        if (!file) return;
        if (file.size > 2_000_000) return;
        setUploading(type);
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                await fetch('/api/proxy/borrower/kyc/documents', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                    body: JSON.stringify({ type, content: String(reader.result || ''), mimeType: file.type }),
                });
                loadKyc();
            } finally { setUploading(''); }
        };
        reader.readAsDataURL(file);
    };

    if (loading) return (
        <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
            <Loader2 className="animate-spin mr-2" size={16} /> {t('loading')}
        </div>
    );

    const kycStatus = kyc?.kycStatus || me?.kycStatus || 'PENDING';
    const kycBadge = kycStatus === 'VERIFIED'
        ? { icon: <ShieldCheck size={15} />, cls: 'text-emerald-700 bg-emerald-50 border-emerald-100', label: t('kycVerified') }
        : kycStatus === 'REJECTED'
            ? { icon: <ShieldAlert size={15} />, cls: 'text-red-700 bg-red-50 border-red-100', label: t('kycRejected') }
            : { icon: <ShieldQuestion size={15} />, cls: 'text-amber-700 bg-amber-50 border-amber-100', label: t('kycPending') };

    return (
        <div className="min-h-screen bg-secondary">
            <header className="bg-white border-b border-border">
                <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
                    <div>
                        <p className="text-sm font-bold text-foreground">{me?.firstName} {me?.lastName}</p>
                        <p className="text-xs text-muted-foreground">{me?.organization}</p>
                    </div>
                    <button onClick={logout} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
                        <LogOut size={15} /> {t('logout')}
                    </button>
                </div>
            </header>

            <main className="max-w-3xl mx-auto px-4 py-5 space-y-5">
                {/* KYC status */}
                <div className={`flex items-center gap-2 text-sm font-medium border rounded-md px-4 py-2.5 ${kycBadge.cls}`}>
                    {kycBadge.icon} {kycBadge.label}
                </div>

                {/* Loans */}
                <section className="space-y-3">
                    <h2 className="text-sm font-bold text-foreground flex items-center gap-2"><Wallet size={15} /> {t('myLoans')}</h2>
                    {loans.length === 0 && <p className="text-sm text-muted-foreground">{t('noLoans')}</p>}
                    {loans.map(l => (
                        <div key={l.id} className="bg-white border border-border rounded-md p-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs text-muted-foreground">{t('principal')}</span>
                                <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600">{l.status}</span>
                            </div>
                            <p className="text-xl font-bold text-foreground">{l.currency} {l.principal.toLocaleString()}</p>
                            <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
                                <div>
                                    <p className="text-xs text-muted-foreground">{t('outstanding')}</p>
                                    <p className="font-semibold text-foreground">{l.currency} {l.outstanding.toLocaleString()}</p>
                                </div>
                                {l.nextDueDate && (
                                    <div>
                                        <p className="text-xs text-muted-foreground flex items-center gap-1"><CalendarClock size={12} /> {t('nextDue')}</p>
                                        <p className="font-semibold text-foreground">
                                            {l.currency} {(l.nextDueAmount ?? 0).toLocaleString()} · {new Date(l.nextDueDate).toLocaleDateString()}
                                        </p>
                                    </div>
                                )}
                            </div>
                            <a href={`/api/proxy/borrower/loans/${l.id}/statement`} target="_blank" rel="noopener"
                                className="inline-flex items-center gap-1.5 mt-3 text-sm font-medium text-primary hover:underline">
                                <FileText size={14} /> {t('downloadStatement')}
                            </a>
                            <div className="mt-3">
                                <KeyFactsAgreement
                                    keyFactsPath={`/borrower/loans/${l.id}/key-facts`}
                                    signPath={`/borrower/loans/${l.id}/sign`}
                                />
                            </div>
                        </div>
                    ))}
                </section>

                {/* Payment QR */}
                {qr?.qrRendered && (
                    <section className="bg-white border border-border rounded-md p-4">
                        <h2 className="text-sm font-bold text-foreground flex items-center gap-2 mb-3"><QrCode size={15} /> {t('payViaQr')}</h2>
                        <div className="flex flex-col items-center gap-2">
                            <img src={qr.qrRendered} alt="QR" className="w-48 h-48 rounded border border-border bg-white object-contain" />
                            <p className="text-sm font-semibold text-foreground">{qr.label}</p>
                            <p className="text-xs text-muted-foreground">{[qr.bankName, qr.accountName, qr.accountNumber].filter(Boolean).join(' · ')}</p>
                            <p className="text-[11px] text-muted-foreground">{t('qrHint')}</p>
                        </div>
                    </section>
                )}

                {/* KYC upload */}
                {kycStatus !== 'VERIFIED' && (
                    <section className="bg-white border border-border rounded-md p-4">
                        <h2 className="text-sm font-bold text-foreground flex items-center gap-2 mb-1"><Upload size={15} /> {t('uploadKyc')}</h2>
                        <p className="text-xs text-muted-foreground mb-3">{t('uploadKycHint')}</p>
                        <div className="grid grid-cols-2 gap-3">
                            {KYC_DOC_TYPES.map(type => {
                                const has = kyc?.documents.some(d => d.type === type);
                                return (
                                    <label key={type} className="flex flex-col items-center justify-center gap-1 p-3 border border-dashed border-border rounded-lg cursor-pointer hover:bg-slate-50 text-center">
                                        {uploading === type ? <Loader2 size={16} className="animate-spin text-primary" /> : has ? <ShieldCheck size={16} className="text-emerald-500" /> : <Upload size={16} className="text-muted-foreground" />}
                                        <span className="text-[11px] text-muted-foreground">{t(`doc_${type}` as any)}</span>
                                        <input type="file" accept="image/*" className="hidden" onChange={e => uploadDoc(type, e.target.files?.[0])} />
                                    </label>
                                );
                            })}
                        </div>
                    </section>
                )}
            </main>
        </div>
    );
}
