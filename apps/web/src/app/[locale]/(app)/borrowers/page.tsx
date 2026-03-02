"use client";

import { useEffect, useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Plus, Search, ShieldAlert, User, Phone, CreditCard, MapPin, Pencil, Trash2, Loader2, ArrowRightCircle, Fingerprint, Activity } from 'lucide-react';
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

export default function BorrowersPage() {
    const t = useTranslations('Borrowers');
    const { locale } = useParams();
    const { showToast } = useToast();
    const confirm = useConfirm();
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
        const ok = await confirm({
            title: 'Delete Borrower Identity',
            message: 'This will permanently expunge this client identity and all historical financial ties. This protocol cannot be inverted.',
            confirmLabel: 'Expunge Identity',
            variant: 'danger',
        });
        if (!ok) return;
        setDeletingId(id);
        try {
            await api.delete(`/borrowers/${id}`);
            showToast('Identity expunged successfully', 'success');
            fetchBorrowers();
        } catch (error: any) {
            showToast(error.response?.data?.message || 'Failed to expunge identity', 'error');
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
        <div className="space-y-10 animate-in fade-in slide-in-from-bottom-6 duration-1000 font-urbanist pb-10">
            {/* Elite Header */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-indigo-600 rounded-[0.8rem] flex items-center justify-center text-white shadow-lg shadow-indigo-600/20">
                            <Fingerprint size={22} />
                        </div>
                        <h1 className="text-4xl font-black text-slate-950 tracking-tighter">{t('title')}</h1>
                    </div>
                    <p className="text-slate-500 font-bold ml-1">
                        Managing <span className="text-indigo-600 font-black">{borrowers.length}</span> verified individual digital identities.
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    <Button
                        onClick={() => setIsCrossCheckOpen(true)}
                        variant="ghost"
                        className="flex items-center gap-2 rounded-2xl font-black text-[11px] uppercase tracking-widest px-6 h-12 bg-white/50 border border-slate-200/50 hover:bg-white shadow-sm transition-all"
                    >
                        <ShieldAlert size={16} className="text-amber-500" />
                        Intelligence Cross-Check
                    </Button>
                    <Button
                        onClick={() => { setSelectedBorrower(null); setIsModalOpen(true); }}
                        className="flex items-center gap-2 bg-slate-950 text-white hover:bg-slate-800 shadow-xl shadow-slate-950/20 rounded-2xl font-black text-[11px] uppercase tracking-widest px-8 h-12 transition-all hover:scale-[1.02] active:scale-[0.98]"
                    >
                        <Plus size={18} />
                        Register Core Identity
                    </Button>
                </div>
            </div>

            {/* Industrial Search Logic */}
            <div className="relative group max-w-4xl">
                <Search size={22} className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors duration-300" />
                <input
                    type="text"
                    placeholder="Search by identity name, validated phone, or legal ID number..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-16 pr-6 h-16 text-sm font-bold border-white bg-white/40 glass premium-shadow rounded-[1.8rem] focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all duration-300 text-slate-950 placeholder:text-slate-400 placeholder:font-medium"
                />
                {searchQuery && (
                    <div className="absolute right-6 top-1/2 -translate-y-1/2 bg-indigo-50 px-3 py-1 rounded-full text-[10px] font-black text-indigo-600 uppercase tracking-widest">
                        {filtered.length} Re-matches
                    </div>
                )}
            </div>

            {/* High-Contrast Identity Ledger */}
            <div className="glass rounded-[3.5rem] premium-shadow border-white/40 overflow-hidden bg-white/40">
                <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse">
                        <thead>
                            <tr className="bg-slate-950/5">
                                <th className="pl-10 pr-5 py-6 text-left text-[11px] font-black text-slate-400 uppercase tracking-[0.25em]">Validated Identity</th>
                                <th className="px-5 py-6 text-left text-[11px] font-black text-slate-400 uppercase tracking-[0.25em]">Comms Protocol</th>
                                <th className="px-5 py-6 text-left text-[11px] font-black text-slate-400 uppercase tracking-[0.25em] hidden md:table-cell">Legal Identifier</th>
                                <th className="px-5 py-6 text-left text-[11px] font-black text-slate-400 uppercase tracking-[0.25em] hidden lg:table-cell">Physical Vector</th>
                                <th className="pl-5 pr-10 py-6 text-right text-[11px] font-black text-slate-400 uppercase tracking-[0.25em]">Governance</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100/50">
                            {loading ? (
                                Array.from({ length: 6 }).map((_, i) => (
                                    <tr key={i}>
                                        <td className="pl-10 pr-5 py-8"><div className="h-10 w-48 bg-slate-100/50 rounded-2xl animate-pulse" /></td>
                                        <td className="px-5 py-8"><div className="h-4 w-32 bg-slate-100/50 rounded-lg animate-pulse" /></td>
                                        <td className="px-5 py-8 hidden md:table-cell"><div className="h-4 w-24 bg-slate-100/50 rounded-lg animate-pulse" /></td>
                                        <td className="px-5 py-8 hidden lg:table-cell"><div className="h-4 w-40 bg-slate-100/50 rounded-lg animate-pulse" /></td>
                                        <td className="pl-5 pr-10 py-8"><div className="h-10 w-24 bg-slate-100/50 rounded-2xl animate-pulse float-right" /></td>
                                    </tr>
                                ))
                            ) : filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-5 py-32 text-center">
                                        <div className="relative inline-block mb-4">
                                            <div className="w-20 h-20 bg-slate-50 rounded-[2.5rem] flex items-center justify-center text-slate-200">
                                                <User size={48} />
                                            </div>
                                            <Activity className="absolute -bottom-2 -right-2 text-slate-300" size={24} />
                                        </div>
                                        <h3 className="text-xl font-black text-slate-900 tracking-tight">Zero Re-matches Identified</h3>
                                        <p className="text-slate-400 font-bold mt-1 uppercase text-[10px] tracking-widest">No matching digital identities found in central ledger</p>
                                    </td>
                                </tr>
                            ) : (
                                filtered.map(borrower => (
                                    <tr key={borrower.id} className="hover:bg-white/60 transition-all duration-300 group">
                                        <td className="pl-10 pr-5 py-7">
                                            <div className="flex items-center gap-5">
                                                <div className="w-14 h-14 rounded-[1.4rem] bg-indigo-600 flex items-center justify-center text-white text-base font-black shadow-lg shadow-indigo-600/10 group-hover:scale-110 group-hover:rotate-3 transition-all duration-500">
                                                    {borrower.firstName.charAt(0)}{borrower.lastName.charAt(0)}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="font-extrabold text-slate-950 text-lg tracking-tighter leading-tight group-hover:text-indigo-600 transition-colors">{borrower.firstName} {borrower.lastName}</span>
                                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Verified Identity</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-5 py-7">
                                            <div className="px-4 py-2 bg-white/60 rounded-xl border border-white inline-flex items-center gap-2 group-hover:border-indigo-100 transition-all">
                                                <Phone size={12} className="text-indigo-500" />
                                                <span className="text-sm font-black text-slate-900 tracking-tight">{borrower.phone}</span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-7 hidden md:table-cell">
                                            <div className="flex flex-col">
                                                <span className="text-sm font-black text-slate-500 tracking-widest font-mono uppercase">{borrower.idNumber}</span>
                                                <span className="text-[9px] font-black text-slate-300 uppercase tracking-wider">Credential ID</span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-7 hidden lg:table-cell max-w-[220px]">
                                            <div className="flex items-start gap-2">
                                                <MapPin size={14} className="text-slate-300 mt-1 flex-shrink-0" />
                                                <span className="text-sm font-bold text-slate-400 leading-tight truncate">{borrower.address}</span>
                                            </div>
                                        </td>
                                        <td className="pl-5 pr-10 py-7 text-right">
                                            <div className="flex items-center justify-end gap-3 translate-x-2 opacity-80 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-500">
                                                <Link href={`/${locale}/borrowers/${borrower.id}`}>
                                                    <button className="flex items-center gap-2 pr-2 pl-5 py-2.5 bg-slate-950 text-white font-black text-[10px] uppercase tracking-[0.2em] rounded-2xl hover:bg-indigo-600 transition-all shadow-xl shadow-slate-950/20 active:scale-95">
                                                        Deep Intelligence <ArrowRightCircle size={14} className="text-white/50" />
                                                    </button>
                                                </Link>
                                                <button
                                                    onClick={() => handleEdit(borrower)}
                                                    className="p-3 rounded-2xl text-slate-400 hover:text-indigo-600 hover:bg-white transition-all shadow-sm hover:premium-shadow"
                                                    title="Modify Identity"
                                                >
                                                    <Pencil size={18} />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(borrower.id)}
                                                    disabled={deletingId === borrower.id}
                                                    className="p-3 rounded-2xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-all disabled:opacity-50"
                                                    title="Expunge Hub"
                                                >
                                                    {deletingId === borrower.id ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <BorrowerModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                onSuccess={() => { fetchBorrowers(); showToast('Identity state synchronized', 'success'); }}
                borrower={selectedBorrower}
            />
            <CrossCheckModal open={isCrossCheckOpen} onOpenChange={setIsCrossCheckOpen} />
        </div>
    );
}
