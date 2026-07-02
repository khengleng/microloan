"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, CheckCircle2 } from 'lucide-react';
import api from '@/lib/api';

export default function ResetPasswordPage() {
    const t = useTranslations('Auth');
    const { locale } = useParams();
    const router = useRouter();
    const [token, setToken] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);

    // Read the token from the URL client-side (avoids useSearchParams Suspense).
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        setToken(params.get('token') || '');
    }, []);

    const inputClass = "w-full h-10 px-3 bg-secondary border border-border rounded text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors";

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (password.length < 12) { setError(t('passwordTooShort')); return; }
        if (password !== confirm) { setError(t('passwordsNoMatch')); return; }
        setLoading(true);
        try {
            await api.post('/auth/reset-password', { token, newPassword: password });
            setDone(true);
            setTimeout(() => router.push(`/${locale}/login`), 2500);
        } catch (err: any) {
            setError(err?.response?.data?.message || t('invalidLink'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-background">
            <div className="w-full max-w-[360px] px-4">
                <h1 className="text-xl font-bold text-foreground mb-1">{t('resetTitle')}</h1>
                <p className="text-[13px] text-muted-foreground mb-6">{t('resetDesc')}</p>

                {done ? (
                    <div className="rounded-lg border border-border bg-secondary p-5 text-center">
                        <CheckCircle2 className="mx-auto mb-2 text-green-500" size={28} />
                        <p className="text-[13px] text-foreground font-medium">{t('resetDone')}</p>
                    </div>
                ) : !token ? (
                    <div className="rounded-lg border border-border bg-secondary p-5 text-center">
                        <p className="text-[13px] text-foreground">{t('missingToken')}</p>
                        <Link href={`/${locale}/forgot-password`} className="inline-block mt-3 text-[13px] text-primary hover:underline">{t('requestResetLink')}</Link>
                    </div>
                ) : (
                    <form onSubmit={submit} className="space-y-4">
                        {error && <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</div>}
                        <div>
                            <label className="text-[12px] font-semibold text-muted-foreground mb-1.5 block">{t('newPassword')}</label>
                            <input type="password" required value={password} onChange={e => setPassword(e.target.value)} className={inputClass} />
                        </div>
                        <div>
                            <label className="text-[12px] font-semibold text-muted-foreground mb-1.5 block">{t('confirmPassword')}</label>
                            <input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)} className={inputClass} />
                        </div>
                        <button type="submit" disabled={loading} className="w-full h-10 bg-primary text-primary-foreground rounded text-[13px] font-semibold hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
                            {loading ? <Loader2 className="animate-spin" size={16} /> : null} {t('updatePassword')}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
