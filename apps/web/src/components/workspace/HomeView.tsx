"use client";

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, LayoutDashboard, Lock, Plus, RefreshCw } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useWorkspace, type WorkQueue } from '@/lib/workspace';
import { itemVisible, NAV } from '@/lib/nav';
import { Empty, Spinner } from '@/components/lending/ui';
import { fmtMoney } from '@/components/lending/format';

/** Queues whose first items are listed under the tiles, most urgent first. */
const WORKLIST_ORDER = [
    'APPLICATIONS_TO_APPROVE', 'DISBURSEMENTS_TO_APPROVE', 'DISBURSEMENTS_TO_EXECUTE', 'WRITE_OFFS_TO_APPROVE',
    'RESTRUCTURES_TO_APPROVE', 'AGED_LOSS', 'PERIODS_TO_APPROVE', 'ACCESS_TO_APPROVE', 'FLAGS_TO_APPROVE', 'PRODUCT_VERSIONS_TO_REVIEW',
    'QR_RECEIPTS_TO_VERIFY', 'APPLICATIONS_TO_RECOMMEND', 'DOCUMENTS_TO_REVIEW', 'COLLECTION_TASKS', 'PAST_DUE', 'DISBURSEMENTS_TO_PREPARE',
    'RESTRUCTURES_TO_ASSESS', 'APPLICATIONS_DRAFT', 'PLAN_PAYMENTS_TO_CONFIRM',
];

const KPI_ITEM = NAV[0].items.find((i) => i.href === '/dashboard')!;

/**
 * Home: the person's own queues — what to approve, prepare and chase —
 * computed by GET /me/work, with a link to the KPI dashboard of the lending
 * book for those who can read it.
 */
export function HomeView() {
    const t = useTranslations('Workspace.home');
    const tq = useTranslations('Workspace.queues');
    const { locale } = useParams();
    const { user, loading: authLoading } = useAuth();
    const ws = useWorkspace();
    const { access, work, ready } = ws;

    if (authLoading || !ready) return <Spinner />;
    const href = (p: string) => `/${locale}${p}`;
    const title = (q: WorkQueue) => (tq.has(q.code) ? tq(q.code) : q.title);
    const queues = work?.queues ?? [];
    const needYou = queues.filter((q) => q.kind !== 'INFO' && q.count > 0).length;
    const listed = WORKLIST_ORDER.map((c) => queues.find((q) => q.code === c && q.items.length > 0)).filter(Boolean).slice(0, 3) as WorkQueue[];
    const showKpi = !ws.isPlatform && itemVisible(KPI_ITEM, ws);
    const name = access?.principal.email?.split('@')[0] ?? user?.email?.split('@')[0] ?? '';

    return (
        <div className="max-w-[1280px] mx-auto space-y-5 pb-10">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
                <div className="min-w-0">
                    <h1 className="text-2xl font-bold text-[#1A1F36] tracking-tight">{t('title')}</h1>
                    <p className="text-[#697386] text-[14px] mt-0.5">
                        {work ? (needYou ? t('subtitle', { count: needYou, name }) : t('subtitleClear', { name })) : t('loading')}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={ws.reloadWork} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold rounded border border-[#E3E8EE] bg-white text-[#3C4257] hover:bg-slate-50">
                        <RefreshCw size={14} /> {t('refresh')}
                    </button>
                    {showKpi && (
                        <Link href={href('/dashboard')} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold rounded border border-[#E3E8EE] bg-white text-[#3C4257] hover:bg-slate-50">
                            <LayoutDashboard size={14} /> {t('kpiDashboard')}
                        </Link>
                    )}
                    {ws.can('loan_application.create') && (
                        <Link href={href('/lending/applications')} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold rounded bg-[#635BFF] text-white hover:bg-[#5249e6]">
                            <Plus size={14} /> {t('newApplication')}
                        </Link>
                    )}
                </div>
            </div>

            {!work ? <Spinner /> : queues.length === 0 ? (
                <section className="bg-white border border-[#E3E8EE] rounded-lg"><Empty>{t('noQueues')}</Empty></section>
            ) : (
                <div data-tour="home-queues" className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(230px,1fr))]">
                    {queues.map((q) => <QueueTile key={q.code} q={q} title={title(q)} href={href(q.href)} />)}
                </div>
            )}

            {listed.map((q) => (
                <section key={q.code} className="bg-white border border-[#E3E8EE] rounded-lg shadow-sm">
                    <header className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 border-b border-[#E3E8EE]">
                        <h2 className="text-[15px] font-bold text-[#1A1F36]">{title(q)}</h2>
                        <span className="text-[12px] text-[#697386]">{t('oldestFirst')}</span>
                    </header>
                    <ul>
                        {q.items.map((it) => (
                            <li key={it.id} className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] items-center gap-3 px-5 py-2.5 border-b border-[#E3E8EE] last:border-0 text-[13px]">
                                <div className="min-w-0">
                                    <p className="text-[#1A1F36] truncate">{it.label || it.reference}</p>
                                    <p className="font-mono text-[11.5px] text-[#697386] truncate">{it.reference}</p>
                                </div>
                                <div className="text-right tabular-nums font-semibold text-[#3C4257]">
                                    {it.amount ? `${fmtMoney(it.amount)} ${it.currency ?? ''}` : ''}
                                </div>
                                <div className="flex items-center justify-end gap-2">
                                    {it.aboveLimit && <span className="text-[12px] text-amber-800" title={t('aboveLimitWhy')}>{t('aboveLimit')}</span>}
                                    {q.needsMfa && <span className="text-[12px] text-amber-800 inline-flex items-center gap-1" title={t('needsMfaWhy')}><Lock size={12} /> {t('needsMfa')}</span>}
                                    <Link href={href(it.href)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[#E3E8EE] font-semibold text-[#635BFF] hover:bg-[#F0F5FF]">
                                        {t('open')} <ArrowRight size={12} />
                                    </Link>
                                </div>
                            </li>
                        ))}
                    </ul>
                    {q.count > q.items.length && (
                        <Link href={href(q.href)} className="block px-5 py-2 text-[12.5px] font-semibold text-[#635BFF] hover:underline">
                            {t('seeAll', { count: q.count })}
                        </Link>
                    )}
                </section>
            ))}
        </div>
    );
}

function QueueTile({ q, title, href }: { q: WorkQueue; title: string; href: string }) {
    const t = useTranslations('Workspace.home');
    const locked = q.needsMfa;
    return (
        <Link
            href={href}
            className={`rounded-lg border p-3.5 grid gap-2 content-start transition-colors ${locked ? 'bg-slate-50 border-[#E3E8EE]' : 'bg-white border-[#E3E8EE] hover:border-[#635BFF]/50'}`}
        >
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-[14px] font-semibold text-[#1A1F36]">{title}</span>
                <span className={`text-[26px] font-extrabold tabular-nums tracking-tight ${locked ? 'text-[#8792A2]' : q.count > 0 && q.kind !== 'INFO' ? 'text-[#1A1F36]' : 'text-[#8792A2]'}`}>{q.count}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
                {q.kind === 'MAKER' && <span className="text-[10.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">{t('youPrepare')}</span>}
                {q.kind === 'CHECKER' && <span className="text-[10.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#F0F5FF] text-[#3F38D9]">{t('youApprove')}</span>}
                {q.kind === 'INFO' && <span className="text-[10.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{t('forInformation')}</span>}
                {q.money && <span className="text-[10.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800">{t('money')}</span>}
                {locked && <span className="text-[10.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-50 text-amber-900" title={t('needsMfaWhy')}>{t('needsMfa')}</span>}
            </div>
        </Link>
    );
}
