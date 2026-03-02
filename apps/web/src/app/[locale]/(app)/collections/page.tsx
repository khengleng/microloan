"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Eye, Phone, User, Calendar, Loader2, MessageSquare, TrendingDown, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface OverdueLoan {
    id: string;
    borrower: { firstName: string; lastName: string; phone: string };
    principal: number;
    schedules: Array<{
        dueDate: string;
        totalAmount: number;
    }>;
}

export default function CollectionsPage() {
    const { locale } = useParams();
    const [loans, setLoans] = useState<OverdueLoan[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.get('/loans/overdue')
            .then(res => setLoans(res.data))
            .catch(err => console.error(err))
            .finally(() => setLoading(false));
    }, []);

    if (loading) return (
        <div className="flex flex-col h-[60vh] items-center justify-center space-y-4">
            <Loader2 className="animate-spin text-[#635BFF]" size={40} />
            <p className="text-[#697386] font-medium">Loading collection data...</p>
        </div>
    );

    return (
        <div className="max-w-[1200px] mx-auto space-y-8 animate-in fade-in duration-500 pb-10">
            {/* Header Area */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-[#1A1F36] tracking-tight">Overdue Collections</h1>
                    <p className="text-[#697386] text-[14px]">Identify and manage accounts requiring immediate attention.</p>
                </div>
                {loans.length > 0 && (
                    <div className="px-4 py-2 bg-white border border-[#E3E8EE] rounded-lg shadow-sm flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full bg-[#FF5D5D] animate-pulse" />
                        <span className="text-[13px] font-semibold text-[#1A1F36]">{loans.length} active delinquencies</span>
                    </div>
                )}
            </div>

            {loans.length === 0 ? (
                <div className="bg-white border border-[#E3E8EE] rounded-lg p-16 text-center shadow-sm">
                    <div className="w-16 h-16 bg-[#F0F5FF] text-[#635BFF] rounded-full flex items-center justify-center mx-auto mb-4">
                        <CheckCircle2 size={32} />
                    </div>
                    <h2 className="text-[18px] font-bold text-[#1A1F36]">Portfolio is healthy</h2>
                    <p className="text-[#697386] text-[14px] mt-1">There are no overdue payments currently requiring collection.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {loans.map(loan => {
                        const oldestDue = new Date(loan.schedules[0]?.dueDate);
                        const daysLate = Math.floor((Date.now() - oldestDue.getTime()) / (1000 * 60 * 60 * 24));
                        const totalOverdue = loan.schedules.reduce((acc, s) => acc + Number(s.totalAmount), 0);

                        return (
                            <div key={loan.id} className="bg-white border border-[#E3E8EE] rounded-lg shadow-sm hover:shadow-md transition-all flex flex-col group overflow-hidden">
                                <div className="p-6 flex-1">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded bg-[#F7FAFC] border border-[#E3E8EE] flex items-center justify-center text-[#4F566B] font-bold text-sm">
                                                {loan.borrower.firstName[0]}{loan.borrower.lastName[0]}
                                            </div>
                                            <div>
                                                <h3 className="text-[14px] font-bold text-[#1A1F36] transition-colors">{loan.borrower.firstName} {loan.borrower.lastName}</h3>
                                                <p className="text-[12px] text-[#697386] font-medium">#{loan.id.slice(-6).toUpperCase()}</p>
                                            </div>
                                        </div>
                                        <div className={`px-2 py-0.5 rounded text-[11px] font-bold ${daysLate > 30 ? 'bg-[#FFF0F0] text-[#FF5D5D]' : 'bg-[#FFF9E6] text-[#946C00]'}`}>
                                            {daysLate}d late
                                        </div>
                                    </div>

                                    <div className="mt-6 space-y-4">
                                        <div>
                                            <p className="text-[11px] font-bold text-[#697386] uppercase tracking-wider mb-1">Total Overdue</p>
                                            <p className="text-[20px] font-bold text-[#1A1F36] tracking-tight">${totalOverdue.toLocaleString()}</p>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4 pb-4 border-b border-[#F7FAFC]">
                                            <div>
                                                <p className="text-[11px] font-bold text-[#AAB7C4] uppercase mb-0.5">Oldest Due</p>
                                                <p className="text-[13px] font-semibold text-[#4F566B]">{oldestDue.toLocaleDateString()}</p>
                                            </div>
                                            <div>
                                                <p className="text-[11px] font-bold text-[#AAB7C4] uppercase mb-0.5">Principal</p>
                                                <p className="text-[13px] font-semibold text-[#4F566B]">${loan.principal.toLocaleString()}</p>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 text-[13px] text-[#4F566B] font-medium pt-1">
                                            <Phone size={14} className="text-[#697386]" />
                                            {loan.borrower.phone}
                                        </div>
                                    </div>
                                </div>

                                <div className="p-4 bg-[#F7FAFC] border-t border-[#E3E8EE] flex gap-2">
                                    <Link href={`/${locale}/loans/${loan.id}`} className="flex-1">
                                        <button className="w-full py-2 bg-white border border-[#E3E8EE] rounded shadow-sm text-[13px] font-bold text-[#4F566B] hover:bg-slate-50 transition-colors">
                                            View Loan
                                        </button>
                                    </Link>
                                    <button className="flex-1 py-2 bg-white border border-[#E3E8EE] rounded shadow-sm text-[13px] font-bold text-[#4F566B] hover:bg-slate-50 transition-colors flex items-center justify-center gap-2">
                                        <MessageSquare size={14} className="text-[#697386]" />
                                        Log Call
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
