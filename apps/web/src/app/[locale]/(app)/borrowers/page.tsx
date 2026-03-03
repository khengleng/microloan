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
        <div className="max-w-[1200px] mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20">
            {/* Header Area */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div>
                    <h1 className="text-4xl font-black text-foreground tracking-tighter mb-2">Customer <span className="text-primary italic">Registry</span></h1>
                    <p className="text-muted-foreground text-[15px] font-medium max-w-md">
                        Financial profile management and credit-worthiness verification database.
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => setIsCrossCheckOpen(true)}
                        className="px-5 py-3 bg-card border border-border text-foreground text-[13px] font-black rounded-2xl shadow-sm hover:bg-sidebar-accent transition-all flex items-center gap-3 active:scale-95"
                    >
                        <ShieldAlert size={16} className="text-orange-400" />
                        Verification Protocol
                    </button>
                    <button
                        onClick={() => { setSelectedBorrower(null); setIsModalOpen(true); }}
                        className="premium-button text-[14px] flex items-center gap-2"
                    >
                        <Plus size={18} />
                        Register Client
                    </button>
                </div>
            </div>

            {/* Toolbar */}
            <div className="premium-card p-6 flex flex-col md:flex-row gap-6 items-center">
                <div className="relative flex-1 w-full group">
                    <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" />
                    <input
                        type="text"
                        placeholder="Search identities by name, phone, or bio-ID..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full pl-12 pr-6 py-4 bg-background/50 border border-border rounded-2xl text-[14px] font-bold text-foreground focus:outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all placeholder:opacity-50"
                    />
                </div>
                <div className="flex items-center gap-3 text-muted-foreground text-[13px] font-black whitespace-nowrap bg-border/20 px-4 py-2 rounded-xl">
                    <Activity size={14} className="text-primary" />
                    <span className="uppercase tracking-widest">{filtered.length} Indexed Nodes</span>
                </div>
            </div>

            {/* Table */}
            <div className="premium-card overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full">
                        <thead className="bg-white/[0.02] border-b border-border/50">
                            <tr>
                                <th className="px-8 py-5 text-left text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em]">Customer Entity</th>
                                <th className="px-8 py-5 text-left text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em]">Contact Anchor</th>
                                <th className="px-8 py-5 text-left text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em] hidden md:table-cell">Identity ID</th>
                                <th className="px-8 py-5 text-left text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em] hidden lg:table-cell">Geographic Node</th>
                                <th className="px-8 py-5 text-right text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em]">Control</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                            {loading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td colSpan={5} className="px-8 py-6 h-20 bg-white/[0.01]" />
                                    </tr>
                                ))
                            ) : filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-8 py-24 text-center">
                                        <div className="text-muted-foreground/20 mb-4"><User size={60} className="mx-auto" /></div>
                                        <p className="text-lg font-black text-foreground">Zero Identities Located</p>
                                        <p className="text-[13px] text-muted-foreground mt-2 max-w-xs mx-auto font-medium">Verify your search criteria or register a new financial node to start tracking.</p>
                                    </td>
                                </tr>
                            ) : (
                                filtered.map(borrower => (
                                    <tr key={borrower.id} className="hover:bg-primary/[0.03] transition-colors group">
                                        <td className="px-8 py-6">
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary text-sm font-black shadow-inner border border-primary/5">
                                                    {borrower.firstName.charAt(0)}{borrower.lastName.charAt(0)}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[15px] font-black text-foreground tracking-tight">{borrower.firstName} {borrower.lastName}</span>
                                                    <div className="flex items-center gap-1.5">
                                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                                        <span className="text-[11px] text-muted-foreground font-black uppercase tracking-wider">Active Portfolio</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-8 py-6">
                                            <div className="flex items-center gap-3 text-foreground/80 text-[14px] font-bold">
                                                <Phone size={14} className="text-primary/60" />
                                                <span>{borrower.phone}</span>
                                            </div>
                                        </td>
                                        <td className="px-8 py-6 hidden md:table-cell">
                                            <span className="text-[12px] font-black text-muted-foreground bg-border/30 px-3 py-1.5 rounded-xl border border-border/50">{borrower.idNumber}</span>
                                        </td>
                                        <td className="px-8 py-6 hidden lg:table-cell max-w-[240px]">
                                            <div className="flex items-center gap-2 text-muted-foreground text-[13px] font-medium">
                                                <MapPin size={14} className="flex-shrink-0 opacity-50" />
                                                <span className="truncate">{borrower.address}</span>
                                            </div>
                                        </td>
                                        <td className="px-8 py-6 text-right">
                                            <div className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Link href={`/${locale}/borrowers/${borrower.id}`}>
                                                    <button className="bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground font-black text-[12px] px-4 py-2 rounded-xl transition-all uppercase tracking-widest shadow-sm">
                                                        Data
                                                    </button>
                                                </Link>
                                                <button
                                                    onClick={() => handleEdit(borrower)}
                                                    className="p-2.5 text-muted-foreground hover:text-foreground hover:bg-card border border-transparent hover:border-border rounded-xl transition-all"
                                                >
                                                    <Pencil size={18} />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(borrower.id)}
                                                    disabled={deletingId === borrower.id}
                                                    className="p-2.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 border border-transparent hover:border-destructive/20 rounded-xl transition-all"
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
                onSuccess={() => { fetchBorrowers(); showToast('Customer updated', 'success'); }}
                borrower={selectedBorrower}
            />
            <CrossCheckModal open={isCrossCheckOpen} onOpenChange={setIsCrossCheckOpen} />
        </div>
    );
}
