"use client";

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Archive } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace';

/**
 * States plainly that a screen covers the original (legacy) loans module only,
 * and links to the lending-platform screens that cover the main book.
 */
export function LegacyModuleNote({ extra }: { extra?: string }) {
    const { locale } = useParams();
    const o = useTranslations('Overview');
    const { can } = useWorkspace();
    const links = [
        { href: '/dashboard', label: o('linkDashboard'), show: can('loan.read') },
        { href: '/lending/loans', label: o('linkLendingLoans'), show: can('loan.read') },
        { href: '/lending/regulatory', label: o('linkRegulatory'), show: can('accounting.read') },
        { href: '/lending/accounting', label: o('linkLendingAccounting'), show: can('accounting.read') },
    ].filter((l) => l.show);
    return (
        <div role="note" className="border border-amber-200 bg-amber-50 rounded-md px-4 py-3 text-[13px] text-amber-900 flex items-start gap-2">
            <Archive size={16} className="mt-0.5 shrink-0" />
            <div>
                <p className="font-bold">{o('legacyModuleOnly')}</p>
                <p>{o('legacyModuleOnlyBody')}{extra ? ` ${extra}` : ''}</p>
                {links.length > 0 && (
                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                        {links.map((l) => (
                            <Link key={l.href} href={`/${locale}${l.href}`} className="underline font-semibold">{l.label}</Link>
                        ))}
                    </p>
                )}
            </div>
        </div>
    );
}
