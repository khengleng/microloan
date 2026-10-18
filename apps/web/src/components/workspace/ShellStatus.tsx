"use client";

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ShieldAlert, UserCheck } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace';
import { compareDecimal, fmtMoney } from '@/components/lending/format';

const chip = 'inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap';

/** Business date, scope, approval authority and sign-in strength, always in view. */
export function ShellChips() {
    const t = useTranslations('Workspace.shell');
    const { access, isPlatform } = useWorkspace();
    if (isPlatform) return <span className={`${chip} bg-[#F0F5FF] border-transparent text-[#3A4161]`}>{t('platformScope')}</span>;
    if (!access || !access.hasLending) return null;
    const s = access.scope;
    const scope = s.all
        ? t('allBranches')
        : s.branches.length === 1
            ? t('branch', { name: s.branches[0].name })
            : s.branches.length > 1
                ? t('branches', { count: s.branches.length })
                : s.legalEntities.length
                    ? s.legalEntities.map((e) => e.code).join(', ')
                    : t('limitedScope');
    const scopeTitle = s.branches.map((b) => b.name).join(', ');
    // The largest limit per currency across approval permissions.
    const limits = new Map<string, string>();
    for (const a of access.authorities) {
        const cur = limits.get(a.currency);
        if (!cur || compareDecimal(a.maxAmount, cur) > 0) limits.set(a.currency, a.maxAmount);
    }
    const mfa = access.assurance.current === 'MFA';
    return (
        <div data-tour="status-chips" className="hidden md:flex flex-wrap items-center gap-1.5">
            {access.businessDate && (
                <span className={`${chip} border-border bg-white text-muted-foreground`} title={t('businessDateTitle')}>
                    {t('businessDate', { date: access.businessDate })}
                </span>
            )}
            <span className={`${chip} border-border bg-white text-muted-foreground`} title={scopeTitle || undefined}>{scope}</span>
            {limits.size > 0 && (
                <span className={`${chip} border-transparent bg-emerald-50 text-emerald-800`} title={t('limitTitle')}>
                    {t('limit', { amounts: [...limits.entries()].map(([c, m]) => `${fmtMoney(m)} ${c}`).join(' · ') })}
                </span>
            )}
            {access.assurance.mfaGatedPermissions.length > 0 && (
                <span className={`${chip} border-transparent ${mfa ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden />
                    {mfa ? t('mfa') : t('passwordOnly')}
                </span>
            )}
        </div>
    );
}

/** "Verify to approve" and "acting with delegated authority" notices under the top bar. */
export function ShellBanners() {
    const t = useTranslations('Workspace.shell');
    const { locale } = useParams();
    const { access } = useWorkspace();
    if (!access) return null;
    const delegated = access.delegations.received;
    return (
        <>
            {access.assurance.stepUpNeeded && (
                <div className="flex items-start gap-2 px-5 py-2 text-[13px] bg-amber-50 text-amber-900 border-b border-amber-200" role="status">
                    <ShieldAlert size={15} className="mt-0.5 flex-shrink-0" />
                    <p>
                        <b>{t('stepUpTitle')}</b> {t('stepUpBody')}{' '}
                        <Link href={`/${locale}/settings`} className="font-bold underline">
                            {access.assurance.mfaEnrolled ? t('stepUpSignIn') : t('stepUpEnrol')}
                        </Link>
                    </p>
                </div>
            )}
            {delegated.map((d) => (
                <div key={d.id} className="flex items-start gap-2 px-5 py-2 text-[13px] bg-[#F0F5FF] text-[#3A4161] border-b border-[#C9D7FF]" role="status">
                    <UserCheck size={15} className="mt-0.5 flex-shrink-0" />
                    <p>
                        {t('delegation', {
                            from: d.fromEmail ?? d.fromUserId,
                            until: d.validTo.slice(0, 10),
                        })}
                        {d.maxAmount && d.currency ? ` ${t('delegationCap', { amount: `${fmtMoney(d.maxAmount)} ${d.currency}` })}` : ''}
                    </p>
                </div>
            ))}
        </>
    );
}
