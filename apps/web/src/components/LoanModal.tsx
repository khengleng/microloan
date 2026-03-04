"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Trash2, Loader2, Plus, ShieldCheck } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import api from "@/lib/api";

interface LoanModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
}
interface Borrower { id: string; firstName: string; lastName: string; }
interface LoanProduct {
    id: string; name: string; interestMethod: string;
    policies: Array<{ interestRate: number; minTermMonths: number; maxTermMonths: number; }>;
}

const fieldCls = "w-full h-9 px-3 bg-white border border-border rounded text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors";
const labelCls = "block text-sm font-medium text-foreground mb-1";
const selectCls = `${fieldCls} appearance-none`;

export function LoanModal({ open, onOpenChange, onSuccess }: LoanModalProps) {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(false);
    const [borrowers, setBorrowers] = useState<Borrower[]>([]);
    const [products, setProducts] = useState<LoanProduct[]>([]);
    const [formData, setFormData] = useState({
        borrowerId: '', productId: '', principal: '',
        annualInterestRate: '', termMonths: '',
        startDate: new Date().toISOString().split('T')[0],
        interestMethod: 'FLAT',
        collaterals: [] as any[],
        guarantors: [] as any[]
    });

    const [fetchError, setFetchError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setFetchError(null);
            Promise.all([api.get('/borrowers'), api.get('/loan-products')])
                .then(([bRes, pRes]) => {
                    setBorrowers(bRes.data);
                    setProducts(pRes.data);
                })
                .catch((err) => {
                    const status = err.response?.status;
                    if (status === 403) {
                        setFetchError('You do not have permission to create loans. Contact your administrator.');
                    } else {
                        setFetchError('Failed to load loan form data. Please try again.');
                    }
                });
        }
    }, [open]);

    const handleProductChange = (productId: string) => {
        const product = products.find(p => p.id === productId);
        if (product) {
            setFormData({
                ...formData, productId,
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
                borrowerId: '', productId: '', principal: '',
                annualInterestRate: '', termMonths: '',
                startDate: new Date().toISOString().split('T')[0],
                interestMethod: 'FLAT', collaterals: [], guarantors: []
            });
        } catch (error: any) {
            const msg = error.response?.data?.message || 'Failed to create loan';
            showToast(Array.isArray(msg) ? msg[0] : msg, 'error');
        } finally {
            setLoading(false);
        }
    };

    const addCollateral = () => setFormData({
        ...formData, collaterals: [...formData.collaterals, { type: 'LAND_TITLE', description: '', value: '0', idNumber: '' }]
    });
    const addGuarantor = () => setFormData({
        ...formData, guarantors: [...formData.guarantors, { name: '', phone: '', relation: '', idNumber: '' }]
    });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-white border border-border rounded-lg p-0 shadow-lg overflow-x-hidden">
                {/* Header */}
                <div className="px-6 py-4 border-b border-border sticky top-0 bg-white z-10">
                    <DialogTitle className="text-base font-bold text-foreground">New Loan</DialogTitle>
                    <DialogDescription className="text-sm text-muted-foreground mt-0.5">Fill in the details to originate a new loan for a borrower.</DialogDescription>
                </div>

                {fetchError ? (
                    <div className="px-6 py-8 text-center space-y-3">
                        <p className="text-sm text-destructive font-medium">{fetchError}</p>
                        <button type="button" onClick={() => onOpenChange(false)} className="btn-ghost text-sm">Close</button>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit}>
                        <div className="px-6 py-5 space-y-5">
                            {/* Borrower + Product */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="borrowerId" className={labelCls}>Borrower <span className="text-destructive">*</span></label>
                                    <select id="borrowerId" className={selectCls} value={formData.borrowerId} onChange={e => setFormData({ ...formData, borrowerId: e.target.value })} required>
                                        <option value="">Select borrower...</option>
                                        {borrowers.map(b => <option key={b.id} value={b.id}>{b.firstName} {b.lastName}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label htmlFor="productId" className={labelCls}>Loan Product <span className="text-muted-foreground text-xs">(optional)</span></label>
                                    <select id="productId" className={selectCls} value={formData.productId} onChange={e => handleProductChange(e.target.value)}>
                                        <option value="">Manual / custom parameters</option>
                                        {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                    </select>
                                </div>
                            </div>

                            {/* Financial Parameters */}
                            <div className="p-4 bg-muted rounded border border-border grid grid-cols-1 md:grid-cols-3 gap-4">
                                <div>
                                    <label htmlFor="principal" className={labelCls}>Principal (USD) <span className="text-destructive">*</span></label>
                                    <input id="principal" type="number" step="0.01" min="0" className={fieldCls} placeholder="0.00" value={formData.principal} onChange={e => setFormData({ ...formData, principal: e.target.value })} required />
                                </div>
                                <div>
                                    <label htmlFor="annualInterestRate" className={labelCls}>Annual Interest Rate (%) <span className="text-destructive">*</span></label>
                                    <input id="annualInterestRate" type="number" step="0.01" min="0" className={fieldCls} placeholder="0.00" value={formData.annualInterestRate} onChange={e => setFormData({ ...formData, annualInterestRate: e.target.value })} required />
                                </div>
                                <div>
                                    <label htmlFor="termMonths" className={labelCls}>Term (months) <span className="text-destructive">*</span></label>
                                    <input id="termMonths" type="number" min="1" className={fieldCls} placeholder="12" value={formData.termMonths} onChange={e => setFormData({ ...formData, termMonths: e.target.value })} required />
                                </div>
                            </div>

                            {/* Schedule */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="startDate" className={labelCls}>Start Date <span className="text-destructive">*</span></label>
                                    <input id="startDate" type="date" className={fieldCls} value={formData.startDate} onChange={e => setFormData({ ...formData, startDate: e.target.value })} required />
                                </div>
                                <div>
                                    <label htmlFor="interestMethod" className={labelCls}>Interest Method <span className="text-destructive">*</span></label>
                                    <select id="interestMethod" className={selectCls} value={formData.interestMethod} onChange={e => setFormData({ ...formData, interestMethod: e.target.value })} required>
                                        <option value="FLAT">Flat Rate</option>
                                        <option value="REDUCING_BALANCE">Reducing Balance</option>
                                    </select>
                                </div>
                            </div>

                            {/* Collaterals */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-semibold text-foreground">Collaterals</span>
                                    <button type="button" onClick={addCollateral} className="btn-ghost text-xs px-3 py-1 h-auto">
                                        <Plus size={13} /> Add
                                    </button>
                                </div>
                                {formData.collaterals.length === 0 && (
                                    <p className="text-sm text-muted-foreground py-2">No collaterals added.</p>
                                )}
                                <div className="space-y-2">
                                    {formData.collaterals.map((c, i) => (
                                        <div key={i} className="flex gap-2 items-center p-3 bg-muted rounded border border-border">
                                            <span className="text-xs text-muted-foreground w-5 text-center">{i + 1}</span>
                                            <select className={`${selectCls} flex-1`} value={c.type} onChange={e => {
                                                const next = [...formData.collaterals]; next[i].type = e.target.value;
                                                setFormData({ ...formData, collaterals: next });
                                            }}>
                                                <option value="LAND_TITLE">Land Title</option>
                                                <option value="VEHICLE">Vehicle</option>
                                                <option value="GOLD">Gold</option>
                                                <option value="ID_CARD">ID Card</option>
                                                <option value="OTHER">Other</option>
                                            </select>
                                            <input type="number" placeholder="Value (USD)" className={`${fieldCls} flex-1`} value={c.value} onChange={e => {
                                                const next = [...formData.collaterals]; next[i].value = e.target.value;
                                                setFormData({ ...formData, collaterals: next });
                                            }} />
                                            <button type="button" onClick={() => {
                                                const next = [...formData.collaterals]; next.splice(i, 1);
                                                setFormData({ ...formData, collaterals: next });
                                            }} className="text-destructive hover:text-destructive/80 p-1">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Guarantors */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-sm font-semibold text-foreground">Guarantors</span>
                                    <button type="button" onClick={addGuarantor} className="btn-ghost text-xs px-3 py-1 h-auto">
                                        <Plus size={13} /> Add
                                    </button>
                                </div>
                                {formData.guarantors.length === 0 && (
                                    <p className="text-sm text-muted-foreground py-2">No guarantors added.</p>
                                )}
                                <div className="space-y-2">
                                    {formData.guarantors.map((g, i) => (
                                        <div key={i} className="flex gap-2 items-center p-3 bg-muted rounded border border-border">
                                            <span className="text-xs text-muted-foreground w-5 text-center">{i + 1}</span>
                                            <input placeholder="Full name" className={`${fieldCls} flex-1`} value={g.name} onChange={e => {
                                                const next = [...formData.guarantors]; next[i].name = e.target.value;
                                                setFormData({ ...formData, guarantors: next });
                                            }} />
                                            <input placeholder="Phone" className={`${fieldCls} flex-1`} value={g.phone} onChange={e => {
                                                const next = [...formData.guarantors]; next[i].phone = e.target.value;
                                                setFormData({ ...formData, guarantors: next });
                                            }} />
                                            <button type="button" onClick={() => {
                                                const next = [...formData.guarantors]; next.splice(i, 1);
                                                setFormData({ ...formData, guarantors: next });
                                            }} className="text-destructive hover:text-destructive/80 p-1">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="px-6 py-4 border-t border-border bg-muted/40 flex justify-end gap-2">
                            <button type="button" onClick={() => onOpenChange(false)} className="btn-ghost">Cancel</button>
                            <button type="submit" disabled={loading} className="btn-primary">
                                {loading && <Loader2 size={14} className="animate-spin" />}
                                {loading ? 'Creating...' : 'Create Loan'}
                            </button>
                        </div>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}
