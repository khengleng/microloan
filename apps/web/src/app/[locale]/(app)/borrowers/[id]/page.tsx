"use client";

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useWorkspace } from '@/lib/workspace';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Phone, MapPin, CreditCard, FileText, Eye, Plus, UserCheck, Wallet, Activity, Calendar, ShieldCheck, ShieldAlert, ShieldQuestion, Loader2, Building2, Briefcase, Cake } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BorrowerModal } from '@/components/BorrowerModal';
import { BorrowerKycReview } from '@/components/BorrowerKycReview';
import { AmlCustomerPanel } from '@/components/lending/aml/AmlCustomerPanel';

interface CreditCheck {
    id: string;
    status: string;
    score: number | null;
    grade: string | null;
    summary: string | null;
    provider: string;
    createdAt: string;
    completedAt?: string | null;
}

const CREDIT_STATUS_STYLES: Record<string, string> = {
    COMPLETED: 'bg-emerald-100 text-emerald-700',
    PENDING: 'bg-amber-100 text-amber-700',
    PROCESSING: 'bg-indigo-100 text-indigo-700',
    FAILED: 'bg-rose-100 text-rose-700',
};

const STATUS_STYLES: Record<string, string> = {
    DRAFT: 'bg-slate-100 text-slate-500',
    APPROVED: 'bg-indigo-100 text-indigo-700',
    DISBURSED: 'bg-emerald-100 text-emerald-700 shadow-sm',
    CLOSED: 'bg-slate-200 text-slate-500',
    DEFAULTED: 'bg-rose-100 text-rose-700',
};

interface Borrower {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    address: string;
    idNumber: string;
    telegramChatId?: string;
    createdAt: string;
    kycStatus?: 'PENDING' | 'VERIFIED' | 'REJECTED' | string;
    amlStatus?: string | null;
    dateOfBirth?: string | null;
    idType?: string | null;
    occupation?: string | null;
    branchId?: string | null;
    branch?: { id: string; name: string; code: string | null } | null;
    monthlyIncome?: number | null;
    monthlyExpenses?: number | null;
    loans?: {
        id: string;
        principal: number;
        status: string;
        annualInterestRate: number;
        termMonths: number;
        startDate: string;
        interestMethod: string;
    }[];
}

export default function BorrowerProfilePage() {
    const { id, locale } = useParams();
    const { showToast } = useToast();
    const tc = useTranslations('Customers');
    const t = useTranslations('Borrowers.profile');
    const st = useTranslations('Status');
    const { legacyCan } = useWorkspace();
    const [borrower, setBorrower] = useState<Borrower | null>(null);
    const [loading, setLoading] = useState(true);
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [creditChecks, setCreditChecks] = useState<CreditCheck[]>([]);
    const [runningCheck, setRunningCheck] = useState(false);
    const [cbcNotice, setCbcNotice] = useState<string | null>(null);

    const fetch = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get(`/borrowers/${id}`);
            setBorrower(res.data);
        } catch {
            showToast(t('loadFailed'), 'error');
        } finally {
            setLoading(false);
        }
    }, [id]);

    const fetchCreditChecks = useCallback(async () => {
        try {
            const res = await api.get(`/credit-checks/borrower/${id}`);
            setCreditChecks(res.data);
        } catch {
            // non-fatal: credit history simply won't render
        }
    }, [id]);

    const handleRunCreditCheck = async () => {
        setRunningCheck(true);
        setCbcNotice(null);
        try {
            await api.post('/credit-checks', { borrowerId: id });
            showToast(t('creditCheckSubmitted'), 'success');
            fetchCreditChecks();
        } catch (err: any) {
            // 503 = integration not provisioned yet; surface the exact server message.
            const msg = err?.response?.data?.message || t('creditCheckFailed');
            setCbcNotice(msg);
            if (err?.response?.status !== 503) showToast(t('creditCheckFailed'), 'error');
        } finally {
            setRunningCheck(false);
        }
    };

    useEffect(() => { fetch(); }, [fetch]);
    useEffect(() => { fetchCreditChecks(); }, [fetchCreditChecks]);

    if (loading) return <div className="flex h-64 items-center justify-center text-slate-400 font-black animate-pulse uppercase tracking-[0.2em]">{t('loading')}</div>;
    if (!borrower) return <div className="text-center py-20 font-black text-rose-500">{t('notFound')}</div>;

    const loans = borrower.loans ?? [];
    const totalBorrowed = loans.reduce((s, l) => s + Number(l.principal), 0);
    const activeLoans = loans.filter(l => l.status === 'DISBURSED').length;
    const closedLoans = loans.filter(l => l.status === 'CLOSED').length;
    // The badge shows the customer's recorded KYC status, never a fixed label.
    const kyc = borrower.kycStatus === 'VERIFIED'
        ? { cls: 'bg-emerald-100 text-emerald-700', icon: <UserCheck size={12} />, label: tc('kycBadge.VERIFIED') }
        : borrower.kycStatus === 'REJECTED'
            ? { cls: 'bg-rose-100 text-rose-700', icon: <ShieldAlert size={12} />, label: tc('kycBadge.REJECTED') }
            : { cls: 'bg-amber-100 text-amber-700', icon: <ShieldQuestion size={12} />, label: tc('kycBadge.PENDING') };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header / Actions */}
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
                <div className="flex items-center gap-4">
                    <Link href={`/${locale}/borrowers`}>
                        <div className="w-12 h-12 glass rounded-2xl flex items-center justify-center text-slate-600 hover:bg-white hover:text-indigo-600 transition-all shadow-sm">
                            <ChevronLeft size={24} />
                        </div>
                    </Link>
                    <div>
                        <h1 className="text-3xl font-black text-slate-900 tracking-tight">{t('title')}</h1>
                        <p className="text-slate-500 font-medium">{t('subtitle')}</p>
                    </div>
                </div>
                <div className="flex gap-3">
                    <Link href={`/${locale}/lending/customers/${id}/documents`}>
                        <Button variant="secondary" className="rounded-2xl font-bold px-6 h-12 shadow-sm">
                            {t('documents')}
                        </Button>
                    </Link>
                    <Link href={`/${locale}/lending/customers/${id}/alternative-data`}>
                        <Button variant="secondary" className="rounded-2xl font-bold px-6 h-12 shadow-sm">
                            {t('alternativeData')}
                        </Button>
                    </Link>
                {legacyCan('CUSTOMER_UPDATE') && (
                <Button
                        onClick={() => setIsEditOpen(true)}
                        variant="secondary"
                        className="rounded-2xl font-bold px-8 h-12 shadow-sm"
                    >
                        {t('modifyProfile')}
                    </Button>
                )}
                </div>
            </div>

            {/* Profile Overview Card */}
            <div className="glass p-8 rounded-[2.5rem] premium-shadow border-indigo-100/10 relative overflow-hidden group">
                <div className="absolute top-0 right-0 w-48 h-48 bg-indigo-500/5 rounded-full -mr-20 -mt-20" />

                <div className="flex flex-col md:flex-row gap-8 items-start relative">
                    <div className="w-24 h-24 rounded-[2rem] bg-indigo-600 text-white flex items-center justify-center text-3xl font-black shadow-lg shadow-indigo-200">
                        {borrower.firstName.charAt(0).toUpperCase()}{borrower.lastName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                            <h2 className="text-3xl font-black text-slate-900 tracking-tight">{borrower.firstName} {borrower.lastName}</h2>
                            <span className={`${kyc.cls} px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow-sm flex items-center gap-1.5`}>{kyc.icon} {kyc.label}</span>
                            {borrower.amlStatus === 'FLAGGED' && (
                                <span className="bg-rose-100 text-rose-700 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest shadow-sm flex items-center gap-1.5"><ShieldAlert size={12} /> {tc('aml.FLAGGED')}</span>
                            )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-y-4 gap-x-8 mt-4">
                            {borrower.phone && (
                                <div className="space-y-1">
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('phoneNumber')}</p>
                                    <p className="font-extrabold text-slate-800 flex items-center gap-1.5 text-sm"><Phone size={14} className="text-indigo-500" />{borrower.phone}</p>
                                </div>
                            )}
                            {borrower.idNumber && (
                                <div className="space-y-1">
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('nationalIdPassport')}</p>
                                    <p className="font-extrabold text-slate-800 flex items-center gap-1.5 text-sm"><CreditCard size={14} className="text-indigo-500" />{borrower.idNumber}</p>
                                </div>
                            )}
                            {borrower.address && (
                                <div className="space-y-1 lg:col-span-1">
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('residence')}</p>
                                    <p className="font-extrabold text-slate-800 flex items-center gap-1.5 text-sm truncate max-w-xs"><MapPin size={14} className="text-indigo-500" />{borrower.address}</p>
                                </div>
                            )}
                            <div className="space-y-1">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{tc('branch')}</p>
                                <p className="font-extrabold text-slate-800 flex items-center gap-1.5 text-sm"><Building2 size={14} className="text-indigo-500" />{borrower.branch ? borrower.branch.name : <span className="text-amber-700">{tc('noBranchYet')}</span>}</p>
                            </div>
                            <div className="space-y-1">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{tc('dateOfBirth')}</p>
                                <p className="font-extrabold text-slate-800 flex items-center gap-1.5 text-sm"><Cake size={14} className="text-indigo-500" />{borrower.dateOfBirth ? String(borrower.dateOfBirth).slice(0, 10) : tc('notRecorded')}</p>
                            </div>
                            <div className="space-y-1">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{tc('idType')} · {tc('occupation')}</p>
                                <p className="font-extrabold text-slate-800 flex items-center gap-1.5 text-sm"><Briefcase size={14} className="text-indigo-500" />{borrower.idType ? tc.has(`idTypes.${borrower.idType}`) ? tc(`idTypes.${borrower.idType}`) : borrower.idType : tc('notRecorded')} · {borrower.occupation || tc('notRecorded')}</p>
                            </div>
                            <div className="space-y-1">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{tc('amlStatus')}</p>
                                <p className="font-extrabold text-slate-800 flex items-center gap-1.5 text-sm"><ShieldCheck size={14} className="text-indigo-500" />{tc(`aml.${borrower.amlStatus && ['NOT_SCREENED', 'CLEAR', 'FLAGGED'].includes(borrower.amlStatus) ? borrower.amlStatus : 'NOT_SCREENED'}`)}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-1.5 mt-6 text-[10px] font-black text-slate-300 uppercase tracking-widest italic">
                            <Calendar size={12} /> {t('originated', { date: new Date(borrower.createdAt).toLocaleDateString() })}
                        </div>
                    </div>
                </div>

                {/* Performance Stats Overlay */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-10 pt-8 border-t border-slate-100/50">
                    <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100/50 text-center">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">{t('historicalCount')}</p>
                        <p className="text-2xl font-black text-slate-900">{loans.length} <span className="text-xs text-slate-300">{t('loansUnit', { count: loans.length })}</span></p>
                    </div>
                    <div className="p-5 bg-emerald-50/50 rounded-3xl border border-emerald-100/20 text-center">
                        <p className="text-[10px] font-black text-emerald-600/60 uppercase tracking-widest mb-1.5">{t('activePortfolios')}</p>
                        <p className="text-2xl font-black text-emerald-700">{activeLoans}</p>
                    </div>
                    <div className="p-5 bg-slate-50/50 rounded-3xl border border-slate-100/50 text-center">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">{t('closedRecords')}</p>
                        <p className="text-2xl font-black text-slate-400">{closedLoans}</p>
                    </div>
                    <div className="p-5 bg-indigo-50/50 rounded-3xl border border-indigo-100/20 text-center">
                        <p className="text-[10px] font-black text-indigo-600/60 uppercase tracking-widest mb-1.5">{t('cumulativeDebt')}</p>
                        <p className="text-2xl font-black text-indigo-600">${totalBorrowed.toLocaleString()}</p>
                    </div>
                </div>
            </div>

            {/* Content Tabs / Sections */}
            <div className="grid grid-cols-1 gap-8">
                {/* Manual e-KYC review (borrower-uploaded documents) */}
                <BorrowerKycReview borrowerId={String(id)} onChange={fetch} />

                {/* AML/CFT: status, risk rating, screening, EDD and referrals (D-118…D-122) */}
                <AmlCustomerPanel borrowerId={String(id)} onChange={fetch} />

                {/* Loan History Table */}
                <div className="glass p-8 rounded-[2.5rem] premium-shadow border-indigo-100/10">
                    <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
                        <h3 className="text-xl font-black text-slate-900 flex items-center gap-3 tracking-tight">
                            <Activity size={22} className="text-indigo-600" /> {t('loanRegister')}
                        </h3>
                        <Link href={`/${locale}/loans`}>
                            <Button className="rounded-2xl font-black text-[10px] uppercase tracking-widest bg-slate-950 text-white hover:bg-slate-800 h-10 px-6 gap-2">
                                <Plus size={14} /> {t('originate')}
                            </Button>
                        </Link>
                    </div>

                    {loans.length === 0 ? (
                        <div className="py-20 text-center bg-slate-50/50 rounded-3xl border border-dashed border-slate-200">
                            <FileText size={48} strokeWidth={1} className="mx-auto text-slate-300 mb-4" />
                            <p className="text-slate-400 font-extrabold uppercase tracking-widest text-[10px]">{t('noLoans')}</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto no-scrollbar">
                            <table className="w-full border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-100">
                                        <th className="text-left py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('colPrincipal')}</th>
                                        <th className="text-right py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest hidden md:table-cell">{t('colRate')}</th>
                                        <th className="text-right py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest hidden md:table-cell">{t('colTerm')}</th>
                                        <th className="text-right py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest hidden lg:table-cell">{t('colMethod')}</th>
                                        <th className="text-right py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('colStatus')}</th>
                                        <th className="text-right py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('colAction')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100/50">
                                    {loans.map(loan => (
                                        <tr key={loan.id} className="group hover:bg-slate-50/50 transition-colors">
                                            <td className="py-5">
                                                <p className="text-base font-black text-slate-900 tracking-tight">${Number(loan.principal).toLocaleString()}</p>
                                                <p className="text-[10px] font-bold text-slate-400 mt-0.5">{t('idLabel', { id: loan.id.slice(-6).toUpperCase() })}</p>
                                            </td>
                                            <td className="py-5 text-right font-black text-indigo-600 text-sm hidden md:table-cell">{loan.annualInterestRate}%</td>
                                            <td className="py-5 text-right font-extrabold text-slate-700 text-sm hidden md:table-cell">{t('termMonths', { n: loan.termMonths })}</td>
                                            <td className="py-5 text-right font-bold text-slate-400 text-[10px] uppercase hidden lg:table-cell">{loan.interestMethod}</td>
                                            <td className="py-5 text-right">
                                                <span className={`px-3 py-1 text-[9px] font-black uppercase tracking-widest rounded-full shadow-sm ${STATUS_STYLES[loan.status] || 'bg-gray-100 text-gray-600'}`}>
                                                    {st.has(loan.status) ? st(loan.status) : loan.status}
                                                </span>
                                            </td>
                                            <td className="py-5 text-right">
                                                <Link href={`/${locale}/loans/${loan.id}`}>
                                                    <div className="w-10 h-10 ml-auto rounded-xl bg-slate-50 text-slate-400 hover:text-indigo-600 hover:bg-white transition-all shadow-sm flex items-center justify-center border border-slate-100">
                                                        <Eye size={16} />
                                                    </div>
                                                </Link>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
                {/* Credit Bureau (CBC) */}
                <div className="glass p-8 rounded-[2.5rem] premium-shadow border-indigo-100/10">
                    <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
                        <h3 className="text-xl font-black text-slate-900 flex items-center gap-3 tracking-tight">
                            <ShieldCheck size={22} className="text-indigo-600" /> {t('creditBureau')}
                        </h3>
                        <Button
                            onClick={handleRunCreditCheck}
                            disabled={runningCheck}
                            className="rounded-2xl font-black text-[10px] uppercase tracking-widest bg-slate-950 text-white hover:bg-slate-800 h-10 px-6 gap-2 disabled:opacity-60"
                        >
                            {runningCheck ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} {t('runCreditCheck')}
                        </Button>
                    </div>

                    {cbcNotice && (
                        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
                            <ShieldCheck size={18} className="text-amber-500 shrink-0" />
                            <p className="text-[13px] font-bold text-amber-700">{cbcNotice}</p>
                        </div>
                    )}

                    {creditChecks.length === 0 ? (
                        <div className="py-20 text-center bg-slate-50/50 rounded-3xl border border-dashed border-slate-200">
                            <ShieldCheck size={48} strokeWidth={1} className="mx-auto text-slate-300 mb-4" />
                            <p className="text-slate-400 font-extrabold uppercase tracking-widest text-[10px]">{t('noCreditChecks')}</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto no-scrollbar">
                            <table className="w-full border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-100">
                                        <th className="text-left py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('colDate')}</th>
                                        <th className="text-left py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest hidden md:table-cell">{t('colProvider')}</th>
                                        <th className="text-left py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('colCheckStatus')}</th>
                                        <th className="text-right py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('colScore')}</th>
                                        <th className="text-right py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">{t('colGrade')}</th>
                                        <th className="text-left py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest hidden lg:table-cell">{t('colSummary')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100/50">
                                    {creditChecks.map(check => (
                                        <tr key={check.id} className="group hover:bg-slate-50/50 transition-colors">
                                            <td className="py-5 text-sm font-extrabold text-slate-800">{new Date(check.createdAt).toLocaleDateString()}</td>
                                            <td className="py-5 text-sm font-bold text-slate-500 hidden md:table-cell">{check.provider}</td>
                                            <td className="py-5">
                                                <span className={`px-3 py-1 text-[9px] font-black uppercase tracking-widest rounded-full shadow-sm ${CREDIT_STATUS_STYLES[check.status] || 'bg-gray-100 text-gray-600'}`}>
                                                    {st.has(check.status) ? st(check.status) : check.status}
                                                </span>
                                            </td>
                                            <td className="py-5 text-right font-black text-indigo-600 text-sm">{check.score ?? '—'}</td>
                                            <td className="py-5 text-right font-black text-slate-900 text-sm">{check.grade ?? '—'}</td>
                                            <td className="py-5 text-sm text-slate-500 font-medium max-w-md hidden lg:table-cell">{check.summary ?? '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            <BorrowerModal
                open={isEditOpen}
                onOpenChange={setIsEditOpen}
                onSuccess={() => { fetch(); showToast(t('updated'), 'success'); }}
                borrower={borrower}
            />
        </div>
    );
}
