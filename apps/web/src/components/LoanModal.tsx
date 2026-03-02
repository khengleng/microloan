"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FilePlus, User, Package, DollarSign, Percent, Calendar, Settings2, ShieldCheck, Plus, Trash2, Loader2, Activity } from "lucide-react";
import api from "@/lib/api";

interface LoanModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
}

interface Borrower {
    id: string;
    firstName: string;
    lastName: string;
}

interface LoanProduct {
    id: string;
    name: string;
    interestMethod: string;
    policies: Array<{
        interestRate: number;
        minTermMonths: number;
        maxTermMonths: number;
    }>;
}

export function LoanModal({ open, onOpenChange, onSuccess }: LoanModalProps) {
    const t = useTranslations('Loans');
    const [loading, setLoading] = useState(false);
    const [borrowers, setBorrowers] = useState<Borrower[]>([]);
    const [products, setProducts] = useState<LoanProduct[]>([]);
    const [formData, setFormData] = useState({
        borrowerId: '',
        productId: '',
        principal: '',
        annualInterestRate: '',
        termMonths: '',
        startDate: new Date().toISOString().split('T')[0],
        interestMethod: 'FLAT',
        collaterals: [] as any[],
        guarantors: [] as any[]
    });

    useEffect(() => {
        if (open) {
            Promise.all([
                api.get('/borrowers'),
                api.get('/loan-products')
            ]).then(([bRes, pRes]) => {
                setBorrowers(bRes.data);
                setProducts(pRes.data);
            });
        }
    }, [open]);

    const handleProductChange = (productId: string) => {
        const product = products.find(p => p.id === productId);
        if (product) {
            setFormData({
                ...formData,
                productId,
                interestMethod: product.interestMethod,
                annualInterestRate: product.policies[0]?.interestRate.toString() || '',
            });
        } else {
            setFormData({ ...formData, productId: '' });
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            await api.post('/loans', {
                ...formData,
                principal: parseFloat(formData.principal),
                annualInterestRate: parseFloat(formData.annualInterestRate),
                termMonths: parseInt(formData.termMonths),
            });
            onSuccess();
            onOpenChange(false);
            setFormData({
                borrowerId: '',
                productId: '',
                principal: '',
                annualInterestRate: '',
                termMonths: '',
                startDate: new Date().toISOString().split('T')[0],
                interestMethod: 'FLAT',
                collaterals: [],
                guarantors: []
            });
        } catch (error) {
            console.error('Failed to issue loan', error);
            alert('Failed to issue loan');
        } finally {
            setLoading(false);
        }
    };

    const addCollateral = () => {
        setFormData({
            ...formData,
            collaterals: [...formData.collaterals, { type: 'LAND_TITLE', description: '', value: '0', idNumber: '' }]
        });
    };

    const addGuarantor = () => {
        setFormData({
            ...formData,
            guarantors: [...formData.guarantors, { name: '', phone: '', relation: '', idNumber: '' }]
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto rounded-[2.5rem] border-none glass p-0 shadow-2xl no-scrollbar font-urbanist">
                <div className="p-8 space-y-10">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                            <FilePlus className="text-indigo-600" size={28} /> Capital Disbursement Protocol
                        </DialogTitle>
                        <DialogDescription className="text-slate-500 font-medium">
                            Originate a new financial instrument and bind it to a validated digital client identity.
                        </DialogDescription>
                    </DialogHeader>

                    <form onSubmit={handleSubmit} className="space-y-10">
                        {/* Primary Configuration */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-3">
                                <Label htmlFor="borrowerId" className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Target Identity</Label>
                                <div className="relative group">
                                    <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={18} />
                                    <select
                                        id="borrowerId"
                                        className="w-full h-14 pl-12 pr-6 rounded-2xl border border-slate-200/50 bg-white font-bold text-sm appearance-none focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all cursor-pointer"
                                        value={formData.borrowerId}
                                        onChange={e => setFormData({ ...formData, borrowerId: e.target.value })}
                                        required
                                    >
                                        <option value="">Select Validated Client</option>
                                        {borrowers.map(b => (
                                            <option key={b.id} value={b.id}>{b.firstName} {b.lastName}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div className="space-y-3">
                                <Label htmlFor="productId" className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Product Template</Label>
                                <div className="relative group">
                                    <Package className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={18} />
                                    <select
                                        id="productId"
                                        className="w-full h-14 pl-12 pr-6 rounded-2xl border border-slate-200/50 bg-white font-bold text-sm appearance-none focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all cursor-pointer"
                                        value={formData.productId}
                                        onChange={e => handleProductChange(e.target.value)}
                                    >
                                        <option value="">Manual Logical Entry</option>
                                        {products.map(p => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* Financial Parameters */}
                        <div className="p-8 glass bg-slate-50/50 rounded-[2rem] border border-slate-100/50 grid grid-cols-1 md:grid-cols-3 gap-8">
                            <div className="space-y-3">
                                <Label htmlFor="principal" className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Principal (USD)</Label>
                                <div className="relative group">
                                    <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={18} />
                                    <Input
                                        id="principal"
                                        type="number"
                                        step="0.01"
                                        className="h-14 pl-12 pr-6 rounded-2xl border-slate-200/50 bg-white shadow-sm focus:ring-4 focus:ring-indigo-500/10 transition-all font-black text-lg"
                                        value={formData.principal}
                                        onChange={e => setFormData({ ...formData, principal: e.target.value })}
                                        required
                                    />
                                </div>
                            </div>
                            <div className="space-y-3">
                                <Label htmlFor="annualInterestRate" className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Logic Rate %</Label>
                                <div className="relative group">
                                    <Percent className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={18} />
                                    <Input
                                        id="annualInterestRate"
                                        type="number"
                                        step="0.01"
                                        className="h-14 pl-12 pr-6 rounded-2xl border-slate-200/50 bg-white shadow-sm focus:ring-4 focus:ring-indigo-500/10 transition-all font-black text-lg text-indigo-600"
                                        value={formData.annualInterestRate}
                                        onChange={e => setFormData({ ...formData, annualInterestRate: e.target.value })}
                                        required
                                    />
                                </div>
                            </div>
                            <div className="space-y-3">
                                <Label htmlFor="termMonths" className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Duration (Months)</Label>
                                <div className="relative group">
                                    <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={18} />
                                    <Input
                                        id="termMonths"
                                        type="number"
                                        className="h-14 pl-12 pr-6 rounded-2xl border-slate-200/50 bg-white shadow-sm focus:ring-4 focus:ring-indigo-500/10 transition-all font-black text-lg"
                                        value={formData.termMonths}
                                        onChange={e => setFormData({ ...formData, termMonths: e.target.value })}
                                        required
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Schedule Logic */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-3">
                                <Label htmlFor="startDate" className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Origination Date</Label>
                                <Input
                                    id="startDate"
                                    type="date"
                                    className="h-14 px-6 rounded-2xl border-slate-200/50 bg-white shadow-sm focus:ring-4 focus:ring-indigo-500/10 transition-all font-bold"
                                    value={formData.startDate}
                                    onChange={e => setFormData({ ...formData, startDate: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="space-y-3">
                                <Label htmlFor="interestMethod" className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">Calculation Method</Label>
                                <div className="relative group">
                                    <Settings2 className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={18} />
                                    <select
                                        id="interestMethod"
                                        className="w-full h-14 pl-12 pr-6 rounded-2xl border border-slate-200/50 bg-white font-black text-xs uppercase tracking-[0.1em] appearance-none focus:outline-none focus:ring-4 focus:ring-indigo-500/10 transition-all cursor-pointer"
                                        value={formData.interestMethod}
                                        onChange={e => setFormData({ ...formData, interestMethod: e.target.value })}
                                        required
                                    >
                                        <option value="FLAT">Flat Logical Amortization</option>
                                        <option value="REDUCING_BALANCE">Reducing Balance Protocol</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* Governance (Collateral & Guarantors) */}
                        <div className="pt-6">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-sm font-black text-slate-900 uppercase tracking-[0.2em] flex items-center gap-2">
                                    <ShieldCheck size={18} className="text-indigo-600" /> System Governance & Security
                                </h3>
                                <div className="flex gap-3">
                                    <Button type="button" variant="secondary" size="sm" onClick={addCollateral} className="rounded-xl font-black text-[10px] uppercase tracking-widest px-4 h-9 shadow-sm">+ Collateral</Button>
                                    <Button type="button" variant="secondary" size="sm" onClick={addGuarantor} className="rounded-xl font-black text-[10px] uppercase tracking-widest px-4 h-9 shadow-sm">+ Guarantor</Button>
                                </div>
                            </div>

                            <div className="space-y-4">
                                {formData.collaterals.map((c, i) => (
                                    <div key={i} className="p-5 glass bg-white/50 border border-slate-100/50 rounded-2xl flex flex-col md:flex-row gap-4 items-center animate-in slide-in-from-right-4 duration-300">
                                        <div className="w-full md:w-32 flex flex-col items-center md:items-start">
                                            <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest mb-1">Asset #{i + 1}</span>
                                            <div className="text-[10px] font-black text-slate-400 uppercase">Collateral</div>
                                        </div>
                                        <select className="flex-1 h-11 px-4 border-slate-200/50 rounded-xl text-xs font-bold uppercase tracking-widest bg-white" value={c.type} onChange={e => {
                                            const next = [...formData.collaterals];
                                            next[i].type = e.target.value;
                                            setFormData({ ...formData, collaterals: next });
                                        }}>
                                            <option value="LAND_TITLE">Land Title Matrix</option>
                                            <option value="VEHICLE">Automotive Asset</option>
                                            <option value="GOLD">Commodity (Gold)</option>
                                            <option value="ID_CARD">Personal Identifier</option>
                                            <option value="OTHER">Diversified Asset</option>
                                        </select>
                                        <Input placeholder="Market Value (USD)" type="number" className="flex-1 h-11 px-4 border-slate-200/50 rounded-xl font-black" value={c.value} onChange={e => {
                                            const next = [...formData.collaterals];
                                            next[i].value = e.target.value;
                                            setFormData({ ...formData, collaterals: next });
                                        }} />
                                        <Button type="button" size="icon" variant="ghost" className="text-rose-500 hover:bg-rose-50 rounded-xl" onClick={() => {
                                            const next = [...formData.collaterals];
                                            next.splice(i, 1);
                                            setFormData({ ...formData, collaterals: next });
                                        }}><Trash2 size={16} /></Button>
                                    </div>
                                ))}

                                {formData.guarantors.map((g, i) => (
                                    <div key={i} className="p-5 glass bg-indigo-50/50 border border-indigo-100/50 rounded-2xl flex flex-col md:flex-row gap-4 items-center animate-in slide-in-from-right-4 duration-300">
                                        <div className="w-full md:w-32 flex flex-col items-center md:items-start">
                                            <span className="text-[9px] font-black text-indigo-600 uppercase tracking-widest mb-1">Entity #{i + 1}</span>
                                            <div className="text-[10px] font-black text-indigo-400 uppercase">Guarantor</div>
                                        </div>
                                        <Input placeholder="Legal Identity Name" className="flex-1 h-11 px-4 border-indigo-100/50 rounded-xl font-bold bg-white" value={g.name} onChange={e => {
                                            const next = [...formData.guarantors];
                                            next[i].name = e.target.value;
                                            setFormData({ ...formData, guarantors: next });
                                        }} />
                                        <Input placeholder="Verified Phone Num" className="flex-1 h-11 px-4 border-indigo-100/50 rounded-xl font-bold bg-white" value={g.phone} onChange={e => {
                                            const next = [...formData.guarantors];
                                            next[i].phone = e.target.value;
                                            setFormData({ ...formData, guarantors: next });
                                        }} />
                                        <Button type="button" size="icon" variant="ghost" className="text-rose-500 hover:bg-rose-50 rounded-xl" onClick={() => {
                                            const next = [...formData.guarantors];
                                            next.splice(i, 1);
                                            setFormData({ ...formData, guarantors: next });
                                        }}><Trash2 size={16} /></Button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 pt-6 border-t border-slate-100/50">
                            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="h-12 rounded-xl font-bold px-8">
                                Dismiss
                            </Button>
                            <Button type="submit" disabled={loading} className="h-12 rounded-xl bg-slate-950 hover:bg-slate-800 text-white font-black text-xs uppercase tracking-widest px-10 shadow-xl shadow-slate-950/20 active:scale-[0.98]">
                                {loading ? <Activity className="animate-spin mr-2" size={16} /> : <FilePlus className="mr-2" size={16} />}
                                {loading ? 'Committing...' : 'Originate Loan Instrument'}
                            </Button>
                        </div>
                    </form>
                </div>
            </DialogContent>
        </Dialog>
    );
}
