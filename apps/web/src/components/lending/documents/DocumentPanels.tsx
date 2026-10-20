"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download, Lock, Unlock } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { ActionPanel, Btn, ErrorBox, Field, KV, SelectInput, Spinner, Table, TextArea, TextInput, td, th } from '../ui';
import { clean, useAction, useApi } from '../useAsync';
import { StatusBadge } from '../StatusBadge';
import { Person } from '../People';
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
    const t = useTranslations('LendingDocuments');
    const { showToast } = useToast();
    const { busy, error, run } = useAction();
    const [file, setFile] = useState<File | null>(null);
    const [form, setForm] = useState({ category: 'KYC', typeCode: '', title: '', applicationId: '', issuedOn: '', expiresOn: '', note: '' });
    const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
    const submit = () =>
        run('upload', async () => {
            if (!file) throw new Error(t('upload.chooseFile'));
            const body = await readFile(file, (k) => t(`file.${k}`));
            await api.post(`/lending/customers/${borrowerId}/documents`, clean({ ...form, typeCode: form.typeCode.toUpperCase(), ...body }));
            showToast(t('upload.done'), 'success');
            onDone();
        });
    return (
        <ActionPanel title={t('upload.title')} onClose={onClose}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label={t('common.category')}><SelectInput value={form.category} onChange={set('category')} options={CATEGORY_OPTIONS.map((c) => ({ value: c, label: t(`categories.${c}`) }))} /></Field>
                <Field label={t('common.typeCode')} hint={t('upload.typeCodeHint')}><TextInput value={form.typeCode} onChange={set('typeCode')} placeholder="NATIONAL_ID" /></Field>
                <Field label={t('upload.titleLabel')}><TextInput value={form.title} onChange={set('title')} placeholder={t('upload.titlePlaceholder')} /></Field>
                <Field label={t('common.forApplication')}>
                    <SelectInput value={form.applicationId} onChange={set('applicationId')} placeholder={t('common.customerLevel')} options={applications.map((a) => ({ value: a.id, label: a.reference }))} />
                </Field>
                <Field label={t('common.issuedOn')}><TextInput type="date" value={form.issuedOn} onChange={set('issuedOn')} /></Field>
                <Field label={t('common.expiresOn')} hint={t('upload.expiresHint')}><TextInput type="date" value={form.expiresOn} onChange={set('expiresOn')} /></Field>
                <Field label={t('common.file')} hint={t('upload.fileHint')} className="md:col-span-2"><FilePick onPick={setFile} /></Field>
                <Field label={t('common.note')}><TextInput value={form.note} onChange={set('note')} /></Field>
            </div>
            <ErrorBox error={error} />
            <div className="flex justify-end gap-2">
                <Btn variant="ghost" onClick={onClose}>{t('common.cancel')}</Btn>
                <Btn variant="primary" busy={busy === 'upload'} disabled={!file || !form.typeCode} onClick={submit}>{t('common.upload')}</Btn>
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
    const t = useTranslations('LendingDocuments');
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
            showToast(t('request.done'), 'success');
            onDone();
        });
    return (
        <ActionPanel title={t('request.title')} onClose={onClose}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label={t('common.category')}><SelectInput value={form.category} onChange={set('category')} options={CATEGORY_OPTIONS.map((c) => ({ value: c, label: t(`categories.${c}`) }))} /></Field>
                <Field label={t('common.typeCode')}><TextInput value={form.typeCode} onChange={set('typeCode')} placeholder="PROOF_OF_ADDRESS" /></Field>
                <Field label={t('request.label')}><TextInput value={form.label} onChange={set('label')} placeholder={t('request.labelPlaceholder')} /></Field>
                <Field label={t('common.forApplication')}>
                    <SelectInput value={form.applicationId} onChange={set('applicationId')} placeholder={t('common.customerLevel')} options={applications.map((a) => ({ value: a.id, label: a.reference }))} />
                </Field>
                <Field label={t('request.dueBy')}><TextInput type="date" value={form.dueOn} onChange={set('dueOn')} /></Field>
                <Field label={t('request.message')} className="md:col-span-3"><TextArea value={form.message} onChange={set('message')} rows={2} /></Field>
            </div>
            <ErrorBox error={error} />
            <div className="flex justify-end gap-2">
                <Btn variant="ghost" onClick={onClose}>{t('common.cancel')}</Btn>
                <Btn variant="primary" busy={busy === 'request'} disabled={!form.typeCode || form.label.length < 2} onClick={submit}>{t('request.submit')}</Btn>
            </div>
        </ActionPanel>
    );
}

type Action = 'review' | 'replace' | 'expiry' | 'hold' | 'delete' | null;

/** One document: versions, review, replacement, expiry, legal hold, deletion and its access trail. */
export function DocumentDetailPanel({ documentId, onChanged }: { documentId: string; onChanged: () => void }) {
    const t = useTranslations('LendingDocuments');
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
                    [t('detail.origin'), d.legacySource ? t('detail.originWithSource', { origin: t.has(`origins.${d.origin}`) ? t(`origins.${d.origin}`) : d.origin, source: d.legacySource.replace(/_/g, ' ').toLowerCase() }) : (t.has(`origins.${d.origin}`) ? t(`origins.${d.origin}`) : d.origin)],
                    [t('detail.visible'), d.customerVisible ? t('detail.yes') : t('detail.no')],
                    [t('detail.issuedExpires'), `${d.issuedOn ?? '—'} / ${d.expiresOn ?? '—'}`],
                    [t('detail.retention'), d.retention.relationshipOpen ? t('detail.retentionOpen', { years: d.retention.years, source: d.retention.source }) : t('detail.retentionUntil', { date: d.retention.retainUntil ?? '—', years: d.retention.years, source: d.retention.source })],
                    [t('detail.legalHold'), d.legalHold ? t('detail.legalHoldYes', { reason: d.legalHoldReason ?? '' }) : t('detail.no')],
                    [t('detail.request'), d.request ? `${d.request.label} · ${d.request.status}` : '—'],
                    [t('common.status'), d.status === 'DELETED' ? t('detail.deleted', { reason: d.deletionReason ?? '' }) : t('detail.active')],
                    [t('detail.documentId'), <span key="id" className="font-mono text-[11px]">{d.id}</span>],
                ]}
            />
            {active && (
                <div className="flex flex-wrap gap-2">
                    <Btn size="sm" onClick={() => download()} busy={busy === 'dl-cur'}><Download size={13} /> {t('detail.downloadCurrent')}</Btn>
                    {d.reviewStatus === 'PENDING_REVIEW' && <Btn size="sm" variant={action === 'review' ? 'primary' : 'secondary'} onClick={() => open('review')}>{t('common.review')}</Btn>}
                    {d.origin !== 'GENERATED' && <Btn size="sm" variant={action === 'replace' ? 'primary' : 'secondary'} onClick={() => open('replace')}>{t('detail.replace')}</Btn>}
                    <Btn size="sm" variant={action === 'expiry' ? 'primary' : 'secondary'} onClick={() => open('expiry')}>{t('detail.dates')}</Btn>
                    <Btn size="sm" variant={action === 'hold' ? 'primary' : 'secondary'} onClick={() => open('hold')}>
                        {d.legalHold ? <><Unlock size={13} /> {t('detail.releaseHold')}</> : <><Lock size={13} /> {t('detail.legalHold')}</>}
                    </Btn>
                    <Btn size="sm" variant="danger" onClick={() => open('delete')} disabled={d.legalHold || !d.retention.eligibleForDeletion}
                        reason={d.legalHold ? t('detail.underHold') : !d.retention.eligibleForDeletion ? t('detail.retentionNotEnded') : undefined}>
                        {t('common.delete')}
                    </Btn>
                </div>
            )}

            {action === 'review' && (
                <ActionPanel title={t('detail.reviewTitle', { version: current.version })} onClose={() => setAction(null)}>
                    <p className="text-[12px] text-[#697386]">{current.uploaderType === 'CUSTOMER' ? t('detail.uploadedByCustomer', { date: fmtDateTime(current.createdAt) }) : t.rich('detail.uploadedByUser', { date: fmtDateTime(current.createdAt), who: () => <Person id={current.uploadedBy} /> })}</p>
                    <Field label={t('detail.rejectReason')}><TextInput value={reason} onChange={setReason} placeholder={t('detail.rejectPlaceholder')} /></Field>
                    <ErrorBox error={error} />
                    <div className="flex justify-end gap-2">
                        <Btn variant="danger" busy={busy === 'reject'} disabled={reason.trim().length < 3}
                            onClick={() => run('reject', async () => { await api.post(`/lending/documents/${documentId}/review`, { decision: 'REJECT', reason }); done(t('detail.rejected')); })}>{t('detail.reject')}</Btn>
                        <Btn variant="primary" busy={busy === 'accept'}
                            onClick={() => run('accept', async () => { await api.post(`/lending/documents/${documentId}/review`, clean({ decision: 'ACCEPT', reason })); done(t('detail.accepted')); })}>{t('detail.accept')}</Btn>
                    </div>
                </ActionPanel>
            )}
            {action === 'replace' && (
                <ActionPanel title={t('detail.replaceTitle', { version: d.currentVersion + 1 })} onClose={() => setAction(null)}>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <Field label={t('common.file')} className="md:col-span-2"><FilePick onPick={setFile} /></Field>
                        <Field label={t('detail.newExpiry')}><TextInput type="date" value={dates.expiresOn} onChange={(v) => setDates((x) => ({ ...x, expiresOn: v }))} /></Field>
                        <Field label={t('common.note')} className="md:col-span-3"><TextInput value={reason} onChange={setReason} placeholder={t('detail.replacePlaceholder')} /></Field>
                    </div>
                    <ErrorBox error={error} />
                    <div className="flex justify-end">
                        <Btn variant="primary" busy={busy === 'replace'} disabled={!file}
                            onClick={() => run('replace', async () => {
                                const body = await readFile(file!, (k) => t(`file.${k}`));
                                await api.post(`/lending/documents/${documentId}/versions`, clean({ ...body, note: reason, expiresOn: dates.expiresOn }));
                                done(t('detail.replaced'));
                            })}>{t('detail.uploadNewVersion')}</Btn>
                    </div>
                </ActionPanel>
            )}
            {action === 'expiry' && (
                <ActionPanel title={t('detail.datesTitle')} onClose={() => setAction(null)}>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label={t('common.issuedOn')}><TextInput type="date" value={dates.issuedOn} onChange={(v) => setDates((x) => ({ ...x, issuedOn: v }))} /></Field>
                        <Field label={t('common.expiresOn')}><TextInput type="date" value={dates.expiresOn} onChange={(v) => setDates((x) => ({ ...x, expiresOn: v }))} /></Field>
                    </div>
                    <ErrorBox error={error} />
                    <div className="flex justify-end">
                        <Btn variant="primary" busy={busy === 'expiry'}
                            onClick={() => run('expiry', async () => {
                                await api.put(`/lending/documents/${documentId}/expiry`, { issuedOn: dates.issuedOn || null, expiresOn: dates.expiresOn || null });
                                done(t('detail.datesSaved'));
                            })}>{t('common.save')}</Btn>
                    </div>
                </ActionPanel>
            )}
            {action === 'hold' && (
                <ActionPanel title={d.legalHold ? t('detail.releaseTitle') : t('detail.placeTitle')} onClose={() => setAction(null)}>
                    <p className="text-[12px] text-[#697386]">{t('detail.holdNote')}</p>
                    <Field label={t('common.reason')}><TextInput value={reason} onChange={setReason} placeholder={t('detail.holdPlaceholder')} /></Field>
                    <ErrorBox error={error} />
                    <div className="flex justify-end">
                        <Btn variant="primary" busy={busy === 'hold'} disabled={reason.trim().length < 3}
                            onClick={() => run('hold', async () => {
                                await api.post(`/lending/documents/${documentId}/legal-hold`, { hold: !d.legalHold, reason });
                                done(d.legalHold ? t('detail.holdReleased') : t('detail.holdPlaced'));
                            })}>{d.legalHold ? t('detail.release') : t('detail.placeHold')}</Btn>
                    </div>
                </ActionPanel>
            )}
            {action === 'delete' && (
                <ActionPanel title={t('detail.deleteTitle')} onClose={() => setAction(null)}>
                    <p className="text-[12px] text-[#697386]">{t('detail.deleteNote')}</p>
                    <Field label={t('common.reason')}><TextInput value={reason} onChange={setReason} /></Field>
                    <ErrorBox error={error} />
                    <div className="flex justify-end">
                        <Btn variant="danger" busy={busy === 'delete'} disabled={reason.trim().length < 3}
                            onClick={() => run('delete', async () => {
                                await api.post(`/lending/documents/${documentId}/delete`, { reason });
                                done(t('detail.deletedToast'));
                            })}>{t('common.delete')}</Btn>
                    </div>
                </ActionPanel>
            )}
            {!action && <ErrorBox error={error} />}

            <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-1">{t('detail.versions')}</p>
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>v</th><th className={th}>{t('common.file')}</th><th className={th}>{t('common.uploaded')}</th><th className={th}>{t('common.review')}</th><th className={th}>SHA-256</th><th className={th}></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {d.versions.map((v) => (
                            <tr key={v.id}>
                                <td className={td}>{v.version}</td>
                                <td className={td}>{v.fileName}<div className="text-[11px] text-[#697386]">{v.mimeType} · {fmtBytes(v.sizeBytes)} · {v.storageProvider}</div>{v.note && <div className="text-[11px] text-[#697386]">{v.note}</div>}</td>
                                <td className={td}>{fmtDateTime(v.createdAt)}<div className="text-[11px] text-[#697386]">{v.uploaderType === 'CUSTOMER' ? t('detail.uploaderCustomer') : v.uploaderType === 'SYSTEM' ? t('detail.uploaderSystem') : <Person id={v.uploadedBy} />}</div></td>
                                <td className={td}><StatusBadge status={v.reviewStatus} />{v.rejectionReason && <div className="text-[11px] text-red-700 mt-0.5">{v.rejectionReason}</div>}</td>
                                <td className={`${td} font-mono text-[11px]`}>{v.sha256 ? `${v.sha256.slice(0, 12)}…` : '—'}</td>
                                <td className={`${td} text-right`}>
                                    {v.purged ? <span className="text-[11px] text-[#8792A2]">{t('detail.fileRemoved')}</span> : active && <Btn size="sm" variant="ghost" busy={busy === `dl-${v.version}`} onClick={() => download(v.version)}><Download size={13} /></Btn>}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            </div>
            <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-1">{t('detail.accessLog')}</p>
                <ul className="text-[12px] text-[#3C4257] space-y-0.5 max-h-48 overflow-auto">
                    {d.accessLog.map((a) => (
                        <li key={a.id} className="flex gap-2">
                            <span className="text-[#697386] tabular-nums whitespace-nowrap">{fmtDateTime(a.eventTime)}</span>
                            <span className="font-mono">{a.action}</span>
                            <StatusBadge status={a.outcome} />
                            <Person id={a.actorId} className="text-[11px] text-[#697386] truncate" />
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
