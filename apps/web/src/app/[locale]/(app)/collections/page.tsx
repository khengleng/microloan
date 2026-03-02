"use client";

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Eye, Phone, User, Calendar, Loader2, MessageSquare, TrendingDown } from 'lucide-react';
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

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header Area */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                        <AlertTriangle className="text-rose-500" size={32} /> Debt Collection Unit
                    </h1>
                    <p className="text-slate-500 font-medium mt-1">Priority management for high-risk overdue installments</p>
                </div>
                <div className="glass px-6 py-3 rounded-2xl border-rose-200/50 flex items-center gap-3 bg-rose-50/50">
                    <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center">
                        <TrendingDown className="text-rose-600" size={20} />
                    </div>
                    <div>
                        <p className="text-[10px] font-black text-rose-400 uppercase tracking-widest">At Risk Portfolio</p>
                        <p className="text-xl font-black text-rose-700">{loans.length} Active Delinquencies</p>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center items-center py-32">
                    <Loader2 className="animate-spin text-slate-300" size={48} strokeWidth={1} />
                </div>
            ) : loans.length === 0 ? (
                <div className="glass rounded-[2.5rem] p-24 text-center premium-shadow border-emerald-100/20 bg-emerald-50/20">
                    <div className="w-20 h-20 bg-emerald-100/50 rounded-full flex items-center justify-center mx-auto mb-6">
                        <User className="text-emerald-600" size={40} />
                    </div>
                    <h2 className="text-2xl font-black text-emerald-950 tracking-tight italic">Portfolio Healthy!</h2>
                    <p className="text-emerald-700/60 font-bold mt-2 uppercase tracking-widest text-xs">No overdue loans currently active in the system.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {loans.map(loan => {
                        const oldestDue = new Date(loan.schedules[0]?.dueDate);
                        const daysLate = Math.floor((Date.now() - oldestDue.getTime()) / (1000 * 60 * 60 * 24));
                        const totalOverdue = loan.schedules.reduce((acc, s) => acc + Number(s.totalAmount), 0);

                        return (
                            <div key={loan.id} className="glass p-7 rounded-[2.5rem] premium-shadow border-indigo-100/10 flex flex-col group hover:-translate-y-1 transition-all duration-300 relative overflow-hidden">
                                <div className={`absolute top-0 right-0 w-2 h-full transition-all duration-500 ${daysLate > 30 ? 'bg-rose-500' : 'bg-amber-400'}`} />

                                <div className="flex-1">
                                    <div className="flex justify-between items-start mb-6">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center font-black text-slate-500 text-sm shadow-sm group-hover:bg-indigo-600 group-hover:text-white transition-all">
                                                {loan.borrower.firstName[0]}{loan.borrower.lastName[0]}
                                            </div>
                                            <div>
                                                <h3 className="font-black text-slate-900 leading-tight tracking-tight">{loan.borrower.firstName} {loan.borrower.lastName}</h3>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="text-[11px] font-black text-indigo-500/70 uppercase tracking-tighter">ID: {loan.id.slice(-6).toUpperCase()}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className={`px-4 py-2 rounded-2xl font-black uppercase tracking-widest text-[10px] w-fit mb-6 shadow-sm ${daysLate > 30 ? 'bg-rose-600 text-white' : 'bg-amber-400 text-slate-900'}`}>
                                        {daysLate} Days Delinquent
                                    </div>

                                    <div className="space-y-4">
                                        <div className="flex justify-between items-end border-b border-slate-50 pb-3">
                                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Overdue Balance</span>
                                            <span className="text-xl font-black text-rose-600 tracking-tight">${totalOverdue.toLocaleString()}</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Oldest Due Date</p>
                                                <p className="font-bold text-slate-700 text-xs">{oldestDue.toLocaleDateString()}</p>
                                            </div>
                                            <div>
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Principal</p>
                                                <p className="font-bold text-slate-700 text-xs">${loan.principal.toLocaleString()}</p>
                                            </div>
                                        </div>
                                        <div className="pt-2">
                                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Client Hotline</p>
                                            <p className="font-black text-indigo-600 group-hover:underline flex items-center gap-2">
                                                <Phone size={14} /> {loan.borrower.phone}
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div className="mt-8 flex gap-3">
                                    <Link href={`/${locale}/loans/${loan.id}`} className="flex-1">
                                        <Button variant="secondary" className="w-full rounded-2xl font-bold h-11 text-[11px] uppercase tracking-widest">
                                            <Eye size={14} className="mr-2" /> Details
                                        </Button>
                                    </Link>
                                    <Button className="flex-1 bg-slate-950 text-white rounded-2xl font-black h-11 text-[11px] uppercase tracking-widest shadow-lg shadow-slate-950/20 hover:bg-slate-800 transition-all">
                                        <MessageSquare size={14} className="mr-2" /> Log Call
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
