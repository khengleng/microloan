"use client";

import { useEffect, useState, useCallback } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Plus, Edit2, Trash2 } from 'lucide-react';
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

    if (loading) return <div>Loading products...</div>;

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Loan Products</h1>
                <Button onClick={() => { setEditingProduct(null); setIsModalOpen(true); }} className="flex items-center gap-2">
                    <Plus size={16} />
                    Create Product
                </Button>
            </div>

            <ProductModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                onSuccess={fetchProducts}
                productToEdit={editingProduct}
            />

            <div className="grid grid-cols-1 gap-6">
                {products.length === 0 ? (
                    <div className="bg-white p-8 text-center text-gray-500 rounded-lg shadow">No loan products found. Create one above!</div>
                ) : (
                    products.map(product => (
                        <div key={product.id} className="bg-white p-6 rounded-lg shadow">
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h2 className="text-xl font-bold flex items-center gap-2">
                                        {product.name}
                                        {!product.isActive && <span className="text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded">INACTIVE</span>}
                                    </h2>
                                    <p className="text-gray-500 text-sm mt-1">{product.description || 'No description provided.'}</p>
                                    <div className="text-sm font-medium mt-2 bg-slate-100 inline-block px-3 py-1 rounded">Method: {product.interestMethod}</div>
                                </div>
                                <div className="flex gap-2">
                                    <Button size="sm" variant="outline" onClick={() => { setEditingProduct(product); setIsModalOpen(true); }}>
                                        <Edit2 size={16} className="mr-2" /> Edit
                                    </Button>
                                    <Button size="sm" variant="destructive" onClick={() => handleDelete(product.id, product.name)}>
                                        <Trash2 size={16} />
                                    </Button>
                                </div>
                            </div>

                            <div className="mt-6 border-t pt-4">
                                <h3 className="text-sm font-semibold mb-3">Rate Policies by Credit Rating</h3>
                                {product.policies.length === 0 ? (
                                    <div className="text-sm text-gray-500">No policies defined. This product cannot be selected!</div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full divide-y divide-gray-200 text-sm border rounded">
                                            <thead className="bg-gray-50">
                                                <tr>
                                                    <th className="px-4 py-2 text-left font-medium text-gray-500">Credit Rating</th>
                                                    <th className="px-4 py-2 text-right font-medium text-gray-500">Interest Rate</th>
                                                    <th className="px-4 py-2 text-right font-medium text-gray-500">Term Limit</th>
                                                    <th className="px-4 py-2 text-right font-medium text-gray-500">Principal Limit</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-200">
                                                {product.policies.map(p => (
                                                    <tr key={p.id}>
                                                        <td className="px-4 py-2 font-medium">{p.creditRating}</td>
                                                        <td className="px-4 py-2 text-right">{p.interestRate}%</td>
                                                        <td className="px-4 py-2 text-right text-gray-500">
                                                            {p.minTermMonths || 0} - {p.maxTermMonths || '∞'} Months
                                                        </td>
                                                        <td className="px-4 py-2 text-right text-gray-500">
                                                            ${p.minPrincipal ? p.minPrincipal.toLocaleString() : '0'} - ${p.maxPrincipal ? p.maxPrincipal.toLocaleString() : '∞'}
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
        </div>
    );
}
