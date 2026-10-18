"use client";

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileText, HandCoins, Trash2, Undo2, Upload } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useWorkspace } from '@/lib/workspace';

/*
 * Servicing tools for loans of the original module. Each control shows only
 * to people the API would let through: the route's roles (compared as the API
 * does, legacy names mapped to canonical ones) and the permission it checks.
 */

const CANONICAL: Record<string, string> = { ADMIN: 'TENANT_ADMIN', OPERATOR: 'LOAN_OFFICER', FINANCE: 'ACCOUNTANT', SALES: 'CUSTOMER_SUPPORT', CX: 'CUSTOMER_SUPPORT' };
const canon = (r: string | null | undefined) => (r ? CANONICAL[r] ?? r : '');

/** Roles listed on each original-module route (loans, repayments, collections controllers). */
const ROUTE_ROLES = {
    writeOff: ['ADMIN', 'FINANCE', 'TENANT_ADMIN', 'ACCOUNTANT', 'SUPERADMIN'],
    deleteLoan: ['ADMIN', 'OPERATOR'],
    uploadDocument: ['ADMIN', 'OPERATOR', 'SALES'],
    deleteDocument: ['ADMIN', 'OPERATOR'],
    reverseRepayment: ['ADMIN', 'FINANCE', 'TENANT_ADMIN', 'ACCOUNTANT', 'SUPERADMIN'],
    promises: ['ADMIN', 'OPERATOR', 'FINANCE', 'CX', 'TENANT_ADMIN', 'ACCOUNTANT', 'LOAN_OFFICER', 'BRANCH_MANAGER', 'CUSTOMER_SUPPORT'],
} as const;
const ROUTE_PERMISSION: Record<keyof typeof ROUTE_ROLES, string> = {
    writeOff: 'LOAN_WRITEOFF',
    deleteLoan: 'USER_DELETE',
    uploadDocument: 'DOCUMENT_UPLOAD',
    deleteDocument: 'DOCUMENT_DELETE',
    reverseRepayment: 'LOAN_REPAYMENT_POST',
    promises: 'CUSTOMER_UPDATE',
};

export function useLegacyAllowed() {
    const { legacyCan, legacyRole } = useWorkspace();
    return (what: keyof typeof ROUTE_ROLES) =>
        ROUTE_ROLES[what].some((r) => canon(r) === canon(legacyRole)) && legacyCan(ROUTE_PERMISSION[what]);
}

const cardCls = 'bg-white border border-border rounded-md';
const headCls = 'flex items-center gap-2 px-4 py-3 border-b border-border';
const inputCls = 'h-9 px-3 border border-border rounded text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';
const errText = (e: unknown, fallback: string) => {
    const m = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
    return Array.isArray(m) ? m.join('; ') : typeof m === 'string' ? m : fallback;
};

interface Promise_ { id: string; amount: string | number; currency: string; promisedDate: string; status: 'PENDING' | 'KEPT' | 'BROKEN'; notes?: string | null; createdAt: string }

/** UC-59: promises to pay — list, record, and mark kept or broken. */
export function PromisesToPayCard({ loanId, open }: { loanId: string; open: boolean }) {
    const t = useTranslations('Servicing.legacy');
    const { showToast } = useToast();
    const allowed = useLegacyAllowed()('promises');
    const [rows, setRows] = useState<Promise_[] | null>(null);
    const [amount, setAmount] = useState('');
    const [date, setDate] = useState('');
    const [notes, setNotes] = useState('');
    const [problem, setProblem] = useState('');
    const [busy, setBusy] = useState<string | null>(null);

    const load = useCallback(() => {
        api.get<Promise_[]>(`/collections/loans/${loanId}/promises`).then((r) => setRows(r.data), () => setRows([]));
    }, [loanId]);
    useEffect(() => { load(); }, [load]);

    const record = async () => {
        const n = Number(amount);
        if (!/^\d+(\.\d{1,2})?$/.test(amount.trim()) || !(n > 0)) { setProblem(t('promiseAmountInvalid')); return; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setProblem(t('promiseDateInvalid')); return; }
        setProblem('');
        setBusy('new');
        try {
            await api.post(`/collections/loans/${loanId}/promises`, { amount: n, promisedDate: date, ...(notes.trim() ? { notes: notes.trim() } : {}) });
            showToast(t('promiseRecorded'), 'success');
            setAmount(''); setDate(''); setNotes('');
            load();
        } catch (e) {
            setProblem(errText(e, t('failed')));
        } finally { setBusy(null); }
    };
    const mark = async (p: Promise_, status: 'KEPT' | 'BROKEN') => {
        setBusy(p.id);
        try {
            await api.patch(`/collections/promises/${p.id}`, { status });
            showToast(status === 'KEPT' ? t('markedKept') : t('markedBroken'), 'success');
            load();
        } catch (e) {
            showToast(errText(e, t('failed')), 'error');
        } finally { setBusy(null); }
    };

    return (
        <div className={cardCls} id="promises">
            <div className={headCls}><HandCoins size={14} className="text-primary" /><h3 className="text-sm font-bold text-foreground">{t('promisesTitle')}</h3></div>
            <div className="px-4 py-3 space-y-3">
                {rows === null ? <p className="text-xs text-muted-foreground">…</p> : rows.length === 0 ? <p className="text-sm text-muted-foreground">{t('noPromises')}</p> : (
                    <ul className="divide-y divide-border">
                        {rows.map((p) => (
                            <li key={p.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <p className="text-sm font-semibold">{p.currency} {Number(p.amount).toLocaleString()} · {t('by', { date: p.promisedDate.slice(0, 10) })}</p>
                                    {p.notes && <p className="text-xs text-muted-foreground">{p.notes}</p>}
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className={p.status === 'KEPT' ? 'badge-success' : p.status === 'BROKEN' ? 'badge-danger' : 'badge-warning'}>{t(`ptp.${p.status}`)}</span>
                                    {allowed && p.status === 'PENDING' && (
                                        <>
                                            <button className="btn-ghost text-xs px-2 py-1 h-auto" disabled={busy === p.id} onClick={() => mark(p, 'KEPT')}>{t('markKept')}</button>
                                            <button className="btn-ghost text-xs px-2 py-1 h-auto text-destructive" disabled={busy === p.id} onClick={() => mark(p, 'BROKEN')}>{t('markBroken')}</button>
                                        </>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
                {allowed && open && (
                    <div className="space-y-2 border-t border-border pt-3">
                        <p className="text-xs font-semibold text-foreground">{t('newPromise')}</p>
                        <div className="flex flex-wrap gap-2">
                            <input className={`${inputCls} w-28`} inputMode="decimal" placeholder={t('amount')} value={amount} onChange={(e) => setAmount(e.target.value)} />
                            <input className={`${inputCls} w-40`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                            <input className={`${inputCls} flex-1 min-w-[140px]`} placeholder={t('notes')} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
                            <button className="btn-primary text-xs px-3" disabled={busy === 'new'} onClick={record}>{t('record')}</button>
                        </div>
                        {problem && <p className="text-xs text-destructive" role="alert">{problem}</p>}
                        <p className="text-[11px] text-muted-foreground">{t('promiseHint')}</p>
                    </div>
                )}
            </div>
        </div>
    );
}

interface Repayment { id: string; amount: string | number; date: string; reversedAt?: string | null }

/** P1 #13: reverse a posted repayment (with a reason); the schedule is replayed without it. */
export function LegacyRepaymentsCard({ repayments, currency, onChanged }: { repayments: Repayment[]; currency: string; onChanged: () => void }) {
    const t = useTranslations('Servicing.legacy');
    const { showToast } = useToast();
    const allowed = useLegacyAllowed()('reverseRepayment');
    const [reversing, setReversing] = useState<string | null>(null);
    const [reason, setReason] = useState('');
    const [problem, setProblem] = useState('');
    const [busy, setBusy] = useState(false);
    if (!repayments.length) return null;

    const reverse = async (id: string) => {
        if (!reason.trim()) { setProblem(t('reasonRequired')); return; }
        setBusy(true);
        try {
            await api.post(`/repayments/${id}/reverse`, { reason: reason.trim() });
            showToast(t('reversed'), 'success');
            setReversing(null); setReason(''); setProblem('');
            onChanged();
        } catch (e) {
            setProblem(errText(e, t('failed')));
        } finally { setBusy(false); }
    };

    return (
        <div className={cardCls}>
            <div className={headCls}><Undo2 size={14} className="text-primary" /><h3 className="text-sm font-bold text-foreground">{t('repaymentsTitle')}</h3></div>
            <ul className="divide-y divide-border">
                {[...repayments].reverse().map((r) => (
                    <li key={r.id} className="px-4 py-2.5 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-sm">{new Date(r.date).toLocaleDateString()} · <b>{currency} {Number(r.amount).toLocaleString()}</b></span>
                            {r.reversedAt ? <span className="badge-neutral text-[11px]">{t('reversedOn', { date: r.reversedAt.slice(0, 10) })}</span>
                                : allowed && reversing !== r.id && <button className="btn-ghost text-xs px-2 py-1 h-auto" onClick={() => { setReversing(r.id); setReason(''); setProblem(''); }}>{t('reverse')}</button>}
                        </div>
                        {reversing === r.id && (
                            <div className="flex flex-wrap gap-2">
                                <input className={`${inputCls} flex-1 min-w-[160px]`} placeholder={t('reversalReason')} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                                <button className="btn-danger text-xs px-3" disabled={busy} onClick={() => reverse(r.id)}>{t('confirmReverse')}</button>
                                <button className="btn-ghost text-xs px-3" onClick={() => setReversing(null)}>{t('cancel')}</button>
                                {problem && <p className="w-full text-xs text-destructive" role="alert">{problem}</p>}
                            </div>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}

interface Doc { id: string; name: string; content: string; type: string; createdAt: string }
const MAX_DOC_BYTES = 5 * 1024 * 1024;

/** Documents on the loan: download, upload (as the API takes them, a data URI up to 5 MB) and delete. */
export function LegacyDocumentsCard({ loanId, documents, onChanged }: { loanId: string; documents: Doc[]; onChanged: () => void }) {
    const t = useTranslations('Servicing.legacy');
    const { showToast } = useToast();
    const confirm = useConfirm();
    const allow = useLegacyAllowed();
    const canUpload = allow('uploadDocument');
    const canDelete = allow('deleteDocument');
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState('');

    const upload = async (file: File | undefined) => {
        if (!file) return;
        if (file.size > MAX_DOC_BYTES) { setProblem(t('fileTooLarge')); return; }
        setProblem('');
        setBusy(true);
        try {
            const content = await new Promise<string>((resolve, reject) => {
                const r = new FileReader();
                r.onerror = () => reject(new Error(t('fileUnreadable')));
                r.onload = () => resolve(String(r.result || ''));
                r.readAsDataURL(file);
            });
            await api.post(`/loans/${loanId}/documents`, { name: file.name.slice(0, 200), content, type: (file.type || 'application/octet-stream').slice(0, 100) });
            showToast(t('uploaded'), 'success');
            onChanged();
        } catch (e) {
            setProblem(errText(e, (e as Error)?.message || t('failed')));
        } finally { setBusy(false); }
    };
    const remove = async (d: Doc) => {
        if (!(await confirm({ title: t('deleteDocTitle'), message: t('deleteDocMessage', { name: d.name }), confirmLabel: t('delete'), variant: 'danger' }))) return;
        try {
            await api.delete(`/loans/${loanId}/documents/${d.id}`);
            showToast(t('docDeleted'), 'success');
            onChanged();
        } catch (e) {
            showToast(errText(e, t('failed')), 'error');
        }
    };

    if (!documents.length && !canUpload) return null;
    return (
        <div className={cardCls}>
            <div className={headCls}><FileText size={14} className="text-primary" /><h3 className="text-sm font-bold text-foreground">{t('documentsTitle')}</h3></div>
            <div className="px-4 py-3 space-y-2">
                {documents.length === 0 ? <p className="text-sm text-muted-foreground">{t('noDocuments')}</p> : (
                    <ul className="divide-y divide-border">
                        {documents.map((d) => (
                            <li key={d.id} className="py-2 flex items-center justify-between gap-2">
                                {d.content.startsWith('data:') || /^https?:\/\//.test(d.content)
                                    ? <a href={d.content} download={d.name} target="_blank" rel="noopener noreferrer" className="text-sm text-primary font-semibold hover:underline truncate">{d.name}</a>
                                    : <span className="text-sm truncate">{d.name}</span>}
                                {canDelete && <button className="btn-ghost text-xs px-2 py-1 h-auto text-destructive" onClick={() => remove(d)} aria-label={t('delete')}><Trash2 size={12} /></button>}
                            </li>
                        ))}
                    </ul>
                )}
                {canUpload && (
                    <label className={`btn-ghost text-xs px-3 py-1.5 h-auto inline-flex items-center gap-1.5 cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
                        <Upload size={12} /> {t('upload')}
                        <input type="file" className="hidden" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
                    </label>
                )}
                {problem && <p className="text-xs text-destructive" role="alert">{problem}</p>}
            </div>
        </div>
    );
}

/** Write-off (DISBURSED or DEFAULTED loans) and delete (PENDING loans), as the API allows. */
export function LegacyLoanDangerZone({ loanId, status, onChanged, onDeleted }: { loanId: string; status: string; onChanged: () => void; onDeleted: () => void }) {
    const t = useTranslations('Servicing.legacy');
    const { showToast } = useToast();
    const confirm = useConfirm();
    const allow = useLegacyAllowed();
    const canWriteOff = allow('writeOff') && (status === 'DISBURSED' || status === 'DEFAULTED');
    const canDelete = allow('deleteLoan') && status === 'PENDING';
    const [writingOff, setWritingOff] = useState(false);
    const [reason, setReason] = useState('');
    const [problem, setProblem] = useState('');
    const [busy, setBusy] = useState(false);
    if (!canWriteOff && !canDelete) return null;

    const writeOff = async () => {
        if (!reason.trim()) { setProblem(t('reasonRequired')); return; }
        if (!(await confirm({ title: t('writeOffTitle'), message: t('writeOffMessage'), confirmLabel: t('writeOff'), variant: 'danger' }))) return;
        setBusy(true);
        try {
            await api.post(`/loans/${loanId}/write-off`, { reason: reason.trim() });
            showToast(t('writtenOff'), 'success');
            setWritingOff(false); setReason(''); setProblem('');
            onChanged();
        } catch (e) {
            setProblem(errText(e, t('failed')));
        } finally { setBusy(false); }
    };
    const remove = async () => {
        if (!(await confirm({ title: t('deleteLoanTitle'), message: t('deleteLoanMessage'), confirmLabel: t('delete'), variant: 'danger' }))) return;
        try {
            await api.delete(`/loans/${loanId}`);
            showToast(t('loanDeleted'), 'success');
            onDeleted();
        } catch (e) {
            showToast(errText(e, t('failed')), 'error');
        }
    };

    return (
        <div className={`${cardCls} border-destructive/30`}>
            <div className={headCls}><Trash2 size={14} className="text-destructive" /><h3 className="text-sm font-bold text-foreground">{t('dangerTitle')}</h3></div>
            <div className="px-4 py-3 space-y-2">
                {canWriteOff && !writingOff && <button className="btn-ghost text-xs px-3 py-1.5 h-auto text-destructive border-destructive/30" onClick={() => setWritingOff(true)}>{t('writeOff')}</button>}
                {canWriteOff && writingOff && (
                    <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">{t('writeOffHint')}</p>
                        <input className={`${inputCls} w-full`} placeholder={t('writeOffReason')} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                        <div className="flex gap-2">
                            <button className="btn-danger text-xs px-3" disabled={busy} onClick={writeOff}>{t('writeOff')}</button>
                            <button className="btn-ghost text-xs px-3" onClick={() => setWritingOff(false)}>{t('cancel')}</button>
                        </div>
                    </div>
                )}
                {canDelete && <button className="btn-ghost text-xs px-3 py-1.5 h-auto text-destructive border-destructive/30" onClick={remove}>{t('deleteLoan')}</button>}
                {problem && <p className="text-xs text-destructive" role="alert">{problem}</p>}
            </div>
        </div>
    );
}
