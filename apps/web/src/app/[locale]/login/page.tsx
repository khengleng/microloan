"use client";
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useParams } from 'next/navigation';
import Cookies from 'js-cookie';

export default function LoginPage() {
    const t = useTranslations('Index');
    const { locale } = useParams();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const router = useRouter();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/v1'}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            if (!res.ok) throw new Error('Login failed');
            const data = await res.json();
            Cookies.set('access_token', data.access_token);
            Cookies.set('refresh_token', data.refresh_token);
            router.push('/en/dashboard');
        } catch {
            alert('Login failed. Ensure seed.ts was run and API is up.');
        }
    };

    return (
        <div className="flex h-screen items-center justify-center bg-gray-50">
            <div className="w-full max-w-md p-8 bg-white rounded-lg shadow">
                <h1 className="text-2xl font-bold text-center mb-6">{t('title')}</h1>
                <form onSubmit={handleLogin} className="space-y-4">
                    <div>
                        <label htmlFor="email" className="block text-sm font-medium mb-1">Email</label>
                        <input
                            id="email"
                            type="email"
                            autoComplete="email"
                            className="w-full border p-2 rounded"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                        />
                    </div>
                    <div>
                        <label htmlFor="password" className="block text-sm font-medium mb-1">Password</label>
                        <input
                            id="password"
                            type="password"
                            autoComplete="current-password"
                            className="w-full border p-2 rounded"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                        />
                    </div>
                    <button type="submit" className="w-full bg-blue-600 text-white p-2 rounded hover:bg-blue-700">
                        {t('login')}
                    </button>
                    <div className="text-center mt-4 text-sm text-gray-500">
                        New operator? <button type="button" onClick={() => router.push(`/${locale}/register`)} className="text-blue-600 hover:underline">Register your organization</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
