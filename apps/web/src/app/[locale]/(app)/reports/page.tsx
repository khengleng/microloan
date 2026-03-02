"use client";

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Download, FileBarChart, PieChart, Activity, ShieldCheck } from 'lucide-react';
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
        <div className="max-w-[1000px] mx-auto space-y-8 animate-in fade-in duration-500 pb-10">
            {/* Header Area */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-[#1A1F36] tracking-tight">Reporting & Exports</h1>
                    <p className="text-[#697386] text-[14px] mt-1">Export financial data and operational insights for your business.</p>
                </div>
                <div className="flex items-center gap-2 text-[#697386] text-[12px] font-semibold bg-[#F6F9FC] px-3 py-1.5 rounded-md border border-[#E3E8EE]">
                    <ShieldCheck size={14} className="text-[#AAB7C4]" />
                    <span>Verified Audit Data</span>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Loan Portfolio Card */}
                <div className="bg-white border border-[#E3E8EE] p-6 rounded-lg shadow-sm hover:shadow-md transition-all">
                    <div className="w-10 h-10 bg-[#F0F5FF] rounded-md flex items-center justify-center text-[#635BFF] mb-4">
                        <PieChart size={20} />
                    </div>
                    <h2 className="text-[16px] font-bold text-[#1A1F36] mb-2 tracking-tight">Loan Portfolio Masterbook</h2>
                    <p className="text-[#697386] text-[14px] leading-relaxed mb-6 h-[60px]">
                        A complete record of all active and closed loan assets, including principal breakdown and interest metrics.
                    </p>
                    <button
                        onClick={() => handleDownload('loan-book', 'loan_book.csv')}
                        className="w-full bg-[#635BFF] hover:bg-[#5D55EF] text-white text-[13px] font-semibold py-2.5 px-4 rounded shadow-sm transition-all flex items-center justify-center gap-2"
                    >
                        <Download size={14} />
                        Download Portfolio CSV
                    </button>
                </div>

                {/* Repayments Ledger Card */}
                <div className="bg-white border border-[#E3E8EE] p-6 rounded-lg shadow-sm hover:shadow-md transition-all">
                    <div className="w-10 h-10 bg-[#E6F9F1] rounded-md flex items-center justify-center text-[#3ECF8E] mb-4">
                        <Activity size={20} />
                    </div>
                    <h2 className="text-[16px] font-bold text-[#1A1F36] mb-2 tracking-tight">Collections & Cash Flow</h2>
                    <p className="text-[#697386] text-[14px] leading-relaxed mb-6 h-[60px]">
                        Detailed history of all repayments, principal recalls, and interest recovery events across all time periods.
                    </p>
                    <button
                        onClick={() => handleDownload('repayments', 'repayments.csv')}
                        className="w-full bg-[#635BFF] hover:bg-[#5D55EF] text-white text-[13px] font-semibold py-2.5 px-4 rounded shadow-sm transition-all flex items-center justify-center gap-2"
                    >
                        <Download size={14} />
                        Download Repayments CSV
                    </button>
                </div>
            </div>

            {/* Info Box */}
            <div className="bg-[#F6F9FC] border border-[#E3E8EE] p-6 rounded-lg flex items-start gap-4">
                <div className="text-[#AAB7C4] mt-0.5">
                    <FileBarChart size={20} />
                </div>
                <div>
                    <h4 className="text-[13px] font-bold text-[#1A1F36] mb-1">Custom Reports</h4>
                    <p className="text-[13px] text-[#697386] leading-relaxed">
                        Looking for something specific? Monthly performance summaries and risk exposure reports are automatically generated on the 1st of every month. For custom data requests, please contact support.
                    </p>
                </div>
            </div>
        </div>
    );
}
