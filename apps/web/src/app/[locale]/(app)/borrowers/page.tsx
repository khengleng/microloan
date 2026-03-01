"use client";

import { useEffect, useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { Plus, Search, ShieldAlert, User, Phone, CreditCard, MapPin, Pencil, Trash2, Loader2 } from 'lucide-react';
import { BorrowerModal } from '@/components/BorrowerModal';
import { CrossCheckModal } from '@/components/CrossCheckModal';

interface Borrower {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    idNumber: string;
    address: string;
}

export default function BorrowersPage() {
    const t = useTranslations('Borrowers');
    const { showToast } = useToast();
    const [borrowers, setBorrowers] = useState<Borrower[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isCrossCheckOpen, setIsCrossCheckOpen] = useState(false);
    const [selectedBorrower, setSelectedBorrower] = useState<Borrower | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const fetchBorrowers = async () => {
        setLoading(true);
        try {
            const res = await api.get('/borrowers');
            setBorrowers(res.data);
        } catch {
            showToast('Failed to load borrowers', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleEdit = (borrower: Borrower) => {
        setSelectedBorrower(borrower);
        setIsModalOpen(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this borrower? This action cannot be undone.')) return;
        setDeletingId(id);
        try {
            await api.delete(`/borrowers/${id}`);
            showToast('Borrower deleted successfully', 'success');
            fetchBorrowers();
        } catch (error: any) {
            showToast(error.response?.data?.message || 'Failed to delete borrower', 'error');
        } finally {
            setDeletingId(null);
        }
    };

    useEffect(() => { fetchBorrowers(); }, []);

    const filtered = useMemo(() =>
        borrowers.filter(b =>
            `${b.firstName} ${b.lastName} ${b.phone} ${b.idNumber} ${b.address}`
                .toLowerCase()
                .includes(searchQuery.toLowerCase())
        ), [borrowers, searchQuery]);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
                    <p className="text-sm text-slate-500 mt-0.5">{borrowers.length} borrower{borrowers.length !== 1 ? 's' : ''} total</p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                    <Button
                        onClick={() => setIsCrossCheckOpen(true)}
                        variant="outline"
                        className="flex items-center gap-2 border-amber-200 text-amber-700 hover:bg-amber-50"
                    >
                        <ShieldAlert size={15} />
                        Credit Check
                    </Button>
                    <Button
                        onClick={() => { setSelectedBorrower(null); setIsModalOpen(true); }}
                        className="flex items-center gap-2 bg-slate-900 hover:bg-slate-700"
                    >
                        <Plus size={15} />
                        {t('add_new')}
                    </Button>
                </div>
            </div>

            {/* Search */}
            <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                    type="text"
                    placeholder="Search by name, phone, or ID number..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                />
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                <table className="min-w-full">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-100">
                            <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                <div className="flex items-center gap-1.5"><User size={12} />{t('name')}</div>
                            </th>
                            <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                <div className="flex items-center gap-1.5"><Phone size={12} />{t('phone')}</div>
                            </th>
                            <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider hidden md:table-cell">
                                <div className="flex items-center gap-1.5"><CreditCard size={12} />{t('id_number')}</div>
                            </th>
                            <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider hidden lg:table-cell">
                                <div className="flex items-center gap-1.5"><MapPin size={12} />{t('address')}</div>
                            </th>
                            <th className="px-5 py-3.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {loading ? (
                            Array.from({ length: 4 }).map((_, i) => (
                                <tr key={i}>
                                    {Array.from({ length: 5 }).map((_, j) => (
                                        <td key={j} className="px-5 py-4">
                                            <div className="h-4 bg-slate-100 rounded animate-pulse" style={{ width: `${60 + (i + j) * 7}%` }} />
                                        </td>
                                    ))}
                                </tr>
                            ))
                        ) : filtered.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-5 py-16 text-center">
                                    <User size={40} className="mx-auto text-slate-200 mb-3" />
                                    <p className="text-slate-400 font-medium">
                                        {searchQuery ? 'No borrowers match your search' : t('no_borrowers')}
                                    </p>
                                </td>
                            </tr>
                        ) : (
                            filtered.map(borrower => (
                                <tr key={borrower.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-5 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                                {borrower.firstName.charAt(0)}{borrower.lastName.charAt(0)}
                                            </div>
                                            <span className="font-medium text-slate-900 text-sm">{borrower.firstName} {borrower.lastName}</span>
                                        </div>
                                    </td>
                                    <td className="px-5 py-4 text-sm text-slate-600">{borrower.phone}</td>
                                    <td className="px-5 py-4 text-sm text-slate-600 hidden md:table-cell font-mono">{borrower.idNumber}</td>
                                    <td className="px-5 py-4 text-sm text-slate-500 hidden lg:table-cell max-w-[180px] truncate">{borrower.address}</td>
                                    <td className="px-5 py-4 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <button
                                                onClick={() => handleEdit(borrower)}
                                                className="p-1.5 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                                title="Edit"
                                            >
                                                <Pencil size={14} />
                                            </button>
                                            <button
                                                onClick={() => handleDelete(borrower.id)}
                                                disabled={deletingId === borrower.id}
                                                className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                                                title="Delete"
                                            >
                                                {deletingId === borrower.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            <BorrowerModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                onSuccess={() => { fetchBorrowers(); showToast('Borrower saved successfully', 'success'); }}
                borrower={selectedBorrower}
            />
            <CrossCheckModal open={isCrossCheckOpen} onOpenChange={setIsCrossCheckOpen} />
        </div>
    );
}
