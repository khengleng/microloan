"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import { ShieldCheck, Lock, Mail, Loader2, Zap, ArrowRight, Fingerprint } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Link from 'next/link';

export default function LoginPage() {
    const t = useTranslations('Index');
    const { locale } = useParams();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
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

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6 animate-in fade-in duration-700 relative overflow-hidden">
            {/* Ambient glow */}
            <div className="pointer-events-none absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[120px]" />

            <div className="w-full max-w-[440px] space-y-10 relative z-10">
                {/* Brand Logo */}
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary rounded-2xl flex items-center justify-center text-primary-foreground text-[15px] font-black shadow-lg">
                        M
                    </div>
                    <span className="text-[22px] font-black text-foreground tracking-tighter">MicroLend <span className="text-primary italic">OS</span></span>
                </div>

                <div className="premium-card p-10 space-y-8">
                    <div>
                        <h1 className="text-3xl font-black text-foreground tracking-tighter mb-2 leading-tight">
                            {mfaStep ? 'Identity Verification' : 'Access Your'}
                        </h1>
                        {!mfaStep && <h2 className="text-3xl font-black text-primary italic tracking-tighter">Portfolio.</h2>}
                        <p className="text-muted-foreground text-[14px] font-medium mt-3 opacity-70">
                            {mfaStep
                                ? 'Enter the 6-digit code from your authenticator app.'
                                : 'Sign in to manage your microfinance operations.'}
                        </p>
                    </div>

                    {!mfaStep ? (
                        <form onSubmit={handleLogin} className="space-y-6">
                            <div className="space-y-5">
                                <div className="space-y-3">
                                    <Label htmlFor="email" className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em] opacity-60">Email Address</Label>
                                    <div className="relative group">
                                        <Mail className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" size={18} />
                                        <Input
                                            id="email"
                                            type="email"
                                            placeholder="you@example.com"
                                            className="h-14 pl-14 pr-6 rounded-2xl border-border/50 bg-background/50 focus:ring-4 focus:ring-primary/10 focus:border-primary text-foreground font-bold transition-all"
                                            required
                                            value={email}
                                            onChange={e => setEmail(e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center">
                                        <Label htmlFor="password" className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em] opacity-60">Password</Label>
                                        <button type="button" className="text-[12px] font-black text-primary hover:text-primary/80 transition-colors uppercase tracking-widest">Forgot?</button>
                                    </div>
                                    <div className="relative group">
                                        <Lock className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" size={18} />
                                        <Input
                                            id="password"
                                            type="password"
                                            placeholder="••••••••"
                                            className="h-14 pl-14 pr-6 rounded-2xl border-border/50 bg-background/50 focus:ring-4 focus:ring-primary/10 focus:border-primary text-foreground font-bold transition-all"
                                            required
                                            value={password}
                                            onChange={e => setPassword(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>

                            {error && (
                                <div className="text-[13px] font-black text-destructive bg-destructive/10 border border-destructive/20 px-5 py-3 rounded-2xl">
                                    {error}
                                </div>
                            )}

                            <button
                                type="submit"
                                className="premium-button w-full h-14 flex items-center justify-center gap-3 group text-[14px]"
                                disabled={loading}
                            >
                                {loading ? <Loader2 size={20} className="animate-spin" /> : <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />}
                                <span className="uppercase tracking-[0.2em] font-black text-[12px]">
                                    {loading ? 'Signing In...' : 'Continue'}
                                </span>
                            </button>
                        </form>
                    ) : (
                        <form onSubmit={handleMfaVerify} className="space-y-6 animate-in slide-in-from-bottom-2">
                            <div className="space-y-3">
                                <Label htmlFor="mfaCode" className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em] opacity-60">Verification Code</Label>
                                <div className="relative group">
                                    <Fingerprint className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" size={20} />
                                    <Input
                                        id="mfaCode"
                                        placeholder="000 000"
                                        maxLength={6}
                                        className="h-16 pl-14 text-center text-3xl font-black tracking-[0.3em] rounded-2xl border-border/50 bg-background/50 focus:ring-4 focus:ring-primary/10 focus:border-primary text-foreground transition-all"
                                        value={mfaCode}
                                        onChange={e => setMfaCode(e.target.value)}
                                        required
                                        autoFocus
                                    />
                                </div>
                            </div>

                            {error && (
                                <div className="text-[13px] font-black text-destructive bg-destructive/10 border border-destructive/20 px-5 py-3 rounded-2xl">
                                    {error}
                                </div>
                            )}

                            <div className="space-y-4">
                                <button type="submit" disabled={loading} className="premium-button w-full h-14 flex items-center justify-center gap-3 text-[12px] uppercase tracking-[0.2em]">
                                    {loading ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
                                    {loading ? 'Verifying...' : 'Confirm Identity'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setMfaStep(false)}
                                    className="w-full text-center text-[12px] font-black text-muted-foreground hover:text-foreground transition-colors uppercase tracking-widest"
                                >
                                    Use Different Method
                                </button>
                            </div>
                        </form>
                    )}
                </div>

                <div className="text-center">
                    <p className="text-[13px] text-muted-foreground font-medium">
                        Don&apos;t have an account?{' '}
                        <Link href={`/${locale}/register`} className="text-primary font-black hover:text-primary/80 transition-colors">
                            Create Account
                        </Link>
                    </p>
                </div>

                <div className="flex items-center justify-center gap-6 border-t border-border/50 pt-6">
                    <span className="text-[11px] font-black text-muted-foreground opacity-40">© MicroLend OS</span>
                    <button className="text-[11px] font-black text-muted-foreground opacity-40 hover:opacity-80 transition-opacity uppercase tracking-widest">Terms</button>
                    <button className="text-[11px] font-black text-muted-foreground opacity-40 hover:opacity-80 transition-opacity uppercase tracking-widest">Privacy</button>
                </div>
            </div>
        </div>
    );
}
