"use client";

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Building2, Mail, Lock, CheckCircle2, ArrowRight, ShieldCheck, Zap, Fingerprint, Activity, Globe } from 'lucide-react';
import Link from 'next/link';

export default function RegisterTenantPage() {
    const router = useRouter();
    const { locale } = useParams();
    const [submitting, setSubmitting] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState('');
    const [formData, setFormData] = useState({
        organizationName: '',
        adminEmail: '',
        adminPassword: ''
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setError('');
        try {
            const res = await fetch(`/api/proxy/auth/register-tenant`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.message || 'Registration failed');
            }

            setSuccess(true);
            setTimeout(() => {
                router.push(`/${locale}/login`);
            }, 3000);
        } catch (err: any) {
            setError(err.message || 'An error occurred during registration.');
        } finally {
            setSubmitting(false);
        }
    };

    if (success) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] p-6 font-urbanist">
                <div className="max-w-md w-full glass p-12 rounded-[3rem] premium-shadow border-indigo-100/10 text-center animate-in fade-in zoom-in duration-700">
                    <div className="mx-auto w-20 h-20 bg-emerald-50 text-emerald-600 rounded-[2rem] flex items-center justify-center mb-8 shadow-sm">
                        <ShieldCheck size={40} />
                    </div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tight mb-3">Onboarding Complete</h1>
                    <p className="text-slate-500 font-medium leading-relaxed mb-10 text-sm">
                        The organizational instance for <strong className="text-indigo-600 font-black">{formData.organizationName}</strong> has been initialized in the global registry.
                    </p>
                    <div className="space-y-4">
                        <div className="px-6 py-3 bg-white/50 backdrop-blur-sm rounded-2xl border border-slate-100/50 flex items-center justify-center gap-2 text-[11px] font-black text-slate-400 uppercase tracking-widest italic">
                            <Activity size={14} className="animate-pulse" /> Finalizing Environment Hash...
                        </div>
                        <Button
                            onClick={() => router.push(`/${locale}/login`)}
                            className="w-full h-14 bg-slate-950 hover:bg-slate-800 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-slate-950/20"
                        >
                            Establish First Access
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen grid lg:grid-cols-2 bg-[#F8FAFC] font-urbanist overflow-hidden">
            {/* Left Side: Industrial Intelligence Branding */}
            <div className="hidden lg:flex flex-col justify-between bg-slate-950 p-16 text-white relative overflow-hidden">
                <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-indigo-600/10 rounded-full blur-[120px] -mr-40 -mt-40 animate-pulse transition-all duration-3000" />

                <div className="relative z-10">
                    <div className="flex items-center gap-4 mb-20 animate-in fade-in slide-in-from-left-4 duration-700">
                        <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-600/30">
                            <Zap size={24} className="fill-white" />
                        </div>
                        <span className="text-2xl font-black tracking-tighter">Impact <span className="text-indigo-400">MicroLend</span></span>
                    </div>

                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-1000">
                        <h2 className="text-6xl font-black leading-[1.05] tracking-tight">
                            Architecting the <br />
                            <span className="text-indigo-400">Future of Finance.</span>
                        </h2>
                        <p className="text-slate-400 text-lg max-w-lg leading-relaxed font-medium">
                            Deploy industrial-grade microfinance infrastructure in minutes. Our distributed PaaS logic provides isolated multi-tenancy, automated risk tiering, and cryptographic auditability.
                        </p>
                    </div>
                </div>

                <div className="relative z-10 grid grid-cols-2 gap-6 animate-in fade-in slide-in-from-bottom-12 duration-1000 delay-300">
                    <div className="p-6 glass bg-white/5 border-white/5 rounded-3xl backdrop-blur-xl">
                        <div className="w-10 h-10 bg-indigo-500/20 text-indigo-400 rounded-xl flex items-center justify-center mb-4"><Globe size={20} /></div>
                        <div className="font-black text-sm uppercase tracking-widest mb-1">Global Logic</div>
                        <div className="text-[11px] text-slate-500 font-bold leading-relaxed uppercase">Regional Compliance & Multi-Currency Ready</div>
                    </div>
                    <div className="p-6 glass bg-white/5 border-white/5 rounded-3xl backdrop-blur-xl">
                        <div className="w-10 h-10 bg-emerald-500/20 text-emerald-400 rounded-xl flex items-center justify-center mb-4"><Fingerprint size={20} /></div>
                        <div className="font-black text-sm uppercase tracking-widest mb-1">Vault Security</div>
                        <div className="text-[11px] text-slate-500 font-bold leading-relaxed uppercase">Bank-Grade MFA & Immutable Ledger</div>
                    </div>
                </div>
            </div>

            {/* Right Side: Deployment Form */}
            <div className="flex flex-col justify-center p-8 md:p-16 lg:p-24 relative overflow-y-auto">
                <div className="max-w-[440px] w-full mx-auto space-y-12 animate-in fade-in slide-in-from-right-8 duration-700">
                    <div>
                        <h1 className="text-4xl font-black text-slate-900 tracking-tight mb-4">Instance Provisioning</h1>
                        <p className="text-slate-500 font-medium">
                            Already registered?
                            <Link href={`/${locale}/login`} className="text-indigo-600 hover:text-indigo-500 ml-2 font-black underline decoration-indigo-200 decoration-2 underline-offset-4">Log in to Console</Link>
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-8">
                        <div className="space-y-6">
                            <div className="space-y-3">
                                <Label htmlFor="org" className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Universal Entity Name</Label>
                                <div className="relative group">
                                    <Building2 className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={20} />
                                    <Input
                                        id="org"
                                        placeholder="Acme Microfinance Group"
                                        className="h-14 pl-14 pr-6 rounded-2xl border-slate-200/50 bg-white shadow-sm focus:ring-4 focus:ring-indigo-500/10 transition-all font-bold"
                                        required
                                        value={formData.organizationName}
                                        onChange={e => setFormData({ ...formData, organizationName: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="space-y-3">
                                <Label htmlFor="email" className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Admin Identity Identifier</Label>
                                <div className="relative group">
                                    <Mail className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={20} />
                                    <Input
                                        id="email"
                                        type="email"
                                        autoComplete="email"
                                        placeholder="admin@organization.com"
                                        className="h-14 pl-14 pr-6 rounded-2xl border-slate-200/50 bg-white shadow-sm focus:ring-4 focus:ring-indigo-500/10 transition-all font-bold"
                                        required
                                        value={formData.adminEmail}
                                        onChange={e => setFormData({ ...formData, adminEmail: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="space-y-3">
                                <Label htmlFor="pass" className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Logic Tier Credential</Label>
                                <div className="relative group">
                                    <Lock className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={20} />
                                    <Input
                                        id="pass"
                                        type="password"
                                        autoComplete="new-password"
                                        placeholder="Min. 8 alphanumeric bits"
                                        className="h-14 pl-14 pr-6 rounded-2xl border-slate-200/50 bg-white shadow-sm focus:ring-4 focus:ring-indigo-500/10 transition-all font-bold"
                                        required
                                        value={formData.adminPassword}
                                        onChange={e => setFormData({ ...formData, adminPassword: e.target.value })}
                                    />
                                </div>
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1 italic">Entropy: 128-bit Recommended Access Lock.</p>
                            </div>
                        </div>

                        {error && (
                            <div className="bg-rose-50 border border-rose-100 text-rose-600 px-6 py-4 rounded-2xl text-[11px] font-black uppercase tracking-widest animate-in slide-in-from-top-2 duration-300">
                                Provisioning Error: {error}
                            </div>
                        )}

                        <div className="pt-4 flex flex-col gap-4">
                            <Button
                                type="submit"
                                className="w-full h-16 bg-slate-950 hover:bg-slate-800 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] transition-all shadow-xl shadow-slate-950/20 active:scale-[0.98] flex items-center justify-center gap-3"
                                disabled={submitting}
                            >
                                {submitting ? <Activity className="animate-spin" size={20} /> : <ArrowRight size={20} />}
                                {submitting ? 'Initializing Vault...' : 'Provision Now'}
                            </Button>

                            <p className="text-center text-[10px] text-slate-400 uppercase font-black tracking-widest mt-4">
                                By provisioning, you acknowledge our <Link href="#" className="text-slate-900 border-b border-slate-200">Logic Protocols</Link> & <Link href="#" className="text-slate-900 border-b border-slate-200">Legal Directives</Link>.
                            </p>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
