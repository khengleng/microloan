"use client";

import { useEffect, useState, useCallback, useRef } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Plus, Search, FileText, Loader2, Download, ChevronLeft, ChevronRight } from 'lucide-react';
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

interface PageMeta { total: number; page: number; limit: number; pages: number; }

const STATUS_BADGE: Record<string, string> = {
    PENDING: 'badge-warning',
    APPROVED: 'badge-info',
    REJECTED: 'badge-danger',
    DISBURSED: 'badge-success',
    CLOSED: 'badge-neutral',
    DEFAULTED: 'badge-danger',
};

const STATUSES = ['ALL', 'PENDING', 'APPROVED', 'DISBURSED', 'CLOSED', 'DEFAULTED'];
const LIMIT = 50;

export default function LoansPage() {
    const { locale } = useParams();
    const { showToast } = useToast();
    const [loans, setLoans] = useState<Loan[]>([]);
    const [meta, setMeta] = useState<PageMeta | null>(null);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('ALL');
    const [page, setPage] = useState(1);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const fetchLoans = useCallback(async (pg: number, search: string, status: string) => {
        setLoading(true);
        try {
            const params: any = { page: pg, limit: LIMIT };
            if (search) params.search = search;
            if (status !== 'ALL') params.status = status;
            const res = await api.get('/loans', { params });
            setLoans(res.data.data);
            setMeta(res.data);
        } catch {
            showToast('Failed to load loans', 'error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchLoans(1, '', 'ALL'); }, [fetchLoans]);

    const handleSearchChange = (value: string) => {
        setSearchQuery(value);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setPage(1);
            fetchLoans(1, value, statusFilter);
        }, 350);
    };

    const handleStatusChange = (status: string) => {
        setStatusFilter(status);
        setPage(1);
        fetchLoans(1, searchQuery, status);
    };

    const handlePageChange = (pg: number) => {
        setPage(pg);
        fetchLoans(pg, searchQuery, statusFilter);
    };

    const exportToExcel = async () => {
        try {
            const res = await api.get('/exports/loans/excel', { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `loans_${new Date().toISOString().split('T')[0]}.xlsx`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            showToast('Loans exported', 'success');
        } catch {
            showToast('Failed to export', 'error');
        }
    };

    return (
        <div className="max-w-6xl space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-foreground">Loans</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        {meta ? `${meta.total.toLocaleString()} total loans` : 'Manage your loan portfolio.'}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={exportToExcel} className="btn-ghost">
                        <Download size={14} /> Export
                    </button>
                    <button onClick={() => setIsModalOpen(true)} className="btn-primary">
                        <Plus size={14} /> New Loan
                    </button>
                </div>
            </div>

            {/* Status Tabs + Search */}
            <div className="bg-white border border-border rounded-md">
                {/* Status tabs */}
                <div className="flex items-center border-b border-border overflow-x-auto no-scrollbar px-2 pt-1">
                    {STATUSES.map(s => (
                        <button
                            key={s}
                            onClick={() => handleStatusChange(s)}
                            className={`pb-3 pt-1 px-3 text-[13px] font-semibold transition-all whitespace-nowrap relative ${statusFilter === s
                                ? 'text-primary'
                                : 'text-muted-foreground hover:text-foreground'
                                }`}
                        >
                            {s === 'ALL' ? 'All Loans' : s.charAt(0) + s.slice(1).toLowerCase()}
                            {statusFilter === s && (
                                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t" />
                            )}
                        </button>
                    ))}
                </div>
                {/* Search */}
                <div className="p-3">
                    <div className="relative">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Filter by borrower name..."
                            value={searchQuery}
                            onChange={e => handleSearchChange(e.target.value)}
                            className="w-full pl-8 pr-4 h-9 bg-white border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors"
                        />
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white border border-border rounded-md overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-border">
                        <thead className="bg-muted/30">
                            <tr>
                                <th className="table-header px-4 py-2.5 text-left">Borrower</th>
                                <th className="table-header px-4 py-2.5 text-right">Amount</th>
                                <th className="table-header px-4 py-2.5 text-right hidden md:table-cell">Rate</th>
                                <th className="table-header px-4 py-2.5 text-right hidden sm:table-cell">Term</th>
                                <th className="table-header px-4 py-2.5 text-center">Status</th>
                                <th className="table-header px-4 py-2.5 text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {loading ? (
                                Array.from({ length: 8 }).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td colSpan={6} className="px-4 py-4 h-14 bg-muted/20" />
                                    </tr>
                                ))
                            ) : loans.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="px-4 py-20 text-center">
                                        <FileText size={32} className="mx-auto text-muted-foreground/20 mb-3" />
                                        <p className="text-sm font-medium text-foreground">No loans found</p>
                                        <p className="text-xs text-muted-foreground mt-1">Try adjusting your filters.</p>
                                    </td>
                                </tr>
                            ) : (
                                loans.map(loan => (
                                    <tr key={loan.id} className="hover:bg-muted/20 transition-colors">
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center text-primary text-xs font-bold flex-shrink-0">
                                                    {loan.borrower.firstName[0]}{loan.borrower.lastName[0]}
                                                </div>
                                                <div>
                                                    <p className="text-sm font-semibold text-foreground">{loan.borrower.firstName} {loan.borrower.lastName}</p>
                                                    <p className="text-xs text-muted-foreground">#{loan.id.slice(-6).toUpperCase()}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <span className="text-sm font-bold text-foreground">${Number(loan.principal).toLocaleString()}</span>
                                        </td>
                                        <td className="px-4 py-3 text-right hidden md:table-cell">
                                            <span className="text-sm text-muted-foreground">{loan.annualInterestRate}%</span>
                                        </td>
                                        <td className="px-4 py-3 text-right hidden sm:table-cell">
                                            <span className="text-sm text-muted-foreground">{loan.termMonths} mo</span>
                                        </td>
                                        <td className="px-4 py-3 text-center">
                                            <span className={STATUS_BADGE[loan.status] || 'badge-neutral'}>
                                                {loan.status}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <Link href={`/${locale}/loans/${loan.id}`}>
                                                <button className="btn-ghost text-xs px-2.5 py-1 h-auto">View</button>
                                            </Link>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {meta && meta.pages > 1 && (
                    <div className="px-4 py-3 border-t border-border flex items-center justify-between bg-muted/30">
                        <button
                            onClick={() => handlePageChange(Math.max(1, page - 1))}
                            disabled={page === 1}
                            className="btn-ghost text-sm disabled:opacity-40"
                        >
                            <ChevronLeft size={14} /> Previous
                        </button>
                        <span className="text-xs text-muted-foreground">
                            {((page - 1) * LIMIT) + 1}–{Math.min(page * LIMIT, meta.total)} of {meta.total.toLocaleString()}
                        </span>
                        <button
                            onClick={() => handlePageChange(Math.min(meta.pages, page + 1))}
                            disabled={page === meta.pages}
                            className="btn-ghost text-sm disabled:opacity-40"
                        >
                            Next <ChevronRight size={14} />
                        </button>
                    </div>
                )}
            </div>

            <LoanModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                onSuccess={() => { fetchLoans(page, searchQuery, statusFilter); showToast('Loan created', 'success'); }}
            />
        </div>
    );
}
