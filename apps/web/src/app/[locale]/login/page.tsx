"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import { ShieldCheck, Lock, Mail, Key, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function LoginPage() {
    const t = useTranslations('Index');
    const { locale } = useParams();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [mfaStep, setMfaStep] = useState(false);
    const [mfaCode, setMfaCode] = useState('');
    // mfaToken is the short-lived JWT issued by the server after password success
    // It is NEVER a raw userId — safe to hold in component state (memory only)
    const [mfaToken, setMfaToken] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const router = useRouter();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        try {
            // Calls our Next.js server route, NOT the NestJS API directly.
            // The server route sets HttpOnly cookies — tokens never touch JS.
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data?.message || 'Login failed. Please check your credentials.');
                return;
            }
            if (data.mfaRequired) {
                setMfaToken(data.mfaToken); // short-lived JWT, not a userId
                setMfaStep(true);
                return;
            }
            // Tokens are already in HttpOnly cookies — just navigate
            router.push(`/${locale}/dashboard`);
        } catch {
            setError('Login failed. Please check your credentials.');
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
            // HttpOnly cookies set by server — just navigate
            router.push(`/${locale}/dashboard`);
        } catch {
            setError('Invalid verification code.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
            <Card className="w-full max-w-md shadow-xl border-slate-200">
                <CardHeader className="space-y-1">
                    <CardTitle className="text-2xl font-bold text-center flex items-center justify-center gap-2 text-slate-900">
                        {mfaStep ? (
                            <ShieldCheck className="text-blue-600" />
                        ) : (
                            <img src="/logo.png" alt="Logo" className="w-8 h-8 rounded" />
                        )}
                        Magic Money
                    </CardTitle>
                    <CardDescription className="text-center">
                        {mfaStep ? 'Enter your 6-digit security code' : t('title')}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {!mfaStep ? (
                        <form onSubmit={handleLogin} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="email">Email</Label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-3 text-slate-400" size={18} />
                                    <Input
                                        id="email"
                                        type="email"
                                        autoComplete="email"
                                        placeholder="admin@example.com"
                                        className="pl-10 h-11"
                                        value={email}
                                        onChange={e => setEmail(e.target.value)}
                                        required
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="password">Password</Label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-3 text-slate-400" size={18} />
                                    <Input
                                        id="password"
                                        type="password"
                                        autoComplete="current-password"
                                        placeholder="••••••••"
                                        className="pl-10 h-11"
                                        value={password}
                                        onChange={e => setPassword(e.target.value)}
                                        required
                                    />
                                </div>
                            </div>
                            {error && (
                                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                                    {error}
                                </p>
                            )}
                            <Button type="submit" disabled={loading} className="w-full bg-slate-900 hover:bg-slate-800 h-11">
                                {loading ? <Loader2 className="animate-spin mr-2" /> : t('login')}
                            </Button>
                            <div className="text-center mt-6 text-sm text-slate-500">
                                New operator? <button type="button" onClick={() => router.push(`/${locale}/register`)} className="text-blue-600 hover:underline font-medium">Register your organization</button>
                            </div>
                        </form>
                    ) : (
                        <form onSubmit={handleMfaVerify} className="space-y-6">
                            <div className="space-y-2">
                                <Label htmlFor="mfaCode">Verification Code</Label>
                                <div className="relative">
                                    <Key className="absolute left-3 top-3 text-slate-400" size={18} />
                                    <Input
                                        id="mfaCode"
                                        placeholder="000000"
                                        maxLength={6}
                                        className="pl-10 h-11 text-center text-lg tracking-[0.5em] font-mono"
                                        value={mfaCode}
                                        onChange={e => setMfaCode(e.target.value)}
                                        required
                                        autoFocus
                                    />
                                </div>
                            </div>
                            {error && (
                                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                                    {error}
                                </p>
                            )}
                            <Button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 h-11">
                                {loading ? <Loader2 className="animate-spin mr-2" /> : 'Verify & Sign In'}
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={() => setMfaStep(false)}
                                className="w-full text-slate-500"
                            >
                                Back to login
                            </Button>
                        </form>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
