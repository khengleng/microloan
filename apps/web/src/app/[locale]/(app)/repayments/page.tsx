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
        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-6 duration-1000 font-urbanist pb-10">
            {/* Elite Recovery Header */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-emerald-600 rounded-[0.8rem] flex items-center justify-center text-white shadow-lg shadow-emerald-600/20">
                            <Receipt size={22} />
                        </div>
                        <h1 className="text-4xl font-black text-slate-950 tracking-tighter">Capital Recovery Ledger</h1>
                    </div>
                    <div className="flex items-center gap-2 text-slate-500 font-bold ml-1">
                        Total Recovery Inflow: <span className="text-emerald-600 font-black tracking-tight">${totalCollected.toLocaleString()}</span> across {repayments.length} transactions
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    <Button
                        onClick={exportToExcel}
                        variant="ghost"
                        className="flex items-center gap-2 rounded-2xl font-black text-[11px] uppercase tracking-widest px-6 h-12 bg-white/50 border border-slate-200/50 hover:bg-white shadow-sm transition-all"
                    >
                        <Download size={16} /> Export Intelligence
                    </Button>
                    <Button
                        onClick={() => setIsModalOpen(true)}
                        className="flex items-center gap-2 bg-emerald-600 text-white hover:bg-emerald-700 shadow-xl shadow-emerald-600/20 rounded-2xl font-black text-[11px] uppercase tracking-widest px-8 h-12 transition-all hover:scale-[1.02] active:scale-[0.98]"
                    >
                        <Plus size={18} />
                        Post Recovery Entry
                    </Button>
                </div>
            </div>

            {/* Recovery Highlights */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="glass p-6 rounded-[2.5rem] premium-shadow border-white/60 bg-gradient-to-br from-emerald-50/50 to-white/80">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1">Total Verified Recovery</span>
                        <div className="text-3xl font-black text-slate-950 tracking-tighter">${totalCollected.toLocaleString()}</div>
                    </div>
                </div>
                <div className="glass p-6 rounded-[2.5rem] premium-shadow border-white/60 bg-white/80">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Transaction Velocity</span>
                        <div className="text-3xl font-black text-slate-950 tracking-tighter">{repayments.length} <span className="text-slate-300 font-medium text-lg">POSTS</span></div>
                    </div>
                </div>
                <div className="glass p-6 rounded-[2.5rem] premium-shadow border-white/60 bg-white/80">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Average Liquidation</span>
                        <div className="text-3xl font-black text-slate-950 tracking-tighter">${repayments.length ? (totalCollected / repayments.length).toFixed(0) : 0}</div>
                    </div>
                </div>
                <div className="glass p-6 rounded-[2.5rem] premium-shadow border-white/60 bg-indigo-50/30">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mb-1">System Health</span>
                        <div className="flex items-center gap-2">
                            <span className="text-2xl font-black text-slate-950 tracking-tighter uppercase whitespace-nowrap">Immutable Alpha</span>
                            <CheckCircle2 size={24} className="text-emerald-500" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Industrial Ledger Filter */}
            <div className="relative group max-w-4xl">
                <Search size={22} className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-600 transition-colors duration-300" />
                <input
                    type="text"
                    placeholder="Filter recovery events by validated identity name or transaction ID..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-16 pr-6 h-16 text-sm font-bold border-white bg-white/40 glass premium-shadow rounded-[1.8rem] focus:outline-none focus:ring-4 focus:ring-emerald-500/10 transition-all duration-300 text-slate-950 placeholder:text-slate-400"
                />
            </div>

            {/* High-Contrast Liquidation Ledger */}
            <div className="glass rounded-[3.5rem] premium-shadow border-white/40 overflow-hidden bg-white/40">
                <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse">
                        <thead>
                            <tr className="bg-emerald-950/5">
                                <th className="pl-10 pr-5 py-6 text-left text-[11px] font-black text-slate-400 uppercase tracking-[0.25em]">Validated Identity</th>
                                <th className="px-5 py-6 text-right text-[11px] font-black text-slate-400 uppercase tracking-[0.25em]">Gross Recovery</th>
                                <th className="px-5 py-6 text-right text-[11px] font-black text-slate-400 uppercase tracking-[0.25em] hidden md:table-cell">Logic (Interest)</th>
                                <th className="px-5 py-6 text-right text-[11px] font-black text-slate-400 uppercase tracking-[0.25em] hidden md:table-cell">Capital (Principal)</th>
                                <th className="px-5 py-6 text-right text-[11px] font-black text-slate-400 uppercase tracking-[0.25em] hidden md:table-cell">Deviation (Penalty)</th>
                                <th className="pl-5 pr-10 py-6 text-right text-[11px] font-black text-slate-400 uppercase tracking-[0.25em]">Execution Event</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100/50">
                            {loading ? (
                                Array.from({ length: 6 }).map((_, i) => (
                                    <tr key={i}>
                                        <td className="pl-10 pr-5 py-8"><div className="h-10 w-48 bg-slate-100/50 rounded-2xl animate-pulse" /></td>
                                        <td className="px-5 py-8"><div className="h-6 w-24 bg-slate-100/50 rounded-lg animate-pulse float-right" /></td>
                                        <td className="px-5 py-8 hidden md:table-cell"><div className="h-4 w-20 bg-slate-100/50 rounded-lg animate-pulse float-right" /></td>
                                        <td className="px-5 py-8 hidden md:table-cell"><div className="h-4 w-20 bg-slate-100/50 rounded-lg animate-pulse float-right" /></td>
                                        <td className="px-5 py-8 hidden md:table-cell"><div className="h-4 w-20 bg-slate-100/50 rounded-lg animate-pulse float-right" /></td>
                                        <td className="pl-5 pr-10 py-8"><div className="h-4 w-32 bg-slate-100/50 rounded-lg animate-pulse float-right" /></td>
                                    </tr>
                                ))
                            ) : filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-5 py-32 text-center">
                                        <div className="relative inline-block mb-4">
                                            <div className="w-20 h-20 bg-slate-50 rounded-[2.5rem] flex items-center justify-center text-slate-200">
                                                <CreditCard size={48} />
                                            </div>
                                            <Activity className="absolute -bottom-2 -right-2 text-slate-300" size={24} />
                                        </div>
                                        <h3 className="text-xl font-black text-slate-900 tracking-tight">Zero Recovery Events Identified</h3>
                                        <p className="text-slate-400 font-bold mt-1 uppercase text-[10px] tracking-widest">No matching liquidation records found in central ledger</p>
                                    </td>
                                </tr>
                            ) : (
                                filtered.map(rp => (
                                    <tr key={rp.id} className="hover:bg-white/60 transition-all duration-300 group">
                                        <td className="pl-10 pr-5 py-7">
                                            <div className="flex items-center gap-5">
                                                <div className="w-14 h-14 rounded-[1.4rem] bg-emerald-600 flex items-center justify-center text-white text-base font-black shadow-lg shadow-emerald-600/10 group-hover:scale-110 group-hover:rotate-3 transition-all duration-500">
                                                    {rp.loan.borrower.firstName.charAt(0)}{rp.loan.borrower.lastName.charAt(0)}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="font-extrabold text-slate-950 text-lg tracking-tighter leading-tight group-hover:text-emerald-600 transition-colors">{rp.loan.borrower.firstName} {rp.loan.borrower.lastName}</span>
                                                    <div className="flex items-center gap-2 mt-0.5">
                                                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Digital Payer</span>
                                                        <ArrowUpRight size={10} className="text-emerald-500" />
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-5 py-7 text-right">
                                            <div className="flex flex-col items-end">
                                                <span className="text-xl font-black text-emerald-700 tracking-tighter">${Number(rp.amount).toLocaleString()}</span>
                                                <span className="text-[9px] font-extrabold text-emerald-500 uppercase tracking-widest">Gross Liquidation</span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-7 text-right hidden md:table-cell">
                                            <div className="flex flex-col items-end">
                                                <span className="text-sm font-black text-slate-800 tracking-tight">${Number(rp.interestPaid).toLocaleString()}</span>
                                                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Interest Recovery</span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-7 text-right hidden md:table-cell">
                                            <div className="flex flex-col items-end">
                                                <span className="text-sm font-black text-slate-800 tracking-tight">${Number(rp.principalPaid).toLocaleString()}</span>
                                                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Principal Recall</span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-7 text-right hidden md:table-cell">
                                            <div className="flex flex-col items-end">
                                                <span className="text-sm font-black text-slate-400 tracking-tight">${Number(rp.penaltyPaid || 0).toLocaleString()}</span>
                                                <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Penalty Injection</span>
                                            </div>
                                        </td>
                                        <td className="pl-5 pr-10 py-7 text-right">
                                            <div className="flex flex-col items-end">
                                                <div className="flex items-center gap-2 px-3 py-1 bg-white/60 rounded-xl border border-white shadow-sm group-hover:bg-emerald-50 transition-all">
                                                    <DollarSign size={10} className="text-emerald-600" />
                                                    <span className="text-xs font-black text-slate-700 tracking-widest font-mono uppercase">{new Date(rp.date).toISOString().split('T')[0]}</span>
                                                </div>
                                                <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest mt-1">Validated ledger entry</span>
                                            </div>
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
                onSuccess={() => { fetchRepayments(); showToast('Recovery injection verified and posted', 'success'); }}
            />
        </div>
    );
}
