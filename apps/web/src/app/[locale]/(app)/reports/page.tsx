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
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header Area */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                        <FileBarChart className="text-indigo-600" size={32} /> Central Reporting Intelligence
                    </h1>
                    <p className="text-slate-500 font-medium mt-1">Export high-fidelity financial data and operational insights</p>
                </div>
                <div className="hidden lg:flex items-center gap-2 bg-slate-100 px-4 py-2 rounded-2xl border border-slate-200/50">
                    <ShieldCheck className="text-slate-400" size={18} />
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Audit Verified Data</span>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Loan Portfolio Card */}
                <div className="glass p-8 rounded-[2.5rem] premium-shadow border-indigo-100/10 relative overflow-hidden group hover:-translate-y-1 transition-all duration-300">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full -mr-12 -mt-12" />
                    <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center text-indigo-600 mb-6 shadow-sm group-hover:bg-indigo-600 group-hover:text-white transition-all">
                        <PieChart size={28} />
                    </div>
                    <h2 className="text-xl font-black text-slate-900 mb-3 tracking-tight">Loan Portfolio Masterbook</h2>
                    <p className="text-slate-500 font-medium text-sm leading-relaxed mb-8">
                        Comprehensive ledger of all active and closed loan assets. Includes borrower demographics, principal breakdown, and interest method metrics.
                    </p>
                    <Button
                        onClick={() => handleDownload('loan-book', 'loan_book.csv')}
                        className="w-full h-14 bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-600/20 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 transition-all active:scale-95"
                    >
                        <Download size={18} />
                        {t('export_loan_book')}
                    </Button>
                </div>

                {/* Repayments Ledger Card */}
                <div className="glass p-8 rounded-[2.5rem] premium-shadow border-emerald-100/10 relative overflow-hidden group hover:-translate-y-1 transition-all duration-300">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full -mr-12 -mt-12" />
                    <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center text-emerald-600 mb-6 shadow-sm group-hover:bg-emerald-600 group-hover:text-white transition-all">
                        <Activity size={28} />
                    </div>
                    <h2 className="text-xl font-black text-slate-900 mb-3 tracking-tight">Repayments & Cash Flow Ledger</h2>
                    <p className="text-slate-500 font-medium text-sm leading-relaxed mb-8">
                        Detailed historical collection data. Track principal and interest recovery across all time periods for accurate financial reconciliation.
                    </p>
                    <Button
                        onClick={() => handleDownload('repayments', 'repayments.csv')}
                        className="w-full h-14 bg-emerald-600 hover:bg-emerald-700 shadow-lg shadow-emerald-600/20 rounded-2xl font-black text-xs uppercase tracking-widest flex items-center justify-center gap-3 transition-all active:scale-95"
                    >
                        <Download size={18} />
                        {t('export_repayments')}
                    </Button>
                </div>
            </div>

            {/* Hint Box */}
            <div className="p-8 bg-slate-100 rounded-[2.5rem] border border-slate-200/50 flex flex-col md:flex-row items-center gap-6">
                <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center text-slate-400 shadow-sm shrink-0">
                    <FileBarChart size={24} />
                </div>
                <div>
                    <h4 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-1">Advanced Reporting Suite</h4>
                    <p className="text-sm text-slate-500 font-medium">Monthly performance summaries and risk exposure heatmaps are automatically generated on the 1st of every month and available in the Audit Vault.</p>
                </div>
            </div>
        </div>
    );
}
