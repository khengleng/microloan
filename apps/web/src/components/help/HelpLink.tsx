"use client";

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CircleHelp } from 'lucide-react';
import { guideHref } from '@/lib/user-guide';

/**
 * A small "Help" link to a user-guide chapter (and section). It opens in a new
 * tab so work in progress on the page is kept. An unknown chapter falls back
 * to the guide's contents.
 */
export function HelpLink({ chapter, anchor, label, className = '' }: {
    chapter: string; anchor?: string; label?: string; className?: string;
}) {
    const { locale } = useParams<{ locale: string }>();
    const t = useTranslations('Help');
    const href = guideHref(locale ?? 'en', { chapter, anchor });
    return (
        <Link
            href={href}
            target="_blank"
            rel="noopener"
            title={t('openGuide')}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[12px] font-semibold text-[#635BFF] hover:bg-[#F0F5FF] hover:underline ${className}`}
        >
            <CircleHelp size={13} aria-hidden="true" />
            {label ?? t('link')}
        </Link>
    );
}
