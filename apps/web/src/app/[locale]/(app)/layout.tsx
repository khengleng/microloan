"use client";
import { useTranslations } from "next-intl";
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';

import api from '@/lib/api';
import {
    LayoutDashboard, Users, FileText, CreditCard, BarChart2,
    Settings, Building, LogOut, ShieldCheck, AlertTriangle, UserCog, Shield, Menu
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
                className={`flex items-center gap-2.5 px-3 py-2 rounded text-[13px] font-medium transition-colors duration-150 ${active
                        ? 'bg-secondary text-foreground'
                        : 'text-sidebar-foreground hover:bg-secondary/60 hover:text-foreground'
                    }`}
            >
                <Icon size={16} className={active ? 'text-primary' : 'text-muted-foreground'} />
                <span>{label}</span>
                {active && <div className="ml-auto w-0.5 h-4 bg-primary rounded-full" />}
            </Link>
        );
    };

    return (
        <div className="flex h-screen bg-background text-foreground" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
            {/* Mobile overlay */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 lg:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={`fixed lg:relative inset-y-0 left-0 z-50 w-56 bg-sidebar border-r border-border flex flex-col flex-shrink-0 transition-transform duration-200 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
                }`}>
                {/* Brand */}
                <div className="h-14 flex items-center px-4 border-b border-border gap-2.5">
                    <div className="w-7 h-7 bg-primary rounded flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                        {user?.tenantName ? user.tenantName.charAt(0).toUpperCase() : 'M'}
                    </div>
                    <span className="text-[14px] font-bold text-foreground truncate">{user?.tenantName || 'MicroLend'}</span>
                </div>

                {/* Nav */}
                <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto no-scrollbar">
                    {isSuperAdmin && (
                        <div className="pb-4">
                            <p className="text-[11px] uppercase text-muted-foreground px-3 py-2 font-bold tracking-wider">Platform</p>
                            {navItem('/tenants', 'Organizations', Building)}
                            {navItem('/users', 'My Team', UserCog)}
                            {navItem('/audit', 'Audit Log', Shield)}
                        </div>
                    )}

                    {!isSuperAdmin && (
                        <div className="space-y-4">
                            <div>
                                <p className="text-[11px] uppercase text-muted-foreground px-3 py-2 font-bold tracking-wider">Operations</p>
                                {navItem('/dashboard', 'Dashboard', LayoutDashboard)}
                                {(isSales || isFinance) && navItem('/borrowers', 'Borrowers', Users)}
                                {(isSales || isFinance) && navItem('/loans', 'Loans', FileText)}
                                {isFinance && navItem('/repayments', 'Repayments', CreditCard)}
                                {isFinance && navItem('/collections', 'Collections', AlertTriangle)}
                                {isFinance && navItem('/reports', 'Reports', BarChart2)}
                                {navItem('/products', 'Products', BarChart2)}
                            </div>

                            {isAdmin && (
                                <div>
                                    <p className="text-[11px] uppercase text-muted-foreground px-3 py-2 font-bold tracking-wider">Admin</p>
                                    {navItem('/users', 'Team', UserCog)}
                                    {navItem('/audit', 'Audit Log', Shield)}
                                    {navItem('/settings', 'Settings', Settings)}
                                </div>
                            )}
                        </div>
                    )}
                </nav>

                {/* User footer */}
                <div className="p-2 border-t border-border">
                    <div className="flex items-center gap-2.5 px-3 py-2.5 rounded bg-secondary/40 mb-1">
                        <div className="w-7 h-7 rounded bg-border flex items-center justify-center text-xs font-bold text-foreground flex-shrink-0">
                            {user?.email?.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                            <p className="text-[13px] font-semibold text-foreground truncate capitalize">{user?.email?.split('@')[0]}</p>
                            <p className="text-[11px] text-muted-foreground truncate">{user?.role}</p>
                        </div>
                    </div>
                    <button
                        onClick={async () => {
                            await fetch('/api/auth/logout', { method: 'POST' });
                            window.location.href = `/${locale}/login`;
                        }}
                        className="flex items-center gap-2 w-full px-3 py-2 text-[13px] text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                    >
                        <LogOut size={14} />
                        Sign Out
                    </button>
                </div>
            </aside>

            {/* Main */}
            <main className="flex-1 overflow-auto flex flex-col min-w-0">
                {/* Topbar */}
                <header className="h-14 bg-sidebar border-b border-border px-5 flex justify-between items-center sticky top-0 z-40">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setSidebarOpen(true)}
                            className="lg:hidden p-1.5 rounded text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                        >
                            <Menu size={18} />
                        </button>
                        <div className="hidden sm:block">
                            <span className="text-[13px] text-muted-foreground">MicroLend</span>
                            <span className="text-[13px] text-border mx-2">/</span>
                            <span className="text-[13px] font-semibold text-foreground capitalize">
                                {pathname.split('/').pop()?.replace('-', ' ')}
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-1 bg-secondary/50 p-0.5 rounded border border-border">
                        <Link href={`/en/dashboard`} className={`px-3 py-1 text-[12px] rounded font-bold transition-all ${locale === 'en' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}>EN</Link>
                        <Link href={`/km/dashboard`} className={`px-3 py-1 text-[12px] rounded font-bold transition-all ${locale === 'km' ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground'}`}>KM</Link>
                    </div>
                </header>
                <div className="p-6 max-w-7xl w-full mx-auto">
                    {children}
                </div>
            </main>
        </div>
    );
}
