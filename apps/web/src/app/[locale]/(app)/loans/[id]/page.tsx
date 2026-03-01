"use client";

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { ChevronLeft, Plus, CheckCircle, Trash2, FileText, Download, ThumbsUp } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { RepaymentModal } from '@/components/RepaymentModal';

interface ScheduleItem {
    installmentNumber: number;
    dueDate: string;
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    outstandingPrincipal: number;
    paidPrincipal: number;
    paidInterest: number;
    isPaid: boolean;
}

interface Repayment {
    id: string;
    amount: number;
    date: string;
    principalPaid: number;
    interestPaid: number;
}

interface Document {
    id: string;
    name: string;
    content: string;
    type: string;
    createdAt: string;
}

interface Loan {
    id: string;
    borrower: {
        id: string;
        firstName: string;
        lastName: string;
        phone: string;
        loans: {
            id: string;
            status: string;
            principal: number;
            createdAt: string;
        }[];
    };
    principal: number;
    annualInterestRate: number;
    termMonths: number;
    startDate: string;
    interestMethod: string;
    status: string;
    schedules: ScheduleItem[];
    repayments: Repayment[];
    documents: Document[];
}

export default function LoanDetailsPage() {
    const { id, locale } = useParams();
    const router = useRouter();
    const t = useTranslations('LoanDetails');
    const { showToast } = useToast();
    const confirm = useConfirm();
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

    const handleApprove = async () => {
        const ok = await confirm({
            title: 'Approve Loan',
            message: 'This loan will move to APPROVED status, awaiting disbursement.',
            confirmLabel: 'Approve',
            variant: 'default',
        });
        if (!ok) return;
        try {
            await api.put(`/loans/${id}/status`, { status: 'APPROVED' });
            showToast('Loan approved successfully', 'success');
            fetchLoan();
        } catch (error) {
            showToast('Failed to approve loan', 'error');
        }
    };

    const handleDisburse = async () => {
        const ok = await confirm({
            title: 'Disburse Loan',
            message: 'This will activate the repayment schedule. The borrower will receive the funds.',
            confirmLabel: 'Disburse',
            variant: 'warning',
        });
        if (!ok) return;
        try {
            await api.put(`/loans/${id}/status`, { status: 'DISBURSED' });
            showToast('Loan disbursed — repayment schedule is now active', 'success');
            fetchLoan();
        } catch (error) {
            showToast('Failed to disburse loan', 'error');
        }
    };

    const handleDelete = async () => {
        const ok = await confirm({
            title: 'Delete Draft Loan',
            message: 'This draft loan will be permanently deleted. This cannot be undone.',
            confirmLabel: 'Delete',
            variant: 'danger',
        });
        if (!ok) return;
        try {
            await api.delete(`/loans/${id}`);
            showToast('Loan deleted', 'success');
            router.push(`/${locale}/loans`);
        } catch (error) {
            showToast('Failed to delete loan', 'error');
        }
    };

    const [uploadingDoc, setUploadingDoc] = useState(false);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) {
            showToast('File too large. Limit is 5MB.', 'error');
            return;
        }
        setUploadingDoc(true);

        const formData = new FormData();
        formData.append('file', file);

        try {
            await api.post(`/documents/upload/${id}`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            showToast('Document uploaded successfully to Vault', 'success');
            fetchLoan();
        } catch {
            showToast('Upload failed', 'error');
        } finally {
            setUploadingDoc(false);
        }
    };

    const handleDownloadDoc = async (docId: string, name: string) => {
        try {
            const res = await api.get(`/documents/download/${docId}`, { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', name);
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch {
            showToast('Download failed', 'error');
        }
    };

    const handleDeleteDoc = async (docId: string) => {
        const ok = await confirm({
            title: 'Delete Document',
            message: 'This document will be permanently removed from this loan.',
            confirmLabel: 'Delete',
            variant: 'danger',
        });
        if (!ok) return;
        try {
            await api.delete(`/loans/${id}/documents/${docId}`);
            showToast('Document deleted', 'success');
            fetchLoan();
        } catch {
            showToast('Delete failed', 'error');
        }
    };

    useEffect(() => {
        fetchLoan();
    }, [fetchLoan]);

    if (loading) return <div>Loading...</div>;
    if (!loan) return <div>Loan not found</div>;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Link href={`/${locale}/loans`}>
                        <Button variant="ghost" size="icon"><ChevronLeft size={24} /></Button>
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold">{t('title')}</h1>
                        <Link href={`/${locale}/borrowers/${loan.borrower.id}`} className="text-sm text-blue-600 hover:underline">
                            {loan.borrower.firstName} {loan.borrower.lastName} →
                        </Link>
                    </div>
                </div>
                <div className="flex gap-2">
                    {loan.status === 'DRAFT' && (
                        <>
                            <Button onClick={handleDelete} variant="destructive" className="flex items-center gap-2">
                                <Trash2 size={16} /> Delete Draft
                            </Button>
                            <Button onClick={handleApprove} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700">
                                <ThumbsUp size={16} /> Approve
                            </Button>
                        </>
                    )}
                    {loan.status === 'APPROVED' && (
                        <Button onClick={handleDisburse} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700">
                            <CheckCircle size={16} /> Disburse Loan
                        </Button>
                    )}
                    {loan.status === 'DISBURSED' && (
                        <Button onClick={() => setIsModalOpen(true)} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700">
                            <Plus size={16} /> Make a Payment
                        </Button>
                    )}
                </div>
            </div>

            <RepaymentModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                onSuccess={fetchLoan}
                defaultLoanId={loan.id}
            />

            {loan.status === 'DRAFT' && loan.borrower.loans && loan.borrower.loans.length > 1 && (
                <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-lg">
                    <div className="flex">
                        <div className="ml-3">
                            <h3 className="text-sm font-medium text-amber-800">Review Existing Loans</h3>
                            <div className="mt-2 text-sm text-amber-700">
                                <p>Before approving this loan, please notice that this borrower has existing loan records:</p>
                                <ul className="list-disc pl-5 mt-1 space-y-1">
                                    {(loan.borrower?.loans || []).filter(l => l.id !== loan.id).map(l => (
                                        <li key={l.id}>
                                            <Link href={`/${locale}/loans/${l.id}`} className="font-semibold underline">
                                                Loan ${l.principal?.toLocaleString()}
                                            </Link>
                                            {' '}- Status: <span className="font-bold">{l.status}</span> (Created {l.createdAt ? new Date(l.createdAt).toLocaleDateString() : 'N/A'})
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            )}

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
                                <th className="text-right py-2 font-medium text-gray-500">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {loan.schedules.map((item) => (
                                <tr key={item.installmentNumber}>
                                    <td className="py-2">{item.installmentNumber}</td>
                                    <td className="py-2">{new Date(item.dueDate).toLocaleDateString()}</td>
                                    <td className="py-2 text-right">
                                        <div className="flex flex-col text-right">
                                            <span>${item.principalAmount.toLocaleString()}</span>
                                            {Number(item.paidPrincipal) > 0 && <span className="text-[10px] text-blue-600">Paid: ${item.paidPrincipal.toLocaleString()}</span>}
                                        </div>
                                    </td>
                                    <td className="py-2 text-right">
                                        <div className="flex flex-col text-right">
                                            <span>${item.interestAmount.toLocaleString()}</span>
                                            {Number(item.paidInterest) > 0 && <span className="text-[10px] text-green-600">Paid: ${item.paidInterest.toLocaleString()}</span>}
                                        </div>
                                    </td>
                                    <td className="py-2 text-right font-medium">${item.totalAmount.toLocaleString()}</td>
                                    <td className="py-2 text-right">
                                        {item.isPaid ? (
                                            <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-[10px] font-bold">PAID</span>
                                        ) : Number(item.paidPrincipal) + Number(item.paidInterest) > 0 ? (
                                            <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 text-[10px] font-bold">PARTIAL</span>
                                        ) : (
                                            <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-800 text-[10px] font-bold">DUE</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
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
                            {(!loan.repayments || loan.repayments.length === 0) ? (
                                <tr><td colSpan={4} className="py-4 text-center text-gray-500">No repayments yet.</td></tr>
                            ) : (
                                (loan.repayments || []).map((rp) => (
                                    <tr key={rp.id}>
                                        <td className="py-2">{new Date(rp.date).toLocaleDateString()}</td>
                                        <td className="py-2 text-right font-medium">${Number(rp.amount || 0).toLocaleString()}</td>
                                        <td className="py-2 text-right text-green-600">${Number(rp.interestPaid || 0).toLocaleString()}</td>
                                        <td className="py-2 text-right text-blue-600">${Number(rp.principalPaid || 0).toLocaleString()}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="bg-white p-6 rounded-lg shadow overflow-hidden">
                    <div className="flex justify-between items-center border-b pb-2 mb-4">
                        <h2 className="text-lg font-semibold">Documents</h2>
                        <div className="relative">
                            <input
                                type="file"
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                onChange={handleFileUpload}
                                disabled={uploadingDoc}
                            />
                            <Button size="sm" variant="outline" disabled={uploadingDoc}>
                                {uploadingDoc ? 'Uploading...' : 'Upload File'}
                            </Button>
                        </div>
                    </div>
                    {(!loan.documents || loan.documents.length === 0) ? (
                        <div className="text-center py-4 text-gray-500">No documents attached.</div>
                    ) : (
                        <ul className="divide-y divide-gray-100">
                            {loan.documents.map(doc => (
                                <li key={doc.id} className="py-3 flex justify-between items-center">
                                    <div className="flex items-center gap-3 overflow-hidden">
                                        <FileText size={20} className="text-gray-400 shrink-0" />
                                        <span className="truncate text-sm font-medium">{doc.name}</span>
                                    </div>
                                    <div className="flex gap-2 shrink-0">
                                        <Button size="icon" variant="ghost" className="text-blue-600 h-8 w-8" onClick={() => handleDownloadDoc(doc.id, doc.name)}>
                                            <Download size={16} />
                                        </Button>
                                        <Button size="icon" variant="ghost" className="text-red-500 h-8 w-8" onClick={() => handleDeleteDoc(doc.id)}>
                                            <Trash2 size={16} />
                                        </Button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
}
