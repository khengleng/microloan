"use client";

import { useEffect, useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { Plus, Search, Eye, FileText, Loader2 } from 'lucide-react';
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

const STATUS_STYLES: Record<string, string> = {
    DRAFT: 'bg-slate-100 text-slate-600',
    APPROVED: 'bg-blue-100 text-blue-700',
    DISBURSED: 'bg-emerald-100 text-emerald-700',
    CLOSED: 'bg-gray-100 text-gray-500',
    DEFAULTED: 'bg-red-100 text-red-700',
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
            showToast('Failed to load loans', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchLoans(); }, []);

    const filtered = useMemo(() =>
        loans.filter(l => {
            const matchSearch = `${l.borrower.firstName} ${l.borrower.lastName}`
                .toLowerCase().includes(searchQuery.toLowerCase());
            const matchStatus = statusFilter === 'ALL' || l.status === statusFilter;
            return matchSearch && matchStatus;
        }),
        [loans, searchQuery, statusFilter]);

    const statuses = ['ALL', 'DRAFT', 'APPROVED', 'DISBURSED', 'CLOSED', 'DEFAULTED'];

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
                    <p className="text-sm text-slate-500 mt-0.5">{loans.length} loan{loans.length !== 1 ? 's' : ''} total</p>
                </div>
                <Button
                    onClick={() => setIsModalOpen(true)}
                    className="flex items-center gap-2 bg-slate-900 hover:bg-slate-700 flex-shrink-0"
                >
                    <Plus size={15} />
                    {t('add_new')}
                </Button>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search by borrower name..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                </div>
                <div className="flex gap-1.5 flex-wrap">
                    {statuses.map(s => (
                        <button
                            key={s}
                            onClick={() => setStatusFilter(s)}
                            className={`px-3 py-2 text-xs font-semibold rounded-lg transition-all ${statusFilter === s
                                    ? 'bg-slate-900 text-white'
                                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                                }`}
                        >
                            {s}
                        </button>
                    ))}
                </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                <table className="min-w-full">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-100">
                            <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('borrower')}</th>
                            <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('principal')}</th>
                            <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider hidden md:table-cell">{t('interest_rate')}</th>
                            <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider hidden sm:table-cell">{t('term')}</th>
                            <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('status')}</th>
                            <th className="px-5 py-3.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {loading ? (
                            Array.from({ length: 4 }).map((_, i) => (
                                <tr key={i}>
                                    {Array.from({ length: 6 }).map((_, j) => (
                                        <td key={j} className="px-5 py-4">
                                            <div className="h-4 bg-slate-100 rounded animate-pulse" style={{ width: `${50 + (i + j) * 8}%` }} />
                                        </td>
                                    ))}
                                </tr>
                            ))
                        ) : filtered.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-5 py-16 text-center">
                                    <FileText size={40} className="mx-auto text-slate-200 mb-3" />
                                    <p className="text-slate-400 font-medium">
                                        {searchQuery || statusFilter !== 'ALL' ? 'No loans match your filters' : t('no_loans')}
                                    </p>
                                </td>
                            </tr>
                        ) : (
                            filtered.map(loan => (
                                <tr key={loan.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-5 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                                {loan.borrower.firstName.charAt(0)}{loan.borrower.lastName.charAt(0)}
                                            </div>
                                            <span className="font-medium text-slate-900 text-sm">{loan.borrower.firstName} {loan.borrower.lastName}</span>
                                        </div>
                                    </td>
                                    <td className="px-5 py-4 text-sm font-semibold text-slate-800">${loan.principal.toLocaleString()}</td>
                                    <td className="px-5 py-4 text-sm text-slate-600 hidden md:table-cell">{loan.annualInterestRate}%</td>
                                    <td className="px-5 py-4 text-sm text-slate-600 hidden sm:table-cell">{loan.termMonths}m</td>
                                    <td className="px-5 py-4">
                                        <span className={`px-2.5 py-1 inline-flex text-[11px] font-semibold rounded-full ${STATUS_STYLES[loan.status] || 'bg-gray-100 text-gray-600'}`}>
                                            {loan.status}
                                        </span>
                                    </td>
                                    <td className="px-5 py-4 text-right">
                                        <Link href={`/${locale}/loans/${loan.id}`}>
                                            <button className="p-1.5 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors" title="View">
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

            <LoanModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                onSuccess={() => { fetchLoans(); showToast('Loan created successfully', 'success'); }}
            />
        </div>
    );
}
