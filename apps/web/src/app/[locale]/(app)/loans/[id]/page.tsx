"use client";

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ChevronLeft, Plus, CheckCircle, Trash2, FileText, Download } from 'lucide-react';
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
    documents: Document[];
}

export default function LoanDetailsPage() {
    const { id, locale } = useParams();
    const router = useRouter();
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

    const handleDisburse = async () => {
        if (!confirm('Are you sure you want to disburse this loan? This will activate the repayment schedule.')) return;
        try {
            await api.put(`/loans/${id}/status`, { status: 'DISBURSED' });
            fetchLoan();
        } catch (error) {
            console.error('Failed to disburse loan', error);
            alert('Failed to disburse loan');
        }
    };

    const handleDelete = async () => {
        if (!confirm('Are you sure you want to delete this DRAFT loan? This action cannot be undone.')) return;
        try {
            await api.delete(`/loans/${id}`);
            router.push(`/${locale}/loans`);
        } catch (error) {
            console.error('Failed to delete loan', error);
            alert('Failed to delete loan');
        }
    };

    const [uploadingDoc, setUploadingDoc] = useState(false);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            alert('File is too large. Limit is 5MB.');
            return;
        }

        setUploadingDoc(true);
        const reader = new FileReader();
        reader.onloadend = async () => {
            const base64Content = reader.result as string;
            try {
                await api.post(`/loans/${id}/documents`, {
                    name: file.name,
                    content: base64Content,
                    type: file.type || 'application/octet-stream',
                });
                fetchLoan();
            } catch (error) {
                console.error('Upload failed', error);
                alert('Upload failed');
            } finally {
                setUploadingDoc(false);
            }
        };
        reader.readAsDataURL(file);
    };

    const handleDeleteDoc = async (docId: string) => {
        if (!confirm('Delete this document?')) return;
        try {
            await api.delete(`/loans/${id}/documents/${docId}`);
            fetchLoan();
        } catch (error) {
            console.error('Delete failed', error);
            alert('Delete failed');
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
                <div className="flex items-center gap-4">
                    <Link href={`/${locale}/loans`}>
                        <Button variant="ghost" size="icon">
                            <ChevronLeft size={24} />
                        </Button>
                    </Link>
                    <h1 className="text-2xl font-bold">{t('title')} - {loan.borrower.firstName} {loan.borrower.lastName}</h1>
                </div>
                <div className="flex gap-2">
                    {loan.status === 'DRAFT' && (
                        <>
                            <Button onClick={handleDelete} variant="destructive" className="flex items-center gap-2">
                                <Trash2 size={16} />
                                Delete Draft
                            </Button>
                            <Button onClick={handleDisburse} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700">
                                <CheckCircle size={16} />
                                Disburse Loan
                            </Button>
                        </>
                    )}
                    {loan.status === 'DISBURSED' && (
                        <Button onClick={() => setIsModalOpen(true)} className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700">
                            <Plus size={16} />
                            Make a Payment
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
                                        <a href={doc.content} download={doc.name}>
                                            <Button size="icon" variant="ghost" className="text-blue-600 h-8 w-8">
                                                <Download size={16} />
                                            </Button>
                                        </a>
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
