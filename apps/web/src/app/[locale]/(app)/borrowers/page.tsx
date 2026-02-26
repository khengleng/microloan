"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { BorrowerModal } from '@/components/BorrowerModal';

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

    useEffect(() => {
        fetchBorrowers();
    }, []);

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">{t('title')}</h1>
                <Button onClick={() => setIsModalOpen(true)} className="flex items-center gap-2">
                    <Plus size={16} />
                    {t('add_new')}
                </Button>
            </div>

            <BorrowerModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                onSuccess={fetchBorrowers}
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
                                        <button className="text-blue-600 hover:text-blue-900 mr-2">Edit</button>
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

