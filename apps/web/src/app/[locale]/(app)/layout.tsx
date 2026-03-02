"use client";
import { useTranslations } from "next-intl";
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';

import api from '@/lib/api';
import {
    LayoutDashboard, Users, FileText, CreditCard, BarChart2,
    Settings, Building, LogOut, ChevronRight, ShieldCheck, AlertTriangle, UserCog, Shield, Menu, X
} from 'lucide-react';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const { locale } = useParams();
    const pathname = usePathname();
    const t = useTranslations('Nav');
    const [user, setUser] = useState<any>(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);

    useEffect(() => {
        api.get('/auth/me')
            .then(res => setUser(res.data))
            .catch(() => {
                // Session invalid — redirect to login (server will clear cookies if needed)
                window.location.href = `/${locale}/login`;
            });
    }, [locale]);

    const role = user?.role;
    const isSuperAdmin = role === 'SUPERADMIN';
    const isAdmin = role === 'ADMIN' || isSuperAdmin;
    const isFinance = role === 'FINANCE' || isAdmin;
    const isSales = role === 'SALES' || isAdmin;

    const navItem = (href: string, label: string, Icon: any) => {
        const active = pathname === `/${locale}${href}`;
        return (
            <Link
                href={`/${locale}${href}`}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${active
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
            >
                <Icon size={17} className="flex-shrink-0" />
                {label}
                {active && <ChevronRight size={14} className="ml-auto opacity-70" />}
            </Link>
        );
    };


    return (
        <div className="flex h-screen bg-slate-50">
            {/* Mobile overlay */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-20 lg:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={`fixed lg:relative inset-y-0 left-0 z-30 w-60 bg-slate-900 text-white flex flex-col flex-shrink-0 shadow-xl transition-transform duration-200 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
                }`}>
                {/* Brand */}
                <div className="p-4 border-b border-slate-800">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                            {user?.tenantName ? user.tenantName.charAt(0).toUpperCase() : '·'}
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-bold text-white truncate">{user?.tenantName || '...'}</p>
                            {role && (
                                <span className="text-[9px] uppercase font-extrabold tracking-wide text-blue-400">{role}</span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Nav */}
                <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
                    {/* SUPERADMIN sees Platform + their team */}
                    {isSuperAdmin && (
                        <>
                            <p className="text-[10px] uppercase text-slate-500 px-3 pt-2 pb-1 font-semibold tracking-widest">Platform</p>
                            {navItem('/tenants', 'Organizations', Building)}
                            <p className="text-[10px] uppercase text-slate-500 px-3 pt-4 pb-1 font-semibold tracking-widest">PaaS Admin</p>
                            {navItem('/users', 'My Team', UserCog)}
                            {navItem('/audit', 'Audit Log', Shield)}
                        </>
                    )}

                    {/* Tenant staff navigation */}
                    {!isSuperAdmin && (
                        <>
                            <p className="text-[10px] uppercase text-slate-500 px-3 pt-2 pb-1 font-semibold tracking-widest">Operations</p>
                            {navItem('/dashboard', t('dashboard'), LayoutDashboard)}
                            {(isSales || isFinance) && navItem('/borrowers', t('borrowers'), Users)}
                            {(isSales || isFinance) && navItem('/loans', t('loans'), FileText)}
                            {isFinance && navItem('/repayments', t('repayments'), CreditCard)}
                            {isFinance && navItem('/collections', 'Collections', AlertTriangle)}
                            {isFinance && navItem('/reports', t('reports'), BarChart2)}
                            {navItem('/products', 'Loan Products', BarChart2)}

                            {isAdmin && (
                                <>
                                    <p className="text-[10px] uppercase text-slate-500 px-3 pt-4 pb-1 font-semibold tracking-widest">Admin</p>
                                    {navItem('/users', 'Team Members', UserCog)}
                                    {navItem('/audit', 'Audit Log', Shield)}
                                    {navItem('/settings', 'Settings', Settings)}
                                </>
                            )}
                        </>
                    )}
                </nav>

                {/* User footer */}
                <div className="p-3 border-t border-slate-800">
                    {user?.twoFactorEnabled && (
                        <div className="flex items-center gap-1.5 px-3 py-1 mb-2 text-[10px] text-emerald-400 font-medium">
                            <ShieldCheck size={12} />
                            MFA Active
                        </div>
                    )}
                    <div className="px-3 py-1 text-xs text-slate-500 truncate mb-1">{user?.email}</div>
                    <button
                        onClick={async () => {
                            // Call the server route to clear HttpOnly cookies
                            // (client JS cannot clear HttpOnly cookies directly)
                            await fetch('/api/auth/logout', { method: 'POST' });
                            window.location.href = `/${locale}/login`;
                        }}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-all"
                    >
                        <LogOut size={15} />
                        {t('logout')}
                    </button>
                </div>
            </aside>

            {/* Main */}
            <main className="flex-1 overflow-auto min-w-0">
                {/* Topbar */}
                <header className="bg-white border-b border-slate-100 px-4 sm:px-6 py-3 flex justify-between items-center sticky top-0 z-10">
                    <div className="flex items-center gap-3">
                        {/* Hamburger — mobile only */}
                        <button
                            onClick={() => setSidebarOpen(true)}
                            className="lg:hidden p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
                        >
                            <Menu size={20} />
                        </button>
                        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-sm text-white hidden sm:flex">
                            {user?.tenantName ? user.tenantName.charAt(0).toUpperCase() : '·'}
                        </div>
                        <span className="text-lg font-bold tracking-tight text-slate-800">{user?.tenantName || '...'}</span>
                    </div>
                    <div className="flex gap-1.5">
                        <Link href={`/en/dashboard`} className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${locale === 'en' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>EN</Link>
                        <Link href={`/km/dashboard`} className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${locale === 'km' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>ខ្មែរ</Link>
                    </div>
                </header>
                <div className="p-6 max-w-7xl mx-auto">
                    {children}
                </div>
            </main>
        </div>
    );
}
