"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Plus, Search, ShieldAlert } from 'lucide-react';
import { BorrowerModal } from '@/components/BorrowerModal';
import { CrossCheckModal } from '@/components/CrossCheckModal';

interface Borrower {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    idNumber: string;
    address: string;
}

export default function BorrowersPage() {
    const t = useTranslations('Borrowers');
    const [borrowers, setBorrowers] = useState<Borrower[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isCrossCheckOpen, setIsCrossCheckOpen] = useState(false);
    const [selectedBorrower, setSelectedBorrower] = useState<Borrower | null>(null);

    const fetchBorrowers = async () => {
        setLoading(true);
        try {
            const res = await api.get('/borrowers');
            setBorrowers(res.data);
        } catch (error) {
            console.error('Failed to fetch borrowers', error);
        } finally {
            setLoading(false);
        }
    };

    const handleEdit = (borrower: Borrower) => {
        setSelectedBorrower(borrower);
        setIsModalOpen(true);
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this borrower?')) return;
        try {
            await api.delete(`/borrowers/${id}`);
            fetchBorrowers();
        } catch (error: any) {
            alert(error.response?.data?.message || 'Failed to delete borrower');
        }
    };

    useEffect(() => {
        fetchBorrowers();
    }, []);

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">{t('title')}</h1>
                <div className="flex gap-4">
                    <Button onClick={() => setIsCrossCheckOpen(true)} className="flex items-center gap-2 bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-200">
                        <ShieldAlert size={16} className="text-amber-600" />
                        Global Reliability Check
                    </Button>
                    <Button onClick={() => { setSelectedBorrower(null); setIsModalOpen(true); }} className="flex items-center gap-2 bg-slate-900">
                        <Plus size={16} />
                        {t('add_new')}
                    </Button>
                </div>
            </div>

            <BorrowerModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                onSuccess={fetchBorrowers}
                borrower={selectedBorrower}
            />

            <CrossCheckModal
                open={isCrossCheckOpen}
                onOpenChange={setIsCrossCheckOpen}
            />

            <div className="bg-white rounded-lg shadow overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('name')}</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('phone')}</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('id_number')}</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('address')}</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('actions')}</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {loading ? (
                            <tr>
                                <td colSpan={5} className="px-6 py-4 text-center">Loading...</td>
                            </tr>
                        ) : borrowers.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-6 py-4 text-center text-gray-500">{t('no_borrowers')}</td>
                            </tr>
                        ) : (
                            borrowers.map((borrower) => (
                                <tr key={borrower.id}>
                                    <td className="px-6 py-4 whitespace-nowrap">{borrower.firstName} {borrower.lastName}</td>
                                    <td className="px-6 py-4 whitespace-nowrap">{borrower.phone}</td>
                                    <td className="px-6 py-4 whitespace-nowrap">{borrower.idNumber}</td>
                                    <td className="px-6 py-4 whitespace-nowrap">{borrower.address}</td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <button
                                            onClick={() => handleEdit(borrower)}
                                            className="text-blue-600 hover:text-blue-900 mr-4 font-medium"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            onClick={() => handleDelete(borrower.id)}
                                            className="text-red-600 hover:text-red-900 font-medium"
                                        >
                                            Delete
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

