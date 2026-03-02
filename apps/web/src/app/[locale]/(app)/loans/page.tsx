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

const STATUS_CONFIG: Record<string, { bg: string, text: string, border: string, dot: string }> = {
    PENDING: { bg: 'bg-[#FFFBEB]', text: 'text-[#F59E0B]', border: 'border-[#FEF3C7]', dot: 'bg-[#F59E0B]' },
    APPROVED: { bg: 'bg-[#F0F5FF]', text: 'text-[#635BFF]', border: 'border-[#E0E7FF]', dot: 'bg-[#635BFF]' },
    REJECTED: { bg: 'bg-[#FEF2F2]', text: 'text-[#EF4444]', border: 'border-[#FEE2E2]', dot: 'bg-[#EF4444]' },
    DISBURSED: { bg: 'bg-[#ECFDF5]', text: 'text-[#10B981]', border: 'border-[#D1FAE5]', dot: 'bg-[#10B981]' },
    CLOSED: { bg: 'bg-[#F9FAFB]', text: 'text-[#6B7280]', border: 'border-[#F3F4F6]', dot: 'bg-[#6B7280]' },
    DEFAULTED: { bg: 'bg-[#FFF1F2]', text: 'text-[#BE123C]', border: 'border-[#FFE4E6]', dot: 'bg-[#BE123C]' },
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
            showToast('Failed to load payment ledger', 'error');
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

    const statuses = ['ALL', 'PENDING', 'APPROVED', 'DISBURSED', 'CLOSED', 'DEFAULTED'];

    const exportToExcel = async () => {
        try {
            const res = await api.get('/exports/loans/excel', { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `payment_ledger_${new Date().toISOString().split('T')[0]}.xlsx`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            showToast('Ledger exported successfully', 'success');
        } catch {
            showToast('Failed to export data', 'error');
        }
    };

    return (
        <div className="max-w-[1200px] mx-auto space-y-8 animate-in fade-in duration-500 pb-10">
            {/* Header Area */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-[#1A1F36] tracking-tight">Payment Portfolio</h1>
                    <p className="text-[#697386] text-[14px]">
                        Monitoring {loans.length} active financial instruments and schedules.
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
                        New Loan
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="space-y-4">
                <div className="flex items-center gap-6 border-b border-[#E3E8EE] overflow-x-auto no-scrollbar">
                    {statuses.map(s => (
                        <button
                            key={s}
                            onClick={() => setStatusFilter(s)}
                            className={`pb-3 text-[13px] font-semibold transition-all whitespace-nowrap relative ${statusFilter === s
                                ? 'text-[#635BFF]'
                                : 'text-[#697386] hover:text-[#1A1F36]'
                                }`}
                        >
                            {s === 'ALL' ? 'All Loans' : s.charAt(0) + s.slice(1).toLowerCase()}
                            {statusFilter === s && (
                                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#635BFF]" />
                            )}
                        </button>
                    ))}
                </div>

                <div className="relative group max-w-md">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#AAB7C4]" />
                    <input
                        type="text"
                        placeholder="Filter by customer name..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-white border border-[#E3E8EE] rounded-md text-[13px] font-medium text-[#1A1F36] focus:outline-none focus:ring-2 focus:ring-[#635BFF]/10 focus:border-[#635BFF] transition-all"
                    />
                </div>
            </div>

            {/* Table */}
            <div className="bg-white border border-[#E3E8EE] rounded-lg shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-[#E3E8EE]">
                        <thead className="bg-[#F7FAFC]">
                            <tr>
                                <th className="px-6 py-3 text-left text-[11px] font-bold text-[#697386] uppercase tracking-wider">Customer</th>
                                <th className="px-6 py-3 text-right text-[11px] font-bold text-[#697386] uppercase tracking-wider">Amount</th>
                                <th className="px-6 py-3 text-right text-[11px) font-bold text-[#697386] uppercase tracking-wider hidden md:table-cell">Rate</th>
                                <th className="px-6 py-3 text-right text-[11px] font-bold text-[#697386] uppercase tracking-wider hidden sm:table-cell">Term</th>
                                <th className="px-6 py-3 text-center text-[11px] font-bold text-[#697386] uppercase tracking-wider">Status</th>
                                <th className="px-6 py-3 text-right text-[11px] font-bold text-[#697386] uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-[#E3E8EE]">
                            {loading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td colSpan={6} className="px-6 py-4 h-16 bg-[#F7FAFC]/30" />
                                    </tr>
                                ))
                            ) : filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-6 py-20 text-center">
                                        <div className="text-[#AAB7C4] mb-2"><FileText size={40} className="mx-auto opacity-20" /></div>
                                        <p className="text-[14px] font-medium text-[#1A1F36]">No loans found</p>
                                    </td>
                                </tr>
                            ) : (
                                filtered.map(loan => (
                                    <tr key={loan.id} className="hover:bg-[#F6F9FC] transition-colors">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-[#F0F5FF] flex items-center justify-center text-[#635BFF] text-[11px] font-bold">
                                                    {loan.borrower.firstName.charAt(0)}{loan.borrower.lastName.charAt(0)}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[13px] font-bold text-[#1A1F36]">{loan.borrower.firstName} {loan.borrower.lastName}</span>
                                                    <span className="text-[11px] text-[#697386] font-medium">#{loan.id.slice(-6).toUpperCase()}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <span className="text-[13px] font-bold text-[#1A1F36]">${loan.principal.toLocaleString()}</span>
                                        </td>
                                        <td className="px-6 py-4 text-right hidden md:table-cell">
                                            <span className="text-[13px] text-[#4F566B]">{loan.annualInterestRate}%</span>
                                        </td>
                                        <td className="px-6 py-4 text-right hidden sm:table-cell">
                                            <span className="text-[13px] text-[#4F566B]">{loan.termMonths} mo</span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex justify-center">
                                                <div className={`px-2.5 py-0.5 rounded-full border ${STATUS_CONFIG[loan.status]?.bg} ${STATUS_CONFIG[loan.status]?.text} ${STATUS_CONFIG[loan.status]?.border} text-[11px] font-bold flex items-center gap-1.5`}>
                                                    <div className={`w-1.5 h-1.5 rounded-full ${STATUS_CONFIG[loan.status]?.dot}`} />
                                                    {loan.status}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <Link href={`/${locale}/loans/${loan.id}`}>
                                                <button className="bg-white border border-[#E3E8EE] text-[#4F566B] hover:text-[#1A1F36] text-[12px] font-bold py-1 px-3 rounded shadow-sm hover:bg-[#F6F9FC] transition-all">
                                                    View
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
                onSuccess={() => { fetchLoans(); showToast('Loan created', 'success'); }}
            />
        </div>
    );
}
