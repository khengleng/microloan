"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { Wallet, Calendar, PiggyBank, Users, TrendingUp, ArrowUpRight, Activity, Percent, Zap, ShieldCheck } from 'lucide-react';

interface DashboardStats {
    activeLoans: number;
    totalBorrowers: number;
    repaymentsThisMonth: number;
    outstandingPrincipal: number;
    dueNext7Days: number;
}

export default function DashboardPage() {
    const t = useTranslations('Dashboard');
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [chartData, setChartData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
        const fetchData = async () => {
            try {
                const [statsRes, cashflowRes] = await Promise.all([
                    api.get('/reports/dashboard'),
                    api.get('/reports/cashflow')
                ]);
                setStats(statsRes.data);
                setChartData(Array.isArray(cashflowRes.data) ? cashflowRes.data : []);
            } catch (err) {
                console.error("Failed to load dashboard data", err);
                setChartData([]);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-card/90 backdrop-blur-xl p-4 border border-border shadow-2xl rounded-2xl text-[13px] premium-shadow">
                    <p className="font-black text-foreground mb-2 tracking-tight">{label}</p>
                    {payload.map((entry: any, index: number) => (
                        <div key={index} className="flex items-center gap-3 py-1">
                            <div className="w-3 h-3 rounded-full shadow-[0_0_8px_rgba(217,233,84,0.3)]" style={{ backgroundColor: entry.color }} />
                            <span className="text-muted-foreground font-bold">{entry.name}:</span>
                            <span className="font-black text-foreground">${entry.value.toLocaleString()}</span>
                        </div>
                    ))}
                </div>
            );
        }
        return null;
    };

    if (loading) return (
        <div className="flex flex-col h-[60vh] items-center justify-center space-y-6">
            <div className="relative">
                <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                <Activity className="absolute inset-0 m-auto text-primary animate-pulse" size={24} />
            </div>
            <p className="text-muted-foreground font-black tracking-widest text-xs uppercase animate-pulse">Synchronizing Market Data...</p>
        </div>
    );

    return (
        <div className="max-w-[1200px] mx-auto space-y-12 animate-in fade-in slide-in-from-bottom-6 duration-1000 pb-20">
            {/* Enterprise Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
                <div>
                    <h1 className="text-5xl font-black text-foreground tracking-tighter mb-3 leading-none">Market <span className="text-primary italic">Dynamics</span></h1>
                    <p className="text-muted-foreground text-[16px] font-medium max-w-lg leading-relaxed">
                        Real-time capital velocity and organizational health metrics across all active high-yield portfolios.
                    </p>
                </div>
                <div className="flex items-center gap-5">
                    <div className="px-6 py-3 bg-card/60 border border-border/50 rounded-2xl flex items-center gap-3 text-[14px] font-black text-foreground shadow-sm backdrop-blur-xl">
                        <Calendar size={18} className="text-primary" /> Active Cycle: 30D
                    </div>
                    <button className="premium-button text-[15px]">
                        Export Analytics
                    </button>
                </div>
            </div>

            {/* Metric Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                {[
                    { label: 'Deployed Capital', value: `$${(stats?.outstandingPrincipal || 0).toLocaleString()}`, icon: Wallet, color: 'text-primary', bg: 'bg-primary/10' },
                    { label: 'Validated Nodes', value: stats?.totalBorrowers || 0, icon: Users, color: 'text-sky-400', bg: 'bg-sky-400/10' },
                    { label: 'Asset Velocity', value: stats?.activeLoans || 0, icon: TrendingUp, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
                    { label: 'Recall Target', value: `$${(stats?.dueNext7Days || 0).toLocaleString()}`, icon: PiggyBank, color: 'text-orange-400', bg: 'bg-orange-400/10' },
                ].map((m, i) => (
                    <div key={i} className="premium-card p-8 group hover:translate-y-[-6px] transition-all cursor-default">
                        <div className="flex items-center justify-between mb-6">
                            <div className={`p-4 rounded-[20px] ${m.bg} ${m.color} transition-all group-hover:scale-110 shadow-lg`}>
                                <m.icon size={24} />
                            </div>
                            <div className="flex items-center gap-1 text-[13px] bg-emerald-400/10 text-emerald-400 px-3 py-1.5 rounded-xl font-black">
                                <ArrowUpRight size={14} /> 12.5%
                            </div>
                        </div>
                        <div className="space-y-1">
                            <span className="text-[12px] font-black text-muted-foreground uppercase tracking-[0.2em] opacity-50 block mb-1">{m.label}</span>
                            <div className="text-4xl font-black text-foreground tracking-tighter">{m.value}</div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Analysis Center */}
            <div className="grid lg:grid-cols-12 gap-10">
                <div className="lg:col-span-8 premium-card overflow-hidden h-full flex flex-col border-border/40">
                    <div className="px-10 py-8 border-b border-border/50 flex items-center justify-between bg-white/[0.01]">
                        <div>
                            <h3 className="text-[18px] font-black text-foreground">Liquidity Flow</h3>
                            <p className="text-[13px] text-muted-foreground font-bold">Comparative inflow vs disbursement vector analysis</p>
                        </div>
                        <div className="flex items-center gap-6">
                            <div className="flex items-center gap-2">
                                <div className="w-2.5 h-2.5 rounded-full bg-primary shadow-[0_0_10px_rgba(217,235,119,0.5)]" />
                                <span className="text-[12px] font-black text-muted-foreground uppercase tracking-widest">Inflow</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-2.5 h-2.5 rounded-full bg-destructive shadow-[0_0_10px_rgba(253,135,142,0.5)]" />
                                <span className="text-[12px] font-black text-muted-foreground uppercase tracking-widest">Outflow</span>
                            </div>
                        </div>
                    </div>
                    <div className="p-10 flex-1">
                        <div className="h-[420px] w-full relative">
                            {isMounted && chartData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="colorPrimary" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#D9EB77" stopOpacity={0.25} />
                                                <stop offset="95%" stopColor="#D9EB77" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="colorDestructive" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#FD878E" stopOpacity={0.15} />
                                                <stop offset="95%" stopColor="#FD878E" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#25281A" />
                                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#A1A17A', fontSize: 12, fontWeight: 900 }} dy={10} />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#A1A17A', fontSize: 12, fontWeight: 900 }} tickFormatter={(v) => `$${v / 1000}k`} />
                                        <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#D9EB77', strokeWidth: 1, strokeDasharray: '4 4' }} />
                                        <Area type="monotone" dataKey="collections" name="Collections" stroke="#D9EB77" strokeWidth={5} fillOpacity={1} fill="url(#colorPrimary)" animationDuration={2500} />
                                        <Area type="monotone" dataKey="disbursements" name="Disbursements" stroke="#FD878E" strokeWidth={3} strokeDasharray="6 6" fillOpacity={1} fill="url(#colorDestructive)" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="h-full w-full flex flex-col items-center justify-center text-muted-foreground text-sm italic bg-black/40 rounded-[32px] border border-dashed border-border/60 gap-4">
                                    <Zap size={32} className="opacity-10" />
                                    <span className="font-black uppercase tracking-[0.3em] text-[10px]">Awaiting Market Feed...</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="lg:col-span-4 space-y-10">
                    {/* Quick Action Matrix */}
                    <div className="premium-card h-fit">
                        <div className="px-8 py-7 border-b border-border/50 bg-white/[0.01] flex items-center justify-between">
                            <h3 className="text-[15px] font-black text-foreground uppercase tracking-widest">Protocol Matrix</h3>
                        </div>
                        <div className="p-8 grid grid-cols-2 gap-5">
                            {[
                                { label: 'Issue Asset', icon: ArrowUpRight, color: 'hover:bg-primary/20 hover:text-primary hover:border-primary/40' },
                                { label: 'Register Node', icon: Users, color: 'hover:bg-sky-400/20 hover:text-sky-400 hover:border-sky-400/40' },
                                { label: 'Recall Funds', icon: PiggyBank, color: 'hover:bg-emerald-400/20 hover:text-emerald-400 hover:border-emerald-400/40' },
                                { label: 'Audit Log', icon: Activity, color: 'hover:bg-orange-400/20 hover:text-orange-400 hover:border-orange-400/40' },
                            ].map((action, i) => (
                                <button key={i} className={`p-6 border border-border/80 rounded-[24px] text-[11px] font-black text-muted-foreground flex flex-col items-center gap-4 transition-all ${action.color} group bg-background/30`}>
                                    <div className="p-3 bg-white/5 rounded-2xl group-hover:bg-transparent transition-colors shadow-inner">
                                        <action.icon size={22} />
                                    </div>
                                    <span className="uppercase tracking-[0.15em]">{action.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Notification Card - Neon Version */}
                    <div className="neon-card relative overflow-hidden group border border-white/40">
                        <div className="absolute -right-6 -top-6 w-40 h-40 bg-black/10 rounded-full group-hover:scale-150 transition-transform duration-1000 blur-2xl" />
                        <div className="absolute -left-10 -bottom-10 w-32 h-32 bg-white/20 rounded-full group-hover:scale-125 transition-transform duration-700 blur-xl" />

                        <div className="relative z-10 flex flex-col h-full">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="p-2 bg-black/10 rounded-lg">
                                    <ShieldCheck size={24} className="text-primary-foreground" />
                                </div>
                                <h4 className="text-[13px] font-black uppercase tracking-[0.2em]">Compliance Engine</h4>
                            </div>
                            <h2 className="text-2xl font-black leading-[1.1] mb-8 tracking-tighter">
                                Critical mediation required for <span className="underline decoration-4 underline-offset-8">4 portfolio nodes</span>.
                            </h2>
                            <button className="w-full py-5 bg-background text-foreground rounded-2xl font-black text-[14px] uppercase shadow-2xl transition-all hover:bg-black hover:text-white active:scale-95 group flex items-center justify-center gap-2">
                                Execute Recovery
                                <Zap size={16} className="text-primary group-hover:animate-pulse" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
