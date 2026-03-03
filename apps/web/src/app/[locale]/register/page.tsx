"use client";

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Building2, Mail, Lock, CheckCircle2, ArrowRight, Loader2 } from 'lucide-react';
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
            <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6 animate-in fade-in zoom-in duration-700 relative overflow-hidden">
                <div className="pointer-events-none absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[120px]" />
                <div className="w-full max-w-[440px] premium-card p-12 text-center relative z-10 space-y-8">
                    <div className="mx-auto w-24 h-24 bg-primary/10 text-primary rounded-[32px] flex items-center justify-center shadow-[0_0_40px_rgba(217,235,119,0.2)]">
                        <CheckCircle2 size={48} />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black text-foreground tracking-tighter mb-3">Node Provisioned</h1>
                        <p className="text-muted-foreground text-[15px] font-medium leading-relaxed opacity-70">
                            Organization <strong className="text-primary">{formData.organizationName}</strong> has been registered. Redirecting to login...
                        </p>
                    </div>
                    <button
                        onClick={() => router.push(`/${locale}/login`)}
                        className="premium-button w-full h-14 flex items-center justify-center gap-3 text-[12px] uppercase tracking-[0.2em]"
                    >
                        <ArrowRight size={20} /> Sign In Now
                    </button>
                </div>
            </div>
        );
    }

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
                        <h1 className="text-3xl font-black text-foreground tracking-tighter mb-2 leading-tight">Create Your</h1>
                        <h2 className="text-3xl font-black text-primary italic tracking-tighter">Organization.</h2>
                        <p className="text-muted-foreground text-[14px] font-medium mt-3 opacity-70">
                            Launch your microfinance portfolio with professional-grade tools.
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-5">
                            <div className="space-y-3">
                                <Label htmlFor="org" className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em] opacity-60">Organization Name</Label>
                                <div className="relative group">
                                    <Building2 className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" size={18} />
                                    <Input
                                        id="org"
                                        placeholder="Acme Microfinance"
                                        className="h-14 pl-14 pr-6 rounded-2xl border-border/50 bg-background/50 focus:ring-4 focus:ring-primary/10 focus:border-primary text-foreground font-bold transition-all"
                                        required
                                        value={formData.organizationName}
                                        onChange={e => setFormData({ ...formData, organizationName: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="space-y-3">
                                <Label htmlFor="email" className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em] opacity-60">Admin Email</Label>
                                <div className="relative group">
                                    <Mail className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" size={18} />
                                    <Input
                                        id="email"
                                        type="email"
                                        autoComplete="email"
                                        placeholder="you@example.com"
                                        className="h-14 pl-14 pr-6 rounded-2xl border-border/50 bg-background/50 focus:ring-4 focus:ring-primary/10 focus:border-primary text-foreground font-bold transition-all"
                                        required
                                        value={formData.adminEmail}
                                        onChange={e => setFormData({ ...formData, adminEmail: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="space-y-3">
                                <Label htmlFor="pass" className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em] opacity-60">Password</Label>
                                <div className="relative group">
                                    <Lock className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" size={18} />
                                    <Input
                                        id="pass"
                                        type="password"
                                        autoComplete="new-password"
                                        placeholder="Min. 8 characters"
                                        className="h-14 pl-14 pr-6 rounded-2xl border-border/50 bg-background/50 focus:ring-4 focus:ring-primary/10 focus:border-primary text-foreground font-bold transition-all"
                                        required
                                        value={formData.adminPassword}
                                        onChange={e => setFormData({ ...formData, adminPassword: e.target.value })}
                                    />
                                </div>
                                <p className="text-[12px] text-muted-foreground ml-2 opacity-50">Use a strong, unique password for your admin account.</p>
                            </div>
                        </div>

                        {error && (
                            <div className="text-[13px] font-black text-destructive bg-destructive/10 border border-destructive/20 px-5 py-3 rounded-2xl">
                                {error}
                            </div>
                        )}

                        <div className="space-y-5">
                            <button
                                type="submit"
                                className="premium-button w-full h-14 flex items-center justify-center gap-3 group"
                                disabled={submitting}
                            >
                                {submitting ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />}
                                <span className="uppercase tracking-[0.2em] text-[12px]">
                                    {submitting ? 'Provisioning...' : 'Create Account'}
                                </span>
                            </button>

                            <p className="text-center text-[12px] text-muted-foreground font-medium opacity-60 leading-relaxed">
                                By signing up, you agree to our{' '}
                                <Link href="#" className="text-primary hover:underline font-black">Terms</Link>
                                {' '}and{' '}
                                <Link href="#" className="text-primary hover:underline font-black">Privacy Policy</Link>.
                            </p>
                        </div>
                    </form>
                </div>

                <div className="text-center">
                    <p className="text-[13px] text-muted-foreground font-medium">
                        Already have an account?{' '}
                        <Link href={`/${locale}/login`} className="text-primary font-black hover:text-primary/80 transition-colors">
                            Sign In
                        </Link>
                    </p>
                </div>

                <div className="flex items-center justify-center gap-6 border-t border-border/50 pt-6">
                    <span className="text-[11px] font-black text-muted-foreground opacity-40">© MicroLend OS</span>
                    <button className="text-[11px] font-black text-muted-foreground opacity-40 hover:opacity-80 transition-opacity uppercase tracking-widest">Support</button>
                    <button className="text-[11px] font-black text-muted-foreground opacity-40 hover:opacity-80 transition-opacity uppercase tracking-widest">Contact</button>
                </div>
            </div>
        </div>
    );
}
