"use client";

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Plus, Edit2, Trash2, Package, ShieldCheck, Zap, Info } from 'lucide-react';
import { ProductModal } from '@/components/ProductModal';

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
        if (!confirm(`Are you sure you want to delete ${name}?`)) return;
        try {
            await api.delete(`/loan-products/${id}`);
            fetchProducts();
        } catch (error) {
            console.error('Failed to delete product', error);
            alert('Failed to delete product (It may be in use by existing loans).');
        }
    };

    if (loading) return <div className="flex h-64 items-center justify-center text-slate-400 font-black animate-pulse uppercase tracking-[0.2em]">Loading Financial Products...</div>;

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header Area */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                        <Package className="text-indigo-600" size={32} /> Credit Product Catalog
                    </h1>
                    <p className="text-slate-500 font-medium mt-1">Configure automated loan policies and interest engines</p>
                </div>
                <Button
                    onClick={() => { setEditingProduct(null); setIsModalOpen(true); }}
                    className="rounded-2xl font-black px-8 h-12 bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-600/20 transition-all hover:scale-[1.02] flex items-center gap-2"
                >
                    <Plus size={18} />
                    Engine New Product
                </Button>
            </div>

            <ProductModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                onSuccess={fetchProducts}
                productToEdit={editingProduct}
            />

            <div className="grid grid-cols-1 gap-8">
                {products.length === 0 ? (
                    <div className="glass p-20 text-center rounded-[2.5rem] premium-shadow border-slate-100/10">
                        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
                            <Zap size={32} />
                        </div>
                        <h2 className="text-slate-900 font-black text-xl mb-1 italic">No logic engines found.</h2>
                        <p className="text-slate-400 font-medium text-sm">Create your first credit product to begin originating loans.</p>
                    </div>
                ) : (
                    products.map(product => (
                        <div key={product.id} className="glass p-8 rounded-[2.5rem] premium-shadow border-indigo-100/10 relative overflow-hidden group">
                            <div className="flex flex-col lg:flex-row justify-between items-start gap-6">
                                <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-2">
                                        <h2 className="text-2xl font-black text-slate-900 tracking-tight">{product.name}</h2>
                                        {!product.isActive && <span className="text-[10px] font-black bg-rose-100 text-rose-600 px-3 py-1 rounded-full uppercase tracking-widest shadow-sm">Suspended</span>}
                                        {product.isActive && <span className="text-[10px] font-black bg-emerald-100 text-emerald-600 px-3 py-1 rounded-full uppercase tracking-widest shadow-sm">Active Engine</span>}
                                    </div>
                                    <p className="text-slate-500 font-medium text-sm leading-relaxed max-w-2xl">{product.description || 'Enterprise-grade automated credit logic engine.'}</p>
                                    <div className="flex items-center gap-4 mt-6">
                                        <div className="flex items-center gap-2 bg-indigo-50 px-4 py-1.5 rounded-full border border-indigo-100/50">
                                            <Zap size={14} className="text-indigo-600" />
                                            <span className="text-[11px] font-black text-indigo-700 uppercase tracking-widest">{product.interestMethod}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex gap-3">
                                    <Button size="lg" variant="secondary" onClick={() => { setEditingProduct(product); setIsModalOpen(true); }} className="rounded-2xl font-bold h-11 px-6 shadow-sm">
                                        <Edit2 size={16} className="mr-2" /> Modify
                                    </Button>
                                    <Button size="lg" variant="secondary" onClick={() => handleDelete(product.id, product.name)} className="rounded-2xl font-bold h-11 px-4 text-rose-500 hover:bg-rose-50 border-rose-100/50">
                                        <Trash2 size={18} />
                                    </Button>
                                </div>
                            </div>

                            <div className="mt-10 pt-8 border-t border-slate-100/50">
                                <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
                                    <ShieldCheck size={14} className="text-slate-400" /> Automated Risk Policies ({product.policies.length})
                                </h3>
                                {product.policies.length === 0 ? (
                                    <div className="p-10 text-center bg-slate-50 rounded-3xl border border-dashed border-slate-200">
                                        <p className="text-xs font-black text-slate-300 uppercase tracking-widest italic">Zero policies defined for this matrix.</p>
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto no-scrollbar">
                                        <table className="min-w-full border-collapse">
                                            <thead>
                                                <tr>
                                                    <th className="text-left pb-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Risk Tier</th>
                                                    <th className="text-right pb-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Rate</th>
                                                    <th className="text-right pb-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Term Logic</th>
                                                    <th className="text-right pb-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Principal Logic</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100/50">
                                                {product.policies.map(p => (
                                                    <tr key={p.id} className="group/row hover:bg-slate-50/50 transition-colors">
                                                        <td className="py-5 font-black text-base text-slate-900 tracking-tight">{p.creditRating}</td>
                                                        <td className="py-5 text-right font-black text-indigo-600 text-base">{p.interestRate}%</td>
                                                        <td className="py-5 text-right text-slate-500 font-bold text-xs uppercase tracking-tighter">
                                                            {p.minTermMonths || 0}m <span className="mx-1 text-slate-200">→</span> {p.maxTermMonths || '∞'}m
                                                        </td>
                                                        <td className="py-5 text-right text-slate-500 font-black text-xs">
                                                            ${p.minPrincipal ? p.minPrincipal.toLocaleString() : '0'} <span className="mx-1 text-slate-200">→</span> ${p.maxPrincipal ? p.maxPrincipal.toLocaleString() : '∞'}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>

            <div className="bg-indigo-50 p-8 rounded-[2.5rem] border border-indigo-100/50 flex flex-col md:flex-row items-center gap-6">
                <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center text-indigo-500 shadow-sm shrink-0">
                    <Info size={24} />
                </div>
                <div>
                    <h4 className="text-sm font-black text-indigo-900 uppercase tracking-widest mb-1">Policy Enforcement Engine</h4>
                    <p className="text-sm text-indigo-700/60 font-medium">Changes to these products will only affect new loan applications. Existing loans will maintain their original originated terms as per regulatory compliance.</p>
                </div>
            </div>
        </div>
    );
}
