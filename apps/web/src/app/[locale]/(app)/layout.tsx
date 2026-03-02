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
            .catch((err) => {
                // ONLY redirect on 401 Unauthorized. 
                // Other errors (500, 502) should probably stay on page or show a retry.
                if (err.response?.status === 401) {
                    window.location.href = `/${locale}/login`;
                } else {
                    console.error('[Session Check Failed]', err.message);
                }
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
                className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-semibold transition-all duration-300 ${active
                    ? 'bg-white/10 text-white shadow-[0_0_20px_rgba(99,102,241,0.3)] backdrop-blur-sm'
                    : 'text-white/60 hover:bg-white/5 hover:text-white'
                    }`}
            >
                <Icon size={18} className={`${active ? 'text-indigo-300' : 'text-white/40'} transition-colors`} />
                <span className="tracking-wide">{label}</span>
                {active && <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 ml-auto shadow-[0_0_8px_#818cf8]" />}
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
            <aside className={`fixed lg:relative inset-y-0 left-0 z-30 w-64 bg-slate-950 bg-gradient-to-b from-[#0F172A] to-[#1E1B4B] text-white flex flex-col flex-shrink-0 shadow-2xl transition-transform duration-300 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
                }`}>
                {/* Brand */}
                <div className="p-6 border-b border-white/5">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-2xl flex items-center justify-center text-white text-lg font-black shadow-lg shadow-indigo-500/20 flex-shrink-0">
                            {user?.tenantName ? user.tenantName.charAt(0).toUpperCase() : 'M'}
                        </div>
                        <div className="min-w-0">
                            <p className="text-base font-extrabold text-white truncate leading-tight tracking-tight">{user?.tenantName || 'Magic Money'}</p>
                            {role && (
                                <span className="text-[10px] uppercase font-black tracking-widest text-indigo-400/80">{role}</span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Nav */}
                <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto custom-scrollbar">
                    {/* SUPERADMIN sees Platform + their team */}
                    {isSuperAdmin && (
                        <>
                            <p className="text-[11px] uppercase text-white/30 px-4 pt-4 pb-2 font-black tracking-[0.2em]">Platform</p>
                            {navItem('/tenants', 'Organizations', Building)}
                            <p className="text-[10px] uppercase text-slate-500 px-3 pt-4 pb-1 font-semibold tracking-widest">PaaS Admin</p>
                            {navItem('/users', 'My Team', UserCog)}
                            {navItem('/audit', 'Audit Log', Shield)}
                        </>
                    )}

                    {/* Tenant staff navigation */}
                    {!isSuperAdmin && (
                        <>
                            <p className="text-[11px] uppercase text-white/30 px-4 pt-4 pb-2 font-black tracking-[0.2em]">Operations</p>
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
                <div className="p-4 border-t border-white/5 bg-black/20">
                    {user?.twoFactorEnabled && (
                        <div className="flex items-center gap-2 px-4 py-1.5 mb-3 text-[10px] text-emerald-400 font-black bg-emerald-400/10 rounded-full w-fit">
                            <ShieldCheck size={12} />
                            MFA PROTECTED
                        </div>
                    )}
                    <div className="px-4 py-1 text-xs text-white/40 truncate mb-2 font-medium">{user?.email}</div>
                    <button
                        onClick={async () => {
                            // Call the server route to clear HttpOnly cookies
                            // (client JS cannot clear HttpOnly cookies directly)
                            await fetch('/api/auth/logout', { method: 'POST' });
                            window.location.href = `/${locale}/login`;
                        }}
                        className="flex items-center gap-3 w-full px-4 py-3 text-sm font-bold text-white/60 hover:text-white hover:bg-white/10 rounded-2xl transition-all duration-300"
                    >
                        <LogOut size={16} className="text-white/40" />
                        {t('logout')}
                    </button>
                </div>
            </aside>

            {/* Main */}
            <main className="flex-1 overflow-auto min-w-0 bg-[#F8FAFC]">
                {/* Topbar */}
                <header className="bg-white/80 backdrop-blur-xl border-b border-slate-200/50 px-6 py-4 flex justify-between items-center sticky top-0 z-20">
                    <div className="flex items-center gap-4">
                        {/* Hamburger — mobile only */}
                        <button
                            onClick={() => setSidebarOpen(true)}
                            className="lg:hidden p-2 rounded-2xl text-slate-600 hover:bg-slate-100 transition-colors"
                        >
                            <Menu size={24} />
                        </button>
                        <div className="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center font-black text-lg text-white hidden sm:flex shadow-lg shadow-indigo-600/20">
                            {user?.tenantName ? user.tenantName.charAt(0).toUpperCase() : 'M'}
                        </div>
                        <span className="text-xl font-black tracking-tight text-slate-900 leading-none">{user?.tenantName || 'Magic Money'}</span>
                    </div>
                    <div className="flex gap-2">
                        <Link href={`/en/dashboard`} className={`px-4 py-1.5 text-xs rounded-full font-black tracking-widest transition-all ${locale === 'en' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>EN</Link>
                        <Link href={`/km/dashboard`} className={`px-4 py-1.5 text-xs rounded-full font-black tracking-widest transition-all ${locale === 'km' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>ខ្មែរ</Link>
                    </div>
                </header>
                <div className="p-6 max-w-7xl mx-auto">
                    {children}
                </div>
            </main>
        </div>
    );
}
