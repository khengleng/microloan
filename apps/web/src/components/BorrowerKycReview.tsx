"use client";

import { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { ShieldCheck, ShieldAlert, ShieldQuestion, Loader2, Check, X } from 'lucide-react';

type Doc = { id: string; type: string; content: string; mimeType?: string | null; createdAt: string };

const DOC_LABEL: Record<string, string> = {
    NATIONAL_ID_FRONT: 'National ID (front)',
    NATIONAL_ID_BACK: 'National ID (back)',
    PASSPORT: 'Passport',
    SELFIE: 'Selfie',
    PROOF_OF_ADDRESS: 'Proof of address',
    OTHER: 'Other',
};

export function BorrowerKycReview({ borrowerId }: { borrowerId: string }) {
    const { showToast } = useToast();
    const [status, setStatus] = useState<string>('PENDING');
    const [docs, setDocs] = useState<Doc[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState('');

    const load = useCallback(() => {
        setLoading(true);
        api.get(`/kyc/${borrowerId}/documents`)
            .then(res => { setStatus(res.data.kycStatus); setDocs(res.data.documents || []); })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [borrowerId]);
    useEffect(load, [load]);

    const setKyc = async (next: 'VERIFIED' | 'REJECTED') => {
        setSaving(next);
        try {
            await api.post(`/kyc/${borrowerId}/verify`, { status: next });
            showToast(next === 'VERIFIED' ? 'Identity verified' : 'Verification rejected', 'success');
            load();
        } catch (err: any) {
            showToast(err.response?.data?.message || 'Action failed', 'error');
        } finally { setSaving(''); }
    };

    const badge = status === 'VERIFIED'
        ? { icon: <ShieldCheck size={16} />, cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', label: 'Verified' }
        : status === 'REJECTED'
            ? { icon: <ShieldAlert size={16} />, cls: 'text-red-700 bg-red-50 border-red-200', label: 'Rejected' }
            : { icon: <ShieldQuestion size={16} />, cls: 'text-amber-700 bg-amber-50 border-amber-200', label: 'Pending review' };

    return (
        <div className="glass p-8 rounded-[2.5rem] premium-shadow border-indigo-100/10">
            <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
                <h3 className="text-xl font-black text-slate-900 flex items-center gap-3 tracking-tight">
                    <ShieldCheck size={22} className="text-indigo-600" /> Identity Verification (KYC)
                </h3>
                <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border ${badge.cls}`}>
                    {badge.icon} {badge.label}
                </span>
            </div>

            {loading ? (
                <div className="flex items-center text-slate-400 text-sm py-6"><Loader2 className="animate-spin mr-2" size={15} /> Loading documents…</div>
            ) : docs.length === 0 ? (
                <p className="text-sm text-slate-400 py-4">No documents uploaded by the borrower yet.</p>
            ) : (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {docs.map(d => (
                            <a key={d.id} href={d.content} target="_blank" rel="noopener" className="block group">
                                <div className="aspect-square rounded-2xl border border-slate-200 overflow-hidden bg-slate-50 flex items-center justify-center">
                                    {(d.mimeType || '').startsWith('image') || d.content.startsWith('data:image')
                                        ? <img src={d.content} alt={d.type} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                                        : <span className="text-xs text-slate-400 px-2 text-center">{DOC_LABEL[d.type] || d.type}</span>}
                                </div>
                                <p className="text-[11px] text-slate-500 mt-1.5 text-center">{DOC_LABEL[d.type] || d.type}</p>
                            </a>
                        ))}
                    </div>

                    {status !== 'VERIFIED' && (
                        <div className="flex items-center gap-3 mt-6">
                            <button onClick={() => setKyc('VERIFIED')} disabled={!!saving}
                                className="flex items-center gap-2 bg-emerald-600 text-white font-bold text-sm px-5 py-2.5 rounded-2xl hover:bg-emerald-700 disabled:opacity-50">
                                {saving === 'VERIFIED' ? <Loader2 size={14} className="animate-spin" /> : <Check size={15} />} Approve
                            </button>
                            <button onClick={() => setKyc('REJECTED')} disabled={!!saving}
                                className="flex items-center gap-2 border border-red-200 text-red-700 font-bold text-sm px-5 py-2.5 rounded-2xl hover:bg-red-50 disabled:opacity-50">
                                {saving === 'REJECTED' ? <Loader2 size={14} className="animate-spin" /> : <X size={15} />} Reject
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
