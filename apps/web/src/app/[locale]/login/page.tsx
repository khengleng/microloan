"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import { Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

export default function LoginPage() {
    const t = useTranslations('Index');
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

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
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
                setError(data?.message || 'Invalid email or password.');
                return;
            }
            if (data.mfaRequired) {
                setMfaToken(data.mfaToken);
                setMfaStep(true);
                return;
            }
            router.push(`/${locale}/dashboard`);
        } catch {
            setError('Unable to connect to service.');
        } finally {
            setLoading(false);
        }
    };

    const handleMfaVerify = async (e: React.FormEvent) => {
        e.preventDefault();
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
                setError(data?.message || 'Invalid verification code.');
                return;
            }
            router.push(`/${locale}/dashboard`);
        } catch {
            setError('MFA validation failure.');
        } finally {
            setLoading(false);
        }
    };

    const inputClass = "w-full h-10 px-3 bg-secondary border border-border rounded text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors";
    const labelClass = "block text-[12px] font-semibold text-muted-foreground mb-1.5";

    return (
        <div className="min-h-screen flex items-center justify-center bg-background" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
            <div className="w-full max-w-[360px] px-4">
                {/* Logo */}
                <div className="flex items-center gap-2 mb-8">
                    <div className="w-7 h-7 bg-primary rounded flex items-center justify-center text-white text-xs font-bold">M</div>
                    <span className="text-[16px] font-bold text-foreground">MicroLend</span>
                </div>

                <div className="bg-card border border-border rounded-lg p-7">
                    <h1 className="text-[18px] font-bold text-foreground mb-1">
                        {mfaStep ? 'Two-factor authentication' : 'Sign in'}
                    </h1>
                    <p className="text-[13px] text-muted-foreground mb-6">
                        {mfaStep
                            ? 'Enter the 6-digit code from your authenticator app.'
                            : 'Enter your credentials to access your dashboard.'}
                    </p>

                    {!mfaStep ? (
                        <form onSubmit={handleLogin} className="space-y-4">
                            <div>
                                <label htmlFor="email" className={labelClass}>Email</label>
                                <input
                                    id="email"
                                    type="email"
                                    placeholder="name@company.com"
                                    className={inputClass}
                                    required
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                />
                            </div>
                            <div>
                                <div className="flex justify-between items-center mb-1.5">
                                    <label htmlFor="password" className="text-[12px] font-semibold text-muted-foreground">Password</label>
                                    <button type="button" className="text-[12px] text-primary hover:text-primary/80 transition-colors">Forgot password?</button>
                                </div>
                                <div className="relative">
                                    <input
                                        id="password"
                                        type={showPassword ? 'text' : 'password'}
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
                                {loading ? 'Signing in...' : 'Sign in'}
                            </button>
                        </form>
                    ) : (
                        <form onSubmit={handleMfaVerify} className="space-y-4">
                            <div>
                                <label htmlFor="mfaCode" className={labelClass}>Verification code</label>
                                <input
                                    id="mfaCode"
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
                                {loading ? 'Verifying...' : 'Confirm'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setMfaStep(false)}
                                className="w-full text-center text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                            >
                                Try another method
                            </button>
                        </form>
                    )}
                </div>

                <p className="text-center text-[13px] text-muted-foreground mt-5">
                    Don&apos;t have an account?{' '}
                    <Link href={`/${locale}/register`} className="text-primary hover:text-primary/80 font-semibold transition-colors">
                        Create account
                    </Link>
                </p>

                <div className="flex items-center justify-center gap-5 mt-6 pt-6 border-t border-border">
                    <span className="text-[11px] text-muted-foreground">© 2025 MicroLend</span>
                    <button className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">Terms</button>
                    <button className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">Privacy</button>
                </div>
            </div>
        </div>
    );
}
