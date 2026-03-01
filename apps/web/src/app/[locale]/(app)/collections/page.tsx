"use client";

import { useEffect, useState, useMemo } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertTriangle, CheckCircle, Search, Eye, Clock } from 'lucide-react';

interface OverdueInstallment {
    dueDate: string;
    totalAmount: number;
    paidPrincipal: number;
    paidInterest: number;
    installmentNumber: number;
    isPaid: boolean;
}

interface OverdueLoan {
    id: string;
    borrower: { firstName: string; lastName: string; phone: string; };
    principal: number;
    startDate: string;
    status: string;
    overdueInstallments: OverdueInstallment[];
    daysOverdue: number;
    totalOverdue: number;
}

export default function OverduePage() {
    const { locale } = useParams();
    const { showToast } = useToast();
    const [loans, setLoans] = useState<OverdueLoan[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');

    useEffect(() => {
        const fetchOverdue = async () => {
            setLoading(true);
            try {
                const res = await api.get('/loans');
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                const overdue: OverdueLoan[] = [];
                for (const loan of res.data) {
                    if (loan.status !== 'DISBURSED') continue;
                    const detail = await api.get(`/loans/${loan.id}`);
                    const overdueInstallments = (detail.data.schedules || []).filter((s: any) =>
                        !s.isPaid && new Date(s.dueDate) < today
                    );
                    if (overdueInstallments.length > 0) {
                        const totalOverdue = overdueInstallments.reduce((sum: number, s: any) =>
                            sum + (Number(s.totalAmount) - Number(s.paidPrincipal) - Number(s.paidInterest)), 0);
                        const oldestDue = new Date(overdueInstallments[0].dueDate);
                        const daysOverdue = Math.floor((today.getTime() - oldestDue.getTime()) / (1000 * 60 * 60 * 24));
                        overdue.push({ ...loan, overdueInstallments, daysOverdue, totalOverdue });
                    }
                }
                setLoans(overdue);
            } catch {
                showToast('Failed to load overdue loans', 'error');
            } finally {
                setLoading(false);
            }
        };
        fetchOverdue();
    }, []);

    const filtered = useMemo(() =>
        loans.filter(l =>
            `${l.borrower.firstName} ${l.borrower.lastName} ${l.borrower.phone}`
                .toLowerCase().includes(searchQuery.toLowerCase())
        ), [loans, searchQuery]);

    const totalAtRisk = loans.reduce((sum, l) => sum + l.totalOverdue, 0);

    const getDaysColor = (days: number) => {
        if (days <= 7) return 'text-amber-600 bg-amber-50';
        if (days <= 30) return 'text-orange-600 bg-orange-50';
        return 'text-red-600 bg-red-50';
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <AlertTriangle size={22} className="text-red-500" /> Collections & Overdue
                    </h1>
                    <p className="text-sm text-slate-500 mt-0.5">
                        {loans.length} overdue loan{loans.length !== 1 ? 's' : ''} · At risk: <span className="font-semibold text-red-600">${totalAtRisk.toLocaleString()}</span>
                    </p>
                </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-4">
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                    <div className="text-2xl font-bold text-amber-700">{loans.filter(l => l.daysOverdue <= 7).length}</div>
                    <div className="text-xs text-amber-600 font-medium mt-0.5">1–7 days overdue</div>
                </div>
                <div className="bg-orange-50 border border-orange-100 rounded-xl p-4">
                    <div className="text-2xl font-bold text-orange-700">{loans.filter(l => l.daysOverdue > 7 && l.daysOverdue <= 30).length}</div>
                    <div className="text-xs text-orange-600 font-medium mt-0.5">8–30 days overdue</div>
                </div>
                <div className="bg-red-50 border border-red-100 rounded-xl p-4">
                    <div className="text-2xl font-bold text-red-700">{loans.filter(l => l.daysOverdue > 30).length}</div>
                    <div className="text-xs text-red-600 font-medium mt-0.5">30+ days overdue</div>
                </div>
            </div>

            <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                    type="text"
                    placeholder="Search by name or phone..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                />
            </div>

            <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                <table className="min-w-full">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-100">
                            <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Borrower</th>
                            <th className="px-5 py-3.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Principal</th>
                            <th className="px-5 py-3.5 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">Overdue</th>
                            <th className="px-5 py-3.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Amount Due</th>
                            <th className="px-5 py-3.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {loading ? (
                            Array.from({ length: 3 }).map((_, i) => (
                                <tr key={i}>
                                    {Array.from({ length: 5 }).map((_, j) => (
                                        <td key={j} className="px-5 py-4">
                                            <div className="h-4 bg-slate-100 rounded animate-pulse" style={{ width: `${55 + (i + j) * 7}%` }} />
                                        </td>
                                    ))}
                                </tr>
                            ))
                        ) : filtered.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-5 py-16 text-center">
                                    <CheckCircle size={40} className="mx-auto text-emerald-200 mb-3" />
                                    <p className="text-slate-400 font-medium">
                                        {searchQuery ? 'No results found' : 'No overdue loans! Great job. 🎉'}
                                    </p>
                                </td>
                            </tr>
                        ) : (
                            filtered.map(loan => (
                                <tr key={loan.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-5 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 rounded-full bg-red-100 text-red-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                                {loan.borrower.firstName.charAt(0)}{loan.borrower.lastName.charAt(0)}
                                            </div>
                                            <div>
                                                <div className="text-sm font-medium text-slate-900">{loan.borrower.firstName} {loan.borrower.lastName}</div>
                                                <div className="text-xs text-slate-400">{loan.borrower.phone}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-5 py-4 text-right text-sm font-medium text-slate-700">${Number(loan.principal).toLocaleString()}</td>
                                    <td className="px-5 py-4 text-center">
                                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${getDaysColor(loan.daysOverdue)}`}>
                                            <Clock size={10} />
                                            {loan.daysOverdue}d · {loan.overdueInstallments.length} installment{loan.overdueInstallments.length !== 1 ? 's' : ''}
                                        </span>
                                    </td>
                                    <td className="px-5 py-4 text-right text-sm font-bold text-red-600">${loan.totalOverdue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                                    <td className="px-5 py-4 text-right">
                                        <Link href={`/${locale}/loans/${loan.id}`}>
                                            <button className="p-1.5 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="View Loan">
                                                <Eye size={14} />
                                            </button>
                                        </Link>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
