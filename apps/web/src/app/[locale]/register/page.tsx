"use client";

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { clarityEvent, claritySetTag } from '@/lib/clarity';
import { GoogleSignInButton } from '@/components/auth/google-sign-in-button';
import { SignupPaymentPanel, type SignupPayment } from '@/components/auth/signup-payment-panel';
import { BrandMark } from '@/components/brand-mark';
import { LocaleSwitch } from '@/components/auth/locale-switch';

type Plan = {
    /** Stable key sent back on submit. */
    name: string;
    /** Customer-facing label the platform owner set. */
    displayName?: string;
    description?: string | null;
    amount: number;
    currency: string;
    requiresPayment: boolean;
    /** `null` on a ceiling means unlimited. */
    limits: {
        maxUsers: number | null;
        maxBorrowers: number | null;
        maxLoans: number | null;
    };
};

/** Render a quota ceiling, where null is unlimited rather than missing. */
const quota = (n: number | null | undefined, t: (k: string) => string) =>
    n === null || n === undefined ? t('unlimited') : n.toLocaleString();

type RegisterResult = {
    tenantName: string;
    plan: string;
    paymentRequired: boolean;
    payment?: SignupPayment;
};

export default function RegisterTenantPage() {
    const t = useTranslations('Register');
    const router = useRouter();
    const { locale } = useParams();
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult] = useState<RegisterResult | null>(null);
    const [error, setError] = useState('');
    const [plans, setPlans] = useState<Plan[]>([]);
    const [selectedPlan, setSelectedPlan] = useState('FREE');
    const [khqrConfigured, setKhqrConfigured] = useState(true);
    const [formData, setFormData] = useState({
        organizationName: '',
        adminEmail: '',
        adminPassword: ''
    });

    useEffect(() => {
        claritySetTag('journey_stage', 'tenant_register');
        clarityEvent('register_page_visit');
        fetch('/api/proxy/auth/plans')
            .then(r => (r.ok ? r.json() : null))
            .then((data: { plans?: Plan[]; khqrConfigured?: boolean } | null) => {
                if (data?.plans) {
                    setPlans(data.plans);
                    // The operator names their own tiers, so "FREE" may not
                    // exist. Preselect the first unpriced tier, else the first
                    // tier offered — never a hardcoded name that 400s on submit.
                    const preferred =
                        data.plans.find(p => !p.requiresPayment) ?? data.plans[0];
                    if (preferred) setSelectedPlan(preferred.name);
                }
                if (typeof data?.khqrConfigured === 'boolean') setKhqrConfigured(data.khqrConfigured);
            })
            .catch(() => { /* plan list is progressive enhancement; FREE still works */ });
    }, []);

    const applyResult = (data: RegisterResult) => {
        clarityEvent('register_submit_success');
        setResult(data);
        // Only a free workspace is usable immediately. A paid one is inert
        // until the platform team confirms payment, so bouncing the applicant
        // to a login they cannot complete would be a dead end.
        if (!data.paymentRequired) {
            setTimeout(() => router.push(`/${locale}/login`), 3000);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        clarityEvent('register_submit_attempt');
        setSubmitting(true);
        setError('');
        try {
            const res = await fetch(`/api/proxy/auth/register-tenant`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...formData, plan: selectedPlan }),
            });

            const data = await res.json();
            if (!res.ok) {
                clarityEvent('register_submit_failed');
                throw new Error(data.message || 'Registration failed');
            }
            applyResult(data);
        } catch (err: unknown) {
            clarityEvent('register_submit_failed');
            setError(err instanceof Error ? err.message : 'An error occurred during registration.');
        } finally {
            setSubmitting(false);
        }
    };

    const handleGoogleSignup = async (idToken: string) => {
        clarityEvent('register_google_attempt');
        setError('');
        if (!formData.organizationName.trim()) {
            throw new Error('Enter your organization name before continuing with Google.');
        }
        const res = await fetch('/api/proxy/auth/google/register-tenant', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                idToken,
                organizationName: formData.organizationName,
                plan: selectedPlan,
            }),
        });
        const data = await res.json();
        if (!res.ok) {
            clarityEvent('register_google_failed');
            throw new Error(data.message || 'Registration failed');
        }
        applyResult(data);
    };

    const inputClass = "w-full h-10 px-3 bg-secondary border border-border rounded text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors";
    const labelClass = "block text-[12px] font-semibold text-muted-foreground mb-1.5";

    if (result) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background py-10">
                <div className="w-full max-w-[420px] px-4">
                    <div className="bg-card border border-border rounded-lg p-8">
                        <div className="text-center">
                            <div className="w-12 h-12 bg-[#26a69a]/15 rounded-full flex items-center justify-center mx-auto mb-4">
                                <CheckCircle2 size={24} className="text-[#26a69a]" />
                            </div>
                            <h1 className="text-[18px] font-bold text-foreground mb-2">
                                {result.paymentRequired ? t('pendingTitle') : t('doneTitle')}
                            </h1>
                            <p className="text-[13px] text-muted-foreground mb-6">
                                <strong className="text-foreground">{result.tenantName}</strong>
                                {result.paymentRequired
                                    ? ' has been created on the ' + result.plan + ' plan. Complete payment to activate it.'
                                    : ' has been registered. Redirecting to login...'}
                            </p>
                        </div>

                        {result.paymentRequired && result.payment ? (
                            <SignupPaymentPanel payment={result.payment} locale={String(locale)} />
                        ) : (
                            <button
                                onClick={() => router.push(`/${locale}/login`)}
                                className="tv-button w-full h-10 text-[13px]"
                            >
                                {t('signInNow')}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    const selected = plans.find(p => p.name === selectedPlan);

    return (
        <div className="min-h-screen bg-background flex items-center justify-center px-4 py-10">
            <div className="w-full max-w-5xl grid lg:grid-cols-[1fr_460px] gap-10 lg:gap-14 items-center">

                {/* ── Brand panel ──────────────────────────────────────────
                    Hidden below lg: on a phone it would just add another
                    screenful above the form, which is the problem this
                    layout exists to solve. */}
                <div className="hidden lg:block">
                    <BrandMark size={40} className="mb-8 [&>span]:text-[20px]" />
                    <h2 className="text-[28px] font-bold text-foreground leading-tight mb-3">
                        {t('heroTitle')}
                    </h2>
                    <p className="text-[14px] text-muted-foreground leading-relaxed mb-8 max-w-[420px]">
{t('heroSubtitle')}
                    </p>
                    <ul className="space-y-3">
                        {[
                            t('feature1'),
                            t('feature2'),
                            t('feature3'),
                        ].map(item => (
                            <li key={item} className="flex items-start gap-2.5 text-[13px] text-muted-foreground">
                                <CheckCircle2 size={15} className="text-primary mt-0.5 shrink-0" />
                                <span>{item}</span>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* ── Form ─────────────────────────────────────────────── */}
                <div className="w-full">
                    <div className="flex items-center justify-between mb-6">
                        <BrandMark className="lg:invisible" />
                        <LocaleSwitch />
                    </div>

                    <div className="bg-card border border-border rounded-xl p-6 sm:p-7">
                        <h1 className="text-[18px] font-bold text-foreground mb-1">{t('title')}</h1>
                        <p className="text-[13px] text-muted-foreground mb-6">
                            {t('subtitle')}
                        </p>

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label htmlFor="org" className={labelClass}>{t('orgName')}</label>
                                <input
                                    id="org"
                                    placeholder={t('orgPlaceholder')}
                                    className={inputClass}
                                    required
                                    value={formData.organizationName}
                                    onChange={e => setFormData({ ...formData, organizationName: e.target.value })}
                                />
                            </div>

                        {plans.length > 0 && (
                            <div>
                                <label className={labelClass}>{t('plan')}</label>
                                {/* A grid, not a stack. Four full-width cards each
                                    carrying a description turned this form into
                                    several screens of scrolling; the chosen plan's
                                    description moves below, where only one shows at
                                    a time. */}
                                <div className="grid grid-cols-2 gap-2">
                                    {plans.map(plan => {
                                        const unavailable = plan.requiresPayment && !khqrConfigured;
                                        const active = selectedPlan === plan.name;
                                        return (
                                            <label
                                                key={plan.name}
                                                className={`flex flex-col gap-1 px-3 py-2.5 rounded-lg border transition-colors ${unavailable
                                                    ? 'opacity-45 cursor-not-allowed border-border bg-secondary'
                                                    : active
                                                        ? 'border-primary bg-primary/5 cursor-pointer ring-1 ring-primary'
                                                        : 'border-border bg-secondary hover:border-primary/50 cursor-pointer'
                                                    }`}
                                            >
                                                <input
                                                    type="radio"
                                                    name="plan"
                                                    value={plan.name}
                                                    checked={active}
                                                    disabled={unavailable}
                                                    onChange={() => setSelectedPlan(plan.name)}
                                                    className="sr-only"
                                                />
                                                <span className="flex items-baseline justify-between gap-2">
                                                    <span className="text-[13px] font-semibold text-foreground truncate">
                                                        {plan.displayName || plan.name}
                                                    </span>
                                                    <span className="text-[12px] font-bold text-foreground whitespace-nowrap">
                                                        {plan.requiresPayment ? `$${plan.amount}` : t('free')}
                                                    </span>
                                                </span>
                                                <span className="text-[11px] text-muted-foreground">
                                                    {quota(plan.limits.maxUsers, t)} {t('users')} · {quota(plan.limits.maxBorrowers, t)} {t('borrowers')}
                                                </span>
                                            </label>
                                        );
                                    })}
                                </div>

                                {selected?.description && (
                                    <p className="text-[11px] text-muted-foreground mt-2">
                                        {selected.description}
                                    </p>
                                )}
                                {!khqrConfigured && (
                                    <p className="text-[11px] text-muted-foreground mt-1.5">
                                        {t('paidUnavailable')}
                                    </p>
                                )}
                            </div>
                        )}

                        <div>
                            <label htmlFor="email" className={labelClass}>{t('adminEmail')}</label>
                            <input
                                id="email"
                                type="email"
                                data-clarity-mask="true"
                                autoComplete="email"
                                placeholder="you@company.com"
                                className={inputClass}
                                required
                                value={formData.adminEmail}
                                onChange={e => setFormData({ ...formData, adminEmail: e.target.value })}
                            />
                        </div>

                        <div>
                            <label htmlFor="pass" className={labelClass}>{t('password')}</label>
                            <input
                                id="pass"
                                type="password"
                                data-clarity-mask="true"
                                autoComplete="new-password"
                                placeholder={t('passwordHint')}
                                minLength={12}
                                className={inputClass}
                                required
                                value={formData.adminPassword}
                                onChange={e => setFormData({ ...formData, adminPassword: e.target.value })}
                            />
                        </div>

                        {error && (
                            <div className="text-[12px] text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2 rounded">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            className="tv-button w-full h-10 text-[13px]"
                            disabled={submitting}
                        >
                            {submitting && <Loader2 size={14} className="animate-spin mr-2" />}
                            {submitting ? t('submitting') : t('submit')}
                        </button>

                        {/* Signing up with Google skips the password fields but not
                            the organization name or the plan choice — both are still
                            required, and the payment gate applies identically. */}
                        <GoogleSignInButton
                            text="signup_with"
                            disabled={submitting}
                            onCredential={handleGoogleSignup}
                            locale={typeof locale === 'string' ? locale : undefined}
                        />

                        <p className="text-center text-[12px] text-muted-foreground leading-relaxed">
                            {t('agree')}{' '}
                            <Link href="/terms-and-conditions" className="text-primary hover:text-primary/80 transition-colors">Terms</Link>
                            {' '}{t('and')}{' '}
                            <Link href="/privacy-policy" className="text-primary hover:text-primary/80 transition-colors">Privacy Policy</Link>.
                        </p>
                        </form>
                    </div>

                    <p className="text-center text-[13px] text-muted-foreground mt-5">
                        {t('haveAccount')}{' '}
                        <Link href={`/${locale}/login`} className="text-primary hover:text-primary/80 font-semibold transition-colors">
                            {t('signIn')}
                        </Link>
                    </p>

                    <div className="flex items-center justify-center gap-5 mt-6 pt-6 border-t border-border">
                        <span className="text-[11px] text-muted-foreground">© 2025 MicroLoan</span>
                        <Link href="/terms-and-conditions" className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">Terms</Link>
                        <Link href="/privacy-policy" className="text-[11px] text-muted-foreground hover:text-foreground transition-colors">Privacy</Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
