"use client";

import { useEffect, useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { Plus, Search, Eye, FileText, Loader2, Download, Landmark, Percent, Calendar, Activity, ArrowRightCircle } from 'lucide-react';
import { LoanModal } from '@/components/LoanModal';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface Loan {
    id: string;
    borrower: { firstName: string; lastName: string; };
    principal: number;
    annualInterestRate: number;
    termMonths: number;
    startDate: string;
    interestMethod: string;
    status: string;
}

const STATUS_CONFIG: Record<string, { bg: string, text: string, ring: string, label: string }> = {
    PENDING: { bg: 'bg-amber-50/50', text: 'text-amber-600', ring: 'border-amber-100', label: 'Analysis' },
    APPROVED: { bg: 'bg-indigo-50/50', text: 'text-indigo-600', ring: 'border-indigo-100', label: 'Committed' },
    REJECTED: { bg: 'bg-red-50/50', text: 'text-red-600', ring: 'border-red-100', label: 'Declined' },
    DISBURSED: { bg: 'bg-emerald-50/50', text: 'text-emerald-600', ring: 'border-emerald-100', label: 'Active Capital' },
    CLOSED: { bg: 'bg-slate-50/50', text: 'text-slate-500', ring: 'border-slate-100', label: 'Matured' },
    DEFAULTED: { bg: 'bg-rose-50/50', text: 'text-rose-600', ring: 'border-rose-100', label: 'Exposed' },
};

export default function LoansPage() {
    const { locale } = useParams();
    const t = useTranslations('Loans');
    const { showToast } = useToast();
    const [loans, setLoans] = useState<Loan[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('ALL');
    const [isModalOpen, setIsModalOpen] = useState(false);

    const fetchLoans = async () => {
        setLoading(true);
        try {
            const res = await api.get('/loans');
            setLoans(res.data);
        } catch {
            showToast('Failed to load asset ledger', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchLoans(); }, []);

    const filtered = useMemo(() => {
        if (!Array.isArray(loans)) return [];
        return loans.filter(l => {
            const matchSearch = `${l.borrower?.firstName || ''} ${l.borrower?.lastName || ''}`
                .toLowerCase().includes(searchQuery.toLowerCase());
            const matchStatus = statusFilter === 'ALL' || l.status === statusFilter;
            return matchSearch && matchStatus;
        });
    }, [loans, searchQuery, statusFilter]);

    const statuses = ['ALL', 'PENDING', 'APPROVED', 'REJECTED', 'DISBURSED', 'CLOSED', 'DEFAULTED'];

    const exportToExcel = async () => {
        try {
            const res = await api.get('/exports/loans/excel', { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `asset_origination_ledger_${new Date().toISOString().split('T')[0]}.xlsx`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            showToast('Asset ledger exported successfully', 'success');
        } catch {
            showToast('Failed to export asset data', 'error');
        }
    };

    return (
        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-6 duration-1000 font-urbanist pb-10">
            {/* Elite Asset Header */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-indigo-600 rounded-[0.8rem] flex items-center justify-center text-white shadow-lg shadow-indigo-600/20">
                            <Landmark size={22} />
                        </div>
                        <h1 className="text-4xl font-black text-slate-950 tracking-tighter">Asset Portfolio Matrix</h1>
                    </div>
                    <p className="text-slate-500 font-bold ml-1">
                        Monitoring <span className="text-indigo-600 font-black">{loans.length}</span> individual financial instruments under active management.
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    <Button
                        onClick={exportToExcel}
                        variant="ghost"
                        className="flex items-center gap-2 rounded-2xl font-black text-[11px] uppercase tracking-widest px-6 h-12 bg-white/50 border border-slate-200/50 hover:bg-white shadow-sm transition-all"
                    >
                        <Download size={16} /> Export Portfolio
                    </Button>
                    <Button
                        onClick={() => setIsModalOpen(true)}
                        className="flex items-center gap-2 bg-slate-950 text-white hover:bg-slate-800 shadow-xl shadow-slate-950/20 rounded-2xl font-black text-[11px] uppercase tracking-widest px-8 h-12 transition-all hover:scale-[1.02] active:scale-[0.98]"
                    >
                        <Plus size={18} />
                        Originate New Asset
                    </Button>
                </div>
            </div>

            {/* Logical Filtration */}
            <div className="flex flex-col gap-6 max-w-5xl">
                <div className="relative group">
                    <Search size={22} className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors duration-300" />
                    <input
                        type="text"
                        placeholder="Filter by digital identity name or instrument ID..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full pl-16 pr-6 h-16 text-sm font-bold border-white bg-white/40 glass premium-shadow rounded-[1.8rem] focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all duration-300 text-slate-950 placeholder:text-slate-400"
                    />
                </div>
                <div className="flex gap-2 p-1.5 bg-slate-950/5 rounded-[2rem] w-fit overflow-x-auto no-scrollbar max-w-full glass">
                    {statuses.map(s => (
                        <button
                            key={s}
                            onClick={() => setStatusFilter(s)}
                            className={`px-6 py-3 text-[10px] font-black uppercase tracking-[0.2em] rounded-full transition-all duration-300 whitespace-nowrap ${statusFilter === s
                                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30 -translate-y-0.5'
                                : 'text-slate-500 hover:text-indigo-600'
                                }`}
                        >
                            {s === 'ALL' ? 'Total Portfolio' : s}
                        </button>
                    ))}
                </div>
            </div>

            {/* High-Fidelity Asset Ledger */}
            <div className="glass rounded-[3.5rem] premium-shadow border-white/40 overflow-hidden bg-white/40">
                <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse">
                        <thead>
                            <tr className="bg-slate-950/5">
                                <th className="pl-10 pr-5 py-6 text-left text-[11px] font-black text-slate-400 uppercase tracking-[0.25em]">Validated Identity</th>
                                <th className="px-5 py-6 text-right text-[11px] font-black text-slate-400 uppercase tracking-[0.25em]">Principal (Par)</th>
                                <th className="px-5 py-6 text-right text-[11px] font-black text-slate-400 uppercase tracking-[0.25em] hidden md:table-cell">Logic Rate</th>
                                <th className="px-5 py-6 text-right text-[11px] font-black text-slate-400 uppercase tracking-[0.25em] hidden sm:table-cell">Duration</th>
                                <th className="px-5 py-6 text-center text-[11px] font-black text-slate-400 uppercase tracking-[0.25em]">Protocol Status</th>
                                <th className="pl-5 pr-10 py-6 text-right text-[11px] font-black text-slate-400 uppercase tracking-[0.25em]">Control</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100/50">
                            {loading ? (
                                Array.from({ length: 6 }).map((_, i) => (
                                    <tr key={i}>
                                        <td className="pl-10 pr-5 py-8"><div className="h-10 w-48 bg-slate-100/50 rounded-2xl animate-pulse" /></td>
                                        <td className="px-5 py-8"><div className="h-6 w-24 bg-slate-100/50 rounded-lg animate-pulse float-right" /></td>
                                        <td className="px-5 py-8 hidden md:table-cell"><div className="h-4 w-12 bg-slate-100/50 rounded-lg animate-pulse float-right" /></td>
                                        <td className="px-5 py-8 hidden sm:table-cell"><div className="h-4 w-12 bg-slate-100/50 rounded-lg animate-pulse float-right" /></td>
                                        <td className="px-5 py-8"><div className="h-8 w-24 bg-slate-100/50 rounded-full animate-pulse mx-auto" /></td>
                                        <td className="pl-5 pr-10 py-8"><div className="h-10 w-24 bg-slate-100/50 rounded-2xl animate-pulse float-right" /></td>
                                    </tr>
                                ))
                            ) : filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-5 py-32 text-center">
                                        <div className="relative inline-block mb-4">
                                            <div className="w-20 h-20 bg-slate-50 rounded-[2.5rem] flex items-center justify-center text-slate-200">
                                                <FileText size={48} />
                                            </div>
                                            <Activity className="absolute -bottom-2 -right-2 text-slate-300" size={24} />
                                        </div>
                                        <h3 className="text-xl font-black text-slate-900 tracking-tight">Zero Asset Re-matches Identified</h3>
                                        <p className="text-slate-400 font-bold mt-1 uppercase text-[10px] tracking-widest">No matching financial instruments found in central portfolio</p>
                                    </td>
                                </tr>
                            ) : (
                                filtered.map(loan => (
                                    <tr key={loan.id} className="hover:bg-white/60 transition-all duration-300 group">
                                        <td className="pl-10 pr-5 py-7">
                                            <div className="flex items-center gap-5">
                                                <div className="w-14 h-14 rounded-[1.4rem] bg-indigo-600 flex items-center justify-center text-white text-base font-black shadow-lg shadow-indigo-600/10 group-hover:scale-110 group-hover:rotate-3 transition-all duration-500">
                                                    {loan.borrower.firstName.charAt(0)}{loan.borrower.lastName.charAt(0)}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="font-extrabold text-slate-950 text-base tracking-tighter leading-tight group-hover:text-indigo-600 transition-colors">{loan.borrower.firstName} {loan.borrower.lastName}</span>
                                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Primary Obligor</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-5 py-7 text-right">
                                            <div className="flex flex-col items-end">
                                                <span className="text-xl font-black text-slate-950 tracking-tighter">${loan.principal.toLocaleString()}</span>
                                                <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Gross Disbursement</span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-7 text-right hidden md:table-cell">
                                            <div className="flex items-center justify-end gap-1.5 px-3 py-1 bg-white/60 rounded-xl border border-white inline-flex font-mono">
                                                <Percent size={10} className="text-slate-400" />
                                                <span className="text-sm font-black text-slate-900 tracking-tight">{loan.annualInterestRate}</span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-7 text-right hidden sm:table-cell">
                                            <div className="flex items-center justify-end gap-1.5 px-3 py-1 bg-white/60 rounded-xl border border-white inline-flex font-mono">
                                                <Calendar size={10} className="text-slate-400" />
                                                <span className="text-sm font-black text-slate-900 tracking-tight">{loan.termMonths}M</span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-7 text-center">
                                            <div className="flex flex-col items-center">
                                                <div className={`px-4 py-2 rounded-2xl border ${STATUS_CONFIG[loan.status]?.ring || 'border-slate-100'} ${STATUS_CONFIG[loan.status]?.bg || 'bg-slate-50/50'} ${STATUS_CONFIG[loan.status]?.text || 'text-slate-400'} text-[10px] font-black uppercase tracking-widest shadow-sm`}>
                                                    {STATUS_CONFIG[loan.status]?.label || loan.status}
                                                </div>
                                                <span className="text-[8px] font-black text-slate-300 uppercase mt-1 tracking-widest">{loan.status} Protocol</span>
                                            </div>
                                        </td>
                                        <td className="pl-5 pr-10 py-7 text-right">
                                            <Link href={`/${locale}/loans/${loan.id}`}>
                                                <button className="flex items-center gap-2 pr-2 pl-5 py-2.5 bg-slate-950 text-white font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl hover:bg-indigo-600 transition-all shadow-xl shadow-slate-950/20 active:scale-95 group-hover:-translate-x-1 duration-500">
                                                    Audit Instrument <ArrowRightCircle size={14} className="text-white/50" />
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

            <LoanModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                onSuccess={() => { fetchLoans(); showToast('Asset origination committed', 'success'); }}
            />
        </div>
    );
}
