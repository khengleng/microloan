"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Eye, Phone, User, Calendar, Loader2 } from 'lucide-react';
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
            .finally(() => setLoading(false));
    }, []);

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <AlertTriangle className="text-red-500" /> Collection Dashboard
                    </h1>
                    <p className="text-sm text-slate-500 mt-0.5">Management for loans with overdue installments</p>
                </div>
                <div className="bg-red-50 px-4 py-2 rounded-lg border border-red-100">
                    <span className="text-red-700 font-bold">{loans.length}</span>
                    <span className="text-red-600 text-sm ml-1.5 font-medium uppercase tracking-wider">At Risk Loans</span>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center items-center py-20">
                    <Loader2 className="animate-spin text-slate-300" size={40} />
                </div>
            ) : loans.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-100 p-20 text-center shadow-sm">
                    <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-4">
                        <User className="text-emerald-500" size={30} />
                    </div>
                    <h2 className="text-lg font-bold text-slate-800">Clean Portfolio!</h2>
                    <p className="text-slate-500 mt-1">No loans currently have overdue installments.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {loans.map(loan => {
                        const oldestDue = new Date(loan.schedules[0]?.dueDate);
                        const daysLate = Math.floor((Date.now() - oldestDue.getTime()) / (1000 * 60 * 60 * 24));
                        const totalOverdue = loan.schedules.reduce((acc, s) => acc + Number(s.totalAmount), 0);

                        return (
                            <div key={loan.id} className="bg-white rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow flex flex-col overflow-hidden">
                                <div className="p-5 flex-1">
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-600">
                                                {loan.borrower.firstName[0]}{loan.borrower.lastName[0]}
                                            </div>
                                            <div>
                                                <h3 className="font-bold text-slate-900">{loan.borrower.firstName} {loan.borrower.lastName}</h3>
                                                <p className="text-sm text-slate-500 flex items-center gap-1.5">
                                                    <Phone size={12} /> {loan.borrower.phone}
                                                </p>
                                            </div>
                                        </div>
                                        <div className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${daysLate > 30 ? 'bg-red-600 text-white' : 'bg-amber-100 text-amber-700'}`}>
                                            {daysLate} Days Late
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <div className="flex justify-between text-sm py-2 border-b border-slate-50">
                                            <span className="text-slate-500">Overdue Amount</span>
                                            <span className="font-bold text-red-600">${totalOverdue.toLocaleString()}</span>
                                        </div>
                                        <div className="flex justify-between text-sm py-2 border-b border-slate-50">
                                            <span className="text-slate-500">Total Principal</span>
                                            <span className="font-medium text-slate-700">${loan.principal.toLocaleString()}</span>
                                        </div>
                                        <div className="flex justify-between text-sm py-2">
                                            <span className="text-slate-500 flex items-center gap-1.5"><Calendar size={13} /> Oldest Due</span>
                                            <span className="font-medium text-slate-700">{oldestDue.toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="p-3 bg-slate-50 border-t border-slate-100 flex gap-2">
                                    <Link href={`/${locale}/loans/${loan.id}`} className="flex-1">
                                        <Button variant="outline" className="w-full text-xs h-9 gap-1.5">
                                            <Eye size={14} /> Full Record
                                        </Button>
                                    </Link>
                                    <Button className="flex-1 bg-slate-900 text-xs h-9 gap-1.5">
                                        <Phone size={14} /> Logging Call
                                    </Button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
