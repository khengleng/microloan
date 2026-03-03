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
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-[13px] font-bold transition-all duration-200 ${active
                        ? 'bg-primary text-primary-foreground'
                        : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground'
                    }`}
            >
                <Icon size={18} className={`${active ? 'text-primary-foreground' : 'text-sidebar-foreground'} transition-colors flex-shrink-0`} />
                <span className="tracking-tight">{label}</span>
            </Link>
        );
    };


    return (
        <div className="flex h-screen bg-background text-foreground font-sans selection:bg-primary selection:text-primary-foreground">
            {/* Mobile overlay */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/60 z-40 lg:hidden backdrop-blur-md"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={`fixed lg:relative inset-y-0 left-0 z-50 w-64 bg-sidebar border-r border-border flex flex-col flex-shrink-0 transition-transform duration-300 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
                }`}>
                {/* Brand */}
                <div className="h-20 flex items-center px-6 border-b border-border/50">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center text-primary-foreground text-lg font-black shadow-[0_0_15px_rgba(217,233,84,0.2)] flex-shrink-0">
                            {user?.tenantName ? user.tenantName.charAt(0).toUpperCase() : 'M'}
                        </div>
                        <h2 className="text-[16px] font-black text-foreground truncate tracking-tight">{user?.tenantName || 'Magic Money'}</h2>
                    </div>
                </div>

                {/* Nav */}
                <nav className="flex-1 p-4 space-y-1 overflow-y-auto no-scrollbar">
                    {/* SUPERADMIN sees Platform + their team */}
                    {isSuperAdmin && (
                        <div className="pb-6">
                            <p className="text-[10px] uppercase text-muted-foreground px-4 py-2 font-black tracking-widest">Platform</p>
                            {navItem('/tenants', 'Organizations', Building)}
                            {navItem('/users', 'My Team', UserCog)}
                            {navItem('/audit', 'Audit Log', Shield)}
                        </div>
                    )}

                    {/* Tenant staff navigation */}
                    {!isSuperAdmin && (
                        <div className="space-y-6">
                            <div>
                                <p className="text-[10px] uppercase text-muted-foreground px-4 py-2 font-black tracking-widest">Operations</p>
                                {navItem('/dashboard', 'Home', LayoutDashboard)}
                                {(isSales || isFinance) && navItem('/borrowers', 'Customers', Users)}
                                {(isSales || isFinance) && navItem('/loans', 'Payments', FileText)}
                                {isFinance && navItem('/repayments', 'Balances', CreditCard)}
                                {isFinance && navItem('/collections', 'Radar', AlertTriangle)}
                                {isFinance && navItem('/reports', 'Reports', BarChart2)}
                                {navItem('/products', 'Products', BarChart2)}
                            </div>

                            {isAdmin && (
                                <div>
                                    <p className="text-[10px] uppercase text-muted-foreground px-4 py-2 font-black tracking-widest">Management</p>
                                    {navItem('/users', 'Team', UserCog)}
                                    {navItem('/audit', 'Activity', Shield)}
                                    {navItem('/settings', 'Settings', Settings)}
                                </div>
                            )}
                        </div>
                    )}
                </nav>

                {/* User footer */}
                <div className="p-4 border-t border-border/50 bg-sidebar/50">
                    <div className="flex items-center gap-3 mb-4 px-3 py-2 rounded-2xl bg-sidebar-accent/50 border border-border/30">
                        <div className="w-10 h-10 rounded-full bg-border/50 flex items-center justify-center text-xs font-black text-foreground border border-white/5">
                            {user?.email?.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                            <p className="text-[13px] font-black text-foreground truncate capitalize">{user?.email?.split('@')[0]}</p>
                            <p className="text-[11px] text-muted-foreground font-bold truncate uppercase tracking-widest">{user?.role}</p>
                        </div>
                    </div>
                    <button
                        onClick={async () => {
                            await fetch('/api/auth/logout', { method: 'POST' });
                            window.location.href = `/${locale}/login`;
                        }}
                        className="flex items-center gap-2 w-full px-4 py-3 text-[13px] font-bold text-muted-foreground hover:text-foreground hover:bg-destructive/10 hover:text-destructive rounded-xl transition-all"
                    >
                        <LogOut size={16} />
                        Sign Out
                    </button>
                </div>
            </aside>

            {/* Main */}
            <main className="flex-1 overflow-auto flex flex-col min-w-0">
                {/* Topbar */}
                <header className="h-20 bg-background/80 backdrop-blur-xl border-b border-border/30 px-8 flex justify-between items-center sticky top-0 z-40 shadow-sm">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => setSidebarOpen(true)}
                            className="lg:hidden p-2 rounded-xl text-muted-foreground hover:bg-sidebar-accent hover:text-foreground transition-all"
                        >
                            <Menu size={22} />
                        </button>
                        <div className="h-5 w-[1px] bg-border/50 hidden lg:block" />
                        <div className="text-[13px] font-black text-muted-foreground hidden sm:block tracking-tight">
                            MicroLend <span className="text-border mx-2 opacity-50">/</span> <span className="text-foreground">{pathname.split('/').pop()?.toUpperCase()}</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-1 bg-border/20 p-1 rounded-xl border border-border/30">
                        <Link href={`/en/dashboard`} className={`px-4 py-1.5 text-[11px] rounded-lg font-black transition-all ${locale === 'en' ? 'bg-primary text-primary-foreground shadow-md' : 'text-muted-foreground hover:text-foreground'}`}>EN</Link>
                        <Link href={`km/dashboard`} className={`px-4 py-1.5 text-[11px] rounded-lg font-black transition-all ${locale === 'km' ? 'bg-primary text-primary-foreground shadow-md' : 'text-muted-foreground hover:text-foreground'}`}>KM</Link>
                    </div>
                </header>
                <div className="p-8 max-w-7xl w-full mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700">
                    {children}
                </div>
            </main>
        </div>
    );
}
