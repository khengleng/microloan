"use client";

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
    ChevronLeft, Plus, CheckCircle, Wallet, Calendar,
    ShieldCheck, MessageSquare, AlertCircle, Loader2, Send
} from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { RepaymentModal } from '@/components/RepaymentModal';
import { clarityEvent, claritySetTag } from '@/lib/clarity';

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

interface Loan {
    id: string;
    borrower: {
        id: string;
        firstName: string;
        lastName: string;
        phone: string;
        loans: { id: string; status: string; principal: number; createdAt: string; }[];
    };
    principal: number;
    annualInterestRate: number;
    termMonths: number;
    startDate: string;
    interestMethod: string;
    status: string;
    schedules: ScheduleItem[];
    repayments: any[];
    collaterals: any[];
    guarantors: any[];
    interactions: any[];
    approvedAt?: string;
    rejectionReason?: string;
}

const STATUS_BADGE: Record<string, string> = {
    PENDING: 'badge-warning',
    APPROVED: 'badge-info',
    REJECTED: 'badge-danger',
    DISBURSED: 'badge-success',
    CLOSED: 'badge-neutral',
    DEFAULTED: 'badge-danger',
};

export default function LoanDetailsPage() {
    const { id, locale } = useParams();
    const router = useRouter();
    const { showToast } = useToast();
    const confirm = useConfirm();
    const [loan, setLoan] = useState<Loan | null>(null);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newNote, setNewNote] = useState('');
    const [submittingNote, setSubmittingNote] = useState(false);
    const [rejectionReason, setRejectionReason] = useState('');
    const [showRejectInput, setShowRejectInput] = useState(false);

    const fetchLoan = useCallback(() => {
        setLoading(true);
        api.get(`/loans/${id}`)
            .then(res => setLoan(res.data))
            .catch(() => showToast('Failed to load loan', 'error'))
            .finally(() => setLoading(false));
    }, [id]);

    useEffect(() => { fetchLoan(); }, [fetchLoan]);

    useEffect(() => {
        claritySetTag('journey_stage', 'loan_status_page');
        clarityEvent('loan_status_page_view');
    }, []);

    useEffect(() => {
        if (!loan) return;
        claritySetTag('loan_status', loan.status);
        if (loan.status === 'APPROVED') clarityEvent('loan_approved_status_view');
        if (loan.status === 'REJECTED') clarityEvent('loan_rejected_status_view');
    }, [loan]);

    const handleApprove = async () => {
        clarityEvent('loan_approve_attempt');
        const ok = await confirm({
            title: 'Approve Loan Application',
            message: 'This loan will be marked as APPROVED. The loan officer can then disburse funds.',
            confirmLabel: 'Approve',
            variant: 'default',
        });
        if (!ok) return;
        try {
            await api.put(`/loans/${id}/status`, { status: 'APPROVED' });
            clarityEvent('loan_approve_success');
            showToast('Loan approved', 'success');
            fetchLoan();
        } catch {
            clarityEvent('loan_approve_failed');
            showToast('Failed to approve loan', 'error');
        }
    };

    const handleReject = async () => {
        if (!rejectionReason.trim()) {
            showToast('Please provide a reason for rejection', 'error');
            return;
        }
        clarityEvent('loan_reject_attempt');
        const ok = await confirm({
            title: 'Reject Loan Application',
            message: `Reason: "${rejectionReason}". This cannot be undone.`,
            confirmLabel: 'Reject',
            variant: 'danger',
        });
        if (!ok) return;
        try {
            await api.put(`/loans/${id}/status`, { status: 'REJECTED', reason: rejectionReason });
            clarityEvent('loan_reject_success');
            showToast('Application rejected', 'success');
            setShowRejectInput(false);
            setRejectionReason('');
            fetchLoan();
        } catch {
            clarityEvent('loan_reject_failed');
            showToast('Failed to reject loan', 'error');
        }
    };

    const handleDisburse = async () => {
        clarityEvent('loan_disburse_attempt');
        const ok = await confirm({
            title: 'Disburse Loan',
            message: 'This will activate the repayment schedule. The borrower will receive the funds.',
            confirmLabel: 'Disburse Funds',
            variant: 'warning',
        });
        if (!ok) return;
        try {
            await api.put(`/loans/${id}/status`, { status: 'DISBURSED' });
            clarityEvent('loan_disburse_success');
            showToast('Loan disbursed successfully', 'success');
            fetchLoan();
        } catch {
            clarityEvent('loan_disburse_failed');
            showToast('Failed to disburse loan', 'error');
        }
    };

    const handleAddNote = async () => {
        if (!newNote.trim()) return;
        setSubmittingNote(true);
        try {
            await api.post(`/loans/${id}/interactions`, { notes: newNote, title: 'Follow-up Note', type: 'NOTE' });
            setNewNote('');
            showToast('Note added', 'success');
            fetchLoan();
        } catch {
            showToast('Failed to add note', 'error');
        } finally {
            setSubmittingNote(false);
        }
    };

    if (loading) return (
        <div className="flex h-64 items-center justify-center text-muted-foreground text-sm gap-2">
            <Loader2 size={16} className="animate-spin" /> Loading loan details...
        </div>
    );
    if (!loan) return (
        <div className="text-center py-20">
            <p className="text-sm font-medium text-destructive">Loan not found</p>
        </div>
    );

    const paidCount = loan.schedules.filter(s => s.isPaid).length;
    const progressPct = loan.schedules.length > 0
        ? Math.round((paidCount / loan.schedules.length) * 100)
        : 0;
    const totalPaid = loan.repayments.reduce((s, r) => s + Number(r.amount), 0);
    const remaining = Number(loan.principal) - loan.repayments.reduce((s, r) => s + Number(r.principalPaid), 0);

    return (
        <div className="max-w-6xl space-y-5">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                    <Link href={`/${locale}/loans`}>
                        <button className="btn-ghost px-2 py-1.5 h-auto">
                            <ChevronLeft size={16} />
                        </button>
                    </Link>
                    <div>
                        <div className="flex items-center gap-2.5">
                            <h1 className="text-xl font-bold text-foreground">Loan #{loan.id.slice(-6).toUpperCase()}</h1>
                            <span className={STATUS_BADGE[loan.status] || 'badge-neutral'}>{loan.status}</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            Borrower:{' '}
                            <Link href={`/${locale}/borrowers/${loan.borrower.id}`} className="text-primary font-semibold hover:underline">
                                {loan.borrower.firstName} {loan.borrower.lastName}
                            </Link>
                        </p>
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap gap-2">
                    {loan.status === 'PENDING' && (
                        <>
                            {showRejectInput ? (
                                <div className="flex items-center gap-2">
                                    <input
                                        type="text"
                                        data-clarity-mask="true"
                                        placeholder="Reason for rejection..."
                                        value={rejectionReason}
                                        onChange={e => setRejectionReason(e.target.value)}
                                        className="h-9 px-3 border border-border rounded text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 w-56"
                                        autoFocus
                                    />
                                    <button onClick={handleReject} className="btn-danger">Confirm</button>
                                    <button onClick={() => setShowRejectInput(false)} className="btn-ghost">Cancel</button>
                                </div>
                            ) : (
                                <button onClick={() => setShowRejectInput(true)} className="btn-ghost text-destructive border-destructive/30 hover:bg-destructive/10">
                                    Reject
                                </button>
                            )}
                            <button onClick={handleApprove} className="btn-primary">
                                <CheckCircle size={14} /> Approve
                            </button>
                        </>
                    )}
                    {loan.status === 'APPROVED' && (
                        <button onClick={handleDisburse} className="btn-primary bg-[#006644] hover:bg-[#004d33]">
                            <Wallet size={14} /> Disburse Funds
                        </button>
                    )}
                    {loan.status === 'DISBURSED' && (
                        <button onClick={() => {
                            clarityEvent('repayment_modal_open_from_loan');
                            setIsModalOpen(true);
                        }} className="btn-primary">
                            <Plus size={14} /> Post Payment
                        </button>
                    )}
                </div>
            </div>

            <RepaymentModal open={isModalOpen} onOpenChange={setIsModalOpen} onSuccess={fetchLoan} defaultLoanId={loan.id} />

            {/* Main Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                {/* Left column */}
                <div className="lg:col-span-1 space-y-4">
                    {/* Loan Summary */}
                    <div className="bg-white border border-border rounded-md">
                        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                            <Wallet size={14} className="text-primary" />
                            <h3 className="text-sm font-bold text-foreground">Loan Summary</h3>
                        </div>
                        <div className="px-4 py-4 space-y-3">
                            <div className="flex justify-between items-center">
                                <span className="text-xs text-muted-foreground">Principal</span>
                                <span className="text-lg font-bold text-foreground">${Number(loan.principal).toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-xs text-muted-foreground">Annual Rate</span>
                                <span className="text-sm font-semibold text-foreground">{loan.annualInterestRate}%</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-xs text-muted-foreground">Term</span>
                                <span className="text-sm font-semibold text-foreground">{loan.termMonths} months</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-xs text-muted-foreground">Method</span>
                                <span className="badge-neutral text-[11px]">{loan.interestMethod}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-xs text-muted-foreground">Start Date</span>
                                <span className="text-sm text-muted-foreground">{new Date(loan.startDate).toLocaleDateString()}</span>
                            </div>

                            {loan.status === 'DISBURSED' && (
                                <div className="pt-3 border-t border-border space-y-2">
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs text-muted-foreground">Total Paid</span>
                                        <span className="text-sm font-bold text-[#006644]">${totalPaid.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs text-muted-foreground">Remaining Principal</span>
                                        <span className="text-sm font-bold text-foreground">${Math.max(0, remaining).toLocaleString()}</span>
                                    </div>
                                    <div className="pt-1">
                                        <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
                                            <span>Progress</span>
                                            <span>{paidCount}/{loan.schedules.length} installments</span>
                                        </div>
                                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-primary rounded-full transition-all"
                                                style={{ width: `${progressPct}%` }}
                                            />
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-1 text-right">{progressPct}% complete</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Collateral */}
                    <div className="bg-white border border-border rounded-md">
                        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                            <ShieldCheck size={14} className="text-[#974F0C]" />
                            <h3 className="text-sm font-bold text-foreground">Security & Collateral</h3>
                        </div>
                        <div className="px-4 py-4">
                            {loan.collaterals?.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No collateral registered.</p>
                            ) : (
                                <div className="space-y-3">
                                    {loan.collaterals?.map((c, idx) => (
                                        <div key={idx} className="p-3 bg-[#FFFAE6] rounded border border-[#FFECB0]">
                                            <p className="text-[11px] font-bold text-[#974F0C] uppercase tracking-wide mb-0.5">{c.type}</p>
                                            <p className="text-sm text-foreground font-medium">{c.description || '—'}</p>
                                            <p className="text-sm font-bold text-[#974F0C] mt-0.5">${Number(c.value).toLocaleString()}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Guarantors */}
                    {loan.guarantors?.length > 0 && (
                        <div className="bg-white border border-border rounded-md">
                            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                                <ShieldCheck size={14} className="text-primary" />
                                <h3 className="text-sm font-bold text-foreground">Guarantors</h3>
                            </div>
                            <div className="px-4 py-4 space-y-3">
                                {loan.guarantors.map((g, idx) => (
                                    <div key={idx} className="p-3 bg-muted/40 rounded border border-border">
                                        <p className="text-sm font-semibold text-foreground">{g.name}</p>
                                        <p className="text-xs text-muted-foreground">{g.phone} · {g.relation}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Right column */}
                <div className="lg:col-span-2 space-y-4">
                    {/* Repayment Schedule */}
                    <div className="bg-white border border-border rounded-md overflow-hidden">
                        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                            <Calendar size={14} className="text-primary" />
                            <h3 className="text-sm font-bold text-foreground">Repayment Schedule</h3>
                            <span className="ml-auto text-xs text-muted-foreground">{paidCount}/{loan.schedules.length} paid</span>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-border">
                                <thead className="bg-muted/30">
                                    <tr>
                                        <th className="table-header px-4 py-2.5 text-left">#</th>
                                        <th className="table-header px-4 py-2.5 text-left">Due Date</th>
                                        <th className="table-header px-4 py-2.5 text-right">Principal</th>
                                        <th className="table-header px-4 py-2.5 text-right">Interest</th>
                                        <th className="table-header px-4 py-2.5 text-right">Total</th>
                                        <th className="table-header px-4 py-2.5 text-right">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {loan.schedules.map(item => {
                                        const isOverdue = !item.isPaid && new Date(item.dueDate) < new Date();
                                        return (
                                            <tr key={item.installmentNumber} className={`transition-colors ${item.isPaid ? 'bg-muted/10' : isOverdue ? 'bg-destructive/5' : 'hover:bg-muted/20'}`}>
                                                <td className="px-4 py-2.5 text-xs text-muted-foreground font-semibold">{item.installmentNumber}</td>
                                                <td className="px-4 py-2.5 text-sm text-foreground">{new Date(item.dueDate).toLocaleDateString()}</td>
                                                <td className="px-4 py-2.5 text-right text-sm text-muted-foreground">${Number(item.principalAmount).toLocaleString()}</td>
                                                <td className="px-4 py-2.5 text-right text-sm text-muted-foreground">${Number(item.interestAmount).toLocaleString()}</td>
                                                <td className="px-4 py-2.5 text-right text-sm font-semibold text-foreground">${Number(item.totalAmount).toLocaleString()}</td>
                                                <td className="px-4 py-2.5 text-right">
                                                    {item.isPaid
                                                        ? <span className="badge-success text-[11px]">Paid</span>
                                                        : isOverdue
                                                            ? <span className="badge-danger text-[11px]">Overdue</span>
                                                            : <span className="badge-neutral text-[11px]">Pending</span>
                                                    }
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Collection Notes */}
                    <div className="bg-white border border-border rounded-md flex flex-col" style={{ minHeight: 360 }}>
                        <div className="flex items-center gap-2 px-4 py-3 border-b border-border flex-shrink-0">
                            <MessageSquare size={14} className="text-primary" />
                            <h3 className="text-sm font-bold text-foreground">Collection Logs & Activity</h3>
                        </div>
                        <div className="flex-1 overflow-y-auto divide-y divide-border">
                            {loan.interactions?.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
                                    <AlertCircle size={28} strokeWidth={1.5} className="opacity-30" />
                                    <p className="text-xs text-muted-foreground">No activity recorded yet.</p>
                                </div>
                            ) : (
                                loan.interactions?.map((it, idx) => (
                                    <div key={idx} className="px-4 py-3 hover:bg-muted/20 transition-colors">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-xs text-muted-foreground">{new Date(it.createdAt).toLocaleString()}</span>
                                            <span className="badge-neutral text-[10px]">{it.type}</span>
                                        </div>
                                        <p className="text-sm font-semibold text-foreground">{it.title}</p>
                                        <p className="text-sm text-muted-foreground mt-0.5">{it.notes}</p>
                                    </div>
                                ))
                            )}
                        </div>
                        <div className="flex gap-2 p-3 border-t border-border flex-shrink-0">
                            <input
                                placeholder="Add a follow-up note..."
                                value={newNote}
                                onChange={e => setNewNote(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleAddNote()}
                                className="flex-1 h-9 px-3 border border-border rounded text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors"
                            />
                            <button
                                onClick={handleAddNote}
                                disabled={submittingNote || !newNote.trim()}
                                className="btn-primary px-3 disabled:opacity-50"
                            >
                                {submittingNote ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
