"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Loader2, MailCheck } from 'lucide-react';
import api from '@/lib/api';

export default function ForgotPasswordPage() {
    const t = useTranslations('Auth');
    const { locale } = useParams();
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [sent, setSent] = useState(false);

    const inputClass = "w-full h-10 px-3 bg-secondary border border-border rounded text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors";

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await api.post('/auth/forgot-password', { email });
        } catch {
            // Response is intentionally generic; ignore errors (e.g. throttling).
        } finally {
            setLoading(false);
            setSent(true);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-background">
            <div className="w-full max-w-[360px] px-4">
                <h1 className="text-xl font-bold text-foreground mb-1">{t('forgotTitle')}</h1>
                <p className="text-[13px] text-muted-foreground mb-6">{t('forgotDesc')}</p>

                {sent ? (
                    <div className="rounded-lg border border-border bg-secondary p-5 text-center">
                        <MailCheck className="mx-auto mb-2 text-primary" size={28} />
                        <p className="text-[13px] text-foreground font-medium">{t('sentTitle')}</p>
                        <p className="text-[12px] text-muted-foreground mt-1">{t('sentDesc')}</p>
                        <Link href={`/${locale}/login`} className="inline-block mt-4 text-[13px] text-primary hover:underline">{t('backToSignIn')}</Link>
                    </div>
                ) : (
                    <form onSubmit={submit} className="space-y-4">
                        <div>
                            <label className="text-[12px] font-semibold text-muted-foreground mb-1.5 block">{t('email')}</label>
                            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder={t('emailPlaceholder')} className={inputClass} />
                        </div>
                        <button type="submit" disabled={loading} className="w-full h-10 bg-primary text-primary-foreground rounded text-[13px] font-semibold hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
                            {loading ? <Loader2 className="animate-spin" size={16} /> : null} {t('sendResetLink')}
                        </button>
                        <div className="text-center">
                            <Link href={`/${locale}/login`} className="text-[13px] text-muted-foreground hover:text-foreground">{t('backToSignIn')}</Link>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
