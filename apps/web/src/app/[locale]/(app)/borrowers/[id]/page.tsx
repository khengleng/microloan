"use client";

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Phone, MapPin, CreditCard, FileText, Eye, Plus, UserCheck, Wallet, Activity, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BorrowerModal } from '@/components/BorrowerModal';

const STATUS_STYLES: Record<string, string> = {
    DRAFT: 'bg-slate-100 text-slate-500',
    APPROVED: 'bg-indigo-100 text-indigo-700',
    DISBURSED: 'bg-emerald-100 text-emerald-700 shadow-sm',
    CLOSED: 'bg-slate-200 text-slate-500',
    DEFAULTED: 'bg-rose-100 text-rose-700',
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

    if (loading) return <div className="flex h-64 items-center justify-center text-slate-400 font-black animate-pulse uppercase tracking-[0.2em]">Loading Profile...</div>;
    if (!borrower) return <div className="text-center py-20 font-black text-rose-500">Borrower not found.</div>;

    const totalBorrowed = borrower.loans.reduce((s, l) => s + Number(l.principal), 0);
    const activeLoans = borrower.loans.filter(l => l.status === 'DISBURSED').length;
    const closedLoans = borrower.loans.filter(l => l.status === 'CLOSED').length;

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header / Actions */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
                <div className="flex items-center gap-4">
                    <Link href={`/${locale}/borrowers`}>
                        <div className="w-12 h-12 glass rounded-2xl flex items-center justify-center text-slate-600 hover:bg-white hover:text-indigo-600 transition-all shadow-sm">
                            <ChevronLeft size={24} />
                        </div>
                    </Link>
                    <div>
                        <h1 className="text-3xl font-black text-slate-900 tracking-tight">Client Digital ID</h1>
                        <p className="text-slate-500 font-medium">Enterprise profile for credit verification and history</p>
                    </div>
                </div>
                <Button
                    onClick={() => setIsEditOpen(true)}
                    variant="secondary"
                    className="rounded-2xl font-bold px-8 h-12 shadow-sm"
                >
                    Modify Profile
                </Button>
            </div>

            {/* Profile Overview Card */}
            <div className="glass p-8 rounded-[2.5rem] premium-shadow border-indigo-100/10 relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-48 h-48 bg-indigo-500/5 rounded-full -mr-20 -mt-20" />

                <div className="flex flex-col md:flex-row gap-8 items-start relative">
                    <div className="w-24 h-24 rounded-[2rem] bg-indigo-600 text-white flex items-center justify-center text-3xl font-black shadow-lg shadow-indigo-200">
                        {borrower.firstName.charAt(0).toUpperCase()}{borrower.lastName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                            <h2 className="text-3xl font-black text-slate-900 tracking-tight">{borrower.firstName} {borrower.lastName}</h2>
                            <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow-sm flex items-center gap-1.5"><UserCheck size={12} /> Verified Client</span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-y-4 gap-x-8 mt-4">
                            {borrower.phone && (
                                <div className="space-y-1">
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Phone Number</p>
                                    <p className="font-extrabold text-slate-800 flex items-center gap-1.5 text-sm"><Phone size={14} className="text-indigo-500" />{borrower.phone}</p>
                                </div>
                            )}
                            {borrower.idNumber && (
                                <div className="space-y-1">
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">National ID / Passport</p>
                                    <p className="font-extrabold text-slate-800 flex items-center gap-1.5 text-sm"><CreditCard size={14} className="text-indigo-500" />{borrower.idNumber}</p>
                                </div>
                            )}
                            {borrower.address && (
                                <div className="space-y-1 lg:col-span-1">
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Registered Residence</p>
                                    <p className="font-extrabold text-slate-800 flex items-center gap-1.5 text-sm truncate max-w-xs"><MapPin size={14} className="text-indigo-500" />{borrower.address}</p>
                                </div>
                            )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-6 text-[10px] font-black text-slate-300 uppercase tracking-widest italic">
                            <Calendar size={12} /> Originated in system {new Date(borrower.createdAt).toLocaleDateString()}
                        </div>
                    </div>
                </div>

                {/* Performance Stats Overlay */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-10 pt-8 border-t border-slate-100/50">
                    <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100/50 text-center">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Historical Count</p>
                        <p className="text-2xl font-black text-slate-900">{borrower.loans.length} <span className="text-xs text-slate-300">Loans</span></p>
                    </div>
                    <div className="p-5 bg-emerald-50/50 rounded-3xl border border-emerald-100/20 text-center">
                        <p className="text-[10px] font-black text-emerald-600/60 uppercase tracking-widest mb-1.5">Active Portfolios</p>
                        <p className="text-2xl font-black text-emerald-700">{activeLoans}</p>
                    </div>
                    <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100/50 text-center">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Closed Records</p>
                        <p className="text-2xl font-black text-slate-400">{closedLoans}</p>
                    </div>
                    <div className="p-5 bg-indigo-50/50 rounded-3xl border border-indigo-100/20 text-center">
                        <p className="text-[10px] font-black text-indigo-600/60 uppercase tracking-widest mb-1.5">CUMULATIVE DEBT</p>
                        <p className="text-2xl font-black text-indigo-600">${totalBorrowed.toLocaleString()}</p>
                    </div>
                </div>
            </div>

            {/* Content Tabs / Sections */}
            <div className="grid grid-cols-1 gap-8">
                {/* Loan History Table */}
                <div className="glass p-8 rounded-[2.5rem] premium-shadow border-indigo-100/10">
                    <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
                        <h3 className="text-xl font-black text-slate-900 flex items-center gap-3 tracking-tight">
                            <Activity size={22} className="text-indigo-600" /> System Loan Register
                        </h3>
                        <Link href={`/${locale}/loans`}>
                            <Button className="rounded-2xl font-black text-[10px] uppercase tracking-widest bg-slate-950 text-white hover:bg-slate-800 h-10 px-6 gap-2">
                                <Plus size={14} /> Originate Engagement
                            </Button>
                        </Link>
                    </div>

                    {borrower.loans.length === 0 ? (
                        <div className="py-20 text-center bg-slate-50/50 rounded-3xl border border-dashed border-slate-200">
                            <FileText size={48} strokeWidth={1} className="mx-auto text-slate-300 mb-4" />
                            <p className="text-slate-400 font-extrabold uppercase tracking-widest text-[10px]">Zero historical engagements found.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto no-scrollbar">
                            <table className="w-full border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-100">
                                        <th className="text-left py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Principal Asset</th>
                                        <th className="text-right py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest hidden md:table-cell">Rate Engine</th>
                                        <th className="text-right py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest hidden md:table-cell">Term (M)</th>
                                        <th className="text-right py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest hidden lg:table-cell">Logic</th>
                                        <th className="text-right py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Market Status</th>
                                        <th className="text-right py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100/50">
                                    {borrower.loans.map(loan => (
                                        <tr key={loan.id} className="group hover:bg-slate-50/50 transition-colors">
                                            <td className="py-5">
                                                <p className="text-base font-black text-slate-900 tracking-tight">${Number(loan.principal).toLocaleString()}</p>
                                                <p className="text-[10px] font-bold text-slate-400 mt-0.5">ID: {loan.id.slice(-6).toUpperCase()}</p>
                                            </td>
                                            <td className="py-5 text-right font-black text-indigo-600 text-sm hidden md:table-cell">{loan.annualInterestRate}%</td>
                                            <td className="py-5 text-right font-extrabold text-slate-700 text-sm hidden md:table-cell">{loan.termMonths}m</td>
                                            <td className="py-5 text-right font-bold text-slate-400 text-[10px] uppercase hidden lg:table-cell">{loan.interestMethod}</td>
                                            <td className="py-5 text-right">
                                                <span className={`px-3 py-1 text-[9px] font-black uppercase tracking-widest rounded-full shadow-sm ${STATUS_STYLES[loan.status] || 'bg-gray-100 text-gray-600'}`}>
                                                    {loan.status}
                                                </span>
                                            </td>
                                            <td className="py-5 text-right">
                                                <Link href={`/${locale}/loans/${loan.id}`}>
                                                    <div className="w-10 h-10 ml-auto rounded-xl bg-slate-50 text-slate-400 hover:text-indigo-600 hover:bg-white transition-all shadow-sm flex items-center justify-center border border-slate-100">
                                                        <Eye size={16} />
                                                    </div>
                                                </Link>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
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
