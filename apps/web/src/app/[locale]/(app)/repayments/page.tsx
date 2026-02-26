"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { RepaymentModal } from '@/components/RepaymentModal';

interface Repayment {
    id: string;
    loan: {
        borrower: {
            firstName: string;
            lastName: string;
        };
    };
    amount: number;
    date: string;
    principalPaid: number;
    interestPaid: number;
}

export default function RepaymentsPage() {
    const t = useTranslations('Repayments');
    const [repayments, setRepayments] = useState<Repayment[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);

    const fetchRepayments = async () => {
        setLoading(true);
        try {
            const res = await api.get('/repayments');
            setRepayments(res.data);
        } catch (error) {
            console.error('Failed to fetch repayments', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchRepayments();
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

            <RepaymentModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                onSuccess={fetchRepayments}
            />

            <div className="bg-white rounded-lg shadow overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('loan')}</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('amount')}</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Interest</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Principal</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('date')}</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {loading ? (
                            <tr>
                                <td colSpan={5} className="px-6 py-4 text-center">Loading...</td>
                            </tr>
                        ) : repayments.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-6 py-4 text-center text-gray-500">{t('no_repayments')}</td>
                            </tr>
                        ) : (
                            repayments.map((rp) => (
                                <tr key={rp.id}>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        {rp.loan.borrower.firstName} {rp.loan.borrower.lastName}
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">${rp.amount.toLocaleString()}</td>
                                    <td className="px-6 py-4 whitespace-nowrap">${rp.interestPaid.toLocaleString()}</td>
                                    <td className="px-6 py-4 whitespace-nowrap">${rp.principalPaid.toLocaleString()}</td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        {new Date(rp.date).toLocaleDateString()}
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
