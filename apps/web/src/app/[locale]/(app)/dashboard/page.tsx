"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { TrendingUp, TrendingDown, Activity, Wallet, Users, PiggyBank, ArrowUpRight, BarChart2, Plus } from 'lucide-react';
import { LoanModal } from '@/components/LoanModal';
import { BorrowerModal } from '@/components/BorrowerModal';
import { RepaymentModal } from '@/components/RepaymentModal';
import { useRouter, useParams } from 'next/navigation';

interface DashboardStats {
    activeLoans: number;
    totalBorrowers: number;
    repaymentsThisMonth: number;
    outstandingPrincipal: number;
    dueNext7Days: number;
}

export default function DashboardPage() {
    const router = useRouter();
    const { locale } = useParams();
    const t = useTranslations('Dashboard');
    const { user } = useAuth(); // from AuthProvider — no extra /auth/me call
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [chartData, setChartData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [isMounted, setIsMounted] = useState(false);
    const [isLoanModalOpen, setIsLoanModalOpen] = useState(false);
    const [isBorrowerModalOpen, setIsBorrowerModalOpen] = useState(false);
    const [isRepaymentModalOpen, setIsRepaymentModalOpen] = useState(false);

    useEffect(() => {
        setIsMounted(true);
        const fetchData = async () => {
            try {
                // Guard: SUPERADMIN has no tenant data — redirect to platform view
                if (user?.role === 'SUPERADMIN') {
                    router.replace(`/${locale}/tenants`);
                    return;
                }
                // user is null while AuthProvider is loading — wait before fetching
                if (!user) return;

                const [statsRes, cashflowRes] = await Promise.all([
                    api.get('/reports/dashboard'),
                    api.get('/reports/cashflow')
                ]);
                setStats(statsRes.data);
                setChartData(Array.isArray(cashflowRes.data) ? cashflowRes.data : []);
            } catch (err) {
                console.error('Failed to load dashboard data', err);
                setChartData([]);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [user, locale]);

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
                            <span className="font-bold text-foreground">${entry.value.toLocaleString()}</span>
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
                Loading market data...
            </div>
        </div>
    );

    const metrics = [
        {
            label: 'Outstanding Principal',
            value: `$${(stats?.outstandingPrincipal || 0).toLocaleString()}`,
            change: '+12.5%',
            positive: true,
            icon: Wallet,
        },
        {
            label: 'Active Borrowers',
            value: stats?.totalBorrowers || 0,
            change: '+3',
            positive: true,
            icon: Users,
        },
        {
            label: 'Active Loans',
            value: stats?.activeLoans || 0,
            change: '+2',
            positive: true,
            icon: BarChart2,
        },
        {
            label: 'Due Next 7 Days',
            value: `$${(stats?.dueNext7Days || 0).toLocaleString()}`,
            change: '',
            positive: false,
            icon: PiggyBank,
            warn: true,
        },
    ];

    return (
        <div className="space-y-5 pb-8">
            {/* Page Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-[18px] font-bold text-foreground">Financial Dashboard</h1>
                    <p className="text-[13px] text-muted-foreground mt-0.5">Portfolio overview and capital metrics</p>
                </div>
                <button onClick={() => setIsLoanModalOpen(true)} className="tv-button gap-1.5 text-[12px]">
                    <Plus size={14} /> New Loan
                </button>
            </div>

            {/* Metric Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {metrics.map((m, i) => (
                    <div key={i} className="tv-card p-4">
                        <div className="flex items-start justify-between mb-3">
                            <span className="text-[12px] text-muted-foreground">{m.label}</span>
                            <m.icon size={15} className="text-muted-foreground" />
                        </div>
                        <div className="text-[22px] font-bold text-foreground leading-none mb-2">{m.value}</div>
                        {m.change && (
                            <div className={`flex items-center gap-1 text-[12px] font-bold ${m.positive ? 'tv-positive' : 'tv-negative'}`}>
                                {m.positive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                {m.change}
                                <span className="text-muted-foreground font-normal">vs last month</span>
                            </div>
                        )}
                        {m.warn && (
                            <div className="text-[12px] text-muted-foreground">Requires collection</div>
                        )}
                    </div>
                ))}
            </div>

            {/* Charts + Actions */}
            <div className="grid lg:grid-cols-3 gap-4">
                {/* Cash Flow Chart */}
                <div className="lg:col-span-2 tv-card min-w-0 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                        <div>
                            <h3 className="text-[14px] font-bold text-foreground">Cash Flow</h3>
                            <p className="text-[12px] text-muted-foreground">Inflow vs Disbursements</p>
                        </div>
                        <div className="flex items-center gap-4 text-[12px]">
                            <div className="flex items-center gap-1.5">
                                <span className="inline-block" style={{ width: 12, height: 2, background: '#2962FF' }} />
                                <span className="text-muted-foreground">Collections</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="inline-block" style={{ width: 12, height: 2, background: '#ef5350' }} />
                                <span className="text-muted-foreground">Disbursements</span>
                            </div>
                        </div>
                    </div>
                    <div className="p-4">
                        <div className="h-[280px] w-full min-w-0">
                            {isMounted ? (
                                chartData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
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
                                            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#787b86', fontSize: 11 }} tickFormatter={(v) => `$${v / 1000}k`} />
                                            <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#2a2e39', strokeWidth: 1 }} />
                                            <Area type="monotone" dataKey="collections" name="Collections" stroke="#2962FF" strokeWidth={2} fillOpacity={1} fill="url(#colorCollections)" />
                                            <Area type="monotone" dataKey="disbursements" name="Disbursements" stroke="#ef5350" strokeWidth={2} strokeDasharray="4 2" fillOpacity={1} fill="url(#colorDisbursements)" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-[13px] gap-2 border border-dashed border-border rounded">
                                        <BarChart2 size={24} className="opacity-30" />
                                        No cashflow data available
                                    </div>
                                )
                            ) : null}
                        </div>
                    </div>
                </div>

                {/* Quick Actions + Alert */}
                <div className="space-y-4">
                    {/* Quick Actions */}
                    <div className="tv-card">
                        <div className="px-4 py-3 border-b border-border">
                            <h3 className="text-[14px] font-bold text-foreground">Quick Actions</h3>
                        </div>
                        <div className="p-3 space-y-1">
                            {[
                                { label: 'Create New Loan', icon: Plus, action: () => setIsLoanModalOpen(true) },
                                { label: 'Add Borrower', icon: Users, action: () => setIsBorrowerModalOpen(true) },
                                { label: 'Record Repayment', icon: PiggyBank, action: () => setIsRepaymentModalOpen(true) },
                                { label: 'View Reports', icon: BarChart2, action: () => router.push(`/${locale}/reports`) },
                            ].map((action, i) => (
                                <button key={i} onClick={action.action} className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded text-[13px] text-foreground hover:bg-secondary transition-colors text-left">
                                    <action.icon size={15} className="text-primary flex-shrink-0" />
                                    {action.label}
                                    <ArrowUpRight size={12} className="ml-auto text-muted-foreground" />
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Alert Card */}
                    <div className="tv-card border-l-2 border-l-[#ef5350]">
                        <div className="p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <div className="w-2 h-2 rounded-full bg-[#ef5350] animate-pulse" />
                                <span className="text-[12px] font-bold text-[#ef5350] uppercase tracking-wide">Attention Required</span>
                            </div>
                            <p className="text-[13px] text-foreground mb-3 leading-relaxed">
                                <strong>4 accounts</strong> are overdue and require immediate intervention.
                            </p>
                            <button className="w-full py-2 text-[12px] font-bold border border-[#ef5350] text-[#ef5350] rounded hover:bg-[#ef5350]/10 transition-colors">
                                Review Overdue Accounts
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Monthly Summary Row */}
            <div className="tv-card">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <h3 className="text-[14px] font-bold text-foreground">Monthly Summary</h3>
                    <span className="text-[12px] text-muted-foreground">Last 30 days</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-border">
                    {[
                        { label: 'Repayments Collected', value: `$${(stats?.repaymentsThisMonth || 0).toLocaleString()}`, positive: true },
                        { label: 'Outstanding Balance', value: `$${(stats?.outstandingPrincipal || 0).toLocaleString()}`, positive: true },
                        { label: 'Active Loan Count', value: stats?.activeLoans || 0, positive: true },
                        { label: 'Upcoming Collections', value: `$${(stats?.dueNext7Days || 0).toLocaleString()}`, positive: false },
                    ].map((s, i) => (
                        <div key={i} className="px-5 py-4">
                            <div className="text-[12px] text-muted-foreground mb-1.5">{s.label}</div>
                            <div className={`text-[18px] font-bold ${s.positive ? 'text-foreground' : 'text-[#ef5350]'}`}>{s.value}</div>
                        </div>
                    ))}
                </div>
            </div>

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
