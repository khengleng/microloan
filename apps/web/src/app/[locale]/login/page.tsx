"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import { ShieldCheck, Lock, Mail, Key, Loader2, Zap, ArrowRight, Activity, Fingerprint } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
        <div className="min-h-screen flex flex-col items-center justify-center bg-[#F6F9FC] p-6 animate-in fade-in duration-500">
            <div className="w-full max-w-[420px] space-y-8">
                {/* Brand Logo */}
                <div className="flex items-center gap-2 mb-10">
                    <div className="w-8 h-8 bg-[#635BFF] rounded-md flex items-center justify-center text-white text-sm font-bold shadow-sm">
                        M
                    </div>
                    <span className="text-[19px] font-bold text-[#1A1F36] tracking-tight">MicroLend</span>
                </div>

                <div className="bg-white p-10 rounded-lg shadow-[0_7px_14px_0_rgba(60,66,87,0.08),0_3px_6px_0_rgba(0,0,0,0.12)] border border-[#E3E8EE]">
                    <div>
                        <h1 className="text-[24px] font-bold text-[#1A1F36] tracking-tight mb-2">
                            {mfaStep ? 'Verification required' : 'Sign in to your account'}
                        </h1>
                        <p className="text-[#697386] text-[14px]">
                            {mfaStep
                                ? 'Please enter the 6-digit code from your authenticator app.'
                                : 'Access your dashboard and manage your loans.'}
                        </p>
                    </div>

                    {!mfaStep ? (
                        <form onSubmit={handleLogin} className="mt-8 space-y-6">
                            <div className="space-y-4">
                                <div className="space-y-1.5">
                                    <Label htmlFor="email" className="text-[13px] font-semibold text-[#1A1F36]">Email</Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        placeholder="you@example.com"
                                        className="h-10 px-3 bg-white border-[#E3E8EE] focus:ring-2 focus:ring-[#635BFF]/10 focus:border-[#635BFF] text-[14px]"
                                        required
                                        value={email}
                                        onChange={e => setEmail(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <div className="flex justify-between items-center">
                                        <Label htmlFor="password" className="text-[13px] font-semibold text-[#1A1F36]">Password</Label>
                                        <button type="button" className="text-[13px] font-semibold text-[#635BFF] hover:text-[#1A1F36] transition-colors">Forgot password?</button>
                                    </div>
                                    <Input
                                        id="password"
                                        type="password"
                                        placeholder="••••••••"
                                        className="h-10 px-3 bg-white border-[#E3E8EE] focus:ring-2 focus:ring-[#635BFF]/10 focus:border-[#635BFF] text-[14px]"
                                        required
                                        value={password}
                                        onChange={e => setPassword(e.target.value)}
                                    />
                                </div>
                            </div>

                            {error && (
                                <div className="text-[13px] font-semibold text-[#FF5D5D] bg-[#FFF8F8] border border-[#FFD9D9] px-3 py-2 rounded">
                                    {error}
                                </div>
                            )}

                            <button
                                type="submit"
                                className="w-full h-10 bg-[#635BFF] hover:bg-[#5D55EF] text-white rounded font-semibold text-[14px] shadow-sm transition-all flex items-center justify-center gap-2"
                                disabled={loading}
                            >
                                {loading && <Loader2 size={16} className="animate-spin" />}
                                {loading ? 'Signing in...' : 'Continue'}
                            </button>
                        </form>
                    ) : (
                        <form onSubmit={handleMfaVerify} className="mt-8 space-y-6 animate-in slide-in-from-bottom-2">
                            <div className="space-y-1.5">
                                <Label htmlFor="mfaCode" className="text-[13px] font-semibold text-[#1A1F36]">Verification code</Label>
                                <Input
                                    id="mfaCode"
                                    placeholder="000 000"
                                    maxLength={6}
                                    className="h-12 text-center text-2xl font-bold tracking-[0.2em] border-[#E3E8EE]"
                                    value={mfaCode}
                                    onChange={e => setMfaCode(e.target.value)}
                                    required
                                    autoFocus
                                />
                            </div>

                            {error && (
                                <div className="text-[13px] font-semibold text-[#FF5D5D] bg-[#FFF8F8] border border-[#FFD9D9] px-3 py-2 rounded">
                                    {error}
                                </div>
                            )}

                            <div className="space-y-3">
                                <button type="submit" disabled={loading} className="w-full h-10 bg-[#635BFF] hover:bg-[#5D55EF] text-white rounded font-semibold text-[14px] shadow-sm flex items-center justify-center">
                                    {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : 'Log in'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setMfaStep(false)}
                                    className="w-full text-center text-[13px] font-semibold text-[#697386] hover:text-[#1A1F36] transition-colors"
                                >
                                    Use another method
                                </button>
                            </div>
                        </form>
                    )}
                </div>

                <div className="text-center">
                    <p className="text-[13px] text-[#697386] font-medium">
                        Don't have an account? <Link href={`/${locale}/register`} className="text-[#635BFF] font-semibold hover:text-[#1A1F36]">Create an account</Link>
                    </p>
                </div>

                <div className="pt-10 flex items-center justify-center gap-6 border-t border-[#E3E8EE]">
                    <span className="text-[12px] font-semibold text-[#697386]">© MicroLend</span>
                    <button className="text-[12px] font-semibold text-[#697386] hover:text-[#1A1F36]">Terms</button>
                    <button className="text-[12px] font-semibold text-[#697386] hover:text-[#1A1F36]">Privacy</button>
                    <button className="text-[12px] font-semibold text-[#697386] hover:text-[#1A1F36]">Cookies</button>
                </div>
            </div>
        </div>
    );
}
