"use client";

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { AlertTriangle, Eye, Phone, Loader2, MessageSquare, CheckCircle2, CreditCard } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { RepaymentModal } from '@/components/RepaymentModal';
import { useToast } from '@/components/ui/toast';

interface OverdueLoan {
    id: string;
    borrower: { firstName: string; lastName: string; phone: string };
    principal: number;
    schedules: Array<{ dueDate: string; totalAmount: number; }>;
}

const AGING_BRACKETS = [
    { label: '1–30 days', min: 1, max: 30, badgeCls: 'badge-warning' },
    { label: '31–60 days', min: 31, max: 60, badgeCls: 'badge-danger' },
    { label: '61–90 days', min: 61, max: 90, badgeCls: 'badge-danger' },
    { label: '90+ days', min: 91, max: Infinity, badgeCls: 'badge-danger' },
];

export default function CollectionsPage() {
    const { locale } = useParams();
    const { showToast } = useToast();
    const [loans, setLoans] = useState<OverdueLoan[]>([]);
    const [loading, setLoading] = useState(true);
    const [repaymentLoanId, setRepaymentLoanId] = useState<string | undefined>(undefined);
    const [repaymentOpen, setRepaymentOpen] = useState(false);

    const fetchLoans = () => {
        setLoading(true);
        api.get('/loans/overdue')
            .then(res => setLoans(res.data))
            .catch(() => showToast('Failed to load overdue loans', 'error'))
            .finally(() => setLoading(false));
    };

    useEffect(() => { fetchLoans(); }, []);

    if (loading) return (
        <div className="flex h-64 items-center justify-center text-muted-foreground text-sm gap-2">
            <Loader2 className="animate-spin" size={16} /> Loading collections...
        </div>
    );

    if (loans.length === 0) return (
        <div className="max-w-3xl space-y-4">
            <div>
                <h1 className="text-xl font-bold text-foreground">Collections</h1>
                <p className="text-sm text-muted-foreground mt-0.5">Overdue accounts requiring follow-up.</p>
            </div>
            <div className="bg-white border border-border rounded-md p-12 text-center">
                <CheckCircle2 size={36} className="mx-auto text-[#006644] mb-3" />
                <h2 className="text-base font-bold text-foreground">Portfolio is current</h2>
                <p className="text-sm text-muted-foreground mt-1">No overdue accounts at this time.</p>
            </div>
        </div>
    );

    // Group loans by aging bracket
    const bucketed = AGING_BRACKETS.map(bracket => ({
        ...bracket,
        loans: loans.filter(loan => {
            const oldest = new Date(loan.schedules[0]?.dueDate);
            const days = Math.floor((Date.now() - oldest.getTime()) / 86400000);
            return days >= bracket.min && days <= bracket.max;
        })
    })).filter(b => b.loans.length > 0);

    return (
        <div className="max-w-5xl space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-foreground">Collections</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        {loans.length} overdue account{loans.length !== 1 ? 's' : ''} requiring attention.
                    </p>
                </div>
                <span className="badge-danger text-xs">{loans.length} delinquent</span>
            </div>

            {/* Aging summary bar */}
            <div className="bg-white border border-border rounded-md p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                {AGING_BRACKETS.map(bracket => {
                    const count = loans.filter(loan => {
                        const days = Math.floor((Date.now() - new Date(loan.schedules[0]?.dueDate).getTime()) / 86400000);
                        return days >= bracket.min && days <= bracket.max;
                    }).length;
                    return (
                        <div key={bracket.label} className="text-center">
                            <p className="text-xs text-muted-foreground mb-1">{bracket.label}</p>
                            <p className={`text-lg font-bold ${count > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>{count}</p>
                        </div>
                    );
                })}
            </div>

            {/* Bucketed tables */}
            {bucketed.map(bucket => (
                <div key={bucket.label} className="bg-white border border-border rounded-md overflow-hidden">
                    <div className="px-4 py-3 border-b border-border flex items-center gap-2 bg-muted/40">
                        <AlertTriangle size={14} className="text-destructive" />
                        <span className="text-sm font-bold text-foreground">{bucket.label}</span>
                        <span className={`${bucket.badgeCls} ml-1`}>{bucket.loans.length}</span>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-border">
                            <thead className="bg-muted/30">
                                <tr>
                                    <th className="table-header px-4 py-2.5 text-left">Borrower</th>
                                    <th className="table-header px-4 py-2.5 text-left">Phone</th>
                                    <th className="table-header px-4 py-2.5 text-right">Overdue Amount</th>
                                    <th className="table-header px-4 py-2.5 text-right">Days Late</th>
                                    <th className="table-header px-4 py-2.5 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                                {bucket.loans.map(loan => {
                                    const oldest = new Date(loan.schedules[0]?.dueDate);
                                    const daysLate = Math.floor((Date.now() - oldest.getTime()) / 86400000);
                                    const totalOverdue = loan.schedules.reduce((acc, s) => acc + Number(s.totalAmount), 0);
                                    return (
                                        <tr key={loan.id} className="hover:bg-muted/20 transition-colors">
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2.5">
                                                    <div className="w-8 h-8 rounded bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground flex-shrink-0">
                                                        {loan.borrower.firstName[0]}{loan.borrower.lastName[0]}
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-semibold text-foreground">{loan.borrower.firstName} {loan.borrower.lastName}</p>
                                                        <p className="text-xs text-muted-foreground">#{loan.id.slice(-6).toUpperCase()}</p>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-muted-foreground">
                                                <span className="flex items-center gap-1.5">
                                                    <Phone size={12} /> {loan.borrower.phone}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-right text-sm font-bold text-destructive">
                                                ${totalOverdue.toLocaleString()}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <span className={daysLate > 30 ? 'badge-danger' : 'badge-warning'}>{daysLate}d</span>
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button
                                                        onClick={() => { setRepaymentLoanId(loan.id); setRepaymentOpen(true); }}
                                                        className="btn-primary text-xs px-3 py-1 h-auto"
                                                    >
                                                        <CreditCard size={12} /> Record Payment
                                                    </button>
                                                    <Link href={`/${locale}/loans/${loan.id}`}>
                                                        <button className="btn-ghost text-xs px-3 py-1 h-auto">
                                                            <Eye size={12} /> View
                                                        </button>
                                                    </Link>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            ))}

            <RepaymentModal
                open={repaymentOpen}
                onOpenChange={setRepaymentOpen}
                defaultLoanId={repaymentLoanId}
                onSuccess={() => {
                    showToast('Payment recorded successfully', 'success');
                    fetchLoans();
                }}
            />
        </div>
    );
}
