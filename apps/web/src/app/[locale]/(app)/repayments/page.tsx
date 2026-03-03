"use client";

import { useEffect, useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { Plus, Search, CreditCard, Loader2, Download, Receipt, Wallet, ArrowUpRight, CheckCircle2, DollarSign, Activity, FileStack } from 'lucide-react';
import { RepaymentModal } from '@/components/RepaymentModal';

interface Repayment {
    id: string;
    loanId: string;
    loan: { borrower: { firstName: string; lastName: string; }; };
    amount: number;
    date: string;
    principalPaid: number;
    interestPaid: number;
    penaltyPaid?: number;
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
            showToast('Failed to load recovery ledger', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchRepayments(); }, []);

    const filtered = useMemo(() => {
        if (!Array.isArray(repayments)) return [];
        return repayments.filter(r =>
            `${r.loan?.borrower?.firstName || ''} ${r.loan?.borrower?.lastName || ''}`
                .toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [repayments, searchQuery]);

    const totalCollected = Array.isArray(repayments)
        ? repayments.reduce((sum, r) => sum + Number(r.amount || 0), 0)
        : 0;

    const exportToExcel = async () => {
        try {
            const res = await api.get('/exports/repayments/excel', { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `repayment_ledger_${new Date().toISOString().split('T')[0]}.xlsx`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            showToast('Ledger exported successfully', 'success');
        } catch {
            showToast('Failed to export recovery data', 'error');
        }
    };

    return (
        <div className="max-w-[1200px] mx-auto space-y-8 animate-in fade-in duration-500 pb-10">
            {/* Header Area */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-[#1A1F36] tracking-tight">Balance Ledger</h1>
                    <p className="text-[#697386] text-[14px]">
                        Total collections: <span className="text-[#1A1F36] font-bold">${totalCollected.toLocaleString()}</span> across {repayments.length} transactions.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={exportToExcel}
                        className="bg-white border border-[#E3E8EE] text-[#4F566B] text-[13px] font-semibold py-2 px-4 rounded shadow-sm hover:bg-[#F6F9FC] transition-all flex items-center gap-2"
                    >
                        <Download size={14} /> Export
                    </button>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="bg-[#635BFF] hover:bg-[#5D55EF] text-white text-[13px] font-semibold py-2 px-4 rounded shadow-sm transition-all flex items-center gap-2"
                    >
                        <Plus size={16} />
                        Add Repayment
                    </button>
                </div>
            </div>

            {/* Metric Overview */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                    { label: 'Total Volume', value: `$${totalCollected.toLocaleString()}`, icon: Wallet, color: 'text-[#635BFF]', bg: 'bg-[#F0F5FF]' },
                    { label: 'Avg Payment', value: `$${repayments.length ? (totalCollected / repayments.length).toFixed(0) : 0}`, icon: Activity, color: 'text-[#00D4FF]', bg: 'bg-[#E0FAFF]' },
                    { label: 'Ledger Audit', value: 'Verified', icon: CheckCircle2, color: 'text-[#3ECF8E]', bg: 'bg-[#E6F9F1]' },
                ].map((m, i) => (
                    <div key={i} className="bg-white border border-[#E3E8EE] p-5 rounded-lg shadow-sm">
                        <div className="flex items-center gap-3 mb-2">
                            <div className={`p-1.5 rounded ${m.bg} ${m.color}`}>
                                <m.icon size={16} />
                            </div>
                            <span className="text-[12px] font-semibold text-[#697386] uppercase tracking-wider">{m.label}</span>
                        </div>
                        <div className="text-2xl font-bold text-[#1A1F36]">{m.value}</div>
                    </div>
                ))}
            </div>

            {/* Toolbar */}
            <div className="relative group max-w-md">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#AAB7C4]" />
                <input
                    type="text"
                    placeholder="Search by customer name..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-white border border-[#E3E8EE] rounded-md text-[13px] font-medium text-[#1A1F36] focus:outline-none focus:ring-2 focus:ring-[#635BFF]/10 focus:border-[#635BFF] transition-all"
                />
            </div>

            {/* Table */}
            <div className="bg-white border border-[#E3E8EE] rounded-lg shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-[#E3E8EE]">
                        <thead className="bg-[#F7FAFC]">
                            <tr>
                                <th className="px-6 py-3 text-left text-[11px] font-bold text-[#697386] uppercase tracking-wider">Customer</th>
                                <th className="px-6 py-3 text-right text-[11px] font-bold text-[#697386] uppercase tracking-wider">Amount</th>
                                <th className="px-6 py-3 text-right text-[11px] font-bold text-[#697386] uppercase tracking-wider hidden md:table-cell">Interest</th>
                                <th className="px-6 py-3 text-right text-[11px] font-bold text-[#697386] uppercase tracking-wider hidden md:table-cell">Principal</th>
                                <th className="px-6 py-3 text-right text-[11px] font-bold text-[#697386] uppercase tracking-wider">Date</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-[#E3E8EE]">
                            {loading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td colSpan={5} className="px-6 py-4 h-16 bg-[#F7FAFC]/30" />
                                    </tr>
                                ))
                            ) : filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-20 text-center">
                                        <div className="text-[#AAB7C4] mb-2"><CreditCard size={40} className="mx-auto opacity-20" /></div>
                                        <p className="text-[14px] font-medium text-[#1A1F36]">No payments found</p>
                                    </td>
                                </tr>
                            ) : (
                                filtered.map(rp => (
                                    <tr key={rp.id} className="hover:bg-[#F6F9FC] transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-[#E6F9F1] flex items-center justify-center text-[#3ECF8E] text-[11px] font-bold">
                                                    {rp.loan.borrower.firstName.charAt(0)}{rp.loan.borrower.lastName.charAt(0)}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[13px] font-bold text-[#1A1F36]">{rp.loan.borrower.firstName} {rp.loan.borrower.lastName}</span>
                                                    <span className="text-[11px] text-[#697386] font-medium">#{rp.id.slice(-6).toUpperCase()}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <span className="text-[13px] font-bold text-[#3ECF8E]">${Number(rp.amount).toLocaleString()}</span>
                                        </td>
                                        <td className="px-6 py-4 text-right hidden md:table-cell">
                                            <span className="text-[13px] text-[#697386]">${Number(rp.interestPaid).toLocaleString()}</span>
                                        </td>
                                        <td className="px-6 py-4 text-right hidden md:table-cell">
                                            <span className="text-[13px] text-[#697386]">${Number(rp.principalPaid).toLocaleString()}</span>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <span className="text-[12px] text-[#4F566B] bg-[#F6F9FC] px-2 py-0.5 rounded border border-[#E3E8EE]">
                                                {new Date(rp.date).toISOString().split('T')[0]}
                                            </span>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <RepaymentModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                onSuccess={() => { fetchRepayments(); showToast('Repayment recorded', 'success'); }}
            />
        </div>
    );
}
