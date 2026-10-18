"use client";

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, LogOut, ShieldAlert, ShieldCheck, UserCircle } from 'lucide-react';
import api, { signOut } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useWorkspace } from '@/lib/workspace';
import { MfaSetup } from '@/components/auth/mfa-setup';
import { useToast } from '@/components/ui/toast';

/**
 * My account — the signed-in person's own sign-in details and security.
 * Open to every staff member (unlike Settings, which is admin-only).
 */
export default function AccountPage() {
    const t = useTranslations('Account');
    const { locale } = useParams();
    const { user, loading } = useAuth();
    const ws = useWorkspace();
    const { showToast } = useToast();
    const [revoking, setRevoking] = useState(false);

    if (loading) {
        return (
            <div className="flex h-64 items-center justify-center text-muted-foreground">
                <Loader2 className="animate-spin" size={18} />
            </div>
        );
    }

    // /auth/me returns the verified token claims, including how this session signed in.
    const amr = (user as { amr?: string } | null)?.amr;
    const mfaSession = amr === 'mfa';
    const roleLabel = ws.access?.roles.length ? ws.access.roles.map((r) => r.name).join(', ') : user?.role;
    const organization = user?.isPlatform ? t('platformScope') : user?.tenantName;

    const signOutEverywhere = async () => {
        if (!window.confirm(t('signOutEverywhereConfirm'))) return;
        setRevoking(true);
        try {
            await api.post('/auth/sessions/revoke-all');
            await signOut(String(locale));
        } catch {
            showToast(t('signOutEverywhereFailed'), 'error');
            setRevoking(false);
        }
    };

    const row = (label: string, value: React.ReactNode) => (
        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 py-2.5 border-b border-border last:border-0">
            <dt className="sm:w-40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
            <dd className="text-sm text-foreground break-all">{value}</dd>
        </div>
    );

    return (
        <div className="max-w-4xl space-y-6">
            <div>
                <h1 className="text-xl font-bold text-foreground">{t('title')}</h1>
                <p className="text-sm text-muted-foreground mt-0.5">{t('subtitle')}</p>
            </div>

            <div className="grid lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-5">
                    <section className="bg-white border border-border rounded-md">
                        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
                            <UserCircle size={16} className="text-primary" />
                            <h2 className="text-sm font-bold text-foreground">{t('profile')}</h2>
                        </div>
                        <dl className="px-5 py-2">
                            {row(t('email'), user?.email)}
                            {row(t('role'), roleLabel)}
                            {row(t('organization'), organization)}
                            {row(t('session'), (
                                <span className={`inline-flex items-center gap-1.5 ${mfaSession ? 'text-emerald-700' : 'text-amber-800'}`}>
                                    {mfaSession ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
                                    {mfaSession ? t('sessionMfa') : t('sessionPassword')}
                                </span>
                            ))}
                        </dl>
                        {!mfaSession && ws.access?.assurance.mfaEnrolled && (
                            <div className="mx-5 mb-4 flex flex-col sm:flex-row sm:items-center gap-3 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                                <p className="flex-1">{t('signInAgainHint')}</p>
                                <button
                                    type="button"
                                    onClick={() => void signOut(String(locale))}
                                    className="font-bold underline whitespace-nowrap text-left"
                                >
                                    {t('signInAgain')}
                                </button>
                            </div>
                        )}
                    </section>

                    <section className="bg-white border border-border rounded-md">
                        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
                            <LogOut size={16} className="text-primary" />
                            <h2 className="text-sm font-bold text-foreground">{t('sessionsTitle')}</h2>
                        </div>
                        <div className="px-5 py-4 space-y-3">
                            <p className="text-sm text-muted-foreground">{t('sessionsDesc')}</p>
                            <button
                                type="button"
                                onClick={signOutEverywhere}
                                disabled={revoking}
                                className="inline-flex items-center gap-2 h-9 px-4 rounded border border-border text-sm font-semibold text-foreground hover:bg-slate-50 disabled:opacity-60"
                            >
                                {revoking ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
                                {t('signOutEverywhere')}
                            </button>
                        </div>
                    </section>
                </div>

                <div className="space-y-5">
                    <MfaSetup />
                </div>
            </div>
        </div>
    );
}
