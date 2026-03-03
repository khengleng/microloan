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
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto rounded-[32px] border-border bg-card/90 backdrop-blur-2xl p-0 shadow-2xl no-scrollbar font-sans border shadow-[0_0_50px_rgba(0,0,0,0.5)]">
                <div className="p-10 space-y-10">
                    <DialogHeader>
                        <DialogTitle className="text-3xl font-black text-foreground tracking-tighter flex items-center gap-4">
                            <div className="p-3 bg-primary/10 rounded-2xl">
                                <FilePlus className="text-primary" size={32} />
                            </div>
                            Capital <span className="text-primary italic">Disbursement</span>
                        </DialogTitle>
                        <DialogDescription className="text-muted-foreground font-bold text-[15px]">
                            Originate a new financial instrument and bind it to a validated digital client identity node.
                        </DialogDescription>
                    </DialogHeader>

                    <form onSubmit={handleSubmit} className="space-y-12">
                        {/* Primary Configuration */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-4">
                                <Label htmlFor="borrowerId" className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em] ml-2">Target Identity</Label>
                                <div className="relative group">
                                    <User className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" size={20} />
                                    <select
                                        id="borrowerId"
                                        className="w-full h-16 pl-14 pr-8 rounded-2xl border border-border/50 bg-background/50 font-black text-[14px] appearance-none focus:outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all cursor-pointer text-foreground"
                                        value={formData.borrowerId}
                                        onChange={e => setFormData({ ...formData, borrowerId: e.target.value })}
                                        required
                                    >
                                        <option value="" className="bg-card">Select Identity Node</option>
                                        {borrowers.map(b => (
                                            <option key={b.id} value={b.id} className="bg-card font-bold">{b.firstName} {b.lastName}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            <div className="space-y-4">
                                <Label htmlFor="productId" className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em] ml-2">Product Protocol</Label>
                                <div className="relative group">
                                    <Package className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" size={20} />
                                    <select
                                        id="productId"
                                        className="w-full h-16 pl-14 pr-8 rounded-2xl border border-border/50 bg-background/50 font-black text-[14px] appearance-none focus:outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all cursor-pointer text-foreground"
                                        value={formData.productId}
                                        onChange={e => handleProductChange(e.target.value)}
                                    >
                                        <option value="" className="bg-card">Manual Parameter Overload</option>
                                        {products.map(p => (
                                            <option key={p.id} value={p.id} className="bg-card font-bold">{p.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* Financial Parameters */}
                        <div className="p-8 bg-background/50 rounded-[32px] border border-border/50 grid grid-cols-1 md:grid-cols-3 gap-8 shadow-inner">
                            <div className="space-y-4">
                                <Label htmlFor="principal" className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em] ml-2">Principal USD</Label>
                                <div className="relative group">
                                    <DollarSign className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" size={20} />
                                    <Input
                                        id="principal"
                                        type="number"
                                        step="0.01"
                                        className="h-16 pl-14 pr-8 rounded-2xl border-border/50 bg-card/50 shadow-sm focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all font-black text-xl text-foreground"
                                        value={formData.principal}
                                        onChange={e => setFormData({ ...formData, principal: e.target.value })}
                                        required
                                    />
                                </div>
                            </div>
                            <div className="space-y-4">
                                <Label htmlFor="annualInterestRate" className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em] ml-2">Annual Rate %</Label>
                                <div className="relative group">
                                    <Percent className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" size={20} />
                                    <Input
                                        id="annualInterestRate"
                                        type="number"
                                        step="0.01"
                                        className="h-16 pl-14 pr-8 rounded-2xl border-border/50 bg-card/50 shadow-sm focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all font-black text-xl text-primary"
                                        value={formData.annualInterestRate}
                                        onChange={e => setFormData({ ...formData, annualInterestRate: e.target.value })}
                                        required
                                    />
                                </div>
                            </div>
                            <div className="space-y-4">
                                <Label htmlFor="termMonths" className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em] ml-2">Term (Months)</Label>
                                <div className="relative group">
                                    <Calendar className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" size={20} />
                                    <Input
                                        id="termMonths"
                                        type="number"
                                        className="h-16 pl-14 pr-8 rounded-2xl border-border/50 bg-card/50 shadow-sm focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all font-black text-xl text-foreground"
                                        value={formData.termMonths}
                                        onChange={e => setFormData({ ...formData, termMonths: e.target.value })}
                                        required
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Schedule Logic */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-4">
                                <Label htmlFor="startDate" className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em] ml-2">Origination Date</Label>
                                <Input
                                    id="startDate"
                                    type="date"
                                    className="h-16 px-6 rounded-2xl border-border/50 bg-card/50 shadow-sm focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all font-black text-foreground"
                                    value={formData.startDate}
                                    onChange={e => setFormData({ ...formData, startDate: e.target.value })}
                                    required
                                />
                            </div>
                            <div className="space-y-4">
                                <Label htmlFor="interestMethod" className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em] ml-2">Logic Model</Label>
                                <div className="relative group">
                                    <Settings2 className="absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" size={20} />
                                    <select
                                        id="interestMethod"
                                        className="w-full h-16 pl-14 pr-8 rounded-2xl border border-border/50 bg-card/50 font-black text-xs uppercase tracking-[0.2em] appearance-none focus:outline-none focus:ring-4 focus:ring-primary/10 focus:border-primary transition-all cursor-pointer text-foreground"
                                        value={formData.interestMethod}
                                        onChange={e => setFormData({ ...formData, interestMethod: e.target.value })}
                                        required
                                    >
                                        <option value="FLAT" className="bg-card">Flat Amortization</option>
                                        <option value="REDUCING_BALANCE" className="bg-card">Reducing Balance</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* Governance (Collateral & Guarantors) */}
                        <div className="space-y-8">
                            <div className="flex justify-between items-end border-b border-border/50 pb-4">
                                <h3 className="text-[13px] font-black text-foreground uppercase tracking-[0.2em] flex items-center gap-3">
                                    <div className="w-8 h-8 bg-emerald-400/10 rounded-lg flex items-center justify-center">
                                        <ShieldCheck size={18} className="text-emerald-400" />
                                    </div>
                                    Risk Mitigation Assets
                                </h3>
                                <div className="flex gap-3">
                                    <Button type="button" variant="outline" size="sm" onClick={addCollateral} className="rounded-xl font-black text-[10px] uppercase tracking-widest px-4 h-10 border-border/50 hover:bg-primary/10 hover:text-primary hover:border-primary/50 transition-all">+ Collateral</Button>
                                    <Button type="button" variant="outline" size="sm" onClick={addGuarantor} className="rounded-xl font-black text-[10px] uppercase tracking-widest px-4 h-10 border-border/50 hover:bg-primary/10 hover:text-primary hover:border-primary/50 transition-all">+ Guarantor</Button>
                                </div>
                            </div>

                            <div className="space-y-6">
                                {formData.collaterals.map((c, i) => (
                                    <div key={i} className="p-6 bg-white/[0.02] border border-border/50 rounded-2xl flex flex-col md:flex-row gap-6 items-center animate-in slide-in-from-right-4 duration-500">
                                        <div className="flex items-center gap-4 w-full md:w-auto">
                                            <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center text-primary text-xs font-black">#{i + 1}</div>
                                            <span className="text-[11px] font-black text-muted-foreground uppercase tracking-widest">Asset</span>
                                        </div>
                                        <select className="flex-1 h-14 px-5 border-border/50 rounded-2xl text-[13px] font-black uppercase tracking-widest bg-card/50 text-foreground" value={c.type} onChange={e => {
                                            const next = [...formData.collaterals];
                                            next[i].type = e.target.value;
                                            setFormData({ ...formData, collaterals: next });
                                        }}>
                                            <option value="LAND_TITLE" className="bg-card">Land Title Matrix</option>
                                            <option value="VEHICLE" className="bg-card">Automotive Asset</option>
                                            <option value="GOLD" className="bg-card">Commodity (Gold)</option>
                                            <option value="ID_CARD" className="bg-card">Identity Key</option>
                                            <option value="OTHER" className="bg-card">Misc Asset</option>
                                        </select>
                                        <Input placeholder="Asset Value (USD)" type="number" className="flex-1 h-14 px-5 border-border/50 rounded-2xl font-black bg-card/50 text-foreground" value={c.value} onChange={e => {
                                            const next = [...formData.collaterals];
                                            next[i].value = e.target.value;
                                            setFormData({ ...formData, collaterals: next });
                                        }} />
                                        <Button type="button" size="icon" variant="ghost" className="text-destructive hover:bg-destructive/10 rounded-xl" onClick={() => {
                                            const next = [...formData.collaterals];
                                            next.splice(i, 1);
                                            setFormData({ ...formData, collaterals: next });
                                        }}><Trash2 size={20} /></Button>
                                    </div>
                                ))}

                                {formData.guarantors.map((g, i) => (
                                    <div key={i} className="p-6 bg-primary/5 border border-primary/20 rounded-2xl flex flex-col md:flex-row gap-6 items-center animate-in slide-in-from-right-4 duration-500">
                                        <div className="flex items-center gap-4 w-full md:w-auto">
                                            <div className="w-10 h-10 bg-primary/20 rounded-xl flex items-center justify-center text-primary text-xs font-black">#{i + 1}</div>
                                            <span className="text-[11px] font-black text-primary uppercase tracking-widest">Co-Signer</span>
                                        </div>
                                        <Input placeholder="Full Legal Name" className="flex-1 h-14 px-5 border-primary/20 rounded-2xl font-black bg-card/50 text-foreground" value={g.name} onChange={e => {
                                            const next = [...formData.guarantors];
                                            next[i].name = e.target.value;
                                            setFormData({ ...formData, guarantors: next });
                                        }} />
                                        <Input placeholder="Validated Phone" className="flex-1 h-14 px-5 border-primary/20 rounded-2xl font-black bg-card/50 text-foreground" value={g.phone} onChange={e => {
                                            const next = [...formData.guarantors];
                                            next[i].phone = e.target.value;
                                            setFormData({ ...formData, guarantors: next });
                                        }} />
                                        <Button type="button" size="icon" variant="ghost" className="text-destructive hover:bg-destructive/10 rounded-xl" onClick={() => {
                                            const next = [...formData.guarantors];
                                            next.splice(i, 1);
                                            setFormData({ ...formData, guarantors: next });
                                        }}><Trash2 size={20} /></Button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="flex justify-end gap-4 pt-10 border-t border-border/50">
                            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="h-14 rounded-2xl font-black px-10 text-muted-foreground hover:text-foreground hover:bg-border/20 uppercase tracking-widest text-[13px]">
                                Abort
                            </Button>
                            <Button type="submit" disabled={loading} className="premium-button h-16 px-12 group uppercase tracking-[0.2em] text-[13px]">
                                {loading ? <Activity className="animate-spin mr-3" size={20} /> : <FilePlus className="mr-3 group-hover:scale-110 transition-transform" size={20} />}
                                {loading ? 'Binding Instrument...' : 'Commit Origination'}
                            </Button>
                        </div>
                    </form>
                </div>
            </DialogContent>
        </Dialog>
    );
}
