"use client";

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Download, FileText, Inbox, Loader2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ACCEPTED_TYPES, readFile } from '../documents/types';

/* Borrower portal (DOC-10): documents the bank asked for, and the customer's own documents. */

interface PortalRequest {
    id: string; label: string; message: string; typeCode: string; dueOn: string | null;
    status: 'OPEN' | 'SUBMITTED' | 'ACCEPTED' | 'CANCELLED'; lastRejection: string | null;
}
interface PortalDocument {
    id: string; title: string; category: string; typeCode: string; reviewStatus: string;
    rejectionReason: string | null; expiresOn: string | null; fileName?: string; createdAt: string;
}

async function call<T>(path: string, body?: unknown, fallback?: (status: number) => string): Promise<T> {
    const res = await fetch(`/api/proxy${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
        const m = data?.message;
        throw new Error(typeof m === 'string' ? m : typeof m?.message === 'string' ? m.message : fallback ? fallback(res.status) : `Something went wrong (${res.status}).`);
    }
    return data as T;
}

const STATUS: Record<PortalRequest['status'], { cls: string }> = {
    OPEN: { cls: 'text-amber-700 bg-amber-50 border-amber-100' },
    SUBMITTED: { cls: 'text-blue-700 bg-blue-50 border-blue-100' },
    ACCEPTED: { cls: 'text-emerald-700 bg-emerald-50 border-emerald-100' },
    CANCELLED: { cls: 'text-slate-600 bg-slate-50 border-slate-100' },
};

export function PortalDocumentsSection() {
    const t = useTranslations('LendingPortal.documents');
    const [requests, setRequests] = useState<PortalRequest[] | null>(null);
    const [docs, setDocs] = useState<PortalDocument[]>([]);
    const [busy, setBusy] = useState('');
    const [error, setError] = useState('');

    const load = useCallback(() => {
        call<{ requests: PortalRequest[] }>('/borrower/document-requests').then((r) => setRequests(r.requests)).catch(() => setRequests([]));
        call<{ documents: PortalDocument[] }>('/borrower/my-documents').then((r) => setDocs(r.documents)).catch(() => setDocs([]));
    }, []);
    useEffect(() => { load(); }, [load]);

    const upload = async (req: PortalRequest, file?: File) => {
        if (!file) return;
        setBusy(req.id);
        setError('');
        try {
            const body = await readFile(file);
            await call(`/borrower/document-requests/${req.id}/upload`, body, (status) => t('somethingWrong', { status }));
            load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy('');
        }
    };

    if (requests === null) return null;
    const open = requests.filter((r) => r.status === 'OPEN' || r.status === 'SUBMITTED');

    return (
        <>
            <section className="bg-white border border-border rounded-md p-4 space-y-3">
                <h2 className="text-sm font-bold text-foreground flex items-center gap-2"><Inbox size={15} /> {t('requestedTitle')}</h2>
                {open.length === 0 ? (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5"><CheckCircle2 size={13} className="text-emerald-600" /> {t('nothingNeeded')}</p>
                ) : open.map((r) => (
                    <div key={r.id} className="border border-border rounded-md p-3 space-y-2">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-sm font-semibold text-foreground">{r.label}</p>
                                {r.message && <p className="text-xs text-muted-foreground mt-0.5">{r.message}</p>}
                                {r.dueOn && <p className="text-xs text-muted-foreground mt-0.5">{t('sendBy', { date: r.dueOn })}</p>}
                            </div>
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded border whitespace-nowrap ${STATUS[r.status].cls}`}>{t(`status.${r.status}`)}</span>
                        </div>
                        {r.lastRejection && r.status === 'OPEN' && (
                            <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded px-2 py-1">{t('lastRejected', { reason: r.lastRejection })}</p>
                        )}
                        <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary cursor-pointer">
                            {busy === r.id ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                            {r.status === 'SUBMITTED' ? t('sendDifferent') : t('upload')}
                            <input type="file" accept={ACCEPTED_TYPES} className="hidden" disabled={!!busy} onChange={(e) => upload(r, e.target.files?.[0])} />
                        </label>
                    </div>
                ))}
                {error && <p className="text-xs text-red-700">{error}</p>}
                <p className="text-[11px] text-muted-foreground">{t('fileTypes')}</p>
            </section>

            {docs.length > 0 && (
                <section className="bg-white border border-border rounded-md p-4 space-y-2">
                    <h2 className="text-sm font-bold text-foreground flex items-center gap-2"><FileText size={15} /> {t('myDocuments')}</h2>
                    <ul className="divide-y divide-border">
                        {docs.map((d) => (
                            <li key={d.id} className="py-2 flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-sm text-foreground truncate">{d.title}</p>
                                    <p className="text-[11px] text-muted-foreground">
                                        {new Date(d.createdAt).toLocaleDateString()}
                                        {d.reviewStatus === 'PENDING_REVIEW' && ` · ${t('beingChecked')}`}
                                        {d.reviewStatus === 'REJECTED' && ` · ${d.rejectionReason ? t('notAcceptedReason', { reason: d.rejectionReason }) : t('notAccepted')}`}
                                        {d.expiresOn && ` · ${t('expires', { date: d.expiresOn })}`}
                                    </p>
                                </div>
                                <a href={`/api/proxy/borrower/my-documents/${d.id}/download`} className="text-xs font-semibold text-primary flex items-center gap-1"><Download size={13} /> {t('download')}</a>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </>
    );
}
