"use client";
import { useTranslations } from "next-intl";
import Link from 'next/link';
import Cookies from 'js-cookie';

import { useParams } from 'next/navigation';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const { locale } = useParams();
    const t = useTranslations('Nav');

    return (
        <div className="flex h-screen bg-gray-100">
            <aside className="w-64 bg-slate-900 text-white flex flex-col">
                <div className="p-4 font-bold text-xl border-b border-slate-800">MicroLend OS</div>
                <nav className="flex-1 p-4 space-y-2">
                    <Link href={`/${locale}/dashboard`} className="block px-4 py-2 rounded hover:bg-slate-800">{t('dashboard')}</Link>
                    <Link href={`/${locale}/borrowers`} className="block px-4 py-2 rounded hover:bg-slate-800">{t('borrowers')}</Link>
                    <Link href={`/${locale}/loans`} className="block px-4 py-2 rounded hover:bg-slate-800">{t('loans')}</Link>
                    <Link href={`/${locale}/products`} className="block px-4 py-2 rounded hover:bg-slate-800">Loan Products</Link>
                    <Link href={`/${locale}/tenants`} className="block px-4 py-2 rounded hover:bg-slate-800">Organizations</Link>
                    <Link href={`/${locale}/repayments`} className="block px-4 py-2 rounded hover:bg-slate-800">{t('repayments')}</Link>
                    <Link href={`/${locale}/reports`} className="block px-4 py-2 rounded hover:bg-slate-800">{t('reports')}</Link>
                </nav>
                <div className="p-4 border-t border-slate-800">
                    <button
                        onClick={() => {
                            Cookies.remove('access_token');
                            Cookies.remove('refresh_token');
                            window.location.href = `/${locale}/login`;
                        }}
                        className="block w-full text-left px-4 py-2 text-slate-300 hover:text-white"
                    >
                        {t('logout')}
                    </button>
                </div>
            </aside>
            <main className="flex-1 overflow-auto">
                {/* Topbar */}
                <header className="bg-white shadow px-6 py-4 flex justify-between items-center">
                    <h2 className="text-xl font-semibold">MicroLend OS</h2>
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
