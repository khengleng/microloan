"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Receipt, DollarSign, Calendar, FileText, Loader2, Wallet, ShieldCheck } from "lucide-react";
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
            <DialogContent className="max-w-xl rounded-[32px] border-border bg-card/90 backdrop-blur-2xl p-0 shadow-2xl overflow-hidden border shadow-[0_0_50px_rgba(0,0,0,0.5)] font-sans">
                <div className="p-10 space-y-10">
                    <DialogHeader>
                        <DialogTitle className="text-3xl font-black text-foreground tracking-tighter flex items-center gap-4">
                            <div className="p-3 bg-primary/10 rounded-2xl">
                                <Receipt className="text-primary" size={32} />
                            </div>
                            Asset <span className="text-primary italic">Recovery</span>
                        </DialogTitle>
                        <DialogDescription className="text-muted-foreground font-bold text-[15px] opacity-70">
                            Execute a principal or interest recovery transaction against an active financial asset.
                        </DialogDescription>
                    </DialogHeader>

                    {loanDetails && (
                        <div className="p-8 bg-primary text-primary-foreground rounded-[24px] flex items-center justify-between shadow-[0_15px_40px_rgba(217,235,119,0.1)] border border-white/20">
                            <div className="flex items-center gap-5">
                                <div className="w-14 h-14 bg-background/20 rounded-2xl flex items-center justify-center text-primary-foreground shadow-inner">
                                    <Wallet size={24} />
                                </div>
                                <div>
                                    <div className="text-[11px] font-black uppercase tracking-[0.2em] opacity-70 mb-1">Exposure Level</div>
                                    <div className="text-3xl font-black tracking-tighter">${loanDetails.totalDue.toLocaleString()}</div>
                                </div>
                            </div>
                            <div className="px-4 py-2 bg-background/20 rounded-xl text-[10px] font-black uppercase tracking-[0.2em] shadow-inner">
                                Active Node
                            </div>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-8">
                        <div className="space-y-3">
                            <Label htmlFor="loanId" className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em] ml-2 opacity-50">Target Asset Instrument</Label>
                            <div className="relative group">
                                <FileText className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors transition-all" size={18} />
                                <select
                                    id="loanId"
                                    className="w-full h-14 pl-14 pr-6 rounded-2xl border-border/50 bg-background/50 font-black text-sm appearance-none focus:outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all cursor-pointer text-foreground"
                                    value={formData.loanId}
                                    onChange={e => setFormData({ ...formData, loanId: e.target.value })}
                                    required
                                >
                                    <option value="" className="bg-card">Select Disbursement Link</option>
                                    {loans.map(l => (
                                        <option key={l.id} value={l.id} className="bg-card">
                                            {l.borrower.firstName} {l.borrower.lastName} - Instrument: ${l.principal.toLocaleString()}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-3">
                                <Label htmlFor="amount" className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em] ml-2 opacity-50">Recovery Amount (USD)</Label>
                                <div className="relative group">
                                    <DollarSign className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors transition-all" size={18} />
                                    <Input
                                        id="amount"
                                        type="number"
                                        step="0.01"
                                        max={loanDetails ? loanDetails.totalDue : undefined}
                                        className="h-14 pl-14 pr-6 rounded-2xl border-border/50 bg-background/50 shadow-inner focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all font-black text-lg text-foreground"
                                        value={formData.amount}
                                        onChange={e => setFormData({ ...formData, amount: e.target.value })}
                                        required
                                    />
                                </div>
                            </div>

                            <div className="space-y-3">
                                <Label htmlFor="date" className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em] ml-2 opacity-50">Execution Date</Label>
                                <div className="relative group">
                                    <Calendar className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors transition-all" size={18} />
                                    <Input
                                        id="date"
                                        type="date"
                                        className="h-14 pl-14 pr-6 rounded-2xl border-border/50 bg-background/50 shadow-inner focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all font-black text-foreground"
                                        value={formData.date}
                                        onChange={e => setFormData({ ...formData, date: e.target.value })}
                                        required
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="px-6 py-4 glass bg-primary/5 rounded-2xl border border-primary/20 flex items-center gap-4">
                            <ShieldCheck className="text-primary" size={20} />
                            <div className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.15em] opacity-80">Validated Ledger Transaction. Immutable Protocol Entry.</div>
                        </div>

                        <div className="flex justify-end gap-4 pt-8 border-t border-border/50">
                            <button type="button" onClick={() => onOpenChange(false)} className="h-14 px-8 rounded-2xl font-black text-[12px] uppercase tracking-widest text-muted-foreground hover:text-foreground hover:bg-white/5 transition-all">
                                Discard
                            </button>
                            <button type="submit" disabled={loading} className="premium-button h-14 px-10 flex items-center gap-3 active:scale-[0.98] transition-all">
                                {loading ? <Loader2 className="animate-spin" size={18} /> : <Receipt size={18} />}
                                <span className="uppercase tracking-[0.2em] text-[12px]">
                                    {loading ? 'Processing...' : 'Post Recovery'}
                                </span>
                            </button>
                        </div>
                    </form>
                </div>
            </DialogContent>
        </Dialog>
    );
}
