"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { Wallet, Calendar, PiggyBank, Users, TrendingUp, ArrowUpRight, Activity, Percent, Zap } from 'lucide-react';

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
                <div className="bg-white p-3 border border-[#E3E8EE] shadow-lg rounded-md text-[13px]">
                    <p className="font-semibold text-[#1A1F36] mb-1">{label}</p>
                    {payload.map((entry: any, index: number) => (
                        <div key={index} className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: entry.color }} />
                            <span className="text-[#4F566B]">{entry.name}:</span>
                            <span className="font-bold text-[#1A1F36]">${entry.value.toLocaleString()}</span>
                        </div>
                    ))}
                </div>
            );
        }
        return null;
    };

    if (loading) return (
        <div className="flex flex-col h-[60vh] items-center justify-center space-y-4">
            <Activity className="animate-spin text-[#635BFF]" size={40} />
            <p className="text-[#697386] font-medium">Fetching platform analytics...</p>
        </div>
    );

    return (
        <div className="max-w-[1200px] mx-auto space-y-8 animate-in fade-in duration-500 pb-10">
            {/* Enterprise Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-[#1A1F36] tracking-tight">Financial Overview</h1>
                    <p className="text-[#697386] text-[14px]">Performance and capital velocity across your organization.</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="px-3 py-1 bg-white border border-[#E3E8EE] rounded flex items-center gap-2 text-[12px] font-semibold text-[#4F566B] shadow-sm">
                        <Calendar size={14} /> Last 30 Days
                    </div>
                    <button className="bg-[#635BFF] hover:bg-[#5D55EF] text-white text-[13px] font-semibold py-2 px-4 rounded shadow-sm transition-all focus:ring-4 focus:ring-[#635BFF]/20">
                        Export Reports
                    </button>
                </div>
            </div>

            {/* Metric Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                    { label: 'Active Capital', value: `$${(stats?.outstandingPrincipal || 0).toLocaleString()}`, icon: Wallet, color: 'text-[#635BFF]', bg: 'bg-[#F0F5FF]' },
                    { label: 'Total Clients', value: stats?.totalBorrowers || 0, icon: Users, color: 'text-[#00D4FF]', bg: 'bg-[#E0FAFF]' },
                    { label: 'Monthly Growth', value: stats?.activeLoans || 0, icon: TrendingUp, color: 'text-[#3ECF8E]', bg: 'bg-[#E6F9F1]' },
                    { label: 'Upcoming Recall', value: `$${(stats?.dueNext7Days || 0).toLocaleString()}`, icon: PiggyBank, color: 'text-[#F59E0B]', bg: 'bg-[#FFFBEB]' },
                ].map((m, i) => (
                    <div key={i} className="bg-white border border-[#E3E8EE] p-5 rounded-lg shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-center gap-3 mb-3">
                            <div className={`p-2 rounded ${m.bg} ${m.color}`}>
                                <m.icon size={18} />
                            </div>
                            <span className="text-[14px] font-semibold text-[#697386]">{m.label}</span>
                        </div>
                        <div className="text-2xl font-bold text-[#1A1F36]">{m.value}</div>
                        <div className="mt-2 flex items-center gap-1 text-[12px]">
                            <span className="text-[#3ECF8E] font-bold">+12.5%</span>
                            <span className="text-[#697386]">vs last month</span>
                        </div>
                    </div>
                ))}
            </div>

            {/* Analysis Center */}
            <div className="grid lg:grid-cols-12 gap-8">
                <div className="lg:col-span-8 bg-white border border-[#E3E8EE] rounded-lg shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-[#E3E8EE] flex items-center justify-between bg-[#F7FAFC]/30">
                        <h3 className="text-[14px] font-bold text-[#1A1F36]">Capital Velocity</h3>
                        <Activity size={16} className="text-[#697386]" />
                    </div>
                    <div className="p-6">
                        <div className="h-[350px] w-full relative">
                            {isMounted && chartData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%" minHeight={350}>
                                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="colorDis" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#635BFF" stopOpacity={0.1} />
                                                <stop offset="95%" stopColor="#635BFF" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E3E8EE" />
                                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#697386', fontSize: 11, fontWeight: 500 }} dy={10} />
                                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#697386', fontSize: 11, fontWeight: 500 }} tickFormatter={(v) => `$${v / 1000}k`} />
                                        <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#635BFF', strokeWidth: 1, strokeDasharray: '4 4' }} />
                                        <Area type="monotone" dataKey="disbursements" name="Disbursements" stroke="#635BFF" strokeWidth={2.5} fillOpacity={1} fill="url(#colorDis)" />
                                        <Area type="monotone" dataKey="collections" name="Collections" stroke="#3ECF8E" strokeWidth={2.5} fill="transparent" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="h-full w-full flex items-center justify-center text-[#AAB7C4] text-sm italic bg-[#F7FAFC] rounded-md border border-dashed border-[#E3E8EE]">No transaction data available</div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="lg:col-span-4 space-y-8">
                    {/* Quick Action Matrix */}
                    <div className="bg-white border border-[#E3E8EE] rounded-lg shadow-sm">
                        <div className="px-6 py-4 border-b border-[#E3E8EE] bg-[#F7FAFC]/30 flex items-center justify-between">
                            <h3 className="text-[14px] font-bold text-[#1A1F36]">Quick Actions</h3>
                            <Percent size={16} className="text-[#697386]" />
                        </div>
                        <div className="p-4 grid grid-cols-2 gap-3">
                            {[
                                { label: 'New Loan', icon: ArrowUpRight, color: 'hover:bg-indigo-50 hover:text-indigo-600' },
                                { label: 'Add Client', icon: Users, color: 'hover:bg-emerald-50 hover:text-emerald-600' },
                                { label: 'Collect', icon: PiggyBank, color: 'hover:bg-amber-50 hover:text-amber-600' },
                                { label: 'Platform', icon: Zap, color: 'hover:bg-purple-50 hover:text-purple-600' },
                            ].map((action, i) => (
                                <button key={i} className={`p-4 border border-[#E3E8EE] rounded-md text-[13px] font-bold text-[#4F566B] flex flex-col items-center gap-2 transition-all ${action.color} transform hover:-translate-y-[1px]`}>
                                    <action.icon size={20} />
                                    {action.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Notification Card */}
                    <div className="bg-[#635BFF] p-6 rounded-lg text-white shadow-lg relative overflow-hidden group">
                        <div className="absolute -right-4 -top-4 w-24 h-24 bg-white/10 rounded-full group-hover:scale-110 transition-transform" />
                        <h4 className="text-sm font-bold opacity-80 uppercase tracking-wider mb-2">Compliance Insight</h4>
                        <p className="text-[13px] leading-relaxed mb-4">You have <strong className="underline">4 overdue</strong> loan installments requiring immediate intervention to maintain portfolio health.</p>
                        <button className="w-full py-2 bg-white text-[#635BFF] rounded font-bold text-[12px] uppercase shadow-md transition-all active:scale-[0.98]">
                            Review Delinquencies
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
