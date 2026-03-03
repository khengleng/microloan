"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import api from "@/lib/api";

interface RepaymentModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
    defaultLoanId?: string;
}

interface Loan {
    id: string;
    borrower: { firstName: string; lastName: string; };
    principal: number;
}

const fieldCls = "w-full h-9 px-3 bg-white border border-border rounded text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors";
const labelCls = "block text-sm font-medium text-foreground mb-1";

export function RepaymentModal({ open, onOpenChange, onSuccess, defaultLoanId }: RepaymentModalProps) {
    const t = useTranslations('Repayments');
    const [loading, setLoading] = useState(false);
    const [loans, setLoans] = useState<Loan[]>([]);
    const [loanDetails, setLoanDetails] = useState<any>(null);
    const [formData, setFormData] = useState({
        loanId: defaultLoanId || '',
        amount: '',
        date: new Date().toISOString().split('T')[0]
    });

    useEffect(() => {
        if (open) {
            api.get('/loans').then(res => {
                setLoans(res.data.filter((l: any) => l.status === 'DISBURSED'));
            });
            if (defaultLoanId) setFormData(prev => ({ ...prev, loanId: defaultLoanId }));
        }
    }, [open, defaultLoanId]);

    useEffect(() => {
        if (formData.loanId) {
            api.get(`/loans/${formData.loanId}`).then(res => {
                const s = res.data.schedules || [];
                const totalDue = s.reduce((acc: number, sch: any) => {
                    return acc
                        + Math.max(0, Number(sch.interestAmount) - Number(sch.paidInterest))
                        + Math.max(0, Number(sch.principalAmount) - Number(sch.paidPrincipal))
                        + Math.max(0, Number(sch.penaltyAmount) - Number(sch.paidPenalty));
                }, 0);
                setLoanDetails({ ...res.data, totalDue });
            }).catch(console.error);
        } else {
            setLoanDetails(null);
        }
    }, [formData.loanId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await api.post('/repayments', { ...formData, amount: parseFloat(formData.amount) });
            onSuccess();
            onOpenChange(false);
            setFormData({ loanId: '', amount: '', date: new Date().toISOString().split('T')[0] });
        } catch (error: any) {
            const msg = error.response?.data?.message || 'Failed to post repayment';
            alert(Array.isArray(msg) ? msg[0] : msg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md bg-white border border-border rounded-lg p-0 shadow-lg overflow-hidden">
                {/* Header */}
                <div className="px-6 py-4 border-b border-border">
                    <DialogTitle className="text-base font-bold text-foreground">Record Repayment</DialogTitle>
                    <p className="text-sm text-muted-foreground mt-0.5">Post a payment against an active loan.</p>
                </div>

                {/* Outstanding balance info */}
                {loanDetails && (
                    <div className="mx-6 mt-4 p-3 bg-muted rounded border border-border flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Outstanding balance</span>
                        <span className="text-sm font-bold text-foreground">${loanDetails.totalDue.toLocaleString()}</span>
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                    <div className="px-6 py-5 space-y-4">
                        <div>
                            <label htmlFor="loanId" className={labelCls}>Loan <span className="text-destructive">*</span></label>
                            <select
                                id="loanId"
                                className={`${fieldCls} appearance-none`}
                                value={formData.loanId}
                                onChange={e => setFormData({ ...formData, loanId: e.target.value })}
                                required
                            >
                                <option value="">Select a loan...</option>
                                {loans.map(l => (
                                    <option key={l.id} value={l.id}>
                                        {l.borrower.firstName} {l.borrower.lastName} — ${l.principal.toLocaleString()}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label htmlFor="amount" className={labelCls}>Amount (USD) <span className="text-destructive">*</span></label>
                                <input
                                    id="amount"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max={loanDetails?.totalDue}
                                    className={fieldCls}
                                    placeholder="0.00"
                                    value={formData.amount}
                                    onChange={e => setFormData({ ...formData, amount: e.target.value })}
                                    required
                                />
                            </div>
                            <div>
                                <label htmlFor="date" className={labelCls}>Payment Date <span className="text-destructive">*</span></label>
                                <input
                                    id="date"
                                    type="date"
                                    className={fieldCls}
                                    value={formData.date}
                                    onChange={e => setFormData({ ...formData, date: e.target.value })}
                                    required
                                />
                            </div>
                        </div>
                    </div>

                    <div className="px-6 py-4 border-t border-border bg-muted/40 flex justify-end gap-2">
                        <button type="button" onClick={() => onOpenChange(false)} className="btn-ghost">Cancel</button>
                        <button type="submit" disabled={loading} className="btn-primary">
                            {loading && <Loader2 size={14} className="animate-spin" />}
                            {loading ? 'Posting...' : 'Post Repayment'}
                        </button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
