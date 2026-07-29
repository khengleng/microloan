"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Check, FileLock2, Landmark, ShieldCheck, Wallet } from 'lucide-react';
import { BrandMark } from '@/components/brand-mark';
import { LocaleSwitch } from '@/components/auth/locale-switch';

/**
 * The landing page.
 *
 * This route used to `redirect()` straight to /login, so a first-time visitor
 * met a password field with no indication of what the product was, what it
 * cost, or that signing up was even possible. Returning users still reach
 * login in one click; everyone else now gets an answer first.
 *
 * Prices come from /auth/plans — the same catalogue the signup page and the
 * KHQR minting read — so the operator repricing a tier updates this page too.
 * A second hardcoded price list here is exactly the drift the PlanTier table
 * was introduced to end.
 */

type Plan = {
    name: string;
    displayName?: string;
    description?: string | null;
    amount: number;
    currency: string;
    requiresPayment: boolean;
    limits: { maxUsers: number | null; maxBorrowers: number | null };
};

export default function HomePage() {
    const t = useTranslations('Home');
    const { locale } = useParams();
    const loc = typeof locale === 'string' ? locale : 'en';
    const [plans, setPlans] = useState<Plan[]>([]);

    useEffect(() => {
        fetch('/api/proxy/auth/plans')
            .then(r => (r.ok ? r.json() : null))
            .then((d: { plans?: Plan[] } | null) => d?.plans && setPlans(d.plans))
            // The page is useful without prices; the section just doesn't render.
            .catch(() => { });
    }, []);

    const quota = (n: number | null) => (n === null ? t('unlimited') : n.toLocaleString());

    const steps = [
        { n: 1, title: t('step1Title'), body: t('step1Body') },
        { n: 2, title: t('step2Title'), body: t('step2Body') },
        { n: 3, title: t('step3Title'), body: t('step3Body') },
    ];

    const features = [
        { Icon: FileLock2, title: t('f1Title'), body: t('f1Body') },
        { Icon: Wallet, title: t('f2Title'), body: t('f2Body') },
        { Icon: Landmark, title: t('f3Title'), body: t('f3Body') },
        { Icon: ShieldCheck, title: t('f4Title'), body: t('f4Body') },
    ];

    return (
        <div className="min-h-screen bg-background">
            <header className="sticky top-0 z-10 border-b border-border bg-background/85 backdrop-blur">
                <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
                    <BrandMark />
                    <div className="flex items-center gap-2">
                        <LocaleSwitch />
                        <Link
                            href={`/${loc}/login`}
                            className="hidden sm:inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                        >
                            {t('navSignIn')}
                        </Link>
                        <Link
                            href={`/${loc}/register`}
                            className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
                        >
                            {t('navStart')}
                        </Link>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-5xl px-4">
                {/* ── Hero ─────────────────────────────────────────────── */}
                <section className="py-16 sm:py-24">
                    <h1 className="max-w-3xl text-[32px] font-bold leading-tight text-foreground sm:text-[44px]">
                        {t('heroTitle')}
                    </h1>
                    <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted-foreground sm:text-[16px]">
                        {t('heroLead')}
                    </p>
                    <div className="mt-8 flex flex-wrap items-center gap-3">
                        <Link
                            href={`/${loc}/register`}
                            className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
                        >
                            {t('ctaPrimary')} <ArrowRight size={16} />
                        </Link>
                        <Link
                            href={`/${loc}/login`}
                            className="inline-flex h-11 items-center rounded-lg border border-border bg-card px-5 text-[14px] font-semibold text-foreground transition-colors hover:border-primary/50"
                        >
                            {t('ctaSecondary')}
                        </Link>
                    </div>
                    <p className="mt-3 text-[12px] text-muted-foreground">{t('ctaNote')}</p>
                </section>

                {/* ── The journey, before you start it ─────────────────── */}
                <section className="border-t border-border py-14">
                    <h2 className="text-[20px] font-bold text-foreground">{t('howTitle')}</h2>
                    <ol className="mt-8 grid gap-6 sm:grid-cols-3">
                        {steps.map(s => (
                            <li key={s.n} className="relative">
                                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-white">
                                    {s.n}
                                </span>
                                <h3 className="mt-3 text-[14px] font-semibold text-foreground">{s.title}</h3>
                                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{s.body}</p>
                            </li>
                        ))}
                    </ol>
                </section>

                {/* ── What it does ─────────────────────────────────────── */}
                <section className="border-t border-border py-14">
                    <h2 className="text-[20px] font-bold text-foreground">{t('featuresTitle')}</h2>
                    <div className="mt-8 grid gap-6 sm:grid-cols-2">
                        {features.map(({ Icon, title, body }) => (
                            <div key={title} className="flex gap-3">
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                                    <Icon size={17} className="text-primary" />
                                </span>
                                <div>
                                    <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
                                    <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* ── Live pricing, straight from the tier table ───────── */}
                {plans.length > 0 && (
                    <section className="border-t border-border py-14">
                        <h2 className="text-[20px] font-bold text-foreground">{t('plansTitle')}</h2>
                        <p className="mt-1.5 text-[13px] text-muted-foreground">{t('plansLead')}</p>
                        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 auto-rows-fr">
                            {plans.map(p => (
                                <div
                                    key={p.name}
                                    className="flex h-full flex-col rounded-xl border border-border bg-card p-4"
                                >
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        {p.displayName || p.name}
                                    </span>
                                    <span className="mt-1 flex items-baseline gap-0.5">
                                        <span className="text-[24px] font-bold leading-none text-foreground">
                                            ${p.amount}
                                        </span>
                                        <span className="text-[11px] text-muted-foreground">{t('perMonth')}</span>
                                    </span>
                                    {p.description && (
                                        <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
                                            {p.description}
                                        </p>
                                    )}
                                    <ul className="mt-3 space-y-1.5 text-[12px] text-muted-foreground">
                                        <li className="flex items-center gap-1.5">
                                            <Check size={12} className="shrink-0 text-primary" />
                                            {quota(p.limits.maxUsers)} {t('users')}
                                        </li>
                                        <li className="flex items-center gap-1.5">
                                            <Check size={12} className="shrink-0 text-primary" />
                                            {quota(p.limits.maxBorrowers)} {t('borrowers')}
                                        </li>
                                    </ul>
                                    <Link
                                        href={`/${loc}/register`}
                                        className="mt-4 inline-flex h-9 items-center justify-center rounded-lg border border-border text-[13px] font-semibold text-foreground transition-colors hover:border-primary hover:text-primary"
                                    >
                                        {t('choosePlan')}
                                    </Link>
                                </div>
                            ))}
                        </div>
                    </section>
                )}
            </main>

            <footer className="border-t border-border">
                <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-6">
                    <span className="text-[11px] text-muted-foreground">
                        © {new Date().getFullYear()} MicroLoan. {t('footerRights')}
                    </span>
                    <div className="flex gap-4">
                        <Link href="/pricing" className="text-[11px] text-muted-foreground hover:text-foreground">
                            {t('navPricing')}
                        </Link>
                        <Link href="/terms-and-conditions" className="text-[11px] text-muted-foreground hover:text-foreground">
                            Terms
                        </Link>
                        <Link href="/privacy-policy" className="text-[11px] text-muted-foreground hover:text-foreground">
                            Privacy
                        </Link>
                    </div>
                </div>
            </footer>
        </div>
    );
}
