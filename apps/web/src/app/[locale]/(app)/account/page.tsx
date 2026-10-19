"use client";

import { useState } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { KeyRound, Loader2, LogOut, ShieldAlert, ShieldCheck, UserCircle } from 'lucide-react';
import api, { signOut } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useWorkspace } from '@/lib/workspace';
import { MfaSetup } from '@/components/auth/mfa-setup';
import { useToast } from '@/components/ui/toast';
import { requestStepUp } from '@/lib/step-up';

/**
 * My account — the signed-in person's own sign-in details and security.
 * Open to every staff member (unlike Settings, which is admin-only).
 */
export default function AccountPage() {
    const t = useTranslations('Account');
    const te = useTranslations('Security.enrolment');
    const { locale } = useParams();
    const pathname = usePathname();
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
    const mfaSession = user?.amr === 'mfa';
    // The role must use an authenticator and has none yet.
    const mustEnrol = !!user?.mfaEnrolmentRequired && !user?.mfaEnrolled;
    // Enrolled, but this session signed in before (or without) a code.
    const enrolled = !!user?.mfaEnrolled || !!ws.access?.assurance.mfaEnrolled;
    const canStepUpHere = enrolled && !mfaSession;
    const stepUp = async () => {
        // A fresh MFA session: reload so the shell and permissions see it.
        if (await requestStepUp()) window.location.replace(pathname || `/${locale}/account`);
    };
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

            {mustEnrol && (
                <div role="alert" className="flex gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                    <ShieldAlert size={18} className="flex-shrink-0 mt-0.5 text-amber-600" />
                    <div className="space-y-1">
                        <p className="font-bold">{te('requiredTitle')}</p>
                        <p>{user?.isPlatform ? te('requiredPlatform') : te('requiredTenant')}</p>
                        <p>{te('requiredNext')}</p>
                    </div>
                </div>
            )}
            {canStepUpHere && user?.mfaEnrolmentRequired && (
                <div role="alert" className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                    <ShieldAlert size={18} className="flex-shrink-0 text-amber-600" />
                    <div className="flex-1 space-y-1">
                        <p className="font-bold">{te('stepUpTitle')}</p>
                        <p>{te('stepUpBody')}</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => void stepUp()}
                        className="inline-flex items-center gap-2 h-9 px-4 rounded bg-primary text-sm font-semibold text-white hover:bg-primary/90 whitespace-nowrap"
                    >
                        <KeyRound size={14} />
                        {te('stepUpButton')}
                    </button>
                </div>
            )}

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
                        {canStepUpHere && !user?.mfaEnrolmentRequired && (
                            <div className="mx-5 mb-4 flex flex-col sm:flex-row sm:items-center gap-3 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                                <p className="flex-1">{t('signInAgainHint')}</p>
                                <button
                                    type="button"
                                    onClick={() => void stepUp()}
                                    className="font-bold underline whitespace-nowrap text-left"
                                >
                                    {te('stepUpButton')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => void signOut(String(locale))}
                                    className="underline whitespace-nowrap text-left"
                                >
                                    {t('signInAgain')}
                                </button>
                            </div>
                        )}
                    </section>

                    <ChangePassword />

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

/** Change one's own password; the API then ends every session, so sign in again. */
function ChangePassword() {
    const t = useTranslations('Account.password');
    const { locale } = useParams();
    const { showToast } = useToast();
    const [form, setForm] = useState({ current: '', next: '', confirm: '' });
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
    const problem = form.next && form.next.length < 12 ? t('tooShort') : form.confirm && form.next !== form.confirm ? t('mismatch') : null;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (busy || problem || !form.current || !form.next || !form.confirm) return;
        setBusy(true);
        setError(null);
        try {
            await api.post('/auth/change-password', { currentPassword: form.current, newPassword: form.next });
            showToast(t('done'), 'success');
            await signOut(String(locale));
        } catch (err) {
            const message = (err as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
            setError(Array.isArray(message) ? message.join(' ') : message || t('failed'));
            setBusy(false);
        }
    };

    const input = (id: string, label: string, value: string, onChange: (e: React.ChangeEvent<HTMLInputElement>) => void, autoComplete: string) => (
        <div className="space-y-1">
            <label htmlFor={id} className="block text-xs font-semibold text-foreground">{label}</label>
            <input
                id={id}
                type="password"
                autoComplete={autoComplete}
                value={value}
                onChange={onChange}
                className="w-full h-9 px-3 rounded border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
        </div>
    );

    return (
        <section className="bg-white border border-border rounded-md">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
                <KeyRound size={16} className="text-primary" />
                <h2 className="text-sm font-bold text-foreground">{t('title')}</h2>
            </div>
            <form onSubmit={submit} className="px-5 py-4 space-y-3">
                <p className="text-sm text-muted-foreground">{t('desc')}</p>
                {input('pw-current', t('current'), form.current, set('current'), 'current-password')}
                <div className="grid sm:grid-cols-2 gap-3">
                    {input('pw-new', t('new'), form.next, set('next'), 'new-password')}
                    {input('pw-confirm', t('confirm'), form.confirm, set('confirm'), 'new-password')}
                </div>
                <p className={`text-xs ${problem ? 'text-red-700' : 'text-muted-foreground'}`}>{problem ?? t('rule')}</p>
                {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
                <button
                    type="submit"
                    disabled={busy || !!problem || !form.current || !form.next || !form.confirm}
                    className="inline-flex items-center gap-2 h-9 px-4 rounded bg-primary text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60"
                >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                    {t('submit')}
                </button>
            </form>
        </section>
    );
}
