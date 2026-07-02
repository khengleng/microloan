"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, Phone, KeyRound, ShieldCheck } from 'lucide-react';

const inputCls = "w-full h-11 px-3 bg-white border border-border rounded text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors";

export default function BorrowerLoginPage() {
    const t = useTranslations('Portal');
    const { locale } = useParams();
    const router = useRouter();
    const [step, setStep] = useState<'phone' | 'code'>('phone');
    const [phone, setPhone] = useState('');
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const requestOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(''); setLoading(true);
        try {
            const res = await fetch('/api/borrower/otp-request', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone }),
            });
            if (!res.ok) throw new Error();
            setStep('code');
        } catch { setError(t('requestFailed')); }
        finally { setLoading(false); }
    };

    const verifyOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(''); setLoading(true);
        try {
            const res = await fetch('/api/borrower/otp-verify', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, code }),
            });
            if (!res.ok) throw new Error();
            router.push(`/${locale}/portal`);
        } catch { setError(t('invalidCode')); }
        finally { setLoading(false); }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-secondary px-4">
            <div className="w-full max-w-sm bg-white border border-border rounded-lg shadow-sm p-6">
                <div className="flex flex-col items-center text-center mb-6">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                        <ShieldCheck className="text-primary" size={22} />
                    </div>
                    <h1 className="text-lg font-bold text-foreground">{t('loginTitle')}</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        {step === 'phone' ? t('loginSubtitle') : t('codeSubtitle', { phone })}
                    </p>
                </div>

                {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded px-3 py-2 mb-4">{error}</p>}

                {step === 'phone' ? (
                    <form onSubmit={requestOtp} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-foreground mb-1">{t('phone')}</label>
                            <div className="relative">
                                <Phone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <input type="tel" required autoFocus className={`${inputCls} pl-9`} placeholder="012 345 678"
                                    value={phone} onChange={e => setPhone(e.target.value)} />
                            </div>
                        </div>
                        <button type="submit" disabled={loading || !phone.trim()} className="btn-primary w-full justify-center h-11">
                            {loading && <Loader2 size={15} className="animate-spin" />} {t('sendCode')}
                        </button>
                    </form>
                ) : (
                    <form onSubmit={verifyOtp} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-foreground mb-1">{t('code')}</label>
                            <div className="relative">
                                <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                <input inputMode="numeric" pattern="[0-9]*" maxLength={6} required autoFocus
                                    className={`${inputCls} pl-9 tracking-[0.5em] font-mono`} placeholder="000000"
                                    value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
                            </div>
                        </div>
                        <button type="submit" disabled={loading || code.length !== 6} className="btn-primary w-full justify-center h-11">
                            {loading && <Loader2 size={15} className="animate-spin" />} {t('verify')}
                        </button>
                        <button type="button" onClick={() => { setStep('phone'); setCode(''); setError(''); }}
                            className="w-full text-sm text-muted-foreground hover:text-foreground">
                            {t('changePhone')}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
