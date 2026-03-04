"use client";

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import { Plus, Package, Zap, Info, Loader2 } from 'lucide-react';
import { ProductModal } from '@/components/ProductModal';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';

interface LoanPolicy {
    id: string;
    creditRating: string;
    interestRate: number;
    minTermMonths: number | null;
    maxTermMonths: number | null;
    minPrincipal: number | null;
    maxPrincipal: number | null;
}

interface LoanProduct {
    id: string;
    name: string;
    description: string | null;
    interestMethod: string;
    isActive: boolean;
    policies: LoanPolicy[];
}

export default function ProductsPage() {
    const { showToast } = useToast();
    const confirm = useConfirm();
    const [products, setProducts] = useState<LoanProduct[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<LoanProduct | null>(null);

    const fetchProducts = useCallback(() => {
        setLoading(true);
        api.get('/loan-products')
            .then(res => setProducts(res.data))
            .catch(err => console.error(err))
            .finally(() => setLoading(false));
    }, []);

    useEffect(() => {
        fetchProducts();
    }, [fetchProducts]);

    const handleDelete = async (id: string, name: string) => {
        const ok = await confirm({
            title: 'Delete Product',
            message: `Are you sure you want to delete "${name}"? This cannot be undone.`,
            confirmLabel: 'Delete',
            variant: 'danger',
        });
        if (!ok) return;
        try {
            await api.delete(`/loan-products/${id}`);
            showToast('Product deleted', 'success');
            fetchProducts();
        } catch {
            showToast('Failed to delete product (it may be in use by existing loans)', 'error');
        }
    };

    if (loading) return (
        <div className="flex flex-col h-[60vh] items-center justify-center space-y-4">
            <Loader2 className="animate-spin text-[#635BFF]" size={40} />
            <p className="text-[#697386] font-medium">Loading products...</p>
        </div>
    );

    return (
        <div className="max-w-[1200px] mx-auto space-y-8 animate-in fade-in duration-500 pb-10">
            {/* Header Area */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-[#1A1F36] tracking-tight">Loan Products</h1>
                    <p className="text-[#697386] text-[14px]">Configure your credit offerings and automated risk policies.</p>
                </div>
                <button
                    onClick={() => { setEditingProduct(null); setIsModalOpen(true); }}
                    className="bg-[#635BFF] hover:bg-[#5D55EF] text-white text-[13px] font-semibold py-2 px-4 rounded shadow-sm transition-all flex items-center gap-2"
                >
                    <Plus size={16} /> New Product
                </button>
            </div>

            <ProductModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                onSuccess={fetchProducts}
                productToEdit={editingProduct}
            />

            <div className="grid grid-cols-1 gap-6">
                {products.length === 0 ? (
                    <div className="bg-white border border-[#E3E8EE] rounded-lg p-16 text-center shadow-sm">
                        <div className="w-16 h-16 bg-[#F7FAFC] text-[#AAB7C4] rounded-full flex items-center justify-center mx-auto mb-4">
                            <Package size={32} />
                        </div>
                        <h2 className="text-[18px] font-bold text-[#1A1F36]">No products found</h2>
                        <p className="text-[#697386] text-[14px] mt-1">Create your first loan product to start originating loans.</p>
                    </div>
                ) : (
                    products.map(product => (
                        <div key={product.id} className="bg-white border border-[#E3E8EE] rounded-lg shadow-sm overflow-hidden">
                            <div className="p-8">
                                <div className="flex flex-col lg:flex-row justify-between items-start gap-6">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-3 mb-2">
                                            <h2 className="text-[20px] font-bold text-[#1A1F36] tracking-tight">{product.name}</h2>
                                            {!product.isActive ? (
                                                <span className="px-2 py-0.5 rounded bg-[#FFF0F0] text-[#FF5D5D] text-[11px] font-bold">Inactive</span>
                                            ) : (
                                                <span className="px-2 py-0.5 rounded bg-[#E6F9F1] text-[#3ECF8E] text-[11px] font-bold">Active</span>
                                            )}
                                        </div>
                                        <p className="text-[#697386] text-[14px] leading-relaxed max-w-2xl">{product.description || 'Professional credit offering with automated policy enforcement.'}</p>

                                        <div className="flex items-center gap-4 mt-6">
                                            <div className="flex items-center gap-2 px-3 py-1 bg-[#F7FAFC] rounded border border-[#E3E8EE]">
                                                <Zap size={14} className="text-[#635BFF]" />
                                                <span className="text-[12px] font-bold text-[#4F566B] uppercase tracking-wider">{product.interestMethod}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={() => { setEditingProduct(product); setIsModalOpen(true); }} className="px-4 py-2 bg-white border border-[#E3E8EE] rounded shadow-sm text-[13px] font-bold text-[#4F566B] hover:bg-slate-50 transition-colors">
                                            Edit
                                        </button>
                                        <button onClick={() => handleDelete(product.id, product.name)} className="px-4 py-2 bg-white border border-[#E3E8EE] rounded shadow-sm text-[13px] font-bold text-[#FF5D5D] hover:bg-[#FFF8F8] transition-colors">
                                            Delete
                                        </button>
                                    </div>
                                </div>

                                <div className="mt-10 pt-8 border-t border-[#F7FAFC]">
                                    <h3 className="text-[12px] font-bold text-[#AAB7C4] uppercase tracking-wider mb-6">Risk Policies ({product.policies.length})</h3>

                                    {product.policies.length === 0 ? (
                                        <div className="p-8 text-center bg-[#F7FAFC] rounded border border-dashed border-[#E3E8EE]">
                                            <p className="text-[13px] text-[#697386] font-medium italic">No specific risk tiers defined.</p>
                                        </div>
                                    ) : (
                                        <div className="overflow-x-auto no-scrollbar">
                                            <table className="min-w-full border-collapse">
                                                <thead>
                                                    <tr className="border-b border-[#F7FAFC]">
                                                        <th className="text-left pb-4 text-[11px] font-bold text-[#AAB7C4] uppercase">Tier</th>
                                                        <th className="text-right pb-4 text-[11px] font-bold text-[#AAB7C4] uppercase">Interest Rate</th>
                                                        <th className="text-right pb-4 text-[11px] font-bold text-[#AAB7C4] uppercase">Term Range</th>
                                                        <th className="text-right pb-4 text-[11px] font-bold text-[#AAB7C4] uppercase">Principal limit</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-[#F7FAFC]">
                                                    {product.policies.map(p => (
                                                        <tr key={p.id} className="hover:bg-[#F7FAFC]/50 transition-colors">
                                                            <td className="py-4 text-[14px] font-bold text-[#1A1F36]">{p.creditRating}</td>
                                                            <td className="py-4 text-right text-[14px] font-bold text-[#635BFF]">{p.interestRate}%</td>
                                                            <td className="py-4 text-right text-[13px] text-[#4F566B] font-medium">
                                                                {p.minTermMonths || 0}m – {p.maxTermMonths || '∞'}m
                                                            </td>
                                                            <td className="py-4 text-right text-[13px] text-[#4F566B] font-medium">
                                                                ${p.minPrincipal ? p.minPrincipal.toLocaleString() : '0'} – ${p.maxPrincipal ? p.maxPrincipal.toLocaleString() : '∞'}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            <div className="bg-[#F0F5FF] p-6 rounded-lg border border-[#E3E8EE] flex gap-4">
                <Info size={20} className="text-[#635BFF] shrink-0 mt-0.5" />
                <p className="text-[14px] text-[#4F566B] leading-relaxed">
                    Changes to product availability or policy terms will only apply to future loan originations. Existing active loans will continue under their original terms.
                </p>
            </div>
        </div>
    );
}
