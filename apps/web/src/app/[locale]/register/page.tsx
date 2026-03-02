"use client";

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Building2, Mail, Lock, CheckCircle2, ArrowRight, ShieldCheck, Zap, Fingerprint, Activity, Globe, Loader2 } from 'lucide-react';
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
            <div className="min-h-screen flex flex-col items-center justify-center bg-[#F6F9FC] p-6 animate-in fade-in zoom-in duration-500">
                <div className="w-full max-w-[420px] bg-white p-10 rounded-lg shadow-lg border border-[#E3E8EE] text-center">
                    <div className="mx-auto w-16 h-16 bg-[#E6F9F1] text-[#3ECF8E] rounded-full flex items-center justify-center mb-6 shadow-sm">
                        <CheckCircle2 size={32} />
                    </div>
                    <h1 className="text-[24px] font-bold text-[#1A1F36] tracking-tight mb-2">Account created</h1>
                    <p className="text-[#697386] text-[14px] leading-relaxed mb-8">
                        Your organization <strong className="text-[#1A1F36]">{formData.organizationName}</strong> has been successfully registered. Redirecting to login...
                    </p>
                    <button
                        onClick={() => router.push(`/${locale}/login`)}
                        className="w-full h-10 bg-[#635BFF] hover:bg-[#5D55EF] text-white rounded font-semibold text-[14px] shadow-sm transition-all"
                    >
                        Sign in now
                    </button>
                </div>
            </div>
        );
    }

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
                        <h1 className="text-[24px] font-bold text-[#1A1F36] tracking-tight mb-2">Create your account</h1>
                        <p className="text-[#697386] text-[14px]">
                            Start managing your microfinance portfolio with professional tools.
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="mt-8 space-y-6">
                        <div className="space-y-4">
                            <div className="space-y-1.5">
                                <Label htmlFor="org" className="text-[13px] font-semibold text-[#1A1F36]">Organization Name</Label>
                                <Input
                                    id="org"
                                    placeholder="Acme Microfinance"
                                    className="h-10 px-3 bg-white border-[#E3E8EE] focus:ring-2 focus:ring-[#635BFF]/10 focus:border-[#635BFF] text-[14px]"
                                    required
                                    value={formData.organizationName}
                                    onChange={e => setFormData({ ...formData, organizationName: e.target.value })}
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="email" className="text-[13px] font-semibold text-[#1A1F36]">Email</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    autoComplete="email"
                                    placeholder="you@example.com"
                                    className="h-10 px-3 bg-white border-[#E3E8EE] focus:ring-2 focus:ring-[#635BFF]/10 focus:border-[#635BFF] text-[14px]"
                                    required
                                    value={formData.adminEmail}
                                    onChange={e => setFormData({ ...formData, adminEmail: e.target.value })}
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="pass" className="text-[13px] font-semibold text-[#1A1F36]">Password</Label>
                                <Input
                                    id="pass"
                                    type="password"
                                    autoComplete="new-password"
                                    placeholder="Min. 8 characters"
                                    className="h-10 px-3 bg-white border-[#E3E8EE] focus:ring-2 focus:ring-[#635BFF]/10 focus:border-[#635BFF] text-[14px]"
                                    required
                                    value={formData.adminPassword}
                                    onChange={e => setFormData({ ...formData, adminPassword: e.target.value })}
                                />
                                <p className="text-[12px] text-[#697386] mt-1">Use a strong, unique password.</p>
                            </div>
                        </div>

                        {error && (
                            <div className="text-[13px] font-semibold text-[#FF5D5D] bg-[#FFF8F8] border border-[#FFD9D9] px-3 py-2 rounded">
                                {error}
                            </div>
                        )}

                        <div className="space-y-4">
                            <button
                                type="submit"
                                className="w-full h-10 bg-[#635BFF] hover:bg-[#5D55EF] text-white rounded font-semibold text-[14px] shadow-sm transition-all flex items-center justify-center gap-2"
                                disabled={submitting}
                            >
                                {submitting && <Loader2 size={16} className="animate-spin" />}
                                {submitting ? 'Creating account...' : 'Create account'}
                            </button>

                            <p className="text-center text-[12px] text-[#697386] leading-relaxed">
                                By signing up, you agree to our <Link href="#" className="text-[#635BFF] hover:underline">Terms of Service</Link> and <Link href="#" className="text-[#635BFF] hover:underline">Privacy Policy</Link>.
                            </p>
                        </div>
                    </form>
                </div>

                <div className="text-center">
                    <p className="text-[13px] text-[#697386] font-medium">
                        Already have an account? <Link href={`/${locale}/login`} className="text-[#635BFF] font-semibold hover:text-[#1A1F36]">Sign in</Link>
                    </p>
                </div>

                <div className="pt-10 flex items-center justify-center gap-6 border-t border-[#E3E8EE]">
                    <span className="text-[12px] font-semibold text-[#697386]">© MicroLend</span>
                    <button className="text-[12px] font-semibold text-[#697386] hover:text-[#1A1F36]">Support</button>
                    <button className="text-[12px] font-semibold text-[#697386] hover:text-[#1A1F36]">Contact</button>
                </div>
            </div>
        </div>
    );
}
