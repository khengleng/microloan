"use client";

import { useEffect, useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { Plus, Search, CreditCard, Loader2, Download } from 'lucide-react';
import { RepaymentModal } from '@/components/RepaymentModal';

interface Repayment {
    id: string;
    loan: { borrower: { firstName: string; lastName: string; }; };
    amount: number;
    date: string;
    principalPaid: number;
    interestPaid: number;
}

export default function RepaymentsPage() {
    const t = useTranslations('Repayments');
    const { showToast } = useToast();
    const [repayments, setRepayments] = useState<Repayment[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);

    const fetchRepayments = async () => {
        setLoading(true);
        try {
            const res = await api.get('/repayments');
            setRepayments(res.data);
        } catch {
            showToast('Failed to load repayments', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchRepayments(); }, []);

    const filtered = useMemo(() =>
        repayments.filter(r =>
            `${r.loan.borrower.firstName} ${r.loan.borrower.lastName}`
                .toLowerCase().includes(searchQuery.toLowerCase())
        ), [repayments, searchQuery]);

    const totalCollected = repayments.reduce((sum, r) => sum + Number(r.amount), 0);

    const exportToExcel = async () => {
        try {
            const res = await api.get('/exports/repayments/excel', { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', 'repayments.xlsx');
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch {
            showToast('Failed to export repayments', 'error');
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
                    <p className="text-sm text-slate-500 mt-0.5">
                        {repayments.length} payments · Total collected: <span className="font-semibold text-emerald-600">${totalCollected.toLocaleString()}</span>
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        onClick={exportToExcel}
                        variant="outline"
                        className="flex items-center gap-2 flex-shrink-0"
                    >
                        <Download size={15} /> Export
                    </Button>
                    <Button onClick={() => setIsModalOpen(true)} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 flex-shrink-0">
                        <Plus size={15} /> {t('add_new')}
                    </Button>
                </div>
            </div>

            <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                    type="text"
                    placeholder="Search by borrower name..."
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
                            <th className="px-5 py-3.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Amount</th>
                            <th className="px-5 py-3.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider hidden md:table-cell">Interest</th>
                            <th className="px-5 py-3.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider hidden md:table-cell">Principal</th>
                            <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('date')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {loading ? (
                            Array.from({ length: 4 }).map((_, i) => (
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
                                    <CreditCard size={40} className="mx-auto text-slate-200 mb-3" />
                                    <p className="text-slate-400 font-medium">{searchQuery ? 'No repayments match your search' : t('no_repayments')}</p>
                                </td>
                            </tr>
                        ) : (
                            filtered.map(rp => (
                                <tr key={rp.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-5 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                                {rp.loan.borrower.firstName.charAt(0)}{rp.loan.borrower.lastName.charAt(0)}
                                            </div>
                                            <span className="text-sm font-medium text-slate-900">{rp.loan.borrower.firstName} {rp.loan.borrower.lastName}</span>
                                        </div>
                                    </td>
                                    <td className="px-5 py-4 text-right text-sm font-bold text-emerald-700">${Number(rp.amount).toLocaleString()}</td>
                                    <td className="px-5 py-4 text-right text-sm text-slate-600 hidden md:table-cell">${Number(rp.interestPaid).toLocaleString()}</td>
                                    <td className="px-5 py-4 text-right text-sm text-slate-600 hidden md:table-cell">${Number(rp.principalPaid).toLocaleString()}</td>
                                    <td className="px-5 py-4 text-sm text-slate-500">{new Date(rp.date).toLocaleDateString()}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            <RepaymentModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                onSuccess={() => { fetchRepayments(); showToast('Repayment posted successfully', 'success'); }}
            />
        </div>
    );
}
