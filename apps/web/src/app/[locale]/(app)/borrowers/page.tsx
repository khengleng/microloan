"use client";

import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Plus, Search, ShieldAlert, User, Phone, MapPin, Pencil, Trash2, Loader2, ArrowRightCircle, ChevronLeft, ChevronRight, Fingerprint } from 'lucide-react';
import { BorrowerModal } from '@/components/BorrowerModal';
import { CrossCheckModal } from '@/components/CrossCheckModal';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface Borrower {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    idNumber: string;
    address: string;
}

interface PageMeta { total: number; page: number; limit: number; pages: number; }

const LIMIT = 50;

export default function BorrowersPage() {
    const { locale } = useParams();
    const t = useTranslations('Borrowers');
    const tc = useTranslations('Common');
    const { showToast } = useToast();
    const confirm = useConfirm();
    const [borrowers, setBorrowers] = useState<Borrower[]>([]);
    const [meta, setMeta] = useState<PageMeta | null>(null);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [page, setPage] = useState(1);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isCrossCheckOpen, setIsCrossCheckOpen] = useState(false);
    const [selectedBorrower, setSelectedBorrower] = useState<Borrower | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const fetchBorrowers = useCallback(async (pg: number, search: string) => {
        setLoading(true);
        try {
            const params: any = { page: pg, limit: LIMIT };
            if (search) params.search = search;
            const res = await api.get('/borrowers', { params });
            setBorrowers(res.data.data);
            setMeta(res.data);
        } catch {
            showToast(t('loadFailed'), 'error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchBorrowers(1, ''); }, [fetchBorrowers]);

    const handleSearchChange = (value: string) => {
        setSearchQuery(value);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setPage(1);
            fetchBorrowers(1, value);
        }, 350);
    };

    const handlePageChange = (pg: number) => {
        setPage(pg);
        fetchBorrowers(pg, searchQuery);
    };

    const handleEdit = (borrower: Borrower) => {
        setSelectedBorrower(borrower);
        setIsModalOpen(true);
    };

    const handleDelete = async (id: string) => {
        const ok = await confirm({
            title: t('deleteTitle'),
            message: t('deleteMessage'),
            confirmLabel: t('deleteConfirm'),
            variant: 'danger',
        });
        if (!ok) return;
        setDeletingId(id);
        try {
            await api.delete(`/borrowers/${id}`);
            showToast(t('deleted'), 'success');
            fetchBorrowers(page, searchQuery);
        } catch (error: any) {
            showToast(error.response?.data?.message || t('deleteFailed'), 'error');
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className="max-w-6xl space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-foreground">{t('title')}</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        {meta ? t('registeredCount', { count: meta.total.toLocaleString() }) : t('manageRegistry')}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setIsCrossCheckOpen(true)}
                        className="btn-ghost"
                    >
                        <ShieldAlert size={14} className="text-amber-500" />
                        {t('creditCheck')}
                    </button>
                    <button
                        onClick={() => { setSelectedBorrower(null); setIsModalOpen(true); }}
                        className="btn-primary"
                    >
                        <Plus size={14} /> {t('newBorrower')}
                    </button>
                </div>
            </div>

            {/* Toolbar */}
            <div className="bg-white border border-border rounded-md p-4 flex items-center gap-3">
                <div className="relative flex-1">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder={t('searchPlaceholder')}
                        value={searchQuery}
                        onChange={e => handleSearchChange(e.target.value)}
                        className="w-full pl-8 pr-4 h-9 bg-white border border-border rounded text-sm text-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors"
                    />
                </div>
                {meta && (
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {t('resultsCount', { count: meta.total })}
                    </span>
                )}
            </div>

            {/* Table */}
            <div className="bg-white border border-border rounded-md overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-border">
                        <thead className="bg-muted/30">
                            <tr>
                                <th className="table-header px-4 py-2.5 text-left">{t('colBorrower')}</th>
                                <th className="table-header px-4 py-2.5 text-left">{t('colPhone')}</th>
                                <th className="table-header px-4 py-2.5 text-left hidden md:table-cell">{t('colIdNumber')}</th>
                                <th className="table-header px-4 py-2.5 text-left hidden lg:table-cell">{t('colAddress')}</th>
                                <th className="table-header px-4 py-2.5 text-right">{t('colActions')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {loading ? (
                                Array.from({ length: 8 }).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td colSpan={5} className="px-4 py-4 h-14 bg-muted/20" />
                                    </tr>
                                ))
                            ) : borrowers.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-20 text-center">
                                        <User size={32} className="mx-auto text-muted-foreground/20 mb-3" />
                                        <p className="text-sm font-medium text-foreground">{t('noBorrowersTitle')}</p>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            {searchQuery ? t('noBorrowersSearch') : t('noBorrowersEmpty')}
                                        </p>
                                    </td>
                                </tr>
                            ) : (
                                borrowers.map(borrower => (
                                    <tr key={borrower.id} className="hover:bg-muted/20 transition-colors group">
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center text-primary text-xs font-bold flex-shrink-0">
                                                    {borrower.firstName[0]}{borrower.lastName[0]}
                                                </div>
                                                <div>
                                                    <p className="text-sm font-semibold text-foreground">{borrower.firstName} {borrower.lastName}</p>
                                                    <p className="text-xs text-muted-foreground">#{borrower.id.slice(-6).toUpperCase()}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                                <Phone size={12} /> {borrower.phone}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 hidden md:table-cell">
                                            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                                <Fingerprint size={11} /> {borrower.idNumber}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 hidden lg:table-cell max-w-[220px]">
                                            <span className="flex items-center gap-1.5 text-xs text-muted-foreground truncate">
                                                <MapPin size={11} className="flex-shrink-0" /> {borrower.address}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Link href={`/${locale}/borrowers/${borrower.id}`}>
                                                    <button className="btn-ghost text-xs px-2.5 py-1 h-auto">
                                                        <ArrowRightCircle size={12} /> {t('view')}
                                                    </button>
                                                </Link>
                                                <button
                                                    onClick={() => handleEdit(borrower)}
                                                    className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
                                                >
                                                    <Pencil size={13} />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(borrower.id)}
                                                    disabled={deletingId === borrower.id}
                                                    className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                                                >
                                                    {deletingId === borrower.id
                                                        ? <Loader2 size={13} className="animate-spin" />
                                                        : <Trash2 size={13} />}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {meta && meta.pages > 1 && (
                    <div className="px-4 py-3 border-t border-border flex items-center justify-between bg-muted/30">
                        <button
                            onClick={() => handlePageChange(Math.max(1, page - 1))}
                            disabled={page === 1}
                            className="btn-ghost text-sm disabled:opacity-40"
                        >
                            <ChevronLeft size={14} /> {tc('previous')}
                        </button>
                        <span className="text-xs text-muted-foreground">
                            {((page - 1) * LIMIT) + 1}–{Math.min(page * LIMIT, meta.total)} of {meta.total.toLocaleString()}
                        </span>
                        <button
                            onClick={() => handlePageChange(Math.min(meta.pages, page + 1))}
                            disabled={page === meta.pages}
                            className="btn-ghost text-sm disabled:opacity-40"
                        >
                            {tc('next')} <ChevronRight size={14} />
                        </button>
                    </div>
                )}
            </div>

            <BorrowerModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                onSuccess={() => { fetchBorrowers(page, searchQuery); showToast(t('saved'), 'success'); }}
                borrower={selectedBorrower}
            />
            <CrossCheckModal open={isCrossCheckOpen} onOpenChange={setIsCrossCheckOpen} />
        </div>
    );
}
