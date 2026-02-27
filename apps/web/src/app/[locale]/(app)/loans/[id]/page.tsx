"use client";

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ChevronLeft, Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { RepaymentModal } from '@/components/RepaymentModal';

interface ScheduleItem {
    installmentNumber: number;
    dueDate: string;
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    outstandingPrincipal: number;
}

interface Repayment {
    id: string;
    amount: number;
    date: string;
    principalPaid: number;
    interestPaid: number;
}

interface Loan {
    id: string;
    borrower: {
        firstName: string;
        lastName: string;
        phone: string;
    };
    principal: number;
    annualInterestRate: number;
    termMonths: number;
    startDate: string;
    interestMethod: string;
    status: string;
    schedules: ScheduleItem[];
    repayments: Repayment[];
}

export default function LoanDetailsPage() {
    const { id, locale } = useParams();
    const t = useTranslations('LoanDetails');
    const [loan, setLoan] = useState<Loan | null>(null);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);

    const fetchLoan = useCallback(() => {
        setLoading(true);
        api.get(`/loans/${id}`)
            .then(res => setLoan(res.data))
            .catch(err => console.error(err))
            .finally(() => setLoading(false));
    }, [id]);

    useEffect(() => {
        fetchLoan();
    }, [fetchLoan]);

    if (loading) return <div>Loading...</div>;
    if (!loan) return <div>Loan not found</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href={`/${locale}/loans`}>
                        <Button variant="ghost" size="icon">
                            <ChevronLeft size={24} />
                        </Button>
                    </Link>
                    <h1 className="text-2xl font-bold">{t('title')} - {loan.borrower.firstName} {loan.borrower.lastName}</h1>
                </div>
                {loan.status === 'DISBURSED' && (
                    <Button onClick={() => setIsModalOpen(true)} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700">
                        <Plus size={16} />
                        Make a Payment
                    </Button>
                )}
            </div>

            <RepaymentModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                onSuccess={fetchLoan}
                defaultLoanId={loan.id}
            />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-lg shadow space-y-4">
                    <h2 className="text-lg font-semibold border-b pb-2">{t('summary')}</h2>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                        <span className="text-gray-500">{t('principal')}:</span>
                        <span className="font-medium">${loan.principal.toLocaleString()}</span>
                        <span className="text-gray-500">Interest Rate:</span>
                        <span className="font-medium">{loan.annualInterestRate}%</span>
                        <span className="text-gray-500">Term:</span>
                        <span className="font-medium">{loan.termMonths} Months</span>
                        <span className="text-gray-500">Method:</span>
                        <span className="font-medium">{loan.interestMethod}</span>
                        <span className="text-gray-500">{t('status')}:</span>
                        <span className="font-medium">{loan.status}</span>
                    </div>
                </div>

                <div className="md:col-span-2 bg-white p-6 rounded-lg shadow overflow-hidden">
                    <h2 className="text-lg font-semibold border-b pb-2 mb-4">{t('schedule')}</h2>
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead>
                            <tr>
                                <th className="text-left py-2 font-medium text-gray-500">{t('installment')}</th>
                                <th className="text-left py-2 font-medium text-gray-500">{t('due_date')}</th>
                                <th className="text-right py-2 font-medium text-gray-500">{t('principal')}</th>
                                <th className="text-right py-2 font-medium text-gray-500">{t('interest')}</th>
                                <th className="text-right py-2 font-medium text-gray-500">{t('total')}</th>
                                <th className="text-right py-2 font-medium text-gray-500">{t('balance')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {loan.schedules.map((item) => (
                                <tr key={item.installmentNumber}>
                                    <td className="py-2">{item.installmentNumber}</td>
                                    <td className="py-2">{new Date(item.dueDate).toLocaleDateString()}</td>
                                    <td className="py-2 text-right">${item.principalAmount.toLocaleString()}</td>
                                    <td className="py-2 text-right">${item.interestAmount.toLocaleString()}</td>
                                    <td className="py-2 text-right font-medium">${item.totalAmount.toLocaleString()}</td>
                                    <td className="py-2 text-right text-gray-500">${item.outstandingPrincipal.toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow overflow-hidden">
                <h2 className="text-lg font-semibold border-b pb-2 mb-4">{t('ledger')}</h2>
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead>
                        <tr>
                            <th className="text-left py-2 font-medium text-gray-500">{t('due_date')}</th>
                            <th className="text-right py-2 font-medium text-gray-500">Amount</th>
                            <th className="text-right py-2 font-medium text-gray-500">Interest Paid</th>
                            <th className="text-right py-2 font-medium text-gray-500">Principal Paid</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {loan.repayments.length === 0 ? (
                            <tr><td colSpan={4} className="py-4 text-center text-gray-500">No repayments yet.</td></tr>
                        ) : (
                            loan.repayments.map((rp) => (
                                <tr key={rp.id}>
                                    <td className="py-2">{new Date(rp.date).toLocaleDateString()}</td>
                                    <td className="py-2 text-right font-medium">${rp.amount.toLocaleString()}</td>
                                    <td className="py-2 text-right text-green-600">${rp.interestPaid?.toLocaleString() || 0}</td>
                                    <td className="py-2 text-right text-blue-600">${rp.principalPaid?.toLocaleString() || 0}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
