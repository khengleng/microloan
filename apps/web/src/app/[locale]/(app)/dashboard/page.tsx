"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
    BarChart, Bar
} from 'recharts';

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

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>

            {loading ? (
                <div className="text-gray-500 flex h-32 items-center justify-center">Loading dashboard...</div>
            ) : (
                <>
                    {/* Top Stats */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-white p-5 rounded-lg shadow-sm border border-gray-100 flex flex-col hover:shadow-md transition">
                            <div className="text-sm text-gray-500 font-medium">Outstanding Principal</div>
                            <div className="text-2xl font-bold mt-2 text-blue-900">
                                ${stats?.outstandingPrincipal?.toLocaleString()}
                            </div>
                        </div>
                        <div className="bg-white p-5 rounded-lg shadow-sm border border-gray-100 flex flex-col hover:shadow-md transition">
                            <div className="text-sm text-gray-500 font-medium">Due Next 7 Days</div>
                            <div className="text-2xl font-bold mt-2 text-indigo-700">
                                ${stats?.dueNext7Days?.toLocaleString()}
                            </div>
                        </div>
                        <div className="bg-white p-5 rounded-lg shadow-sm border border-gray-100 flex flex-col hover:shadow-md transition">
                            <div className="text-sm text-gray-500 font-medium">Collections This Month</div>
                            <div className="text-2xl font-bold mt-2 text-emerald-600">
                                ${stats?.repaymentsThisMonth?.toLocaleString()}
                            </div>
                        </div>
                        <div className="bg-white p-5 rounded-lg shadow-sm border border-gray-100 flex flex-col hover:shadow-md transition">
                            <div className="text-sm text-gray-500 font-medium">Active Accounts</div>
                            <div className="text-2xl font-bold mt-2 text-gray-800">
                                {stats?.activeLoans} Loans / {stats?.totalBorrowers} Borrowers
                            </div>
                        </div>
                    </div>

                    {/* Charts */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
                        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 min-h-[350px]">
                            <h3 className="text-lg font-semibold mb-4 text-gray-800">Cash Flow (Last 6 Months)</h3>
                            <div className="h-72 w-full relative">
                                {isMounted && chartData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height="100%" aspect={3}>
                                        <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 12 }} />
                                            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 12 }} tickFormatter={(value) => `$${value}`} />
                                            <Tooltip
                                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                                formatter={(value: any) => [`$${value}`, undefined]}
                                            />
                                            <Legend verticalAlign="top" height={36} />
                                            <Line type="monotone" dataKey="disbursements" name="Disbursements" stroke="#4F46E5" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
                                            <Line type="monotone" dataKey="collections" name="Collections" stroke="#10B981" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
                                        </LineChart>
                                    </ResponsiveContainer>
                                ) : isMounted ? (
                                    <div className="h-full w-full flex items-center justify-center text-gray-400">No data available</div>
                                ) : (
                                    <div className="h-full w-full bg-gray-50 rounded animate-pulse" />
                                )}
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100 min-h-[350px]">
                            <h3 className="text-lg font-semibold mb-4 text-gray-800">Monthly Volume</h3>
                            <div className="h-72 w-full relative">
                                {isMounted && chartData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height="100%" aspect={3}>
                                        <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 12 }} />
                                            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 12 }} tickFormatter={(value) => `$${value}`} />
                                            <Tooltip
                                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                                formatter={(value: any) => [`$${value}`, undefined]}
                                                cursor={{ fill: '#F3F4F6' }}
                                            />
                                            <Legend verticalAlign="top" height={36} />
                                            <Bar dataKey="disbursements" name="Disbursements" fill="#4F46E5" radius={[4, 4, 0, 0]} />
                                            <Bar dataKey="collections" name="Collections" fill="#10B981" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                ) : isMounted ? (
                                    <div className="h-full w-full flex items-center justify-center text-gray-400">No data available</div>
                                ) : (
                                    <div className="h-full w-full bg-gray-50 rounded animate-pulse" />
                                )}
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
