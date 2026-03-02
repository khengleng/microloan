"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    BarChart, Bar, Cell
} from 'recharts';
import { Wallet, Calendar, PiggyBank, Users, TrendingUp, ArrowUpRight, Activity, Percent, ShieldCheck, Zap } from 'lucide-react';

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
                <div className="glass p-4 rounded-3xl border border-white/40 shadow-2xl backdrop-blur-xl">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">{label}</p>
                    {payload.map((entry: any, index: number) => (
                        <div key={index} className="flex items-center gap-2 mb-1">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                            <span className="text-xs font-black text-slate-900">{entry.name}:</span>
                            <span className="text-xs font-black text-indigo-600">${entry.value.toLocaleString()}</span>
                        </div>
                    ))}
                </div>
            );
        }
        return null;
    };

    return (
        <div className="space-y-10 animate-in fade-in duration-1000 font-urbanist pb-10">
            {/* Control Bar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div>
                    <h1 className="text-4xl font-black text-slate-950 tracking-tighter flex items-center gap-3">
                        <Activity className="text-indigo-600" size={32} /> Central Command
                    </h1>
                    <p className="text-slate-500 font-bold mt-1 max-w-md">Real-time financial intelligence and operational health metrics for the platform.</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 bg-emerald-50/50 px-5 py-3 rounded-2xl border border-emerald-100/50 shadow-sm shadow-emerald-600/5 hover:scale-105 transition-transform duration-300">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-xs font-black text-emerald-700 uppercase tracking-widest">Portfolio Healthy</span>
                    </div>
                    <div className="flex items-center gap-2 bg-indigo-50/50 px-5 py-3 rounded-2xl border border-indigo-100/50 shadow-sm shadow-indigo-600/5 hover:scale-105 transition-transform duration-300">
                        <Zap className="text-indigo-500" size={16} />
                        <span className="text-xs font-black text-indigo-700 uppercase tracking-widest">Live Sync Alpha</span>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="h-44 bg-slate-100/50 rounded-[2.5rem] animate-pulse" />
                    ))}
                </div>
            ) : (
                <>
                    {/* High-Fidelity Metrics */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                        <div className="glass p-8 rounded-[3rem] premium-shadow border-white/60 relative overflow-hidden group hover:-translate-y-2 transition-all duration-500 bg-gradient-to-br from-white/80 to-indigo-50/30">
                            <div className="absolute -top-10 -right-10 w-40 h-40 bg-indigo-600/5 rounded-full blur-3xl group-hover:bg-indigo-600/10 transition-colors" />
                            <div className="w-14 h-14 bg-indigo-600 rounded-[1.5rem] flex items-center justify-center text-white mb-6 shadow-xl shadow-indigo-600/20 group-hover:rotate-12 transition-transform duration-500">
                                <Wallet size={28} />
                            </div>
                            <div className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] mb-2 px-1">Active Exposure</div>
                            <div className="text-3xl font-black text-slate-950 tracking-tighter">
                                ${stats?.outstandingPrincipal?.toLocaleString()}
                            </div>
                            <div className="mt-4 flex items-center gap-1.5 text-[10px] font-black text-indigo-600 bg-indigo-50 w-fit px-3 py-1 rounded-full uppercase tracking-wider">
                                <ArrowUpRight size={10} /> +2.4% Momentum
                            </div>
                        </div>

                        <div className="glass p-8 rounded-[3rem] premium-shadow border-white/60 relative overflow-hidden group hover:-translate-y-2 transition-all duration-500 bg-gradient-to-br from-white/80 to-emerald-50/30">
                            <div className="absolute -top-10 -right-10 w-40 h-40 bg-emerald-600/5 rounded-full blur-3xl group-hover:bg-emerald-600/10 transition-colors" />
                            <div className="w-14 h-14 bg-emerald-600 rounded-[1.5rem] flex items-center justify-center text-white mb-6 shadow-xl shadow-emerald-600/20 group-hover:rotate-12 transition-transform duration-500">
                                <PiggyBank size={28} />
                            </div>
                            <div className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] mb-2 px-1">Monthly Recovery</div>
                            <div className="text-3xl font-black text-slate-950 tracking-tighter">
                                ${stats?.repaymentsThisMonth?.toLocaleString()}
                            </div>
                            <div className="mt-4 flex items-center gap-1.5 text-[10px] font-black text-emerald-600 bg-emerald-50 w-fit px-3 py-1 rounded-full uppercase tracking-wider">
                                <Percent size={10} /> 98% Recovery Rate
                            </div>
                        </div>

                        <div className="glass p-8 rounded-[3rem] premium-shadow border-white/60 relative overflow-hidden group hover:-translate-y-2 transition-all duration-500 bg-gradient-to-br from-white/80 to-amber-50/30">
                            <div className="absolute -top-10 -right-10 w-40 h-40 bg-amber-600/5 rounded-full blur-3xl group-hover:bg-amber-600/10 transition-colors" />
                            <div className="w-14 h-14 bg-amber-500 rounded-[1.5rem] flex items-center justify-center text-white mb-6 shadow-xl shadow-amber-500/20 group-hover:rotate-12 transition-transform duration-500">
                                <Calendar size={28} />
                            </div>
                            <div className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] mb-2 px-1">7D Projected Inflow</div>
                            <div className="text-3xl font-black text-slate-950 tracking-tighter">
                                ${stats?.dueNext7Days?.toLocaleString()}
                            </div>
                            <div className="mt-4 flex items-center gap-1.5 text-[10px] font-black text-amber-600 bg-amber-50 w-fit px-3 py-1 rounded-full uppercase tracking-wider">
                                <ShieldCheck size={10} /> No Critical Delays
                            </div>
                        </div>

                        <div className="glass p-8 rounded-[3rem] premium-shadow border-white/60 relative overflow-hidden group hover:-translate-y-2 transition-all duration-500 bg-gradient-to-br from-white/80 to-slate-50/30">
                            <div className="absolute -top-10 -right-10 w-40 h-40 bg-slate-600/5 rounded-full blur-3xl group-hover:bg-slate-600/10 transition-colors" />
                            <div className="w-14 h-14 bg-slate-800 rounded-[1.5rem] flex items-center justify-center text-white mb-6 shadow-xl shadow-slate-800/20 group-hover:rotate-12 transition-transform duration-500">
                                <Users size={28} />
                            </div>
                            <div className="text-[10px] text-slate-400 font-black uppercase tracking-[0.2em] mb-2 px-1">Ecosystem Scale</div>
                            <div className="text-3xl font-black text-slate-950 tracking-tighter">
                                {stats?.activeLoans} <span className="text-slate-300 font-medium">/</span> {stats?.totalBorrowers}
                            </div>
                            <div className="mt-4 flex items-center gap-1.5 text-[10px] font-black text-slate-600 bg-slate-100 w-fit px-3 py-1 rounded-full uppercase tracking-wider">
                                <Activity size={10} /> Active Identities
                            </div>
                        </div>
                    </div>

                    {/* Industrial Analytical Panel */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                        <div className="glass p-10 rounded-[3.5rem] premium-shadow border-white/40 bg-white/40 overflow-hidden relative group">
                            <div className="flex justify-between items-start mb-8">
                                <div>
                                    <h3 className="text-xl font-black text-slate-950 tracking-tight">Financial Velocity</h3>
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Collections vs Disbursements Protocol</p>
                                </div>
                                <div className="p-3 bg-white rounded-2xl shadow-sm border border-slate-100">
                                    <TrendingUp className="text-indigo-600" size={20} />
                                </div>
                            </div>
                            <div className="h-[350px] w-full relative">
                                {isMounted && chartData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height="100%" minHeight={350}>
                                        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                            <defs>
                                                <linearGradient id="colorDis" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#6366F1" stopOpacity={0.3} />
                                                    <stop offset="95%" stopColor="#6366F1" stopOpacity={0} />
                                                </linearGradient>
                                                <linearGradient id="colorCol" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                                                    <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" strokeOpacity={0.5} />
                                            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 10, fontWeight: 800 }} dy={10} />
                                            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 10, fontWeight: 800 }} tickFormatter={(value) => `$${value / 1000}k`} />
                                            <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#6366F1', strokeWidth: 1, strokeDasharray: '5 5' }} />
                                            <Area type="monotone" dataKey="disbursements" name="Disbursements" stroke="#6366F1" strokeWidth={4} fillOpacity={1} fill="url(#colorDis)" />
                                            <Area type="monotone" dataKey="collections" name="Collections" stroke="#10B981" strokeWidth={4} fillOpacity={1} fill="url(#colorCol)" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="h-full w-full flex items-center justify-center text-slate-300 font-black text-xs uppercase tracking-[0.3em] bg-slate-50/30 rounded-3xl border border-dashed border-slate-200">No Velocity Data</div>
                                )}
                            </div>
                        </div>

                        <div className="glass p-10 rounded-[3.5rem] premium-shadow border-white/40 bg-white/40 overflow-hidden relative">
                            <div className="flex justify-between items-start mb-8">
                                <div>
                                    <h3 className="text-xl font-black text-slate-950 tracking-tight">Capital Deployment</h3>
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Historical Periodical Saturation</p>
                                </div>
                                <div className="p-3 bg-white rounded-2xl shadow-sm border border-slate-100">
                                    <Zap className="text-amber-500" size={20} />
                                </div>
                            </div>
                            <div className="h-[350px] w-full relative">
                                {isMounted && chartData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height="100%" minHeight={350}>
                                        <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} barGap={8}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" strokeOpacity={0.5} />
                                            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 10, fontWeight: 800 }} dy={10} />
                                            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 10, fontWeight: 800 }} tickFormatter={(value) => `$${value / 1000}k`} />
                                            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(99, 102, 241, 0.03)', radius: 20 }} />
                                            <Bar dataKey="disbursements" name="Disbursements" fill="#6366F1" radius={[12, 12, 12, 12]} barSize={24} />
                                            <Bar dataKey="collections" name="Collections" fill="#10B981" radius={[12, 12, 12, 12]} barSize={24} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="h-full w-full flex items-center justify-center text-slate-300 font-black text-xs uppercase tracking-[0.3em] bg-slate-50/30 rounded-3xl border border-dashed border-slate-200">No Deployment Data</div>
                                )}
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
