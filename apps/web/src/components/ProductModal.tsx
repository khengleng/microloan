import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, Package, ShieldCheck, Zap, ChevronDown, Loader2 } from 'lucide-react';
import api from '@/lib/api';

interface LoanPolicy {
    id?: string;
    creditRating: string;
    interestRate: number;
    minTermMonths?: number;
    maxTermMonths?: number;
    minPrincipal?: number;
    maxPrincipal?: number;
}

interface ProductModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSuccess: () => void;
    productToEdit: any | null;
}

export function ProductModal({ open, onOpenChange, onSuccess, productToEdit }: ProductModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [interestMethod, setInterestMethod] = useState('FLAT');
    const [isActive, setIsActive] = useState(true);
    const [policies, setPolicies] = useState<LoanPolicy[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            if (productToEdit) {
                setName(productToEdit.name);
                setDescription(productToEdit.description || '');
                setInterestMethod(productToEdit.interestMethod);
                setIsActive(productToEdit.isActive);
                setPolicies(productToEdit.policies || []);
            } else {
                setName('');
                setDescription('');
                setInterestMethod('FLAT');
                setIsActive(true);
                setPolicies([]);
            }
            setError(null);
        }
    }, [open, productToEdit]);

    const handleAddPolicy = () => {
        setPolicies([...policies, {
            creditRating: 'NEW',
            interestRate: 10,
            minTermMonths: 1,
            maxTermMonths: 36,
            minPrincipal: 100,
            maxPrincipal: 10000
        }]);
    };

    const handleRemovePolicy = (index: number) => {
        setPolicies(policies.filter((_, i) => i !== index));
    };

    const handlePolicyChange = (index: number, field: keyof LoanPolicy, value: any) => {
        const newPolicies = [...policies];
        newPolicies[index] = { ...newPolicies[index], [field]: value };
        setPolicies(newPolicies);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const payload = {
                name,
                description,
                interestMethod,
                isActive,
                policies: policies.map(p => ({
                    creditRating: p.creditRating,
                    interestRate: Number(p.interestRate),
                    minTermMonths: p.minTermMonths ? Number(p.minTermMonths) : undefined,
                    maxTermMonths: p.maxTermMonths ? Number(p.maxTermMonths) : undefined,
                    minPrincipal: p.minPrincipal ? Number(p.minPrincipal) : undefined,
                    maxPrincipal: p.maxPrincipal ? Number(p.maxPrincipal) : undefined,
                }))
            };

            if (productToEdit) {
                await api.put(`/loan-products/${productToEdit.id}`, payload);
            } else {
                await api.post('/loan-products', payload);
            }
            onSuccess();
            onOpenChange(false);
        } catch (err: any) {
            console.error('Failed to save product', err);
            setError(err.response?.data?.message || 'An error occurred while saving.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto rounded-[2.5rem] border-none glass p-0 shadow-2xl">
                <div className="p-8 space-y-8">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                            <Package className="text-indigo-600" size={28} /> {productToEdit ? 'Configure Product Engine' : 'Engine New Credit Product'}
                        </DialogTitle>
                        <DialogDescription className="text-slate-500 font-medium">
                            Architect the automated financial logic and credit limit matrices for your organization.
                        </DialogDescription>
                    </DialogHeader>

                    <form onSubmit={handleSubmit} className="space-y-8">
                        {error && (
                            <div className="bg-rose-50 border border-rose-100/50 text-rose-600 p-4 rounded-2xl text-[11px] font-black uppercase tracking-widest animate-in shake duration-500">
                                Logic Failure: {error}
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-2">
                                <Label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Product Descriptor</Label>
                                <Input
                                    required
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="e.g. Enterprise Daily Liquidity"
                                    className="h-12 rounded-xl border-slate-200/50 focus:ring-4 focus:ring-indigo-500/10 font-bold px-4"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Strategic Summary</Label>
                                <Input
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    placeholder="Short description for internal ops"
                                    className="h-12 rounded-xl border-slate-200/50 focus:ring-4 focus:ring-indigo-500/10 font-bold px-4"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Calculation Engine</Label>
                                <div className="relative">
                                    <select
                                        required
                                        className="w-full h-12 rounded-xl border border-slate-200/50 focus:ring-4 focus:ring-indigo-500/10 bg-white px-4 text-xs font-black uppercase tracking-widest appearance-none cursor-pointer"
                                        value={interestMethod}
                                        onChange={(e) => setInterestMethod(e.target.value)}
                                    >
                                        <option value="FLAT">Flat Logical Rate</option>
                                        <option value="REDUCING_BALANCE">Reducing Balance Engine</option>
                                    </select>
                                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
                                </div>
                            </div>
                            <div className="space-y-2 flex items-center pt-6">
                                <label className="flex items-center gap-3 cursor-pointer group">
                                    <div className="relative">
                                        <input
                                            type="checkbox"
                                            checked={isActive}
                                            onChange={(e) => setIsActive(e.target.checked)}
                                            className="sr-only peer"
                                        />
                                        <div className="w-11 h-6 bg-slate-200 rounded-full peer peer-focus:ring-4 peer-focus:ring-indigo-500/10 transition-all peer-checked:bg-emerald-500" />
                                        <div className="absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-all peer-checked:translate-x-5 shadow-sm" />
                                    </div>
                                    <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest group-hover:text-slate-900 transition-colors">Deployment Status (Active)</span>
                                </label>
                            </div>
                        </div>

                        <div className="mt-6">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                                    <ShieldCheck size={16} className="text-indigo-600" /> Credit Risk Matrices
                                </h3>
                                <Button type="button" size="sm" variant="secondary" onClick={handleAddPolicy} className="rounded-xl font-bold text-[10px] uppercase tracking-widest px-4 gap-2">
                                    <Plus size={14} /> Add Policy
                                </Button>
                            </div>

                            {policies.length === 0 ? (
                                <div className="text-center p-12 bg-slate-50/50 border border-dashed border-slate-200 rounded-3xl">
                                    <Zap size={32} className="mx-auto text-slate-300 mb-3" strokeWidth={1} />
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Provision at least one risk tier to activate this product.</p>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {policies.map((policy, idx) => (
                                        <div key={idx} className="grid grid-cols-1 lg:grid-cols-6 gap-4 p-5 glass bg-white/50 rounded-2xl border border-slate-100/50 items-center animate-in slide-in-from-right-2 duration-300" style={{ animationDelay: `${idx * 50}ms` }}>
                                            <div className="space-y-2">
                                                <Label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block pl-1">Risk Tier</Label>
                                                <Input
                                                    required
                                                    className="h-10 text-xs font-black uppercase tracking-widest rounded-xl border-slate-200/50"
                                                    value={policy.creditRating}
                                                    onChange={(e) => handlePolicyChange(idx, 'creditRating', e.target.value)}
                                                    placeholder="A+, GOV"
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block pl-1">Rate %</Label>
                                                <Input
                                                    required
                                                    type="number"
                                                    step="0.01"
                                                    className="h-10 text-xs font-black text-indigo-600 rounded-xl border-slate-200/50"
                                                    value={policy.interestRate}
                                                    onChange={(e) => handlePolicyChange(idx, 'interestRate', e.target.value)}
                                                />
                                            </div>
                                            <div className="lg:col-span-1 space-y-2">
                                                <Label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block pl-1">Term (Min-Max)</Label>
                                                <div className="flex gap-2 items-center">
                                                    <Input
                                                        type="number"
                                                        className="h-10 text-xs font-bold rounded-xl border-slate-200/50 px-2"
                                                        value={policy.minTermMonths || ''}
                                                        onChange={(e) => handlePolicyChange(idx, 'minTermMonths', e.target.value)}
                                                        placeholder="1"
                                                    />
                                                    <Input
                                                        type="number"
                                                        className="h-10 text-xs font-bold rounded-xl border-slate-200/50 px-2"
                                                        value={policy.maxTermMonths || ''}
                                                        onChange={(e) => handlePolicyChange(idx, 'maxTermMonths', e.target.value)}
                                                        placeholder="36"
                                                    />
                                                </div>
                                            </div>
                                            <div className="lg:col-span-2 space-y-2">
                                                <Label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block pl-1">Principal (Min-Max) $</Label>
                                                <div className="flex gap-2 items-center">
                                                    <Input
                                                        type="number"
                                                        className="h-10 text-xs font-bold rounded-xl border-slate-200/50 px-2"
                                                        value={policy.minPrincipal || ''}
                                                        onChange={(e) => handlePolicyChange(idx, 'minPrincipal', e.target.value)}
                                                        placeholder="100"
                                                    />
                                                    <Input
                                                        type="number"
                                                        className="h-10 text-xs font-bold rounded-xl border-slate-200/50 px-2"
                                                        value={policy.maxPrincipal || ''}
                                                        onChange={(e) => handlePolicyChange(idx, 'maxPrincipal', e.target.value)}
                                                        placeholder="10000"
                                                    />
                                                </div>
                                            </div>
                                            <div className="flex justify-end lg:justify-center pt-4 lg:pt-0">
                                                <Button type="button" size="icon" variant="secondary" className="text-rose-500 h-10 w-10 rounded-xl hover:bg-rose-50" onClick={() => handleRemovePolicy(idx)}>
                                                    <Trash2 size={16} />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end gap-3 pt-6 border-t border-slate-100/50">
                            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="rounded-xl font-bold h-12 px-6">
                                Dismiss
                            </Button>
                            <Button type="submit" disabled={loading} className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs uppercase tracking-widest h-12 px-8 shadow-lg shadow-indigo-600/20">
                                {loading && <Loader2 className="animate-spin mr-2" size={16} />}
                                {loading ? 'Commiting Logic...' : 'Deploy Product Engine'}
                            </Button>
                        </div>
                    </form>
                </div>
            </DialogContent>
        </Dialog>
    );
}
