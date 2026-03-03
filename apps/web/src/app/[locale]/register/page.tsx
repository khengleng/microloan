"use client";

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';
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

    const inputClass = "w-full h-10 px-3 bg-secondary border border-border rounded text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors";
    const labelClass = "block text-[12px] font-semibold text-muted-foreground mb-1.5";

    if (success) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="w-full max-w-[360px] px-4">
                    <div className="bg-card border border-border rounded-lg p-8 text-center">
                        <div className="w-12 h-12 bg-[#26a69a]/15 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckCircle2 size={24} className="text-[#26a69a]" />
                        </div>
                        <h1 className="text-[18px] font-bold text-foreground mb-2">Account created</h1>
                        <p className="text-[13px] text-muted-foreground mb-6">
                            <strong className="text-foreground">{formData.organizationName}</strong> has been registered. Redirecting to login...
                        </p>
                        <button
                            onClick={() => router.push(`/${locale}/login`)}
                            className="tv-button w-full h-10 text-[13px]"
                        >
                            Sign in now
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-background">
            <div className="w-full max-w-[360px] px-4">
                {/* Logo */}
                <div className="flex items-center gap-2 mb-8">
                    <div className="w-7 h-7 bg-primary rounded flex items-center justify-center text-white text-xs font-bold">M</div>
                    <span className="text-[16px] font-bold text-foreground">MicroLoan</span>
                </div>

                <div className="bg-card border border-border rounded-lg p-7">
                    <h1 className="text-[18px] font-bold text-foreground mb-1">Create your account</h1>
                    <p className="text-[13px] text-muted-foreground mb-6">
                        Set up your organization to start managing your portfolio.
                    </p>

                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div>
                            <label htmlFor="org" className={labelClass}>Organization name</label>
                            <input
                                id="org"
                                placeholder="Acme Microfinance"
                                className={inputClass}
                                required
                                value={formData.organizationName}
                                onChange={e => setFormData({ ...formData, organizationName: e.target.value })}
                            />
                        </div>

                        <div>
                            <label htmlFor="email" className={labelClass}>Admin email</label>
                            <input
                                id="email"
                                type="email"
                                autoComplete="email"
                                placeholder="you@company.com"
                                className={inputClass}
                                required
                                value={formData.adminEmail}
                                onChange={e => setFormData({ ...formData, adminEmail: e.target.value })}
                            />
                        </div>

                        <div>
                            <label htmlFor="pass" className={labelClass}>Password</label>
                            <input
                                id="pass"
                                type="password"
                                autoComplete="new-password"
                                placeholder="Minimum 8 characters"
                                className={inputClass}
                                required
                                value={formData.adminPassword}
                                onChange={e => setFormData({ ...formData, adminPassword: e.target.value })}
                            />
                        </div>

                        {error && (
                            <div className="text-[12px] text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2 rounded">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            className="tv-button w-full h-10 text-[13px]"
                            disabled={submitting}
                        >
                            {submitting && <Loader2 size={14} className="animate-spin mr-2" />}
                            {submitting ? 'Creating account...' : 'Create account'}
                        </button>

                        <p className="text-center text-[12px] text-muted-foreground leading-relaxed">
                            By creating an account you agree to our{' '}
                            <Link href="#" className="text-primary hover:text-primary/80 transition-colors">Terms</Link>
                            {' '}and{' '}
                            <Link href="#" className="text-primary hover:text-primary/80 transition-colors">Privacy Policy</Link>.
                        </p>
                    </form>
                </div>

                <p className="text-center text-[13px] text-muted-foreground mt-5">
                    Already have an account?{' '}
                    <Link href={`/${locale}/login`} className="text-primary hover:text-primary/80 font-semibold transition-colors">
                        Sign in
                    </Link>
                </p>

                <div className="flex items-center justify-center gap-5 mt-6 pt-6 border-t border-border">
                    <span className="text-[11px] text-muted-foreground">© 2025 MicroLoan</span>
                    <button className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">Terms</button>
                    <button className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">Privacy</button>
                </div>
            </div>
        </div>
    );
}
