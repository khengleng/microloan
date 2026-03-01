"use client";

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Phone, MapPin, CreditCard, FileText, Eye, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BorrowerModal } from '@/components/BorrowerModal';

const STATUS_STYLES: Record<string, string> = {
    DRAFT: 'bg-slate-100 text-slate-600',
    APPROVED: 'bg-blue-100 text-blue-700',
    DISBURSED: 'bg-emerald-100 text-emerald-700',
    CLOSED: 'bg-gray-100 text-gray-500',
    DEFAULTED: 'bg-red-100 text-red-700',
};

interface Borrower {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    address: string;
    idNumber: string;
    telegramChatId?: string;
    createdAt: string;
    loans: {
        id: string;
        principal: number;
        status: string;
        annualInterestRate: number;
        termMonths: number;
        startDate: string;
        interestMethod: string;
    }[];
}

export default function BorrowerProfilePage() {
    const { id, locale } = useParams();
    const { showToast } = useToast();
    const [borrower, setBorrower] = useState<Borrower | null>(null);
    const [loading, setLoading] = useState(true);
    const [isEditOpen, setIsEditOpen] = useState(false);

    const fetch = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get(`/borrowers/${id}`);
            setBorrower(res.data);
        } catch {
            showToast('Failed to load borrower profile', 'error');
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => { fetch(); }, [fetch]);

    if (loading) {
        return (
            <div className="space-y-6 animate-pulse">
                <div className="h-8 bg-slate-100 rounded w-48" />
                <div className="bg-white rounded-xl p-6 h-40 border border-slate-100" />
                <div className="bg-white rounded-xl p-6 h-60 border border-slate-100" />
            </div>
        );
    }

    if (!borrower) return <div className="text-slate-500 p-8">Borrower not found.</div>;

    const totalBorrowed = borrower.loans.reduce((s, l) => s + Number(l.principal), 0);
    const activeLoans = borrower.loans.filter(l => l.status === 'DISBURSED').length;
    const closedLoans = borrower.loans.filter(l => l.status === 'CLOSED').length;

    return (
        <div className="space-y-6">
            {/* Back + actions */}
            <div className="flex items-center justify-between">
                <Link href={`/${locale}/borrowers`}>
                    <button className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition-colors">
                        <ChevronLeft size={16} /> Back to Borrowers
                    </button>
                </Link>
                <Button
                    onClick={() => setIsEditOpen(true)}
                    variant="outline"
                    className="text-sm"
                >
                    Edit Profile
                </Button>
            </div>

            {/* Profile card */}
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-6">
                <div className="flex items-start gap-5">
                    <div className="w-16 h-16 rounded-2xl bg-blue-600 text-white flex items-center justify-center text-2xl font-bold flex-shrink-0">
                        {borrower.firstName.charAt(0)}{borrower.lastName.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                        <h1 className="text-2xl font-bold text-slate-900">{borrower.firstName} {borrower.lastName}</h1>
                        <div className="flex flex-wrap gap-4 mt-2 text-sm text-slate-500">
                            {borrower.phone && <span className="flex items-center gap-1.5"><Phone size={13} />{borrower.phone}</span>}
                            {borrower.address && <span className="flex items-center gap-1.5"><MapPin size={13} />{borrower.address}</span>}
                            {borrower.idNumber && <span className="flex items-center gap-1.5"><CreditCard size={13} />ID: {borrower.idNumber}</span>}
                        </div>
                        <p className="text-xs text-slate-400 mt-2">Member since {new Date(borrower.createdAt).toLocaleDateString()}</p>
                    </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-50">
                    <div className="text-center">
                        <div className="text-xl font-bold text-slate-900">{borrower.loans.length}</div>
                        <div className="text-xs text-slate-500 mt-0.5">Total Loans</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xl font-bold text-emerald-600">{activeLoans}</div>
                        <div className="text-xs text-slate-500 mt-0.5">Active</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xl font-bold text-slate-400">{closedLoans}</div>
                        <div className="text-xs text-slate-500 mt-0.5">Closed</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xl font-bold text-blue-600">${totalBorrowed.toLocaleString()}</div>
                        <div className="text-xs text-slate-500 mt-0.5">Total Borrowed</div>
                    </div>
                </div>
            </div>

            {/* Loan history */}
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-50">
                    <h2 className="font-semibold text-slate-800 flex items-center gap-2">
                        <FileText size={16} className="text-slate-400" /> Loan History
                    </h2>
                    <Link href={`/${locale}/loans`}>
                        <Button size="sm" className="bg-slate-900 text-white hover:bg-slate-700 gap-1.5 text-xs">
                            <Plus size={13} /> New Loan
                        </Button>
                    </Link>
                </div>
                {borrower.loans.length === 0 ? (
                    <div className="py-16 text-center">
                        <FileText size={36} className="mx-auto text-slate-200 mb-3" />
                        <p className="text-slate-400 text-sm">No loans yet for this borrower.</p>
                    </div>
                ) : (
                    <table className="min-w-full">
                        <thead>
                            <tr className="bg-slate-50">
                                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Principal</th>
                                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider hidden md:table-cell">Rate</th>
                                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider hidden md:table-cell">Term</th>
                                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider hidden lg:table-cell">Method</th>
                                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                                <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {borrower.loans.map(loan => (
                                <tr key={loan.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-5 py-3.5 text-sm font-semibold text-slate-800">${Number(loan.principal).toLocaleString()}</td>
                                    <td className="px-5 py-3.5 text-sm text-slate-600 hidden md:table-cell">{loan.annualInterestRate}%</td>
                                    <td className="px-5 py-3.5 text-sm text-slate-600 hidden md:table-cell">{loan.termMonths}m</td>
                                    <td className="px-5 py-3.5 text-sm text-slate-500 hidden lg:table-cell">{loan.interestMethod}</td>
                                    <td className="px-5 py-3.5">
                                        <span className={`px-2.5 py-0.5 text-[11px] font-semibold rounded-full ${STATUS_STYLES[loan.status] || 'bg-gray-100 text-gray-600'}`}>
                                            {loan.status}
                                        </span>
                                    </td>
                                    <td className="px-5 py-3.5 text-right">
                                        <Link href={`/${locale}/loans/${loan.id}`}>
                                            <button className="p-1.5 rounded-md text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                                                <Eye size={14} />
                                            </button>
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            <BorrowerModal
                open={isEditOpen}
                onOpenChange={setIsEditOpen}
                onSuccess={() => { fetch(); showToast('Borrower updated', 'success'); }}
                borrower={borrower}
            />
        </div>
    );
}
