"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { LoanModal } from '@/components/LoanModal';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface Loan {
    id: string;
    borrower: {
        firstName: string;
        lastName: string;
    };
    principal: number;
    annualInterestRate: number;
    termMonths: number;
    startDate: string;
    interestMethod: string;
    status: string;
}

export default function LoansPage() {
    const { locale } = useParams();
    const t = useTranslations('Loans');
    const [loans, setLoans] = useState<Loan[]>([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);

    const fetchLoans = async () => {
        setLoading(true);
        try {
            const res = await api.get('/loans');
            setLoans(res.data);
        } catch (error) {
            console.error('Failed to fetch loans', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLoans();
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

            <LoanModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                onSuccess={fetchLoans}
            />

            <div className="bg-white rounded-lg shadow overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('borrower')}</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('principal')}</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('interest_rate')}</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('term')}</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('status')}</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('actions')}</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {loading ? (
                            <tr>
                                <td colSpan={6} className="px-6 py-4 text-center">Loading...</td>
                            </tr>
                        ) : loans.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-6 py-4 text-center text-gray-500">{t('no_loans')}</td>
                            </tr>
                        ) : (
                            loans.map((loan) => (
                                <tr key={loan.id}>
                                    <td className="px-6 py-4 whitespace-nowrap">{loan.borrower.firstName} {loan.borrower.lastName}</td>
                                    <td className="px-6 py-4 whitespace-nowrap">${loan.principal.toLocaleString()}</td>
                                    <td className="px-6 py-4 whitespace-nowrap">{loan.annualInterestRate}%</td>
                                    <td className="px-6 py-4 whitespace-nowrap">{loan.termMonths}</td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${loan.status === 'DISBURSED' ? 'bg-green-100 text-green-800' :
                                            loan.status === 'DRAFT' ? 'bg-gray-100 text-gray-800' :
                                                'bg-blue-100 text-blue-800'
                                            }`}>
                                            {loan.status}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <Link href={`/${locale}/loans/${loan.id}`}>
                                            <button className="text-blue-600 hover:text-blue-900 mr-2">View</button>
                                        </Link>
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
