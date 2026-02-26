"use client";

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import api from '@/lib/api';

export default function ReportsPage() {
    const t = useTranslations('Reports');

    const handleDownload = async (endpoint: string, filename: string) => {
        try {
            const res = await api.get(`/reports/${endpoint}`, {
                responseType: 'blob'
            });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', filename);
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (error) {
            console.error('Failed to download report', error);
            alert('Failed to download report');
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold">{t('title')}</h1>
                <p className="text-gray-500">{t('description')}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-lg shadow space-y-4">
                    <h2 className="text-lg font-semibold">Loan Portfolio</h2>
                    <p className="text-sm text-gray-600">Download the full list of active and closed loans including borrower details and interest methods.</p>
                    <Button
                        onClick={() => handleDownload('loan-book', 'loan_book.csv')}
                        variant="outline"
                        className="w-full flex items-center justify-center gap-2"
                    >
                        <Download size={16} />
                        {t('export_loan_book')}
                    </Button>
                </div>

                <div className="bg-white p-6 rounded-lg shadow space-y-4">
                    <h2 className="text-lg font-semibold">Repayments Ledger</h2>
                    <p className="text-sm text-gray-600">Download all repayment transactions history for the current tenant.</p>
                    <Button
                        onClick={() => handleDownload('repayments', 'repayments.csv')}
                        variant="outline"
                        className="w-full flex items-center justify-center gap-2"
                    >
                        <Download size={16} />
                        {t('export_repayments')}
                    </Button>
                </div>
            </div>
        </div>
    );
}
