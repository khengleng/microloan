"use client";

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { ReactNode } from 'react';

export const LENDING_TABS: { href: string; label: string }[] = [
    { href: '/lending/catalogue', label: 'Catalogue' },
    { href: '/lending/products', label: 'Products' },
    { href: '/lending/policies', label: 'Policy library' },
    { href: '/lending/simulator', label: 'Simulator' },
    { href: '/lending/workflows', label: 'Workflows' },
    { href: '/lending/applications', label: 'Applications' },
    { href: '/lending/loans', label: 'Loans' },
    { href: '/lending/facilities', label: 'Facilities' },
    { href: '/lending/groups', label: 'Groups' },
    { href: '/lending/collections', label: 'Collections' },
    { href: '/lending/recovery', label: 'Recovery' },
    { href: '/lending/suspense', label: 'Unidentified payments' },
    { href: '/lending/payment-channels', label: 'Payment channels' },
    { href: '/lending/restructures', label: 'Restructures' },
    { href: '/lending/relief', label: 'Relief programmes' },
    { href: '/lending/documents', label: 'Documents' },
    { href: '/lending/accounting', label: 'Accounting' },
    { href: '/lending/operations', label: 'Operations' },
    { href: '/lending/audit', label: 'Audit' },
    { href: '/lending/access', label: 'Access & policy' },
];

/** Page frame for the lending module: sub-navigation, title and actions. */
export function LendingShell({ title, subtitle, actions, children, back }: {
    title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; back?: { href: string; label: string };
}) {
    const { locale } = useParams();
    const pathname = usePathname() || '';
    const base = `/${locale}`;
    return (
        <div className="max-w-[1280px] mx-auto space-y-5 pb-10">
            <nav className="flex gap-1 overflow-x-auto no-scrollbar border-b border-[#E3E8EE] -mt-1">
                {LENDING_TABS.map((t) => {
                    const active = pathname === `${base}${t.href}` || pathname.startsWith(`${base}${t.href}/`);
                    return (
                        <Link
                            key={t.href}
                            href={`${base}${t.href}`}
                            className={`px-3 py-2 text-[13px] font-semibold whitespace-nowrap -mb-px border-b-2 transition-colors ${active ? 'border-[#635BFF] text-[#635BFF]' : 'border-transparent text-[#697386] hover:text-[#1A1F36]'}`}
                        >
                            {t.label}
                        </Link>
                    );
                })}
            </nav>
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
                <div className="min-w-0">
                    {back && (
                        <Link href={`${base}${back.href}`} className="text-[12px] font-semibold text-[#635BFF] hover:underline">← {back.label}</Link>
                    )}
                    <h1 className="text-2xl font-bold text-[#1A1F36] tracking-tight">{title}</h1>
                    {subtitle && <p className="text-[#697386] text-[14px] mt-0.5">{subtitle}</p>}
                </div>
                {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
            </div>
            {children}
        </div>
    );
}

/** Locale-aware href for lending links. */
export function useLendingHref() {
    const { locale } = useParams();
    return (path: string) => `/${locale}${path}`;
}
