"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import api from "@/lib/api";

interface RepaymentModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
    defaultLoanId?: string;
}

interface Loan {
    id: string;
    borrower: {
        firstName: string;
        lastName: string;
    };
    principal: number;
}

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
                const disbursedLoans = res.data.filter((l: any) => l.status === 'DISBURSED');
                setLoans(disbursedLoans);
            });
            if (defaultLoanId) {
                setFormData(prev => ({ ...prev, loanId: defaultLoanId }));
            }
        }
    }, [open, defaultLoanId]);

    useEffect(() => {
        if (formData.loanId) {
            api.get(`/loans/${formData.loanId}`).then(res => {
                const s = res.data.schedules || [];
                const totalDue = s.reduce((acc: number, schedule: any) => {
                    const dueInt = Math.max(0, Number(schedule.interestAmount) - Number(schedule.paidInterest));
                    const duePrin = Math.max(0, Number(schedule.principalAmount) - Number(schedule.paidPrincipal));
                    return acc + dueInt + duePrin;
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
            await api.post('/repayments', {
                ...formData,
                amount: parseFloat(formData.amount),
            });
            onSuccess();
            onOpenChange(false);
            setFormData({
                loanId: '',
                amount: '',
                date: new Date().toISOString().split('T')[0]
            });
        } catch (error: any) {
            console.error('Failed to post repayment', error);
            const msg = error.response?.data?.message || 'Failed to post repayment';
            alert(Array.isArray(msg) ? msg[0] : msg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{t('add_new')}</DialogTitle>
                    <DialogDescription className="sr-only">
                        Enter details for a new repayment.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="loanId">{t('loan')}</Label>
                        <Select
                            id="loanId"
                            value={formData.loanId}
                            onChange={e => setFormData({ ...formData, loanId: e.target.value })}
                            required
                        >
                            <option value="">Select Loan</option>
                            {loans.map(l => (
                                <option key={l.id} value={l.id}>
                                    {l.borrower.firstName} {l.borrower.lastName} - ${l.principal}
                                </option>
                            ))}
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="amount">{t('amount')} {loanDetails && <span className="text-gray-500 font-normal ml-1">(Max: ${loanDetails.totalDue.toFixed(2)})</span>}</Label>
                        <Input
                            id="amount"
                            type="number"
                            step="0.01"
                            max={loanDetails ? loanDetails.totalDue.toFixed(2) : undefined}
                            value={formData.amount}
                            onChange={e => setFormData({ ...formData, amount: e.target.value })}
                            required
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="date">{t('date')}</Label>
                        <Input
                            id="date"
                            type="date"
                            value={formData.date}
                            onChange={e => setFormData({ ...formData, date: e.target.value })}
                            required
                        />
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={loading}>
                            {loading ? 'Posting...' : t('add_new')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
