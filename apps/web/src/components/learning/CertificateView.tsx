"use client";

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Award, Printer } from 'lucide-react';
import { learning } from '@microloan/shared';
import { useAuth } from '@/lib/auth-context';
import { pathProgress, useLearning } from '@/lib/learning';
import { Spinner } from '@/components/lending/ui';

/** A printable certificate for a completed learning path, from the person's own progress. */
export function CertificateView({ pathId }: { pathId: string }) {
    const t = useTranslations('Learning');
    const { locale } = useParams<{ locale: string }>();
    const base = `/${locale ?? 'en'}`;
    const { user } = useAuth();
    const { progress, enabled } = useLearning();
    const path = learning.PATH_BY_ID[pathId];
    if (enabled && !progress) return <Spinner label={t('loading')} />;
    const pp = path ? pathProgress(path, progress) : null;

    return (
        <div className="max-w-[860px] mx-auto space-y-4 pb-10">
            <div className="flex items-center justify-between gap-3 print:hidden">
                <Link href={`${base}/learn`} className="text-[12px] font-semibold text-[#635BFF] hover:underline">← {t('lesson.back')}</Link>
                {pp?.completedAt && (
                    <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold rounded border border-[#E3E8EE] bg-white hover:bg-slate-50">
                        <Printer size={14} /> {t('certificate.print')}
                    </button>
                )}
            </div>
            {!path || !pp?.completedAt ? (
                <p className="bg-white border border-[#E3E8EE] rounded-lg p-6 text-[14px] text-[#3C4257]">{t('certificate.notYet')}</p>
            ) : (
                <article className="relative bg-white border-[6px] border-double border-[#635BFF]/40 rounded-lg px-6 py-12 sm:px-14 text-center shadow-sm motion-safe:animate-in motion-safe:zoom-in-95 motion-safe:fade-in motion-safe:duration-500">
                    <span className="mx-auto w-16 h-16 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-md"><Award size={32} /></span>
                    <p className="mt-5 text-[12px] font-bold uppercase tracking-[0.2em] text-[#635BFF]">{t('certificate.title')}</p>
                    <p className="mt-6 text-[13px] text-[#697386]">{t('certificate.awardedTo')}</p>
                    <p className="mt-1 text-2xl sm:text-3xl font-bold text-[#1A1F36] break-all">{user?.email ?? ''}</p>
                    <p className="mt-4 text-[15px] text-[#3C4257]">{t('certificate.forPath', { path: path.title })}</p>
                    <p className="mt-1 text-[13px] text-[#697386]">{t('certificate.lessons', { count: pp.total })}</p>
                    <p className="mt-6 text-[13px] text-[#697386]">{t('certificate.on', { date: pp.completedAt.slice(0, 10) })}</p>
                    {user?.tenantName && <p className="mt-1 text-[13px] font-semibold text-[#1A1F36]">{user.tenantName}</p>}
                </article>
            )}
        </div>
    );
}
