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
        <div className="max-w-[1200px] mx-auto space-y-8 animate-in fade-in duration-500 pb-10">
            {/* Header Area */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-[#1A1F36] tracking-tight">{t('title')}</h1>
                    <p className="text-[#697386] text-[14px]">
                        Manage and verify yours customers and their financial profiles.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setIsCrossCheckOpen(true)}
                        className="bg-white border border-[#E3E8EE] text-[#4F566B] text-[13px] font-semibold py-2 px-4 rounded shadow-sm hover:bg-[#F6F9FC] transition-all flex items-center gap-2"
                    >
                        <ShieldAlert size={14} className="text-[#F59E0B]" />
                        Cross-Check
                    </button>
                    <button
                        onClick={() => { setSelectedBorrower(null); setIsModalOpen(true); }}
                        className="bg-[#635BFF] hover:bg-[#5D55EF] text-white text-[13px] font-semibold py-2 px-4 rounded shadow-sm transition-all flex items-center gap-2"
                    >
                        <Plus size={16} />
                        Add Customer
                    </button>
                </div>
            </div>

            {/* Toolbar */}
            <div className="bg-white border border-[#E3E8EE] rounded-lg shadow-sm p-4 flex flex-col md:flex-row gap-4 items-center">
                <div className="relative flex-1 w-full">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#AAB7C4]" />
                    <input
                        type="text"
                        placeholder="Search by name, phone, or ID..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-[#F6F9FC] border border-[#E3E8EE] rounded-md text-[13px] font-medium text-[#1A1F36] focus:outline-none focus:ring-2 focus:ring-[#635BFF]/10 focus:border-[#635BFF] transition-all"
                    />
                </div>
                <div className="flex items-center gap-2 text-[#697386] text-[13px] font-medium whitespace-nowrap">
                    <span>{filtered.length} customers found</span>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white border border-[#E3E8EE] rounded-lg shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-[#E3E8EE]">
                        <thead className="bg-[#F7FAFC]">
                            <tr>
                                <th className="px-6 py-3 text-left text-[11px] font-bold text-[#697386] uppercase tracking-wider">Customer</th>
                                <th className="px-6 py-3 text-left text-[11px] font-bold text-[#697386] uppercase tracking-wider">Contact</th>
                                <th className="px-6 py-3 text-left text-[11px] font-bold text-[#697386] uppercase tracking-wider hidden md:table-cell">ID Number</th>
                                <th className="px-6 py-3 text-left text-[11px] font-bold text-[#697386] uppercase tracking-wider hidden lg:table-cell">Address</th>
                                <th className="px-6 py-3 text-right text-[11px] font-bold text-[#697386] uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-[#E3E8EE]">
                            {loading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td colSpan={5} className="px-6 py-4 h-16 bg-[#F7FAFC]/30" />
                                    </tr>
                                ))
                            ) : filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-20 text-center">
                                        <div className="text-[#AAB7C4] mb-2"><User size={40} className="mx-auto opacity-20" /></div>
                                        <p className="text-[14px] font-medium text-[#1A1F36]">No customers found</p>
                                        <p className="text-[12px] text-[#697386] mt-1">Try adjusting your search query</p>
                                    </td>
                                </tr>
                            ) : (
                                filtered.map(borrower => (
                                    <tr key={borrower.id} className="hover:bg-[#F6F9FC] transition-colors group">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-[#F0F5FF] flex items-center justify-center text-[#635BFF] text-[11px] font-bold">
                                                    {borrower.firstName.charAt(0)}{borrower.lastName.charAt(0)}
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-[13px] font-bold text-[#1A1F36]">{borrower.firstName} {borrower.lastName}</span>
                                                    <span className="text-[11px] text-[#697386] font-medium">Verified Account</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2 text-[#4F566B] text-[13px]">
                                                <Phone size={12} className="text-[#AAB7C4]" />
                                                <span>{borrower.phone}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 hidden md:table-cell">
                                            <span className="text-[12px] font-mono text-[#697386] bg-[#F6F9FC] px-1.5 py-0.5 rounded border border-[#E3E8EE]">{borrower.idNumber}</span>
                                        </td>
                                        <td className="px-6 py-4 hidden lg:table-cell max-w-[200px]">
                                            <span className="text-[13px] text-[#697386] truncate block">{borrower.address}</span>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <Link href={`/${locale}/borrowers/${borrower.id}`}>
                                                    <button className="text-[#635BFF] hover:text-[#5D55EF] font-bold text-[12px] px-2 py-1 transition-colors">
                                                        Details
                                                    </button>
                                                </Link>
                                                <button
                                                    onClick={() => handleEdit(borrower)}
                                                    className="p-1.5 text-[#AAB7C4] hover:text-[#1A1F36] hover:bg-[#E3E8EE] rounded transition-all"
                                                >
                                                    <Pencil size={14} />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(borrower.id)}
                                                    disabled={deletingId === borrower.id}
                                                    className="p-1.5 text-[#AAB7C4] hover:text-[#EF4444] hover:bg-[#FEE2E2] rounded transition-all"
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
