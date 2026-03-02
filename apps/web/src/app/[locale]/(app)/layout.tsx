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
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-semibold transition-all ${active
                    ? 'bg-[#F6F9FC] text-[#635BFF]'
                    : 'text-[#4F566B] hover:bg-[#F6F9FC] hover:text-[#1A1F36]'
                    }`}
            >
                <Icon size={16} className={`${active ? 'text-[#635BFF]' : 'text-[#AAB7C4]'} transition-colors`} />
                <span className="tracking-tight">{label}</span>
            </Link>
        );
    };


    return (
        <div className="flex h-screen bg-[#F6F9FC]">
            {/* Mobile overlay */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 bg-black/5 z-20 lg:hidden backdrop-blur-[2px]"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={`fixed lg:relative inset-y-0 left-0 z-30 w-64 bg-white border-r border-[#E3E8EE] flex flex-col flex-shrink-0 transition-transform duration-300 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
                }`}>
                {/* Brand */}
                <div className="h-16 flex items-center px-6 border-b border-[#E3E8EE]">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 bg-[#635BFF] rounded-md flex items-center justify-center text-white text-sm font-bold shadow-[0_2px_4px_rgba(99,91,255,0.2)] flex-shrink-0">
                            {user?.tenantName ? user.tenantName.charAt(0).toUpperCase() : 'M'}
                        </div>
                        <h2 className="text-[15px] font-bold text-[#1A1F36] truncate tracking-tight">{user?.tenantName || 'Magic Money'}</h2>
                    </div>
                </div>

                {/* Nav */}
                <nav className="flex-1 p-4 space-y-1 overflow-y-auto no-scrollbar">
                    {/* SUPERADMIN sees Platform + their team */}
                    {isSuperAdmin && (
                        <div className="pb-4">
                            <p className="text-[11px] uppercase text-[#AAB7C4] px-3 py-2 font-bold tracking-wider">Platform</p>
                            {navItem('/tenants', 'Organizations', Building)}
                            {navItem('/users', 'My Team', UserCog)}
                            {navItem('/audit', 'Audit Log', Shield)}
                        </div>
                    )}

                    {/* Tenant staff navigation */}
                    {!isSuperAdmin && (
                        <div className="space-y-4">
                            <div>
                                <p className="text-[11px] uppercase text-[#AAB7C4] px-3 py-2 font-bold tracking-wider">Operations</p>
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
                                    <p className="text-[11px] uppercase text-[#AAB7C4] px-3 py-2 font-bold tracking-wider">Management</p>
                                    {navItem('/users', 'Team', UserCog)}
                                    {navItem('/audit', 'Activity', Shield)}
                                    {navItem('/settings', 'Settings', Settings)}
                                </div>
                            )}
                        </div>
                    )}
                </nav>

                {/* User footer */}
                <div className="p-4 border-t border-[#E3E8EE] bg-[#F7FAFC]">
                    <div className="flex items-center gap-2 mb-4 px-3">
                        <div className="w-8 h-8 rounded-full bg-[#E3E8EE] flex items-center justify-center text-[10px] font-bold text-[#4F566B]">
                            {user?.email?.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                            <p className="text-[12px] font-bold text-[#1A1F36] truncate">{user?.email?.split('@')[0]}</p>
                            <p className="text-[10px] text-[#697386] font-medium truncate">{user?.role}</p>
                        </div>
                    </div>
                    <button
                        onClick={async () => {
                            await fetch('/api/auth/logout', { method: 'POST' });
                            window.location.href = `/${locale}/login`;
                        }}
                        className="flex items-center gap-2 w-full px-3 py-2 text-[12px] font-bold text-[#697386] hover:text-[#1A1F36] transition-colors"
                    >
                        <LogOut size={14} />
                        Sign Out
                    </button>
                </div>
            </aside>

            {/* Main */}
            <main className="flex-1 overflow-auto flex flex-col min-w-0">
                {/* Topbar */}
                <header className="h-16 bg-white border-b border-[#E3E8EE] px-8 flex justify-between items-center sticky top-0 z-20 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => setSidebarOpen(true)}
                            className="lg:hidden p-2 rounded-md text-[#4F566B] hover:bg-[#F6F9FC] transition-colors"
                        >
                            <Menu size={20} />
                        </button>
                        <div className="h-4 w-[1px] bg-[#E3E8EE] hidden lg:block" />
                        <div className="text-[13px] font-bold text-[#697386] hidden sm:block">
                            MicroLend <span className="text-[#AAB7C4] mx-1">/</span> {pathname.split('/').pop()?.toUpperCase()}
                        </div>
                    </div>
                    <div className="flex items-center gap-1 bg-[#F6F9FC] p-0.5 rounded-md border border-[#E3E8EE]">
                        <Link href={`/en/dashboard`} className={`px-3 py-1 text-[11px] rounded-sm font-bold transition-all ${locale === 'en' ? 'bg-white text-[#1A1F36] shadow-sm' : 'text-[#697386] hover:text-[#1A1F36]'}`}>EN</Link>
                        <Link href={`/km/dashboard`} className={`px-3 py-1 text-[11px] rounded-sm font-bold transition-all ${locale === 'km' ? 'bg-white text-[#1A1F36] shadow-sm' : 'text-[#697386] hover:text-[#1A1F36]'}`}>KM</Link>
                    </div>
                </header>
                <div className="p-8 max-w-7xl w-full mx-auto">
                    {children}
                </div>
            </main>
        </div>
    );
}
