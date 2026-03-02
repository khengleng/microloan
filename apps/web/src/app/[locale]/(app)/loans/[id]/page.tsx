"use client";

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { ChevronLeft, Plus, CheckCircle, Trash2, FileText, Download, ThumbsUp, Wallet, Calendar, ShieldCheck, UserCheck, MessageSquare, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { RepaymentModal } from '@/components/RepaymentModal';
import { Input } from '@/components/ui/input';

interface ScheduleItem {
    installmentNumber: number;
    dueDate: string;
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    outstandingPrincipal: number;
    paidPrincipal: number;
    paidInterest: number;
    isPaid: boolean;
}

interface Repayment {
    id: string;
    amount: number;
    date: string;
    principalPaid: number;
    interestPaid: number;
}

interface Loan {
    id: string;
    borrower: {
        id: string;
        firstName: string;
        lastName: string;
        phone: string;
        loans: {
            id: string;
            status: string;
            principal: number;
            createdAt: string;
        }[];
    };
    principal: number;
    annualInterestRate: number;
    termMonths: number;
    startDate: string;
    interestMethod: string;
    status: string;
    schedules: ScheduleItem[];
    repayments: Repayment[];
    collaterals: any[];
    guarantors: any[];
    interactions: any[];
    approvedAt?: string;
    rejectionReason?: string;
}

export default function LoanDetailsPage() {
    const { id, locale } = useParams();
    const router = useRouter();
    const t = useTranslations('LoanDetails');
    const { showToast } = useToast();
    const confirm = useConfirm();
    const [loan, setLoan] = useState<Loan | null>(null);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newNote, setNewNote] = useState('');

    const fetchLoan = useCallback(() => {
        setLoading(true);
        api.get(`/loans/${id}`)
            .then(res => setLoan(res.data))
            .catch(err => console.error(err))
            .finally(() => setLoading(false));
    }, [id]);

    useEffect(() => {
        fetchLoan();
    }, [fetchLoan]);

    const handleApprove = async () => {
        const ok = await confirm({
            title: 'Approve Loan Application',
            message: 'This loan will be marked as APPROVED. You will then be able to disburse funds.',
            confirmLabel: 'Approve',
            variant: 'default',
        });
        if (!ok) return;
        try {
            await api.put(`/loans/${id}/status`, { status: 'APPROVED' });
            showToast('Loan approved!', 'success');
            fetchLoan();
        } catch {
            showToast('Approve failed', 'error');
        }
    };

    const handleReject = async () => {
        const reason = window.prompt('Reason for rejection:');
        if (reason === null) return;
        try {
            await api.put(`/loans/${id}/status`, { status: 'REJECTED', reason });
            showToast('Loan applicant rejected', 'success');
            fetchLoan();
        } catch {
            showToast('Reject failed', 'error');
        }
    };

    const handleDisburse = async () => {
        const ok = await confirm({
            title: 'Disburse Loan',
            message: 'This will activate the repayment schedule. The borrower will receive the funds.',
            confirmLabel: 'Disburse',
            variant: 'warning',
        });
        if (!ok) return;
        try {
            await api.put(`/loans/${id}/status`, { status: 'DISBURSED' });
            showToast('Loan disbursed successfully', 'success');
            fetchLoan();
        } catch {
            showToast('Failed to disburse loan', 'error');
        }
    };

    const handleAddNote = async () => {
        if (!newNote) return;
        try {
            await api.post(`/loans/${id}/interactions`, { notes: newNote, title: 'Follow-up Note', type: 'NOTE' });
            setNewNote('');
            showToast('Note added', 'success');
            fetchLoan();
        } catch {
            showToast('Failed to add note', 'error');
        }
    };

    if (loading) return <div className="flex h-64 items-center justify-center text-slate-400 font-black animate-pulse uppercase tracking-[0.2em]">Loading Loan Data...</div>;
    if (!loan) return <div className="text-center py-20 font-black text-rose-500">Loan not found</div>;

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header Area */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                    <Link href={`/${locale}/loans`}>
                        <div className="w-12 h-12 glass rounded-2xl flex items-center justify-center text-slate-600 hover:bg-white hover:text-indigo-600 transition-all shadow-sm">
                            <ChevronLeft size={24} />
                        </div>
                    </Link>
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-3xl font-black text-slate-900 tracking-tight">Loan #{loan.id.slice(-6).toUpperCase()}</h1>
                            <span className={`px-4 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-full ${loan.status === 'DISBURSED' ? 'bg-emerald-100 text-emerald-700 shadow-sm' : 'bg-slate-200 text-slate-600'}`}>{loan.status}</span>
                        </div>
                        <p className="text-slate-500 font-medium mt-1">
                            Borrower: <Link href={`/${locale}/borrowers/${loan.borrower.id}`} className="text-indigo-600 font-extrabold hover:underline">{loan.borrower.firstName} {loan.borrower.lastName}</Link>
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-3">
                    {loan.status === 'PENDING' && (
                        <>
                            <Button onClick={handleReject} variant="secondary" className="rounded-2xl font-bold px-6 h-12 text-rose-600 hover:bg-rose-50 border-rose-100">Reject Application</Button>
                            <Button onClick={handleApprove} className="rounded-2xl font-bold px-8 h-12 bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-600/20 transition-all hover:scale-[1.02]">Approve Application</Button>
                        </>
                    )}
                    {loan.status === 'APPROVED' && (
                        <Button onClick={handleDisburse} className="rounded-2xl font-bold px-8 h-12 bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-100/20 transition-all hover:scale-[1.02] flex items-center gap-2">
                            <CheckCircle size={18} /> Disburse Funds
                        </Button>
                    )}
                    {loan.status === 'DISBURSED' && (
                        <Button onClick={() => setIsModalOpen(true)} className="rounded-2xl font-bold px-8 h-12 bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-100/20 transition-all hover:scale-[1.02] flex items-center gap-2">
                            <Plus size={18} /> Post Payment
                        </Button>
                    )}
                </div>
            </div>

            <RepaymentModal open={isModalOpen} onOpenChange={setIsModalOpen} onSuccess={fetchLoan} defaultLoanId={loan.id} />

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left Column: Summary and Collateral/Guarantors */}
                <div className="lg:col-span-1 space-y-8">
                    {/* Summary Card */}
                    <div className="glass p-8 rounded-[2.5rem] premium-shadow border-indigo-100/10 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full -mr-12 -mt-12" />
                        <h3 className="text-lg font-black text-slate-900 mb-6 flex items-center gap-2">
                            <Wallet size={20} className="text-indigo-500" /> Loan Summary
                        </h3>
                        <div className="space-y-5">
                            <div className="flex justify-between items-end border-b border-slate-100/50 pb-4">
                                <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Principal</span>
                                <span className="text-2xl font-black text-slate-900 tracking-tight">${loan.principal.toLocaleString()}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-y-4 pt-1">
                                <div>
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Interest Rate</p>
                                    <p className="font-extrabold text-slate-800">{loan.annualInterestRate}% Annual</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Term Length</p>
                                    <p className="font-extrabold text-slate-800">{loan.termMonths} Months</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Method</p>
                                    <p className="font-extrabold text-slate-500 text-xs uppercase">{loan.interestMethod}</p>
                                </div>
                                <div>
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Status</p>
                                    <p className="font-extrabold text-slate-800">{loan.status}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Risk Check / Secondary Info */}
                    <div className="glass p-8 rounded-[2.5rem] premium-shadow border-amber-100/20 bg-amber-50/30">
                        <h3 className="text-lg font-black text-amber-900 mb-4 flex items-center gap-2">
                            <ShieldCheck size={20} /> Security & Collateral
                        </h3>
                        {loan.collaterals?.length === 0 ? (
                            <p className="text-sm text-amber-800/60 font-medium italic">No collateral registered for this loan.</p>
                        ) : (
                            <div className="space-y-4">
                                {loan.collaterals?.map((c, idx) => (
                                    <div key={idx} className="p-4 bg-white/60 rounded-2xl border border-amber-200/50">
                                        <p className="text-[10px] font-black text-amber-700 uppercase tracking-widest mb-1">{c.type}</p>
                                        <p className="font-bold text-slate-800 text-sm mb-1">{c.description}</p>
                                        <p className="text-amber-600 font-black text-base">${c.value?.toLocaleString()}</p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Column: Schedule and Interactions */}
                <div className="lg:col-span-2 space-y-8">
                    {/* Repayment Schedule Table */}
                    <div className="glass p-8 rounded-[2.5rem] premium-shadow border-indigo-100/10">
                        <div className="flex items-center justify-between mb-8">
                            <h3 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                                <Calendar size={22} className="text-indigo-500" /> Repayment Schedule
                            </h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-100">
                                        <th className="text-left py-4 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">#</th>
                                        <th className="text-left py-4 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Due Date</th>
                                        <th className="text-right py-4 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Principal</th>
                                        <th className="text-right py-4 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Interest</th>
                                        <th className="text-right py-4 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Total</th>
                                        <th className="text-right py-4 text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {loan.schedules.map((item) => (
                                        <tr key={item.installmentNumber} className="hover:bg-slate-50/50 transition-colors">
                                            <td className="py-4 font-black text-slate-400 text-xs">{item.installmentNumber}</td>
                                            <td className="py-4 font-bold text-slate-600 text-sm">{new Date(item.dueDate).toLocaleDateString()}</td>
                                            <td className="py-4 text-right font-bold text-slate-700 text-sm">${item.principalAmount.toLocaleString()}</td>
                                            <td className="py-4 text-right font-bold text-slate-700 text-sm">${item.interestAmount.toLocaleString()}</td>
                                            <td className="py-4 text-right font-black text-slate-900 text-base">${item.totalAmount.toLocaleString()}</td>
                                            <td className="py-4 text-right">
                                                {item.isPaid ? (
                                                    <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase tracking-widest">Paid</span>
                                                ) : (
                                                    <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-500 text-[10px] font-black uppercase tracking-widest">Active</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Interactions and Collection Notes */}
                    <div className="glass p-8 rounded-[2.5rem] premium-shadow border-indigo-100/10 flex flex-col h-[500px]">
                        <h3 className="text-xl font-black text-slate-900 tracking-tight mb-6 flex items-center gap-2">
                            <MessageSquare size={22} className="text-indigo-500" /> Collection Logs & Activity
                        </h3>
                        <div className="flex-1 overflow-y-auto space-y-4 pr-3 mb-6 no-scrollbar">
                            {loan.interactions?.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-3">
                                    <AlertCircle size={48} strokeWidth={1} />
                                    <p className="font-black text-xs uppercase tracking-widest">No activity recorded for this loan.</p>
                                </div>
                            ) : (
                                loan.interactions?.map((it, idx) => (
                                    <div key={idx} className="bg-slate-50/40 p-5 rounded-3xl border border-slate-100/50 relative">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-[10px] font-black text-indigo-400 uppercase tracking-tighter">{new Date(it.createdAt).toLocaleString()}</span>
                                            <span className="text-[9px] font-black bg-white px-2 py-0.5 rounded-full text-slate-400 border border-slate-100 uppercase">{it.type}</span>
                                        </div>
                                        <p className="text-sm font-black text-slate-800 mb-1 leading-tight">{it.title}</p>
                                        <p className="text-sm text-slate-500 font-medium leading-relaxed">{it.notes}</p>
                                    </div>
                                ))
                            )}
                        </div>
                        <div className="flex gap-3 bg-slate-50 p-3 rounded-[2rem] border border-slate-100 focus-within:border-indigo-200 transition-all">
                            <Input
                                placeholder="Add a follow-up note or visit summary..."
                                value={newNote}
                                onChange={(e) => setNewNote(e.target.value)}
                                className="bg-transparent border-none shadow-none focus-visible:ring-0 placeholder:text-slate-400 font-bold"
                            />
                            <Button onClick={handleAddNote} className="bg-indigo-600 hover:bg-indigo-700 rounded-2xl px-6 font-black h-12 shadow-md shadow-indigo-600/20">Add Log</Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
