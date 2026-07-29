"use client";

import { usePathname, useRouter, useParams } from 'next/navigation';
import { Globe } from 'lucide-react';

/**
 * Language switch for the signed-out screens.
 *
 * The authenticated shell has had one since the sidebar existed, but login,
 * register and the signup payment page had none — so a Khmer reader landing on
 * /en/login had no way out except editing the URL. For a product serving both
 * Cambodian and international institutions, the switch has to be reachable
 * *before* you have an account.
 *
 * Labels are written in their own language, never translated: someone who
 * cannot read the current locale still needs to recognise their own.
 */
const LOCALES = [
    { code: 'en', label: 'English', short: 'EN' },
    { code: 'km', label: 'ខ្មែរ', short: 'ខ្មែរ' },
] as const;

export function LocaleSwitch({ className = '' }: { className?: string }) {
    const router = useRouter();
    const pathname = usePathname();
    const { locale } = useParams();
    const active = typeof locale === 'string' ? locale : 'en';

    /** Swap the leading locale segment so the switch stays on this page. */
    const switchTo = (target: string) => {
        const parts = (pathname || `/${active}`).split('/');
        if (parts.length > 1) parts[1] = target;
        router.push(parts.join('/') || `/${target}`);
    };

    return (
        <div
            className={`inline-flex items-center gap-1 rounded-lg border border-border bg-card p-0.5 ${className}`}
        >
            <Globe size={13} className="text-muted-foreground ml-1.5 mr-0.5 shrink-0" aria-hidden />
            {LOCALES.map(l => {
                const current = l.code === active;
                return (
                    <button
                        key={l.code}
                        type="button"
                        onClick={() => !current && switchTo(l.code)}
                        aria-current={current ? 'true' : undefined}
                        lang={l.code}
                        title={l.label}
                        className={`px-2 py-1 text-[12px] rounded-md transition-colors ${current
                            ? 'bg-primary text-white font-semibold'
                            : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                            }`}
                    >
                        {l.short}
                    </button>
                );
            })}
        </div>
    );
}
