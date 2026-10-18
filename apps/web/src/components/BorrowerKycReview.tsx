"use client";

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useWorkspace } from '@/lib/workspace';
import { ShieldCheck, ShieldAlert, ShieldQuestion, Loader2, Check, X, UserCheck } from 'lucide-react';

type Doc = {
    id: string; type: string; title?: string; content: string; mimeType?: string | null; createdAt: string; link?: string | null;
    origin?: 'PORTAL' | 'STAFF';
};

interface KycReview {
    kycStatus: string;
    verifiedAt?: string | null;
    verifiedBy?: { id: string; name: string | null } | null;
    pendingVerification?: { id: string; recordedBy: { id: string; name: string | null }; recordedAt: string; reason?: string | null } | null;
    you?: { uploadedDocuments: boolean; recordedVerification: boolean; mayRecord: boolean; mayConfirm: boolean };
    documents: Doc[];
}

/** Files held in the customer document library come as a short-lived link (API-served links go through the proxy). */
const srcOf = (d: Doc) => (d.link ? (/^https?:/.test(d.link) ? d.link : `/api/proxy${d.link}`) : d.content);

const DOC_TYPES = ['NATIONAL_ID_FRONT', 'NATIONAL_ID_BACK', 'NATIONAL_ID', 'PASSPORT', 'SELFIE', 'PROOF_OF_ADDRESS', 'OTHER'];

/**
 * Staff identity review: the documents the customer uploaded in the portal and
 * those staff filed in the document library. Verification takes two people —
 * one records it, a different one confirms — and whoever filed a document
 * cannot do either (enforced by the API; the buttons follow its answer).
 */
export function BorrowerKycReview({ borrowerId, onChange }: { borrowerId: string; onChange?: () => void }) {
    const t = useTranslations('Customers');
    const { locale } = useParams();
    const { showToast } = useToast();
    const { legacyCan } = useWorkspace();
    const [data, setData] = useState<KycReview | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState('');
    const [rejecting, setRejecting] = useState(false);
    const [reason, setReason] = useState('');
    const mayUpdate = legacyCan('CUSTOMER_UPDATE');

    const load = useCallback(() => {
        setLoading(true);
        api.get<KycReview>(`/kyc/${borrowerId}/documents`)
            .then(res => setData(res.data))
            .catch(() => {})
            .finally(() => setLoading(false));
    }, [borrowerId]);
    useEffect(load, [load]);

    const setKyc = async (next: 'VERIFIED' | 'REJECTED') => {
        if (next === 'REJECTED' && reason.trim().length < 3) { showToast(t('kyc.reasonNeeded'), 'error'); return; }
        setSaving(next);
        try {
            const res = await api.post<{ kycStatus: string }>(`/kyc/${borrowerId}/verify`, clean({ status: next, reason: reason.trim() }));
            showToast(
                next === 'REJECTED' ? t('kyc.rejectedToast') : res.data.kycStatus === 'VERIFIED' ? t('kyc.confirmedToast') : t('kyc.recordedToast'),
                'success',
            );
            setRejecting(false);
            setReason('');
            load();
            onChange?.();
        } catch (err: any) {
            showToast(err.response?.data?.message || t('kyc.failed'), 'error');
        } finally { setSaving(''); }
    };

    const status = data?.kycStatus ?? 'PENDING';
    const pending = data?.pendingVerification ?? null;
    const you = data?.you;
    const docs = data?.documents ?? [];
    const badge = status === 'VERIFIED'
        ? { icon: <ShieldCheck size={16} />, cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', label: t('kycBadge.VERIFIED') }
        : status === 'REJECTED'
            ? { icon: <ShieldAlert size={16} />, cls: 'text-red-700 bg-red-50 border-red-200', label: t('kycBadge.REJECTED') }
            : pending
                ? { icon: <ShieldQuestion size={16} />, cls: 'text-indigo-700 bg-indigo-50 border-indigo-200', label: t('kyc.awaitingConfirmation') }
                : { icon: <ShieldQuestion size={16} />, cls: 'text-amber-700 bg-amber-50 border-amber-200', label: t('kycBadge.PENDING') };
    const docLabel = (type: string) => (DOC_TYPES.includes(type) ? t(`kyc.docTypes.${type}`) : type.replace(/_/g, ' ').toLowerCase());
    const who = (p?: { id: string; name: string | null } | null) => p?.name ?? t('kyc.aColleague');

    // Why the verify button is not offered to this person, if it is not.
    const blocked = !you ? null
        : you.uploadedDocuments ? t('kyc.youUploaded')
            : you.recordedVerification ? t('kyc.youRecorded')
                : null;
    const verifyLabel = pending ? t('kyc.confirm') : t('kyc.record');
    const mayVerify = mayUpdate && status !== 'VERIFIED' && (pending ? !!you?.mayConfirm : !!you?.mayRecord);

    return (
        <div className="glass p-8 rounded-[2.5rem] premium-shadow border-indigo-100/10">
            <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
                <h3 className="text-xl font-black text-slate-900 flex items-center gap-3 tracking-tight">
                    <ShieldCheck size={22} className="text-indigo-600" /> {t('kyc.title')}
                </h3>
                <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border ${badge.cls}`}>
                    {badge.icon} {badge.label}
                </span>
            </div>

            {status === 'VERIFIED' && data?.verifiedBy && (
                <p className="text-sm text-slate-600 mb-4 flex items-center gap-2">
                    <UserCheck size={15} className="text-emerald-600" />
                    {t('kyc.verifiedBy', { name: who(data.verifiedBy), date: data.verifiedAt ? new Date(data.verifiedAt).toLocaleDateString() : '—' })}
                </p>
            )}
            {pending && (
                <div className="mb-4 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-800">
                    {t('kyc.pendingBy', { name: who(pending.recordedBy), date: new Date(pending.recordedAt).toLocaleString() })}
                    {pending.reason ? <span className="block text-indigo-700/80 mt-0.5">“{pending.reason}”</span> : null}
                </div>
            )}

            {loading && !data ? (
                <div className="flex items-center text-slate-400 text-sm py-6"><Loader2 className="animate-spin mr-2" size={15} /> {t('loading')}</div>
            ) : docs.length === 0 ? (
                <p className="text-sm text-slate-500 py-4">
                    {t('kyc.noDocuments')}{' '}
                    <Link href={`/${locale}/lending/customers/${borrowerId}/documents`} className="font-semibold text-indigo-600 hover:underline">{t('kyc.fileDocument')}</Link>
                </p>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {docs.map(d => (
                        <a key={d.id} href={srcOf(d)} target="_blank" rel="noopener" className="block group">
                            <div className="aspect-square rounded-2xl border border-slate-200 overflow-hidden bg-slate-50 flex items-center justify-center">
                                {(d.mimeType || '').startsWith('image') || d.content.startsWith('data:image')
                                    ? <img src={srcOf(d)} alt={docLabel(d.type)} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                                    : <span className="text-xs text-slate-400 px-2 text-center">{d.title || docLabel(d.type)}</span>}
                            </div>
                            <p className="text-[11px] text-slate-500 mt-1.5 text-center">
                                {docLabel(d.type)} · {d.origin === 'STAFF' ? t('kyc.filedByStaff') : t('kyc.fromPortal')}
                            </p>
                        </a>
                    ))}
                </div>
            )}

            {mayUpdate && status !== 'VERIFIED' && data && (
                <div className="mt-6 space-y-3">
                    {blocked && <p className="text-xs text-slate-500">{blocked}</p>}
                    {rejecting && (
                        <div>
                            <label htmlFor="kyc-reason" className="block text-xs font-semibold text-slate-600 mb-1">{t('kyc.rejectReason')}</label>
                            <textarea id="kyc-reason" value={reason} onChange={e => setReason(e.target.value)} rows={2} maxLength={500}
                                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" />
                        </div>
                    )}
                    <div className="flex items-center gap-3 flex-wrap">
                        {mayVerify && !rejecting && (
                            <button onClick={() => setKyc('VERIFIED')} disabled={!!saving}
                                className="flex items-center gap-2 bg-emerald-600 text-white font-bold text-sm px-5 py-2.5 rounded-2xl hover:bg-emerald-700 disabled:opacity-50">
                                {saving === 'VERIFIED' ? <Loader2 size={14} className="animate-spin" /> : <Check size={15} />} {verifyLabel}
                            </button>
                        )}
                        {status !== 'REJECTED' && (
                            <button onClick={() => (rejecting ? setKyc('REJECTED') : setRejecting(true))} disabled={!!saving}
                                className="flex items-center gap-2 border border-red-200 text-red-700 font-bold text-sm px-5 py-2.5 rounded-2xl hover:bg-red-50 disabled:opacity-50">
                                {saving === 'REJECTED' ? <Loader2 size={14} className="animate-spin" /> : <X size={15} />} {rejecting ? t('kyc.confirmReject') : t('kyc.reject')}
                            </button>
                        )}
                        {rejecting && (
                            <button onClick={() => { setRejecting(false); setReason(''); }} className="text-sm text-slate-500 hover:underline">{t('cancel')}</button>
                        )}
                    </div>
                    {!pending && mayVerify && <p className="text-xs text-slate-500">{t('kyc.twoPeopleHint')}</p>}
                </div>
            )}
        </div>
    );
}

function clean<T extends Record<string, unknown>>(o: T): Partial<T> {
    return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined)) as Partial<T>;
}
