"use client";

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Building2, Mail, Lock, CheckCircle2, ArrowRight } from 'lucide-react';
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
        try {
            // Calls our local proxy to keep requests unified
            const res = await fetch(`/api/proxy/auth/register-tenant`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });

            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.message || 'Registration failed');
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
            <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
                <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-10 text-center animate-in fade-in zoom-in duration-500">
                    <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-6">
                        <CheckCircle2 className="text-green-600" size={32} />
                    </div>
                    <h1 className="text-2xl font-bold text-slate-900 mb-2">Welcome Aboard!</h1>
                    <p className="text-slate-600 mb-8">
                        Your organization <strong>{formData.organizationName}</strong> has been successfully registered.
                    </p>
                    <p className="text-sm text-slate-400">Redirecting to login...</p>
                    <Button
                        onClick={() => router.push(`/${locale}/login`)}
                        className="w-full mt-6 bg-slate-900 hover:bg-slate-800"
                    >
                        Go to Login
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen grid lg:grid-cols-2">
            {/* Left Side: Illustration & Branding */}
            <div className="hidden lg:flex flex-col justify-between bg-slate-900 p-12 text-white relative overflow-hidden">
                <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-12">
                        <img src="/logo.png" alt="Logo" className="w-10 h-10 rounded-lg" />
                        <span className="text-2xl font-bold tracking-tight">Magic Money</span>
                    </div>
                    <h2 className="text-5xl font-extrabold leading-tight mb-6">
                        Start your Lending <br />
                        <span className="text-blue-500 text-6xl">Business in Minutes.</span>
                    </h2>
                    <p className="text-slate-400 text-lg max-w-md leading-relaxed">
                        The ultimate PaaS solution for modern microfinance. Manage organizations, policies,
                        and automation with industrial-grade multi-tenant isolation.
                    </p>
                </div>

                <div className="relative z-10 space-y-6">
                    <div className="flex gap-4 items-center bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 backdrop-blur-sm">
                        <div className="p-3 bg-blue-600/20 text-blue-400 rounded-lg"><Building2 size={24} /></div>
                        <div>
                            <div className="font-semibold">Instant Multi-Tenancy</div>
                            <div className="text-xs text-slate-500 font-medium">Fully isolated data environments</div>
                        </div>
                    </div>
                    <div className="flex gap-4 items-center bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 backdrop-blur-sm">
                        <div className="p-3 bg-green-600/20 text-green-400 rounded-lg"><ArrowRight size={24} /></div>
                        <div>
                            <div className="font-semibold">Automated AI Engines</div>
                            <div className="text-xs text-slate-500 font-medium">Smart risk and credit assessments</div>
                        </div>
                    </div>
                </div>

                {/* Decorative background circle */}
                <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-blue-600/20 rounded-full blur-3xl pointer-events-none"></div>
                <div className="absolute top-0 right-0 w-64 h-64 bg-slate-800 rounded-full blur-3xl opacity-50 pointer-events-none"></div>
            </div>

            {/* Right Side: Form */}
            <div className="flex flex-col justify-center p-8 md:p-12 lg:p-20 bg-white">
                <div className="max-w-md w-full mx-auto">
                    <div className="mb-10">
                        <h1 className="text-3xl font-bold text-slate-900 mb-2">Create an account</h1>
                        <p className="text-slate-500">
                            Already have an account?
                            <Link href={`/${locale}/login`} className="text-blue-600 hover:underline ml-1 font-medium">Log in</Link>
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor="org">Organization Name</Label>
                            <div className="relative">
                                <Building2 className="absolute left-3 top-3 text-slate-400" size={18} />
                                <Input
                                    id="org"
                                    placeholder="Acme Microfinance Co."
                                    className="pl-10 h-12 border-slate-200 focus:border-blue-500 focus:ring-blue-500 transition-all"
                                    required
                                    value={formData.organizationName}
                                    onChange={e => setFormData({ ...formData, organizationName: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="email">Admin Email Address</Label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-3 text-slate-400" size={18} />
                                <Input
                                    id="email"
                                    type="email"
                                    autoComplete="email"
                                    placeholder="admin@example.com"
                                    className="pl-10 h-12 border-slate-200 focus:border-blue-500 focus:ring-blue-500 transition-all"
                                    required
                                    value={formData.adminEmail}
                                    onChange={e => setFormData({ ...formData, adminEmail: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="pass">Admin Password</Label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-3 text-slate-400" size={18} />
                                <Input
                                    id="pass"
                                    type="password"
                                    autoComplete="new-password"
                                    placeholder="••••••••"
                                    className="pl-10 h-12 border-slate-200 focus:border-blue-500 focus:ring-blue-500 transition-all"
                                    required
                                    value={formData.adminPassword}
                                    onChange={e => setFormData({ ...formData, adminPassword: e.target.value })}
                                />
                            </div>
                            <p className="text-[10px] text-slate-400">At least 6 characters required.</p>
                        </div>
                        {error && (
                            <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl text-sm animate-in fade-in slide-in-from-top-2">
                                {error}
                            </div>
                        )}
                        <Button
                            type="submit"
                            className="w-full h-12 bg-slate-900 hover:bg-slate-800 text-white font-semibold transition-all shadow-md active:scale-[0.98]"
                            disabled={submitting}
                        >
                            {submitting ? 'Creating Organization...' : 'Onboard Now'}
                        </Button>

                        <p className="text-center text-xs text-slate-400 mt-8">
                            By signing up, you agree to our Terms of Service and Privacy Policy.
                        </p>
                    </form>
                </div>
            </div>
        </div>
    );
}
