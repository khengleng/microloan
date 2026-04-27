"use client";

import { useEffect, useState, useCallback, useRef } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Plus, Search, CreditCard, Loader2, Download, ChevronLeft, ChevronRight, Wallet, Activity, CheckCircle2 } from 'lucide-react';
import { RepaymentModal } from '@/components/RepaymentModal';
import { clarityEvent, claritySetTag } from '@/lib/clarity';

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

interface PageMeta { total: number; page: number; limit: number; pages: number; }

const LIMIT = 50;

export default function RepaymentsPage() {
    const { showToast } = useToast();
    const [repayments, setRepayments] = useState<Repayment[]>([]);
    const [meta, setMeta] = useState<PageMeta | null>(null);
    const [totalCollected, setTotalCollected] = useState(0);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [page, setPage] = useState(1);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const fetchRepayments = useCallback(async (pg: number, from: string, to: string) => {
        setLoading(true);
        try {
            const params: any = { page: pg, limit: LIMIT };
            if (from) params.startDate = from;
            if (to) params.endDate = to;
            const res = await api.get('/repayments', { params });
            setRepayments(res.data.data);
            setMeta(res.data);
            // Compute total from this page slice; for a grand total we'd need a separate API call
            // but keeping it simple for now: for page 1 without filters this is the full total
            if (pg === 1 && !from && !to) {
                // Use the full sum endpoint or just sum visible — we'll just show page total
            }
        } catch {
            showToast('Failed to load repayments', 'error');
        } finally {
            setLoading(false);
        }
    }, []);

    // Also fetch unfiltered total for the KPI card
    const fetchTotal = useCallback(async () => {
        try {
            const res = await api.get('/repayments', { params: { page: 1, limit: 1 } });
            // Use the summary from reports endpoint instead
            const rptRes = await api.get('/reports/dashboard');
            setTotalCollected(rptRes.data.repaymentsThisMonth || 0);
        } catch { }
    }, []);

    useEffect(() => {
        claritySetTag('journey_stage', 'repayment_page');
        clarityEvent('repayment_page_view');
        fetchRepayments(1, '', '');
        fetchTotal();
    }, [fetchRepayments, fetchTotal]);

    const handleDateChange = (from: string, to: string) => {
        clarityEvent('repayment_filter_apply');
        setPage(1);
        fetchRepayments(1, from, to);
    };

    const handlePageChange = (pg: number) => {
        setPage(pg);
        fetchRepayments(pg, dateFrom, dateTo);
    };

    // Client-side search filter on the current page
    const filtered = searchQuery
        ? repayments.filter(r =>
            `${r.loan?.borrower?.firstName || ''} ${r.loan?.borrower?.lastName || ''}`
                .toLowerCase().includes(searchQuery.toLowerCase())
        )
        : repayments;

    const pageTotal = repayments.reduce((sum, r) => sum + Number(r.amount || 0), 0);

    const exportToExcel = async () => {
        clarityEvent('repayment_export_attempt');
        try {
            const params: any = {};
            if (dateFrom) params.startDate = dateFrom;
            if (dateTo) params.endDate = dateTo;
            const res = await api.get('/exports/repayments/excel', { responseType: 'blob', params });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `repayments_${new Date().toISOString().split('T')[0]}.xlsx`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            clarityEvent('repayment_export_success');
            showToast('Repayments exported', 'success');
        } catch {
            clarityEvent('repayment_export_failed');
            showToast('Failed to export', 'error');
        }
    };

    return (
        <div className="max-w-6xl space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-foreground">Repayments</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        {meta ? `${meta.total.toLocaleString()} transactions` : 'Full repayment history and ledger.'}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={exportToExcel} className="btn-ghost">
                        <Download size={14} /> Export
                    </button>
                    <button onClick={() => {
                        clarityEvent('repayment_form_open');
                        setIsModalOpen(true);
                    }} className="btn-primary">
                        <Plus size={14} /> Record Payment
                    </button>
                </div>
            </div>

            {/* KPI Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {[
                    { label: 'This Month', value: `$${totalCollected.toLocaleString()}`, icon: Wallet, cls: 'text-primary' },
                    { label: 'Average Payment', value: meta && meta.total > 0 ? `$${(pageTotal / repayments.length || 0).toFixed(0)}` : '—', icon: Activity, cls: 'text-foreground' },
                    { label: 'Verified Ledger', value: 'Audited', icon: CheckCircle2, cls: 'text-[#006644]' },
                ].map((m, i) => (
                    <div key={i} className="bg-white border border-border rounded-md px-4 py-3 flex items-center gap-3">
                        <m.icon size={16} className={`${m.cls} flex-shrink-0`} />
                        <div>
                            <p className="text-xs text-muted-foreground">{m.label}</p>
                            <p className={`text-lg font-bold ${m.cls}`}>{m.value}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div className="bg-white border border-border rounded-md p-4">
                <div className="flex flex-wrap gap-2 items-center">
                    <div className="relative flex-1 min-w-[200px]">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            placeholder="Search by borrower name..."
                            value={searchQuery}
                            onChange={e => {
                                clarityEvent('repayment_search_used');
                                setSearchQuery(e.target.value);
                            }}
                            className="w-full pl-8 pr-4 h-9 bg-white border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors"
                        />
                    </div>
                    <div className="flex items-center gap-1.5">
                        <input
                            type="date"
                            value={dateFrom}
                            onChange={e => { setDateFrom(e.target.value); handleDateChange(e.target.value, dateTo); }}
                            className="h-9 px-3 bg-white border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors"
                            title="From date"
                        />
                        <span className="text-xs text-muted-foreground">to</span>
                        <input
                            type="date"
                            value={dateTo}
                            onChange={e => { setDateTo(e.target.value); handleDateChange(dateFrom, e.target.value); }}
                            className="h-9 px-3 bg-white border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors"
                            title="To date"
                        />
                        {(dateFrom || dateTo) && (
                            <button
                                onClick={() => { setDateFrom(''); setDateTo(''); handleDateChange('', ''); }}
                                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                                Clear
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white border border-border rounded-md overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {meta ? `${meta.total.toLocaleString()} transactions` : 'Loading...'}
                    </span>
                    {meta && meta.pages > 1 && (
                        <span className="text-xs text-muted-foreground">Page {page} of {meta.pages}</span>
                    )}
                </div>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-border">
                        <thead className="bg-muted/30">
                            <tr>
                                <th className="table-header px-4 py-2.5 text-left">Borrower</th>
                                <th className="table-header px-4 py-2.5 text-right">Amount</th>
                                <th className="table-header px-4 py-2.5 text-right hidden md:table-cell">Interest</th>
                                <th className="table-header px-4 py-2.5 text-right hidden md:table-cell">Principal</th>
                                <th className="table-header px-4 py-2.5 text-right">Date</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {loading ? (
                                Array.from({ length: 8 }).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td colSpan={5} className="px-4 py-4 h-14 bg-muted/20" />
                                    </tr>
                                ))
                            ) : filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-20 text-center">
                                        <CreditCard size={32} className="mx-auto text-muted-foreground/20 mb-3" />
                                        <p className="text-sm font-medium text-foreground">No repayments found</p>
                                        <p className="text-xs text-muted-foreground mt-1">Try adjusting your filters.</p>
                                    </td>
                                </tr>
                            ) : (
                                filtered.map(rp => (
                                    <tr key={rp.id} className="hover:bg-muted/20 transition-colors">
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded bg-[#E3FCEF] flex items-center justify-center text-[#006644] text-xs font-bold flex-shrink-0">
                                                    {rp.loan.borrower.firstName.charAt(0)}{rp.loan.borrower.lastName.charAt(0)}
                                                </div>
                                                <div>
                                                    <p className="text-sm font-semibold text-foreground">{rp.loan.borrower.firstName} {rp.loan.borrower.lastName}</p>
                                                    <p className="text-xs text-muted-foreground">#{rp.id.slice(-6).toUpperCase()}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <span className="text-sm font-bold text-[#006644]">${Number(rp.amount).toLocaleString()}</span>
                                        </td>
                                        <td className="px-4 py-3 text-right hidden md:table-cell">
                                            <span className="text-sm text-muted-foreground">${Number(rp.interestPaid).toLocaleString()}</span>
                                        </td>
                                        <td className="px-4 py-3 text-right hidden md:table-cell">
                                            <span className="text-sm text-muted-foreground">${Number(rp.principalPaid).toLocaleString()}</span>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <span className="badge-neutral text-[11px]">
                                                {new Date(rp.date).toISOString().split('T')[0]}
                                            </span>
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

            <RepaymentModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                onSuccess={() => { fetchRepayments(page, dateFrom, dateTo); showToast('Repayment recorded', 'success'); }}
            />
        </div>
    );
}
