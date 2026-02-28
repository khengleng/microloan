"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import Cookies from 'js-cookie';
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
    const [mfaUserId, setMfaUserId] = useState('');
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/v1';
            const res = await fetch(`${apiBase}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            if (!res.ok) throw new Error('Login failed');
            const data = await res.json();

            if (data.mfaRequired) {
                setMfaUserId(data.userId);
                setMfaStep(true);
                return;
            }

            completeLogin(data);
        } catch {
            alert('Login failed. Please check your credentials.');
        } finally {
            setLoading(false);
        }
    };

    const handleMfaVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/v1';
            const res = await fetch(`${apiBase}/auth/mfa/authenticate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: mfaUserId, code: mfaCode }),
            });
            if (!res.ok) throw new Error('MFA verification failed');
            const data = await res.json();
            completeLogin(data);
        } catch {
            alert('Invalid verification code.');
        } finally {
            setLoading(false);
        }
    };

    const completeLogin = (data: any) => {
        Cookies.set('access_token', data.access_token);
        Cookies.set('refresh_token', data.refresh_token);
        router.push(`/${locale}/dashboard`);
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
            <Card className="w-full max-w-md shadow-xl border-slate-200">
                <CardHeader className="space-y-1">
                    <CardTitle className="text-2xl font-bold text-center flex items-center justify-center gap-2 text-slate-900">
                        {mfaStep ? <ShieldCheck className="text-blue-600" /> : <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center text-white text-xs">M</div>}
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
