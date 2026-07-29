"use client";

import { useState } from 'react';
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import { Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { clarityEvent, claritySetTag } from '@/lib/clarity';
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';

export default function LoginPage() {
    const t = useTranslations('Auth');
    const { locale } = useParams();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [mfaStep, setMfaStep] = useState(false);
    const [mfaCode, setMfaCode] = useState('');
    const [mfaToken, setMfaToken] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const router = useRouter();

    useEffect(() => {
        claritySetTag('journey_stage', 'landing_login');
        clarityEvent('landing_page_visit');
    }, []);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        clarityEvent('login_submit_attempt');
        setLoading(true);
        setError('');
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            const data = await res.json();
            if (!res.ok) {
                clarityEvent('login_submit_failed');
                setError(data?.message || t('invalidCredentials'));
                return;
            }
            if (data.mfaRequired) {
                clarityEvent('login_mfa_challenge');
                setMfaToken(data.mfaToken);
                setMfaStep(true);
                return;
            }
            // Redirect Platform Staff to platform view; everyone else to dashboard
            const me = await fetch('/api/proxy/auth/me', { headers: { Authorization: `Bearer ${data.accessToken ?? ''}` } }).then(r => r.json()).catch(() => ({}));
            clarityEvent('login_submit_success');
            router.push(me?.isPlatform ? `/${locale}/tenants` : `/${locale}/dashboard`);
        } catch {
            clarityEvent('login_submit_failed');
            setError(t('connectError'));
        } finally {
            setLoading(false);
        }
    };

    const finishLogin = async () => {
        const me = await fetch('/api/proxy/auth/me').then(r => r.json()).catch(() => ({}));
        router.push(me?.isPlatform ? `/${locale}/tenants` : `/${locale}/dashboard`);
    };

    const handleGoogle = async (idToken: string) => {
        clarityEvent('login_google_attempt');
        setError('');
        const res = await fetch('/api/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken }),
        });
        const data = await res.json();
        if (!res.ok) {
            clarityEvent('login_google_failed');
            throw new Error(data?.message || t('invalidCredentials'));
        }
        if (data.mfaRequired) {
            clarityEvent('login_mfa_challenge');
            setMfaToken(data.mfaToken);
            setMfaStep(true);
            return;
        }
        clarityEvent('login_google_success');
        await finishLogin();
    };

    const handleMfaVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        clarityEvent('mfa_verify_attempt');
        setLoading(true);
        setError('');
        try {
            const res = await fetch('/api/auth/mfa', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mfaToken, code: mfaCode }),
            });
            const data = await res.json();
            if (!res.ok) {
                clarityEvent('mfa_verify_failed');
                setError(data?.message || t('invalidCode'));
                return;
            }
            // Redirect Platform Staff to platform view; everyone else to dashboard
            const me = await fetch('/api/proxy/auth/me').then(r => r.json()).catch(() => ({}));
            clarityEvent('mfa_verify_success');
            router.push(me?.isPlatform ? `/${locale}/tenants` : `/${locale}/dashboard`);
        } catch {
            clarityEvent('mfa_verify_failed');
            setError(t('mfaFailure'));
        } finally {
            setLoading(false);
        }
    };

    const inputClass = "w-full h-10 px-3 bg-secondary border border-border rounded text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors";
    const labelClass = "block text-[12px] font-semibold text-muted-foreground mb-1.5";

    return (
        <div className="min-h-screen flex items-center justify-center bg-background">
            <div className="w-full max-w-[360px] px-4">
                {/* Logo */}
                <div className="flex items-center gap-2 mb-8">
                    <div className="w-7 h-7 bg-primary rounded flex items-center justify-center text-white text-xs font-bold">M</div>
                    <span className="text-[16px] font-bold text-foreground">MicroLoan</span>
                </div>

                <div className="bg-card border border-border rounded-lg p-7">
                    <h1 className="text-[18px] font-bold text-foreground mb-1">
                        {mfaStep ? t('twoFactor') : t('signIn')}
                    </h1>
                    <p className="text-[13px] text-muted-foreground mb-6">
                        {mfaStep
                            ? t('twoFactorDesc')
                            : t('signInDesc')}
                    </p>

                    {!mfaStep ? (
                        <form onSubmit={handleLogin} className="space-y-4">
                            <div>
                                <label htmlFor="email" className={labelClass}>{t('email')}</label>
                                <input
                                    id="email"
                                    type="email"
                                    data-clarity-mask="true"
                                    autoComplete="email"
                                    placeholder="name@company.com"
                                    className={inputClass}
                                    required
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                />
                            </div>
                            <div>
                                <div className="flex justify-between items-center mb-1.5">
                                    <label htmlFor="password" className="text-[12px] font-semibold text-muted-foreground">{t('password')}</label>
                                    <Link href={`/${locale}/forgot-password`} className="text-[12px] text-primary hover:text-primary/80 transition-colors">{t('forgotPassword')}</Link>
                                </div>
                                <div className="relative">
                                    <input
                                        id="password"
                                        type={showPassword ? 'text' : 'password'}
                                        data-clarity-mask="true"
                                        autoComplete="current-password"
                                        placeholder="••••••••"
                                        className={`${inputClass} pr-10`}
                                        required
                                        value={password}
                                        onChange={e => setPassword(e.target.value)}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                                    >
                                        {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                                    </button>
                                </div>
                            </div>

                            {error && (
                                <div className="text-[12px] text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2 rounded">
                                    {error}
                                </div>
                            )}

                            <button
                                type="submit"
                                className="tv-button w-full h-10 text-[13px]"
                                disabled={loading}
                            >
                                {loading && <Loader2 size={14} className="animate-spin mr-2" />}
                                {loading ? t('signingIn') : t('signIn')}
                            </button>

                            {/* Renders nothing when Google is not configured, so
                                the divider must not appear on its own either. */}
                            <GoogleSignInButton
                                text="signin_with"
                                disabled={loading}
                                onCredential={handleGoogle}
                            />
                        </form>
                    ) : (
                        <form onSubmit={handleMfaVerify} className="space-y-4">
                            <div>
                                <label htmlFor="mfaCode" className={labelClass}>{t('verificationCode')}</label>
                                <input
                                    id="mfaCode"
                                    data-clarity-mask="true"
                                    placeholder="000000"
                                    maxLength={6}
                                    className={`${inputClass} text-center text-[20px] font-bold tracking-[0.25em]`}
                                    value={mfaCode}
                                    onChange={e => setMfaCode(e.target.value)}
                                    required
                                    autoFocus
                                />
                            </div>

                            {error && (
                                <div className="text-[12px] text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2 rounded">
                                    {error}
                                </div>
                            )}

                            <button type="submit" disabled={loading} className="tv-button w-full h-10 text-[13px]">
                                {loading ? <Loader2 size={14} className="animate-spin mr-2" /> : <ShieldCheck size={14} className="mr-2" />}
                                {loading ? t('verifying') : t('confirm')}
                            </button>
                            <button
                                type="button"
                                onClick={() => setMfaStep(false)}
                                className="w-full text-center text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                            >
                                {t('tryAnother')}
                            </button>
                        </form>
                    )}
                </div>

                <p className="text-center text-[13px] text-muted-foreground mt-5">
                    {t('noAccount')}{' '}
                    <Link href={`/${locale}/register`} className="text-primary hover:text-primary/80 font-semibold transition-colors">
                        {t('createAccount')}
                    </Link>
                </p>

                <div className="flex items-center justify-center gap-5 mt-6 pt-6 border-t border-border">
                    <span className="text-[11px] text-muted-foreground">{t('copyright')}</span>
                    <Link href="/terms-and-conditions" className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">{t('terms')}</Link>
                    <Link href="/privacy-policy" className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">{t('privacy')}</Link>
                </div>
            </div>
        </div>
    );
}
