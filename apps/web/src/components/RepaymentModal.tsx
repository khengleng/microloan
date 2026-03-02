"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Receipt, DollarSign, Calendar, FileText, Loader2, Activity, Wallet, ShieldCheck } from "lucide-react";
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
                    const duePen = Math.max(0, Number(schedule.penaltyAmount) - Number(schedule.paidPenalty));
                    return acc + dueInt + duePrin + duePen;
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
            <DialogContent className="max-w-xl rounded-[2.5rem] border-none glass p-0 shadow-2xl overflow-hidden font-urbanist">
                <div className="p-8 space-y-8">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                            <Receipt className="text-emerald-600" size={28} /> Capital Recovery Injection
                        </DialogTitle>
                        <DialogDescription className="text-slate-500 font-medium">
                            Execute a principal or interest recovery transaction against an active financial asset.
                        </DialogDescription>
                    </DialogHeader>

                    {loanDetails && (
                        <div className="p-6 glass bg-emerald-50/50 rounded-3xl border border-emerald-100/50 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-emerald-600 shadow-sm border border-emerald-100">
                                    <Wallet size={20} />
                                </div>
                                <div>
                                    <div className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Outstanding Exposure</div>
                                    <div className="text-2xl font-black text-slate-900 tracking-tight">${loanDetails.totalDue.toLocaleString()}</div>
                                </div>
                            </div>
                            <div className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-600/20">
                                Active Asset
                            </div>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-2">
                            <Label htmlFor="loanId" className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Target Asset Instrument</Label>
                            <div className="relative group">
                                <FileText className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={18} />
                                <select
                                    id="loanId"
                                    className="w-full h-14 pl-12 pr-6 rounded-2xl border border-slate-200/50 bg-white font-bold text-sm appearance-none focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all cursor-pointer"
                                    value={formData.loanId}
                                    onChange={e => setFormData({ ...formData, loanId: e.target.value })}
                                    required
                                >
                                    <option value="">Select Disbursement Link</option>
                                    {loans.map(l => (
                                        <option key={l.id} value={l.id}>
                                            {l.borrower.firstName} {l.borrower.lastName} - Principal: ${l.principal.toLocaleString()}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <Label htmlFor="amount" className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Recovery Amount (USD)</Label>
                                <div className="relative group">
                                    <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-600 transition-colors" size={18} />
                                    <Input
                                        id="amount"
                                        type="number"
                                        step="0.01"
                                        max={loanDetails ? loanDetails.totalDue : undefined}
                                        className="h-14 pl-12 pr-6 rounded-2xl border-slate-200/50 bg-white shadow-sm focus:ring-4 focus:ring-emerald-500/10 transition-all font-black text-lg"
                                        value={formData.amount}
                                        onChange={e => setFormData({ ...formData, amount: e.target.value })}
                                        required
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="date" className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Execution Date</Label>
                                <div className="relative group">
                                    <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={18} />
                                    <Input
                                        id="date"
                                        type="date"
                                        className="h-14 pl-12 pr-6 rounded-2xl border-slate-200/50 bg-white shadow-sm focus:ring-4 focus:ring-indigo-500/10 transition-all font-bold"
                                        value={formData.date}
                                        onChange={e => setFormData({ ...formData, date: e.target.value })}
                                        required
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="px-6 py-4 glass bg-slate-50/50 rounded-2xl border border-slate-100/50 flex items-center gap-3">
                            <ShieldCheck className="text-indigo-500" size={18} />
                            <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Validated Ledger Transaction. Immutable Entry.</div>
                        </div>

                        <div className="flex justify-end gap-3 pt-6 border-t border-slate-100/50">
                            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="h-12 rounded-xl font-bold px-8">
                                Cancel
                            </Button>
                            <Button type="submit" disabled={loading} className="h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-widest px-10 shadow-xl shadow-emerald-600/20 active:scale-[0.98]">
                                {loading ? <Activity className="animate-spin mr-2" size={16} /> : <Receipt className="mr-2" size={16} />}
                                {loading ? 'Processing...' : 'Post Recovery'}
                            </Button>
                        </div>
                    </form>
                </div>
            </DialogContent>
        </Dialog>
    );
}
