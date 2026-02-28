"use client";
import { useTranslations } from "next-intl";
import Link from 'next/link';
import Cookies from 'js-cookie';

import { useParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import api from '@/lib/api';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const { locale } = useParams();
    const t = useTranslations('Nav');
    const [user, setUser] = useState<any>(null);

    useEffect(() => {
        api.get('/auth/me')
            .then(res => setUser(res.data))
            .catch(() => {
                Cookies.remove('access_token');
                window.location.href = `/${locale}/login`;
            });
    }, [locale]);

    const isSuperAdmin = user?.role === 'SUPERADMIN';
    const isAdmin = user?.role === 'ADMIN' || isSuperAdmin;

    return (
        <div className="flex h-screen bg-gray-100">
            <aside className="w-64 bg-slate-900 text-white flex flex-col">
                <div className="p-4 font-bold text-xl border-b border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center text-white text-xs">M</div>
                        Microloan OS
                    </div>
                    {user?.role && <span className="text-[10px] bg-blue-600 px-1.5 py-0.5 rounded uppercase font-extrabold">{user.role}</span>}
                </div>
                <nav className="flex-1 p-4 space-y-1">
                    {!isSuperAdmin && (
                        <>
                            <Link href={`/${locale}/dashboard`} className="block px-4 py-2 rounded hover:bg-slate-800 transition-colors">{t('dashboard')}</Link>
                            <Link href={`/${locale}/borrowers`} className="block px-4 py-2 rounded hover:bg-slate-800 transition-colors">{t('borrowers')}</Link>
                            <Link href={`/${locale}/loans`} className="block px-4 py-2 rounded hover:bg-slate-800 transition-colors">{t('loans')}</Link>
                            <Link href={`/${locale}/products`} className="block px-4 py-2 rounded hover:bg-slate-800 transition-colors">Loan Products</Link>
                            <Link href={`/${locale}/repayments`} className="block px-4 py-2 rounded hover:bg-slate-800 transition-colors">{t('repayments')}</Link>
                            <Link href={`/${locale}/reports`} className="block px-4 py-2 rounded hover:bg-slate-800 transition-colors">{t('reports')}</Link>
                        </>
                    )}
                    {isSuperAdmin && (
                        <Link href={`/${locale}/tenants`} className="block px-4 py-2 rounded hover:bg-slate-800 transition-colors">Organizations</Link>
                    )}
                    {isAdmin && !isSuperAdmin && (
                        <Link href={`/${locale}/settings`} className="block px-4 py-2 rounded hover:bg-slate-800 transition-colors">Settings</Link>
                    )}
                </nav>
                <div className="p-4 border-t border-slate-800 space-y-2">
                    <div className="px-4 text-xs text-slate-500 font-medium truncate">{user?.email}</div>
                    <button
                        onClick={() => {
                            Cookies.remove('access_token');
                            Cookies.remove('refresh_token');
                            window.location.href = `/${locale}/login`;
                        }}
                        className="block w-full text-left px-4 py-2 text-slate-300 hover:text-white transition-colors"
                    >
                        {t('logout')}
                    </button>
                </div>
            </aside>
            <main className="flex-1 overflow-auto">
                {/* Topbar */}
                <header className="bg-white shadow px-6 py-4 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-xl">M</div>
                        <span className="text-2xl font-bold tracking-tight">Microloan OS</span>
                    </div>
                    <div className="flex gap-2">
                        <Link href={`/en/dashboard`} className={`px-2 py-1 text-sm rounded ${locale === 'en' ? 'bg-slate-900 text-white' : 'bg-gray-100'}`}>EN</Link>
                        <Link href={`/km/dashboard`} className={`px-2 py-1 text-sm rounded ${locale === 'km' ? 'bg-slate-900 text-white' : 'bg-gray-100'}`}>ខ្មែរ</Link>
                    </div>
                </header>
                <div className="p-6">
                    {children}
                </div>
            </main>
        </div>
    );
}
