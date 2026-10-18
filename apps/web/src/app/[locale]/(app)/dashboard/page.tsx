"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useWorkspace } from '@/lib/workspace';
import { money } from '@/lib/currency';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { Activity, Wallet, Users, PiggyBank, ArrowUpRight, BarChart2, Plus, AlertTriangle, Archive } from 'lucide-react';
import { LoanModal } from '@/components/LoanModal';
import { useLegacyStatus } from '@/components/LegacyBanner';
import { BorrowerModal } from '@/components/BorrowerModal';
import { RepaymentModal } from '@/components/RepaymentModal';
import { useRouter, useParams } from 'next/navigation';

/** GET /lending/overview — the lending book, in the tenant's reporting currency. */
interface LendingOverview {
    businessDate: string;
    reportingCurrency: string;
    dueWindowDays: number;
    month: string;
    totals: {
        activeLoans: number;
        overdueLoans: number;
        borrowers: number;
        principalOutstanding: string;
        overdueOutstanding: string;
        dueNextDays: string;
        collectedThisMonth: string;
        collectedLastMonth: string;
        disbursedThisMonth: string;
    };
    byCurrency: {
        currency: string;
        activeLoans: number;
        overdueLoans: number;
        principalOutstanding: string;
        dueNextDays: string;
        collectedThisMonth: string;
    }[];
    unconverted: string[];
    trend: { month: string; collections: string; disbursements: string }[];
}

/** GET /reports/dashboard — the original (legacy) loans module only. */
interface LegacyOverview {
    currency: string;
    kpis: {
        totalPortfolioOutstanding?: number;
        totalBorrowers?: number;
        activeLoans?: number;
        monthlyCollection?: number;
    };
    charts: {
        disbursementTrend?: { month: string; amount: number }[];
        collectionTrend?: { month: string; amount: number }[];
    };
    pagination?: { total: number };
}

type ChartPoint = { name: string; collections: number; disbursements: number };

export default function DashboardPage() {
    const router = useRouter();
    const { locale } = useParams();
    const t = useTranslations('Dashboard');
    const o = useTranslations('Overview');
    const { user } = useAuth(); // from AuthProvider — no extra /auth/me call
    const { ready, can, legacyCan } = useWorkspace();
    const [lend, setLend] = useState<LendingOverview | null>(null);
    const [legacyData, setLegacyData] = useState<LegacyOverview | null>(null);
    const [failed, setFailed] = useState(false);
    const [loading, setLoading] = useState(true);
    const [isMounted, setIsMounted] = useState(false);
    const [isLoanModalOpen, setIsLoanModalOpen] = useState(false);
    const legacy = useLegacyStatus();
    const [isBorrowerModalOpen, setIsBorrowerModalOpen] = useState(false);
    const [isRepaymentModalOpen, setIsRepaymentModalOpen] = useState(false);

    const canLending = can('loan.read');
    const canLegacy = legacyCan('CUSTOMER_VIEW');

    useEffect(() => {
        setIsMounted(true);
        // Guard: Platform staff have no microfinance data — redirect to platform view
        if (user?.isPlatform) {
            router.replace(`/${locale}/tenants`);
            return;
        }
        // user is null while AuthProvider is loading; permissions settle with /me/access
        if (!user || !ready) return;
        let cancelled = false;
        (async () => {
            const [l, g] = await Promise.allSettled([
                canLending ? api.get<LendingOverview>('/lending/overview') : Promise.resolve(null),
                canLegacy ? api.get<LegacyOverview>('/reports/dashboard', { params: { limit: 1 } }) : Promise.resolve(null),
            ]);
            if (cancelled) return;
            setLend(l.status === 'fulfilled' && l.value ? l.value.data : null);
            setLegacyData(g.status === 'fulfilled' && g.value ? g.value.data : null);
            setFailed(l.status === 'rejected' || g.status === 'rejected');
            setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [user, locale, ready, canLending, canLegacy]);

    const cur = lend?.reportingCurrency ?? legacyData?.currency;
    const fmt = (v: number | string | undefined, c = cur) => money(v ?? 0, c);

    // The original module's figures are shown only when it still holds a book.
    const legacyBook = legacyData && ((legacyData.kpis.activeLoans ?? 0) > 0 || (legacyData.kpis.totalPortfolioOutstanding ?? 0) > 0)
        ? legacyData : null;
    const legacyOverdue = legacyBook?.pagination?.total ?? 0;
    const lendingOverdue = lend?.totals.overdueLoans ?? 0;
    const overdueTotal = lendingOverdue + legacyOverdue;

    // Chart: the lending book's last months; the original module's trend only when lending is not visible.
    const chartData: ChartPoint[] = lend
        ? lend.trend.map((p) => ({ name: p.month, collections: Number(p.collections), disbursements: Number(p.disbursements) }))
        : legacyData
            ? (() => {
                const m = new Map<string, ChartPoint>();
                for (const p of legacyData.charts.collectionTrend ?? []) m.set(p.month, { name: p.month, collections: p.amount, disbursements: 0 });
                for (const p of legacyData.charts.disbursementTrend ?? []) {
                    const e = m.get(p.month) ?? { name: p.month, collections: 0, disbursements: 0 };
                    e.disbursements = p.amount;
                    m.set(p.month, e);
                }
                return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
            })()
            : [];
    const chartCurrency = lend ? lend.reportingCurrency : legacyData?.currency;
    const chartHasMoney = chartData.some((p) => p.collections || p.disbursements);

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-card border border-border p-3 rounded text-[12px] shadow-lg">
                    <p className="font-bold text-foreground mb-2">{label}</p>
                    {payload.map((entry: any, index: number) => (
                        <div key={index} className="flex items-center justify-between gap-6">
                            <span className="text-muted-foreground flex items-center gap-1.5">
                                <span className="inline-block w-2 h-2 rounded-full" style={{ background: entry.color }} />
                                {entry.name}
                            </span>
                            <span className="font-bold text-foreground">{money(entry.value, chartCurrency)}</span>
                        </div>
                    ))}
                </div>
            );
        }
        return null;
    };

    if (loading) return (
        <div className="flex h-[50vh] items-center justify-center">
            <div className="flex items-center gap-2 text-muted-foreground text-[13px]">
                <Activity size={16} className="animate-pulse text-primary" />
                {t('loadingData')}
            </div>
        </div>
    );

    const metrics = lend ? [
        { label: t('outstandingPrincipal'), value: fmt(lend.totals.principalOutstanding), note: o('overdueOutstanding', { amount: fmt(lend.totals.overdueOutstanding) }), icon: Wallet },
        { label: o('borrowersWithActiveLoans'), value: lend.totals.borrowers.toLocaleString(), note: null, icon: Users },
        { label: t('activeLoans'), value: lend.totals.activeLoans.toLocaleString(), note: o('overdueLoans', { count: lend.totals.overdueLoans }), icon: BarChart2 },
        { label: o('dueNextDays', { days: lend.dueWindowDays }), value: fmt(lend.totals.dueNextDays), note: t('requiresCollection'), icon: PiggyBank },
    ] : legacyData ? [
        { label: t('outstandingPrincipal'), value: fmt(legacyData.kpis.totalPortfolioOutstanding), note: null, icon: Wallet },
        { label: o('borrowersOnFile'), value: (legacyData.kpis.totalBorrowers ?? 0).toLocaleString(), note: null, icon: Users },
        { label: t('activeLoans'), value: (legacyData.kpis.activeLoans ?? 0).toLocaleString(), note: o('overdueLoans', { count: legacyOverdue }), icon: BarChart2 },
    ] : [];

    const quickActions = [
        ...(legacy?.readonly
            ? (can('loan_application.create') ? [{ label: o('newApplication'), icon: Plus, action: () => router.push(`/${locale}/lending/applications`) }] : [])
            : (legacyCan('LOAN_APPLICATION_CREATE') ? [{ label: t('createNewLoan'), icon: Plus, action: () => setIsLoanModalOpen(true) }] : [])),
        ...(legacyCan('CUSTOMER_CREATE') ? [{ label: t('addBorrower'), icon: Users, action: () => setIsBorrowerModalOpen(true) }] : []),
        ...(legacyCan('LOAN_REPAYMENT_POST') ? [{ label: t('recordRepayment'), icon: PiggyBank, action: () => setIsRepaymentModalOpen(true) }] : []),
        ...(canLegacy ? [{ label: t('viewReports'), icon: BarChart2, action: () => router.push(`/${locale}/reports`) }] : []),
    ];

    return (
        <div className="space-y-5 pb-8">
            {/* Page Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-[18px] font-bold text-foreground">{t('heading')}</h1>
                    <p className="text-[13px] text-muted-foreground mt-0.5">
                        {lend ? o('asOf', { date: lend.businessDate, currency: lend.reportingCurrency }) : t('subtitle')}
                    </p>
                </div>
                {!legacy?.readonly && legacyCan('LOAN_APPLICATION_CREATE') && (
                    <button onClick={() => setIsLoanModalOpen(true)} className="tv-button gap-1.5 text-[12px]">
                        <Plus size={14} /> {t('newLoan')}
                    </button>
                )}
            </div>

            {failed && (
                <div role="alert" className="tv-card p-3 text-[13px] text-[#ef5350]">{o('loadFailed')}</div>
            )}
            {!lend && !legacyData && !failed && (
                <div className="tv-card p-4 text-[13px] text-muted-foreground">{o('noAccess')}</div>
            )}
            {lend && lend.unconverted.length > 0 && (
                <div role="status" className="tv-card p-3 text-[13px] text-foreground flex items-start gap-2">
                    <AlertTriangle size={15} className="text-amber-600 mt-0.5 shrink-0" />
                    <span>
                        {o('unconverted', { currencies: lend.unconverted.join(', '), currency: lend.reportingCurrency })}{' '}
                        {legacyCan('FX_VIEW') && <Link href={`/${locale}/fx`} className="underline">{o('openFx')}</Link>}
                    </span>
                </div>
            )}

            {/* Metric Cards */}
            {metrics.length > 0 && (
                <>
                    {!lend && legacyData && (
                        <p className="text-[12px] text-muted-foreground">{o('legacyOnly')}</p>
                    )}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        {metrics.map((m, i) => (
                            <div key={i} className="tv-card p-4">
                                <div className="flex items-start justify-between mb-3">
                                    <span className="text-[12px] text-muted-foreground">{m.label}</span>
                                    <m.icon size={15} className="text-muted-foreground" />
                                </div>
                                <div className="text-[22px] font-bold text-foreground leading-none mb-2">{m.value}</div>
                                {m.note && <div className="text-[12px] text-muted-foreground">{m.note}</div>}
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* Charts + Actions */}
            <div className="grid lg:grid-cols-3 gap-4">
                {/* Cash Flow Chart */}
                <div className="lg:col-span-2 tv-card min-w-0 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                        <div>
                            <h3 className="text-[14px] font-bold text-foreground">{t('cashFlow')}</h3>
                            <p className="text-[12px] text-muted-foreground">
                                {lend ? o('trendLending', { currency: lend.reportingCurrency }) : legacyData ? o('trendLegacy', { currency: legacyData.currency }) : t('inflowVsDisbursements')}
                            </p>
                        </div>
                        <div className="flex items-center gap-4 text-[12px]">
                            <div className="flex items-center gap-1.5">
                                <span className="inline-block" style={{ width: 12, height: 2, background: '#2962FF' }} />
                                <span className="text-muted-foreground">{t('collections')}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="inline-block" style={{ width: 12, height: 2, background: '#ef5350' }} />
                                <span className="text-muted-foreground">{t('disbursements')}</span>
                            </div>
                        </div>
                    </div>
                    <div className="p-4">
                        <div className="h-[280px] w-full min-w-0">
                            {isMounted ? (
                                chartHasMoney ? (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 10, bottom: 0 }}>
                                            <defs>
                                                <linearGradient id="colorCollections" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#2962FF" stopOpacity={0.15} />
                                                    <stop offset="95%" stopColor="#2962FF" stopOpacity={0} />
                                                </linearGradient>
                                                <linearGradient id="colorDisbursements" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#ef5350" stopOpacity={0.1} />
                                                    <stop offset="95%" stopColor="#ef5350" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="2 2" vertical={false} stroke="#DFE1E6" />
                                            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#787b86', fontSize: 11 }} dy={8} />
                                            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#787b86', fontSize: 11 }} tickFormatter={(v) => Number(v).toLocaleString(undefined, { notation: 'compact' })} />
                                            <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#2a2e39', strokeWidth: 1 }} />
                                            <Area type="monotone" dataKey="collections" name={t('collections')} stroke="#2962FF" strokeWidth={2} fillOpacity={1} fill="url(#colorCollections)" />
                                            <Area type="monotone" dataKey="disbursements" name={t('disbursements')} stroke="#ef5350" strokeWidth={2} strokeDasharray="4 2" fillOpacity={1} fill="url(#colorDisbursements)" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-[13px] gap-2 border border-dashed border-border rounded">
                                        <BarChart2 size={24} className="opacity-30" />
                                        {t('noCashflow')}
                                    </div>
                                )
                            ) : null}
                        </div>
                    </div>
                </div>

                {/* Quick Actions + Alert */}
                <div className="space-y-4">
                    {quickActions.length > 0 && (
                        <div className="tv-card">
                            <div className="px-4 py-3 border-b border-border">
                                <h3 className="text-[14px] font-bold text-foreground">{t('quickActions')}</h3>
                            </div>
                            <div className="p-3 space-y-1">
                                {quickActions.map((action, i) => (
                                    <button key={i} onClick={action.action} className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded text-[13px] text-foreground hover:bg-secondary transition-colors text-left">
                                        <action.icon size={15} className="text-primary flex-shrink-0" />
                                        {action.label}
                                        <ArrowUpRight size={12} className="ml-auto text-muted-foreground" />
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Overdue: the real count, linked to where it is worked */}
                    {(lend || legacyBook) && (
                        <div className={`tv-card ${overdueTotal > 0 ? 'border-l-2 border-l-[#ef5350]' : ''}`}>
                            <div className="p-4">
                                {overdueTotal > 0 ? (
                                    <>
                                        <div className="flex items-center gap-2 mb-2">
                                            <div className="w-2 h-2 rounded-full bg-[#ef5350]" />
                                            <span className="text-[12px] font-bold text-[#ef5350] uppercase tracking-wide">{t('attentionRequired')}</span>
                                        </div>
                                        <p className="text-[13px] text-foreground mb-3 leading-relaxed">
                                            {o('overdueAlert', { count: overdueTotal })}
                                        </p>
                                        <div className="space-y-2">
                                            {lendingOverdue > 0 && (
                                                <Link href={`/${locale}/lending/collections`} className="block w-full text-center py-2 text-[12px] font-bold border border-[#ef5350] text-[#ef5350] rounded hover:bg-[#ef5350]/10 transition-colors">
                                                    {o('reviewLendingOverdue', { count: lendingOverdue })}
                                                </Link>
                                            )}
                                            {legacyOverdue > 0 && (
                                                <Link href={`/${locale}/collections`} className="block w-full text-center py-2 text-[12px] font-bold border border-[#ef5350] text-[#ef5350] rounded hover:bg-[#ef5350]/10 transition-colors">
                                                    {o('reviewLegacyOverdue', { count: legacyOverdue })}
                                                </Link>
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <p className="text-[13px] text-muted-foreground">{o('noOverdue')}</p>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* This month in the lending book */}
            {lend && (
                <div className="tv-card">
                    <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                        <h3 className="text-[14px] font-bold text-foreground">{t('monthlySummary')}</h3>
                        <span className="text-[12px] text-muted-foreground">{o('monthToDate', { month: lend.month, date: lend.businessDate })}</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-border">
                        {[
                            { label: t('repaymentsCollected'), value: fmt(lend.totals.collectedThisMonth) },
                            { label: o('collectedLastMonth'), value: fmt(lend.totals.collectedLastMonth) },
                            { label: o('disbursedThisMonth'), value: fmt(lend.totals.disbursedThisMonth) },
                            { label: t('upcomingCollections'), value: fmt(lend.totals.dueNextDays) },
                        ].map((s, i) => (
                            <div key={i} className="px-5 py-4">
                                <div className="text-[12px] text-muted-foreground mb-1.5">{s.label}</div>
                                <div className="text-[18px] font-bold text-foreground">{s.value}</div>
                            </div>
                        ))}
                    </div>
                    {lend.byCurrency.length > 1 && (
                        <div className="border-t border-border overflow-x-auto">
                            <table className="w-full text-[12px]">
                                <thead>
                                    <tr className="text-muted-foreground text-left">
                                        <th className="px-4 py-2 font-medium">{o('currency')}</th>
                                        <th className="px-4 py-2 font-medium">{t('activeLoans')}</th>
                                        <th className="px-4 py-2 font-medium">{t('outstandingPrincipal')}</th>
                                        <th className="px-4 py-2 font-medium">{o('dueNextDays', { days: lend.dueWindowDays })}</th>
                                        <th className="px-4 py-2 font-medium">{t('repaymentsCollected')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lend.byCurrency.map((c) => (
                                        <tr key={c.currency} className="border-t border-border">
                                            <td className="px-4 py-2 font-bold">{c.currency}</td>
                                            <td className="px-4 py-2">{c.activeLoans}</td>
                                            <td className="px-4 py-2">{money(c.principalOutstanding, c.currency)}</td>
                                            <td className="px-4 py-2">{money(c.dueNextDays, c.currency)}</td>
                                            <td className="px-4 py-2">{money(c.collectedThisMonth, c.currency)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* The original loans module, while it still holds a book */}
            {lend && legacyBook && (
                <div className="tv-card">
                    <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                        <Archive size={14} className="text-muted-foreground" />
                        <h3 className="text-[14px] font-bold text-foreground">{o('legacyHeading')}</h3>
                        <span className="text-[12px] text-muted-foreground">{o('legacyNote')}</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-border">
                        {[
                            { label: t('outstandingPrincipal'), value: money(legacyBook.kpis.totalPortfolioOutstanding ?? 0, legacyBook.currency) },
                            { label: t('activeLoans'), value: (legacyBook.kpis.activeLoans ?? 0).toLocaleString() },
                            { label: o('overdueLoansLabel'), value: legacyOverdue.toLocaleString() },
                            { label: o('collectedAllTime'), value: money(legacyBook.kpis.monthlyCollection ?? 0, legacyBook.currency) },
                        ].map((s, i) => (
                            <div key={i} className="px-5 py-4">
                                <div className="text-[12px] text-muted-foreground mb-1.5">{s.label}</div>
                                <div className="text-[18px] font-bold text-foreground">{s.value}</div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <LoanModal
                open={isLoanModalOpen}
                onOpenChange={setIsLoanModalOpen}
                onSuccess={() => { setIsLoanModalOpen(false); }}
            />
            <BorrowerModal
                open={isBorrowerModalOpen}
                onOpenChange={setIsBorrowerModalOpen}
                onSuccess={() => setIsBorrowerModalOpen(false)}
                borrower={null}
            />
            <RepaymentModal
                open={isRepaymentModalOpen}
                onOpenChange={setIsRepaymentModalOpen}
                onSuccess={() => setIsRepaymentModalOpen(false)}
            />
        </div>
    );
}
