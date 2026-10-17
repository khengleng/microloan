"use client";

import { useState } from 'react';
import { Download, Lock, Unlock } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { ActionPanel, Btn, ErrorBox, Field, KV, SelectInput, Spinner, Table, TextArea, TextInput, td, th } from '../ui';
import { clean, useAction, useApi } from '../useAsync';
import { StatusBadge } from '../StatusBadge';
import { fmtDateTime } from '../format';
import { ACCEPTED_TYPES, DOCUMENT_CATEGORIES, fmtBytes, openLink, readFile } from './types';
import type { DocumentDetail, DocumentLink } from './types';

const CATEGORY_OPTIONS = DOCUMENT_CATEGORIES.filter((c) => c !== 'GENERATED');

/** File input that remembers the chosen file. */
function FilePick({ onPick }: { onPick: (f: File | null) => void }) {
    return (
        <input
            type="file"
            accept={ACCEPTED_TYPES}
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
            className="block w-full text-[12px] text-[#3C4257] file:mr-3 file:rounded file:border file:border-[#E3E8EE] file:bg-white file:px-2.5 file:py-1 file:text-[12px] file:font-semibold"
        />
    );
}

/** Upload a new document to a customer's library (DOC-2). */
export function UploadPanel({ borrowerId, applications, onClose, onDone }: {
    borrowerId: string;
    applications: { id: string; reference: string }[];
    onClose: () => void;
    onDone: () => void;
}) {
    const { showToast } = useToast();
    const { busy, error, run } = useAction();
    const [file, setFile] = useState<File | null>(null);
    const [form, setForm] = useState({ category: 'KYC', typeCode: '', title: '', applicationId: '', issuedOn: '', expiresOn: '', note: '' });
    const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
    const submit = () =>
        run('upload', async () => {
            if (!file) throw new Error('Choose a file.');
            const body = await readFile(file);
            await api.post(`/lending/customers/${borrowerId}/documents`, clean({ ...form, typeCode: form.typeCode.toUpperCase(), ...body }));
            showToast('Document uploaded — awaiting review by another user', 'success');
            onDone();
        });
    return (
        <ActionPanel title="Upload a document" onClose={onClose}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="Category"><SelectInput value={form.category} onChange={set('category')} options={[...CATEGORY_OPTIONS]} /></Field>
                <Field label="Type code" hint="e.g. NATIONAL_ID, PASSPORT, TITLE_DEED"><TextInput value={form.typeCode} onChange={set('typeCode')} placeholder="NATIONAL_ID" /></Field>
                <Field label="Title"><TextInput value={form.title} onChange={set('title')} placeholder="National ID card" /></Field>
                <Field label="For application (optional)">
                    <SelectInput value={form.applicationId} onChange={set('applicationId')} placeholder="Customer-level" options={applications.map((a) => ({ value: a.id, label: a.reference }))} />
                </Field>
                <Field label="Issued on"><TextInput type="date" value={form.issuedOn} onChange={set('issuedOn')} /></Field>
                <Field label="Expires on" hint="Reminders are raised before this date"><TextInput type="date" value={form.expiresOn} onChange={set('expiresOn')} /></Field>
                <Field label="File" hint="PDF, JPEG, PNG or WebP up to 3.5 MB" className="md:col-span-2"><FilePick onPick={setFile} /></Field>
                <Field label="Note"><TextInput value={form.note} onChange={set('note')} /></Field>
            </div>
            <ErrorBox error={error} />
            <div className="flex justify-end gap-2">
                <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
                <Btn variant="primary" busy={busy === 'upload'} disabled={!file || !form.typeCode} onClick={submit}>Upload</Btn>
            </div>
        </ActionPanel>
    );
}

/** Ask the customer for a document; it appears in their portal (DOC-10). */
export function RequestPanel({ borrowerId, applications, preset, onClose, onDone }: {
    borrowerId: string;
    applications: { id: string; reference: string }[];
    preset?: { typeCode: string; label: string; applicationId?: string };
    onClose: () => void;
    onDone: () => void;
}) {
    const { showToast } = useToast();
    const { busy, error, run } = useAction();
    const [form, setForm] = useState({
        category: preset?.applicationId ? 'APPLICATION' : 'KYC',
        typeCode: preset?.typeCode ?? '',
        label: preset?.label ?? '',
        message: '',
        applicationId: preset?.applicationId ?? '',
        dueOn: '',
    });
    const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
    const submit = () =>
        run('request', async () => {
            await api.post(`/lending/customers/${borrowerId}/document-requests`, clean({ ...form, typeCode: form.typeCode.toUpperCase() }));
            showToast('Request sent to the customer', 'success');
            onDone();
        });
    return (
        <ActionPanel title="Request a document from the customer" onClose={onClose}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="Category"><SelectInput value={form.category} onChange={set('category')} options={[...CATEGORY_OPTIONS]} /></Field>
                <Field label="Type code"><TextInput value={form.typeCode} onChange={set('typeCode')} placeholder="PROOF_OF_ADDRESS" /></Field>
                <Field label="What the customer sees"><TextInput value={form.label} onChange={set('label')} placeholder="Proof of address" /></Field>
                <Field label="For application (optional)">
                    <SelectInput value={form.applicationId} onChange={set('applicationId')} placeholder="Customer-level" options={applications.map((a) => ({ value: a.id, label: a.reference }))} />
                </Field>
                <Field label="Due by"><TextInput type="date" value={form.dueOn} onChange={set('dueOn')} /></Field>
                <Field label="Message" className="md:col-span-3"><TextArea value={form.message} onChange={set('message')} rows={2} /></Field>
            </div>
            <ErrorBox error={error} />
            <div className="flex justify-end gap-2">
                <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
                <Btn variant="primary" busy={busy === 'request'} disabled={!form.typeCode || form.label.length < 2} onClick={submit}>Send request</Btn>
            </div>
        </ActionPanel>
    );
}

type Action = 'review' | 'replace' | 'expiry' | 'hold' | 'delete' | null;

/** One document: versions, review, replacement, expiry, legal hold, deletion and its access trail. */
export function DocumentDetailPanel({ documentId, onChanged }: { documentId: string; onChanged: () => void }) {
    const { showToast } = useToast();
    const detail = useApi<DocumentDetail>(`/lending/documents/${documentId}`);
    const { busy, error, run, clearError } = useAction();
    const [action, setAction] = useState<Action>(null);
    const [reason, setReason] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [dates, setDates] = useState({ issuedOn: '', expiresOn: '' });
    const d = detail.data;

    const done = (msg: string) => {
        showToast(msg, 'success');
        setAction(null);
        setReason('');
        setFile(null);
        detail.reload();
        onChanged();
    };
    const download = (version?: number) =>
        run(`dl-${version ?? 'cur'}`, async () => {
            const r = await api.post<DocumentLink>(`/lending/documents/${documentId}/link`, version ? { version } : {});
            openLink(r.data);
        });
    const open = (a: Action) => {
        clearError();
        setReason('');
        setAction((x) => (x === a ? null : a));
        if (a === 'expiry' && d) setDates({ issuedOn: d.issuedOn ?? '', expiresOn: d.expiresOn ?? '' });
    };

    if (detail.loading && !d) return <Spinner />;
    if (detail.error) return <ErrorBox error={detail.error} />;
    if (!d) return null;
    const current = d.versions[0];
    const active = d.status === 'ACTIVE';

    return (
        <div className="space-y-4">
            <KV
                cols={4}
                items={[
                    ['Origin', d.origin + (d.legacySource ? ` (${d.legacySource.replace(/_/g, ' ').toLowerCase()})` : '')],
                    ['Visible to customer', d.customerVisible ? 'Yes' : 'No'],
                    ['Issued / expires', `${d.issuedOn ?? '—'} / ${d.expiresOn ?? '—'}`],
                    ['Retention', d.retention.relationshipOpen ? `${d.retention.years} years after the relationship ends (${d.retention.source})` : `Until ${d.retention.retainUntil} (${d.retention.years} y, ${d.retention.source})`],
                    ['Legal hold', d.legalHold ? `Yes — ${d.legalHoldReason}` : 'No'],
                    ['Request', d.request ? `${d.request.label} · ${d.request.status}` : '—'],
                    ['Status', d.status === 'DELETED' ? `Deleted — ${d.deletionReason}` : 'Active'],
                    ['Document id', <span key="id" className="font-mono text-[11px]">{d.id}</span>],
                ]}
            />
            {active && (
                <div className="flex flex-wrap gap-2">
                    <Btn size="sm" onClick={() => download()} busy={busy === 'dl-cur'}><Download size={13} /> Download current</Btn>
                    {d.reviewStatus === 'PENDING_REVIEW' && <Btn size="sm" variant={action === 'review' ? 'primary' : 'secondary'} onClick={() => open('review')}>Review</Btn>}
                    {d.origin !== 'GENERATED' && <Btn size="sm" variant={action === 'replace' ? 'primary' : 'secondary'} onClick={() => open('replace')}>Replace (new version)</Btn>}
                    <Btn size="sm" variant={action === 'expiry' ? 'primary' : 'secondary'} onClick={() => open('expiry')}>Dates</Btn>
                    <Btn size="sm" variant={action === 'hold' ? 'primary' : 'secondary'} onClick={() => open('hold')}>
                        {d.legalHold ? <><Unlock size={13} /> Release hold</> : <><Lock size={13} /> Legal hold</>}
                    </Btn>
                    <Btn size="sm" variant="danger" onClick={() => open('delete')} disabled={d.legalHold || !d.retention.eligibleForDeletion}
                        reason={d.legalHold ? 'Under legal hold' : !d.retention.eligibleForDeletion ? 'Retention period has not ended' : undefined}>
                        Delete
                    </Btn>
                </div>
            )}

            {action === 'review' && (
                <ActionPanel title={`Review version ${current.version}`} onClose={() => setAction(null)}>
                    <p className="text-[12px] text-[#697386]">Uploaded by {current.uploaderType === 'CUSTOMER' ? 'the customer' : <span className="font-mono">{current.uploadedBy}</span>} on {fmtDateTime(current.createdAt)}. You cannot review a version you uploaded.</p>
                    <Field label="Reason (required to reject)"><TextInput value={reason} onChange={setReason} placeholder="e.g. Photo is blurred" /></Field>
                    <ErrorBox error={error} />
                    <div className="flex justify-end gap-2">
                        <Btn variant="danger" busy={busy === 'reject'} disabled={reason.trim().length < 3}
                            onClick={() => run('reject', async () => { await api.post(`/lending/documents/${documentId}/review`, { decision: 'REJECT', reason }); done('Document rejected'); })}>Reject</Btn>
                        <Btn variant="primary" busy={busy === 'accept'}
                            onClick={() => run('accept', async () => { await api.post(`/lending/documents/${documentId}/review`, clean({ decision: 'ACCEPT', reason })); done('Document accepted'); })}>Accept</Btn>
                    </div>
                </ActionPanel>
            )}
            {action === 'replace' && (
                <ActionPanel title={`Replace — becomes version ${d.currentVersion + 1}`} onClose={() => setAction(null)}>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <Field label="File" className="md:col-span-2"><FilePick onPick={setFile} /></Field>
                        <Field label="New expiry (optional)"><TextInput type="date" value={dates.expiresOn} onChange={(v) => setDates((x) => ({ ...x, expiresOn: v }))} /></Field>
                        <Field label="Note" className="md:col-span-3"><TextInput value={reason} onChange={setReason} placeholder="Why it was replaced" /></Field>
                    </div>
                    <ErrorBox error={error} />
                    <div className="flex justify-end">
                        <Btn variant="primary" busy={busy === 'replace'} disabled={!file}
                            onClick={() => run('replace', async () => {
                                const body = await readFile(file!);
                                await api.post(`/lending/documents/${documentId}/versions`, clean({ ...body, note: reason, expiresOn: dates.expiresOn }));
                                done('New version uploaded — earlier versions are kept');
                            })}>Upload new version</Btn>
                    </div>
                </ActionPanel>
            )}
            {action === 'expiry' && (
                <ActionPanel title="Issue and expiry dates" onClose={() => setAction(null)}>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Issued on"><TextInput type="date" value={dates.issuedOn} onChange={(v) => setDates((x) => ({ ...x, issuedOn: v }))} /></Field>
                        <Field label="Expires on"><TextInput type="date" value={dates.expiresOn} onChange={(v) => setDates((x) => ({ ...x, expiresOn: v }))} /></Field>
                    </div>
                    <ErrorBox error={error} />
                    <div className="flex justify-end">
                        <Btn variant="primary" busy={busy === 'expiry'}
                            onClick={() => run('expiry', async () => {
                                await api.put(`/lending/documents/${documentId}/expiry`, { issuedOn: dates.issuedOn || null, expiresOn: dates.expiresOn || null });
                                done('Dates saved');
                            })}>Save</Btn>
                    </div>
                </ActionPanel>
            )}
            {action === 'hold' && (
                <ActionPanel title={d.legalHold ? 'Release legal hold' : 'Place under legal hold'} onClose={() => setAction(null)}>
                    <p className="text-[12px] text-[#697386]">A document under legal hold cannot be deleted, whatever its retention period.</p>
                    <Field label="Reason"><TextInput value={reason} onChange={setReason} placeholder="e.g. Court order reference" /></Field>
                    <ErrorBox error={error} />
                    <div className="flex justify-end">
                        <Btn variant="primary" busy={busy === 'hold'} disabled={reason.trim().length < 3}
                            onClick={() => run('hold', async () => {
                                await api.post(`/lending/documents/${documentId}/legal-hold`, { hold: !d.legalHold, reason });
                                done(d.legalHold ? 'Legal hold released' : 'Legal hold placed');
                            })}>{d.legalHold ? 'Release' : 'Place hold'}</Btn>
                    </div>
                </ActionPanel>
            )}
            {action === 'delete' && (
                <ActionPanel title="Delete after retention" onClose={() => setAction(null)}>
                    <p className="text-[12px] text-[#697386]">The record is kept (who, when, why); the stored files are removed. This cannot be undone.</p>
                    <Field label="Reason"><TextInput value={reason} onChange={setReason} /></Field>
                    <ErrorBox error={error} />
                    <div className="flex justify-end">
                        <Btn variant="danger" busy={busy === 'delete'} disabled={reason.trim().length < 3}
                            onClick={() => run('delete', async () => {
                                await api.post(`/lending/documents/${documentId}/delete`, { reason });
                                done('Document deleted');
                            })}>Delete</Btn>
                    </div>
                </ActionPanel>
            )}
            {!action && <ErrorBox error={error} />}

            <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-1">Versions</p>
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>v</th><th className={th}>File</th><th className={th}>Uploaded</th><th className={th}>Review</th><th className={th}>SHA-256</th><th className={th}></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {d.versions.map((v) => (
                            <tr key={v.id}>
                                <td className={td}>{v.version}</td>
                                <td className={td}>{v.fileName}<div className="text-[11px] text-[#697386]">{v.mimeType} · {fmtBytes(v.sizeBytes)} · {v.storageProvider}</div>{v.note && <div className="text-[11px] text-[#697386]">{v.note}</div>}</td>
                                <td className={td}>{fmtDateTime(v.createdAt)}<div className="text-[11px] text-[#697386]">{v.uploaderType === 'CUSTOMER' ? 'customer' : v.uploaderType === 'SYSTEM' ? 'system' : <span className="font-mono">{v.uploadedBy.slice(0, 8)}</span>}</div></td>
                                <td className={td}><StatusBadge status={v.reviewStatus} />{v.rejectionReason && <div className="text-[11px] text-red-700 mt-0.5">{v.rejectionReason}</div>}</td>
                                <td className={`${td} font-mono text-[11px]`}>{v.sha256 ? `${v.sha256.slice(0, 12)}…` : '—'}</td>
                                <td className={`${td} text-right`}>
                                    {v.purged ? <span className="text-[11px] text-[#8792A2]">file removed</span> : active && <Btn size="sm" variant="ghost" busy={busy === `dl-${v.version}`} onClick={() => download(v.version)}><Download size={13} /></Btn>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            </div>
            <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-1">Access and change log</p>
                <ul className="text-[12px] text-[#3C4257] space-y-0.5 max-h-48 overflow-auto">
                    {d.accessLog.map((a) => (
                        <li key={a.id} className="flex gap-2">
                            <span className="text-[#697386] tabular-nums whitespace-nowrap">{fmtDateTime(a.eventTime)}</span>
                            <span className="font-mono">{a.action}</span>
                            <StatusBadge status={a.outcome} />
                            <span className="font-mono text-[11px] text-[#697386] truncate">{a.actorId}</span>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
