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
                setError(data?.message || 'Authentication failed. Please check credentials.');
                return;
            }
            if (data.mfaRequired) {
                setMfaToken(data.mfaToken);
                setMfaStep(true);
                return;
            }
            router.push(`/${locale}/dashboard`);
        } catch {
            setError('System unreachable. Please verify connection.');
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
                setError(data?.message || 'Invalid cryptographic code.');
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
        <div className="min-h-screen grid lg:grid-cols-2 bg-[#F8FAFC] font-urbanist overflow-hidden">
            {/* Left Side: Dynamic Core Branding */}
            <div className="hidden lg:flex flex-col justify-between bg-slate-950 p-16 text-white relative overflow-hidden">
                <div className="absolute -top-24 -left-24 w-[600px] h-[600px] bg-indigo-600/10 rounded-full blur-[100px] opacity-50 animate-pulse" />

                <div className="relative z-10">
                    <div className="flex items-center gap-4 mb-20">
                        <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-600/30">
                            <Zap size={24} className="fill-white" />
                        </div>
                        <span className="text-2xl font-black tracking-tighter">Impact <span className="text-indigo-400">MicroLend</span></span>
                    </div>

                    <div className="space-y-6">
                        <h2 className="text-6xl font-black leading-[1.05] tracking-tight">
                            Access the <br />
                            <span className="text-indigo-400">Control Plane.</span>
                        </h2>
                        <p className="text-slate-400 text-lg max-w-sm leading-relaxed font-medium">
                            Authenticate to manage your organizational ledger, credit policies, and automated financial workflows.
                        </p>
                    </div>
                </div>

                <div className="relative z-10 space-y-8 max-w-sm">
                    <div className="flex items-center gap-4 group cursor-default">
                        <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:scale-110 transition-transform"><ShieldCheck size={20} className="text-indigo-400" /></div>
                        <div>
                            <div className="font-black text-[11px] uppercase tracking-widest text-white/50">Security Protocol</div>
                            <div className="text-sm font-bold">Standard RSA & JWT Encryption</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-4 group cursor-default">
                        <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:scale-110 transition-transform"><Activity size={20} className="text-emerald-400" /></div>
                        <div>
                            <div className="font-black text-[11px] uppercase tracking-widest text-white/50">System Health</div>
                            <div className="text-sm font-bold">99.99% Infrastructure Uptime</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Right Side: Identity Gateway */}
            <div className="flex flex-col justify-center p-8 md:p-16 lg:p-24 relative">
                <div className="max-w-[440px] w-full mx-auto space-y-12 animate-in fade-in slide-in-from-right-8 duration-700">
                    <div>
                        <h1 className="text-4xl font-black text-slate-900 tracking-tight mb-4">
                            {mfaStep ? 'Identity Verification' : 'Portal Access'}
                        </h1>
                        <p className="text-slate-500 font-medium">
                            {mfaStep
                                ? 'A 6-digit cryptographic code from your vault is required.'
                                : 'Provisioned operators only. No access without valid credentials.'}
                        </p>
                    </div>

                    {!mfaStep ? (
                        <form onSubmit={handleLogin} className="space-y-8">
                            <div className="space-y-6">
                                <div className="space-y-3">
                                    <Label htmlFor="email" className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Identity Identifier</Label>
                                    <div className="relative group">
                                        <Mail className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={20} />
                                        <Input
                                            id="email"
                                            type="email"
                                            autoComplete="email"
                                            placeholder="admin@organization.com"
                                            className="h-14 pl-14 pr-6 rounded-2xl border-slate-200/50 bg-white shadow-sm focus:ring-4 focus:ring-indigo-500/10 transition-all font-bold"
                                            required
                                            value={email}
                                            onChange={e => setEmail(e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div className="space-y-3">
                                    <Label htmlFor="password" className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Credential Hash</Label>
                                    <div className="relative group">
                                        <Lock className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={20} />
                                        <Input
                                            id="password"
                                            type="password"
                                            autoComplete="current-password"
                                            placeholder="••••••••"
                                            className="h-14 pl-14 pr-6 rounded-2xl border-slate-200/50 bg-white shadow-sm focus:ring-4 focus:ring-indigo-500/10 transition-all font-bold"
                                            required
                                            value={password}
                                            onChange={e => setPassword(e.target.value)}
                                        />
                                    </div>
                                </div>
                            </div>

                            {error && (
                                <div className="bg-rose-50 border border-rose-100 text-rose-600 px-6 py-4 rounded-2xl text-[11px] font-black uppercase tracking-widest animate-in slide-in-from-top-2 duration-300">
                                    Gateway Failure: {error}
                                </div>
                            )}

                            <div className="pt-4 flex flex-col gap-4">
                                <Button
                                    type="submit"
                                    className="w-full h-16 bg-slate-950 hover:bg-slate-800 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] transition-all shadow-xl shadow-slate-950/20 active:scale-[0.98] flex items-center justify-center gap-3"
                                    disabled={loading}
                                >
                                    {loading ? <Activity className="animate-spin" size={20} /> : <ArrowRight size={20} />}
                                    {loading ? 'Authenticating...' : t('login')}
                                </Button>

                                <div className="text-center mt-6">
                                    <p className="text-[11px] font-black text-slate-400 uppercase tracking-widest">
                                        New Entity? <button type="button" onClick={() => router.push(`/${locale}/register`)} className="text-indigo-600 hover:text-indigo-500 ml-2 underline decoration-indigo-200 decoration-2 underline-offset-4">Provision Organization</button>
                                    </p>
                                </div>
                            </div>
                        </form>
                    ) : (
                        <form onSubmit={handleMfaVerify} className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="space-y-4">
                                <Label htmlFor="mfaCode" className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1 text-center block">Input 6-Digit TOTP Challenge</Label>
                                <div className="relative group max-w-[280px] mx-auto">
                                    <Key className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={24} />
                                    <Input
                                        id="mfaCode"
                                        placeholder="000 000"
                                        maxLength={6}
                                        className="h-20 pl-16 pr-6 rounded-[2rem] border-slate-200 focus:ring-8 focus:ring-indigo-500/5 text-3xl tracking-[0.3em] font-black font-urbanist text-center"
                                        value={mfaCode}
                                        onChange={e => setMfaCode(e.target.value)}
                                        required
                                        autoFocus
                                    />
                                </div>
                            </div>

                            {error && (
                                <div className="bg-rose-50 border border-rose-100 text-rose-600 px-6 py-4 rounded-2xl text-[11px] font-black uppercase tracking-widest text-center">
                                    MFA Failure: {error}
                                </div>
                            )}

                            <div className="flex flex-col gap-4">
                                <Button type="submit" disabled={loading} className="h-16 bg-indigo-600 hover:bg-indigo-700 text-white rounded-[2rem] font-black text-xs uppercase tracking-[0.3em] shadow-xl shadow-indigo-600/20 flex items-center justify-center gap-3">
                                    {loading ? <Activity className="animate-spin" size={20} /> : <Fingerprint size={24} />}
                                    Final Authorization
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => setMfaStep(false)}
                                    className="h-12 rounded-2xl font-black text-[10px] text-slate-400 uppercase tracking-widest"
                                >
                                    Dismiss Challenge
                                </Button>
                            </div>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
