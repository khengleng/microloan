"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>{t('add_new')}</DialogTitle>
                    <DialogDescription className="sr-only">
                        Create a new loan application.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="borrowerId">{t('borrower')}</Label>
                            <select
                                id="borrowerId"
                                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                value={formData.borrowerId}
                                onChange={e => setFormData({ ...formData, borrowerId: e.target.value })}
                                required
                            >
                                <option value="">Select Borrower</option>
                                {borrowers.map(b => (
                                    <option key={b.id} value={b.id}>{b.firstName} {b.lastName}</option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="productId">Loan Product</Label>
                            <select
                                id="productId"
                                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                value={formData.productId}
                                onChange={e => handleProductChange(e.target.value)}
                            >
                                <option value="">Manual Entry (No Template)</option>
                                {products.map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="principal">{t('principal')}</Label>
                            <Input
                                id="principal"
                                type="number"
                                step="0.01"
                                value={formData.principal}
                                onChange={e => setFormData({ ...formData, principal: e.target.value })}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="annualInterestRate">{t('interest_rate')}</Label>
                            <Input
                                id="annualInterestRate"
                                type="number"
                                step="0.01"
                                value={formData.annualInterestRate}
                                onChange={e => setFormData({ ...formData, annualInterestRate: e.target.value })}
                                required
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="termMonths">{t('term')}</Label>
                            <Input
                                id="termMonths"
                                type="number"
                                value={formData.termMonths}
                                onChange={e => setFormData({ ...formData, termMonths: e.target.value })}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="startDate">{t('start_date')}</Label>
                            <Input
                                id="startDate"
                                type="date"
                                value={formData.startDate}
                                onChange={e => setFormData({ ...formData, startDate: e.target.value })}
                                required
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="interestMethod">{t('method')}</Label>
                        <select
                            id="interestMethod"
                            className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            value={formData.interestMethod}
                            onChange={e => setFormData({ ...formData, interestMethod: e.target.value })}
                            required
                        >
                            <option value="FLAT">{t('flat')}</option>
                            <option value="REDUCING_BALANCE">{t('reducing_balance')}</option>
                        </select>
                    </div>

                    <div className="border-t border-slate-100 pt-4 mt-6">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Collateral & Guarantors</h3>
                            <div className="flex gap-2">
                                <Button type="button" variant="outline" size="sm" onClick={addCollateral} className="text-xs">+ Collateral</Button>
                                <Button type="button" variant="outline" size="sm" onClick={addGuarantor} className="text-xs">+ Guarantor</Button>
                            </div>
                        </div>

                        {formData.collaterals.map((c, i) => (
                            <div key={i} className="bg-slate-50 p-3 rounded-lg border border-slate-200 mb-3 grid grid-cols-2 gap-3 animate-in fade-in slide-in-from-top-1">
                                <div className="col-span-2 flex justify-between">
                                    <span className="text-[10px] font-bold text-slate-500 uppercase">Collateral #{i + 1}</span>
                                    <button type="button" onClick={() => {
                                        const next = [...formData.collaterals];
                                        next.splice(i, 1);
                                        setFormData({ ...formData, collaterals: next });
                                    }} className="text-red-500 text-[10px] font-bold">REMOVE</button>
                                </div>
                                <select className="text-sm border-slate-200 rounded p-1" value={c.type} onChange={e => {
                                    const next = [...formData.collaterals];
                                    next[i].type = e.target.value;
                                    setFormData({ ...formData, collaterals: next });
                                }}>
                                    <option value="LAND_TITLE">Land Title</option>
                                    <option value="VEHICLE">Vehicle</option>
                                    <option value="GOLD">Gold</option>
                                    <option value="ID_CARD">ID Card</option>
                                    <option value="OTHER">Other</option>
                                </select>
                                <Input placeholder="Value (USD)" type="number" value={c.value} onChange={e => {
                                    const next = [...formData.collaterals];
                                    next[i].value = e.target.value;
                                    setFormData({ ...formData, collaterals: next });
                                }} />
                                <Input placeholder="Description" className="col-span-2" value={c.description} onChange={e => {
                                    const next = [...formData.collaterals];
                                    next[i].description = e.target.value;
                                    setFormData({ ...formData, collaterals: next });
                                }} />
                            </div>
                        ))}

                        {formData.guarantors.map((g, i) => (
                            <div key={i} className="bg-blue-50 p-3 rounded-lg border border-blue-100 mb-3 grid grid-cols-2 gap-3 animate-in fade-in slide-in-from-top-1">
                                <div className="col-span-2 flex justify-between">
                                    <span className="text-[10px] font-bold text-blue-500 uppercase">Guarantor #{i + 1}</span>
                                    <button type="button" onClick={() => {
                                        const next = [...formData.guarantors];
                                        next.splice(i, 1);
                                        setFormData({ ...formData, guarantors: next });
                                    }} className="text-red-500 text-[10px] font-bold">REMOVE</button>
                                </div>
                                <Input placeholder="Full Name" value={g.name} onChange={e => {
                                    const next = [...formData.guarantors];
                                    next[i].name = e.target.value;
                                    setFormData({ ...formData, guarantors: next });
                                }} />
                                <Input placeholder="Phone Number" value={g.phone} onChange={e => {
                                    const next = [...formData.guarantors];
                                    next[i].phone = e.target.value;
                                    setFormData({ ...formData, guarantors: next });
                                }} />
                            </div>
                        ))}
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={loading}>
                            {loading ? 'Issuing...' : t('add_new')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
