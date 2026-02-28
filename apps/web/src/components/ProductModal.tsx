import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2 } from 'lucide-react';
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
            creditRating: 'GOOD',
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
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{productToEdit ? 'Edit Loan Product' : 'Create Loan Product'}</DialogTitle>
                    <DialogDescription>
                        Define the details of the loan product and link its interest rate policies.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-6">
                    {error && (
                        <div className="bg-red-50 text-red-500 p-3 rounded-md text-sm">
                            {error}
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label>Product Name (e.g., Daily Loan)</Label>
                            <Input
                                required
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Name"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Description</Label>
                            <Input
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Short description"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Interest Method</Label>
                            <select
                                required
                                className="w-full border rounded-md p-2 text-sm"
                                value={interestMethod}
                                onChange={(e) => setInterestMethod(e.target.value)}
                            >
                                <option value="FLAT">Flat Rate</option>
                                <option value="REDUCING_BALANCE">Reducing Balance</option>
                            </select>
                        </div>
                        <div className="space-y-2 flex items-center pt-8">
                            <input
                                type="checkbox"
                                id="isActive"
                                checked={isActive}
                                onChange={(e) => setIsActive(e.target.checked)}
                                className="mr-2"
                            />
                            <Label htmlFor="isActive" className="cursor-pointer">Product is Active (can be applied for)</Label>
                        </div>
                    </div>

                    <div className="border-t pt-4">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-semibold text-sm text-gray-700">Policies & Rating Bands</h3>
                            <Button type="button" size="sm" variant="outline" onClick={handleAddPolicy} className="flex items-center gap-2">
                                <Plus size={16} /> Add Policy
                            </Button>
                        </div>

                        {policies.length === 0 ? (
                            <div className="text-center p-4 bg-gray-50 border rounded text-gray-500 text-sm">
                                You need to add at least one credit rating policy for this loan product to be functional.
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {policies.map((policy, idx) => (
                                    <div key={idx} className="grid grid-cols-6 gap-2 items-end bg-gray-50 p-3 rounded border">
                                        <div className="col-span-1 border-r pr-2 shadow-sm rounded p-2 bg-white">
                                            <Label className="text-[10px] uppercase text-gray-500 block mb-1">Credit Rating</Label>
                                            <Input
                                                required
                                                className="h-8 text-sm px-2 font-bold"
                                                value={policy.creditRating}
                                                onChange={(e) => handlePolicyChange(idx, 'creditRating', e.target.value)}
                                                placeholder="e.g. A, GOOD"
                                            />
                                        </div>
                                        <div className="col-span-1 border-r pr-2 shadow-sm rounded p-2 bg-white">
                                            <Label className="text-[10px] uppercase text-gray-500 block mb-1">Int. Rate (%)</Label>
                                            <Input
                                                required
                                                type="number"
                                                step="0.01"
                                                className="h-8 text-sm px-2 text-blue-600 font-bold"
                                                value={policy.interestRate}
                                                onChange={(e) => handlePolicyChange(idx, 'interestRate', e.target.value)}
                                            />
                                        </div>
                                        <div className="col-span-1 border-r shadow-sm rounded p-2 bg-white">
                                            <Label className="text-[10px] uppercase text-gray-500 block mb-1">Term (Min-Max)</Label>
                                            <div className="flex gap-1 items-center">
                                                <Input
                                                    type="number"
                                                    className="h-8 text-xs px-1 w-full"
                                                    value={policy.minTermMonths || ''}
                                                    onChange={(e) => handlePolicyChange(idx, 'minTermMonths', e.target.value)}
                                                />
                                                <span className="text-gray-400">-</span>
                                                <Input
                                                    type="number"
                                                    className="h-8 text-xs px-1 w-full"
                                                    value={policy.maxTermMonths || ''}
                                                    onChange={(e) => handlePolicyChange(idx, 'maxTermMonths', e.target.value)}
                                                />
                                            </div>
                                        </div>
                                        <div className="col-span-2 border-r shadow-sm rounded p-2 bg-white">
                                            <Label className="text-[10px] uppercase text-gray-500 block mb-1">Princ. (Min-Max) $</Label>
                                            <div className="flex gap-1 items-center">
                                                <Input
                                                    type="number"
                                                    className="h-8 text-xs px-1 w-full"
                                                    value={policy.minPrincipal || ''}
                                                    onChange={(e) => handlePolicyChange(idx, 'minPrincipal', e.target.value)}
                                                />
                                                <span className="text-gray-400">-</span>
                                                <Input
                                                    type="number"
                                                    className="h-8 text-xs px-1 w-full"
                                                    value={policy.maxPrincipal || ''}
                                                    onChange={(e) => handlePolicyChange(idx, 'maxPrincipal', e.target.value)}
                                                />
                                            </div>
                                        </div>
                                        <div className="col-span-1 flex justify-center pb-2">
                                            <Button type="button" size="icon" variant="ghost" className="text-red-500 h-8 w-8 hover:bg-red-100" onClick={() => handleRemovePolicy(idx)}>
                                                <Trash2 size={16} />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end gap-2 pt-4">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={loading}>
                            {loading ? 'Saving...' : 'Save Product'}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
