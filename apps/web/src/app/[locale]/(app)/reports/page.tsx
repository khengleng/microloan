"use client";

import { useTranslations } from 'next-intl';
import { Download, FileText, BarChart2, Users, ShieldCheck, Activity } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';

const EXPORTS = [
    {
        title: 'Loan Portfolio',
        description: 'All active and closed loans with principal, interest rate, term, method, and status.',
        endpoint: 'loan-book',
        filename: 'loan_book.csv',
        Icon: FileText,
        iconCls: 'text-primary bg-primary/10',
    },
    {
        title: 'Collections & Repayments',
        description: 'Full repayment history — principal recovered, interest paid, and dates for every transaction.',
        endpoint: 'repayments',
        filename: 'repayments.csv',
        Icon: Activity,
        iconCls: 'text-[#006644] bg-[#E3FCEF]',
    },
];

const EXCEL_EXPORTS = [
    {
        title: 'Loans (Excel)',
        description: 'Loan portfolio in Excel format for spreadsheet analysis.',
        endpoint: '/exports/loans/excel',
        filename: 'loans.xlsx',
        Icon: BarChart2,
        iconCls: 'text-[#006644] bg-[#E3FCEF]',
    },
    {
        title: 'Borrowers (Excel)',
        description: 'Full borrower registry with contact details and ID numbers.',
        endpoint: '/exports/borrowers',
        filename: 'borrowers.xlsx',
        Icon: Users,
        iconCls: 'text-[#974F0C] bg-[#FFFAE6]',
    },
];

export default function ReportsPage() {
    const { showToast } = useToast();

    const handleCsvDownload = async (endpoint: string, filename: string) => {
        try {
            const res = await api.get(`/reports/${endpoint}`, { responseType: 'blob' });
            trigger(res.data, filename);
            showToast(`${filename} downloaded`, 'success');
        } catch { showToast('Download failed', 'error'); }
    };

    const handleExcelDownload = async (endpoint: string, filename: string) => {
        try {
            const res = await api.get(endpoint, { responseType: 'blob' });
            trigger(res.data, filename);
            showToast(`${filename} downloaded`, 'success');
        } catch { showToast('Download failed', 'error'); }
    };

    const trigger = (data: Blob, filename: string) => {
        const url = window.URL.createObjectURL(new Blob([data]));
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        window.URL.revokeObjectURL(url);
    };

    return (
        <div className="max-w-4xl space-y-6">
            <div>
                <h1 className="text-xl font-bold text-foreground">Reports & Exports</h1>
                <p className="text-sm text-muted-foreground mt-0.5">Download financial data for analysis, auditing, or reporting.</p>
            </div>

            {/* CSV Reports */}
            <div>
                <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-3">CSV Reports</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {EXPORTS.map(exp => (
                        <div key={exp.endpoint} className="bg-white border border-border rounded-md p-5 flex flex-col gap-3">
                            <div className="flex items-start gap-3">
                                <div className={`w-9 h-9 rounded flex items-center justify-center flex-shrink-0 ${exp.iconCls}`}>
                                    <exp.Icon size={16} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-foreground">{exp.title}</h3>
                                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{exp.description}</p>
                                </div>
                            </div>
                            <button
                                onClick={() => handleCsvDownload(exp.endpoint, exp.filename)}
                                className="btn-ghost text-sm w-full justify-center"
                            >
                                <Download size={14} /> Download CSV
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {/* Excel Reports */}
            <div>
                <h2 className="text-sm font-bold text-muted-foreground uppercase tracking-wide mb-3">Excel Reports</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {EXCEL_EXPORTS.map(exp => (
                        <div key={exp.endpoint} className="bg-white border border-border rounded-md p-5 flex flex-col gap-3">
                            <div className="flex items-start gap-3">
                                <div className={`w-9 h-9 rounded flex items-center justify-center flex-shrink-0 ${exp.iconCls}`}>
                                    <exp.Icon size={16} />
                                </div>
                                <div>
                                    <h3 className="text-sm font-bold text-foreground">{exp.title}</h3>
                                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{exp.description}</p>
                                </div>
                            </div>
                            <button
                                onClick={() => handleExcelDownload(exp.endpoint, exp.filename)}
                                className="btn-primary text-sm w-full justify-center"
                            >
                                <Download size={14} /> Download Excel
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {/* Info */}
            <div className="bg-white border border-border rounded-md p-4 flex items-start gap-3">
                <ShieldCheck size={16} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                <div>
                    <h4 className="text-sm font-bold text-foreground mb-0.5">Scheduled Reports</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                        Monthly performance summaries and risk exposure reports are generated automatically on the 1st of each month. For custom data requests, contact your administrator.
                    </p>
                </div>
            </div>
        </div>
    );
}
