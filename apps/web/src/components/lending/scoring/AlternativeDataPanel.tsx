"use client";

import { useState } from 'react';
import Link from 'next/link';
import { Plus, ShieldCheck } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useWorkspace } from '@/lib/workspace';
import { LendingShell, useLendingHref } from '../LendingShell';
import { ActionPanel, Btn, Card, Empty, ErrorBox, Field, Notice, SelectInput, Spinner, Table, TextInput, td, th } from '../ui';
import { clean, useAction, useApi } from '../useAsync';
import { StatusBadge } from '../StatusBadge';
import { fmtDateTime, fmtMoney, localToIso } from '../format';
import type { Library } from '../documents/types';
import { shortId, sourceLabel, withIssuePaths } from './types';
import type { AltRecord, AltRecordKind, AlternativeData, ConsentEntry } from './types';

const METHODS = [
    { value: 'SIGNED_FORM', label: 'Signed consent form' },
    { value: 'RECORDED_VERBAL', label: 'Recorded verbal consent' },
    { value: 'BORROWER_PORTAL', label: 'Borrower portal' },
];

const KIND_LABELS: Record<AltRecordKind, string> = {
    UTILITY_BILLS: 'Utility bills',
    TELCO_STATEMENT: 'Telco statement',
    RENT_HISTORY: 'Rent history',
    BUSINESS_CASH_FLOW: 'Business cash flow',
};

/** Default consent expiry a year ahead, as a datetime-local value. */
function defaultExpiry(): string {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function usePerm() {
    const ws = useWorkspace();
    return { can: (p: string) => !ws.access || ws.can(p), me: ws.access?.principal.id ?? null };
}

function useDocumentOptions(borrowerId: string) {
    const lib = useApi<Library>(`/lending/customers/${borrowerId}/documents`);
    const options = (lib.data?.documents ?? [])
        .filter((d) => d.status === 'ACTIVE')
        .map((d) => ({ value: d.id, label: `${d.title} · ${d.typeCode}${d.reviewStatus === 'PENDING_REVIEW' ? ' (awaiting review)' : ''}` }));
    return { options, loading: lib.loading, error: lib.error };
}

function DocumentPicker({ borrowerId, value, onChange, label = 'Evidence document', hint }: { borrowerId: string; value: string; onChange: (v: string) => void; label?: string; hint?: string }) {
    const href = useLendingHref();
    const docs = useDocumentOptions(borrowerId);
    return (
        <Field label={label} hint={hint ?? 'From the customer\'s document library'} error={docs.error?.message}>
            <SelectInput value={value} onChange={onChange} options={docs.options} placeholder={docs.loading ? 'Loading…' : docs.options.length ? 'Choose a document…' : 'No documents — upload one first'} />
            {!docs.loading && docs.options.length === 0 && (
                <Link href={href(`/lending/customers/${borrowerId}/documents`)} className="text-[11px] font-semibold text-[#635BFF] hover:underline">Open the document library</Link>
            )}
        </Field>
    );
}

function GrantForm({ borrowerId, sources, preset, onDone, onClose }: { borrowerId: string; sources: string[]; preset?: string; onDone: () => void; onClose: () => void }) {
    const [form, setForm] = useState({ source: preset ?? sources[0] ?? '', purpose: 'Credit assessment of loan applications', scope: '', method: 'SIGNED_FORM', documentId: '', effectiveAt: '', expiresAt: defaultExpiry() });
    const { busy, error, run } = useAction();
    const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
    const needsDoc = form.method === 'SIGNED_FORM';
    const save = async () => {
        const body = clean({
            source: form.source, purpose: form.purpose.trim(), scope: form.scope.trim(), method: form.method,
            documentId: needsDoc ? form.documentId : form.documentId || undefined,
            effectiveAt: localToIso(form.effectiveAt), expiresAt: localToIso(form.expiresAt),
        });
        const res = await run('grant', () => api.post(`/lending/customers/${borrowerId}/consents`, body));
        if (res) onDone();
    };
    return (
        <ActionPanel title="Record consent" onClose={onClose}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Source"><SelectInput value={form.source} onChange={set('source')} options={sources.map((s) => ({ value: s, label: sourceLabel(s) }))} /></Field>
                <Field label="How consent was given"><SelectInput value={form.method} onChange={set('method')} options={METHODS} /></Field>
                <Field label="Purpose" hint="At least 5 characters" className="md:col-span-2"><TextInput value={form.purpose} onChange={set('purpose')} /></Field>
                <Field label="Scope" hint="Optional — what exactly may be used" className="md:col-span-2"><TextInput value={form.scope} onChange={set('scope')} /></Field>
                <DocumentPicker borrowerId={borrowerId} value={form.documentId} onChange={set('documentId')} label={needsDoc ? 'Signed form' : 'Supporting document (optional)'} />
                <div />
                <Field label="Effective from" hint="Blank = now; cannot be in the future"><TextInput type="datetime-local" value={form.effectiveAt} onChange={set('effectiveAt')} /></Field>
                <Field label="Expires" hint="Must be in the future and within the maximum validity"><TextInput type="datetime-local" value={form.expiresAt} onChange={set('expiresAt')} /></Field>
            </div>
            <ErrorBox error={withIssuePaths(error)} />
            <Btn variant="primary" busy={busy === 'grant'} onClick={save} disabled={!form.source || form.purpose.trim().length < 5 || !form.expiresAt || (needsDoc && !form.documentId)}>
                <ShieldCheck size={14} /> Record consent
            </Btn>
        </ActionPanel>
    );
}

type KindData = Record<string, string>;
const KIND_DEFAULTS: Record<AltRecordKind, KindData> = {
    UTILITY_BILLS: { utility: 'ELECTRICITY', issuer: '', accountReference: '', monthsObserved: '12', monthsOnTime: '' },
    TELCO_STATEMENT: { operator: '', monthsObserved: '12', monthsWithTopUp: '' },
    RENT_HISTORY: { landlord: '', monthsObserved: '12', monthsOnTime: '' },
    BUSINESS_CASH_FLOW: { method: 'SITE_VISIT', monthsObserved: '6', averageMonthlyInflow: '', averageMonthlyOutflow: '', currency: 'USD' },
};
const INT_FIELDS = new Set(['monthsObserved', 'monthsOnTime', 'monthsWithTopUp']);

function CaptureForm({ borrowerId, kinds, onDone, onClose }: { borrowerId: string; kinds: AltRecordKind[]; onDone: () => void; onClose: () => void }) {
    const [kind, setKind] = useState<AltRecordKind>(kinds[0] ?? 'UTILITY_BILLS');
    const [data, setData] = useState<KindData>(KIND_DEFAULTS[kinds[0] ?? 'UTILITY_BILLS']);
    const [meta, setMeta] = useState({ periodFrom: '', periodTo: '', documentId: '', note: '' });
    const { busy, error, run } = useAction();
    const setD = (k: string) => (v: string) => setData((d) => ({ ...d, [k]: v }));
    const setM = (k: keyof typeof meta) => (v: string) => setMeta((m) => ({ ...m, [k]: v }));
    const changeKind = (k: string) => { setKind(k as AltRecordKind); setData(KIND_DEFAULTS[k as AltRecordKind]); };

    const save = async () => {
        const payload: Record<string, string | number> = {};
        for (const [k, v] of Object.entries(data)) payload[k] = INT_FIELDS.has(k) && /^\d+$/.test(v.trim()) ? parseInt(v, 10) : v.trim();
        const body = clean({ kind, data: payload, periodFrom: meta.periodFrom, periodTo: meta.periodTo, documentId: meta.documentId, note: meta.note.trim() });
        const res = await run('capture', () => api.post(`/lending/customers/${borrowerId}/alternative-data`, body));
        if (res) onDone();
    };

    const months = (k: string, label: string) => <Field label={label} hint="months"><TextInput inputMode="numeric" value={data[k] ?? ''} onChange={setD(k)} /></Field>;

    return (
        <ActionPanel title="Capture alternative data" onClose={onClose}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="Kind"><SelectInput value={kind} onChange={changeKind} options={kinds.map((k) => ({ value: k, label: KIND_LABELS[k] ?? k }))} /></Field>
                <Field label="Period from"><TextInput type="date" value={meta.periodFrom} onChange={setM('periodFrom')} /></Field>
                <Field label="Period to"><TextInput type="date" value={meta.periodTo} onChange={setM('periodTo')} /></Field>

                {kind === 'UTILITY_BILLS' && (<>
                    <Field label="Utility"><SelectInput value={data.utility} onChange={setD('utility')} options={[{ value: 'ELECTRICITY', label: 'Electricity' }, { value: 'WATER', label: 'Water' }]} /></Field>
                    <Field label="Issuer" hint="e.g. EDC"><TextInput value={data.issuer} onChange={setD('issuer')} /></Field>
                    <Field label="Account reference"><TextInput value={data.accountReference} onChange={setD('accountReference')} /></Field>
                    {months('monthsObserved', 'Months observed (1–60)')}
                    {months('monthsOnTime', 'Months paid on time')}
                </>)}
                {kind === 'TELCO_STATEMENT' && (<>
                    <Field label="Operator"><TextInput value={data.operator} onChange={setD('operator')} /></Field>
                    {months('monthsObserved', 'Months observed (1–60)')}
                    {months('monthsWithTopUp', 'Months with a top-up')}
                </>)}
                {kind === 'RENT_HISTORY' && (<>
                    <Field label="Landlord"><TextInput value={data.landlord} onChange={setD('landlord')} /></Field>
                    {months('monthsObserved', 'Months observed (1–60)')}
                    {months('monthsOnTime', 'Months paid on time')}
                </>)}
                {kind === 'BUSINESS_CASH_FLOW' && (<>
                    <Field label="Method"><SelectInput value={data.method} onChange={setD('method')} options={[
                        { value: 'SITE_VISIT', label: 'Site visit' }, { value: 'BANK_STATEMENT', label: 'Bank statement' },
                        { value: 'SALES_RECORDS', label: 'Sales records' }, { value: 'OTHER', label: 'Other' },
                    ]} /></Field>
                    {months('monthsObserved', 'Months observed (1–60)')}
                    <Field label="Currency"><SelectInput value={data.currency} onChange={setD('currency')} options={['USD', 'KHR']} /></Field>
                    <Field label="Average monthly inflow"><TextInput inputMode="decimal" value={data.averageMonthlyInflow} onChange={setD('averageMonthlyInflow')} placeholder="0.00" /></Field>
                    <Field label="Average monthly outflow"><TextInput inputMode="decimal" value={data.averageMonthlyOutflow} onChange={setD('averageMonthlyOutflow')} placeholder="0.00" /></Field>
                </>)}

                <DocumentPicker borrowerId={borrowerId} value={meta.documentId} onChange={setM('documentId')} hint="Required — the bill, statement or visit report this data was taken from" />
                <Field label="Note" className="md:col-span-2"><TextInput value={meta.note} onChange={setM('note')} /></Field>
            </div>
            <Notice>The record is unverified until a different officer checks it against the document. The customer needs consent in force for this source.</Notice>
            <ErrorBox error={withIssuePaths(error)} />
            <Btn variant="primary" busy={busy === 'capture'} onClick={save} disabled={!meta.periodFrom || !meta.periodTo || !meta.documentId}>Save record</Btn>
        </ActionPanel>
    );
}

function recordSummary(r: AltRecord): string {
    const d = r.data as Record<string, string | number | undefined>;
    switch (r.kind) {
        case 'UTILITY_BILLS': return `${String(d.utility ?? '').toLowerCase()} · ${d.issuer ?? ''} · ${d.monthsOnTime}/${d.monthsObserved} months on time`;
        case 'TELCO_STATEMENT': return `${d.operator ?? ''} · top-up in ${d.monthsWithTopUp}/${d.monthsObserved} months`;
        case 'RENT_HISTORY': return `${d.landlord ?? ''} · ${d.monthsOnTime}/${d.monthsObserved} months on time`;
        case 'BUSINESS_CASH_FLOW': return `${String(d.method ?? '').toLowerCase().replace(/_/g, ' ')} · in ${fmtMoney(String(d.averageMonthlyInflow ?? ''))} / out ${fmtMoney(String(d.averageMonthlyOutflow ?? ''))} ${d.currency ?? ''} a month over ${d.monthsObserved} months`;
        default: return JSON.stringify(r.data);
    }
}

/** Alternative data and consent for one customer: consent ledger, officer-captured records and their verification. */
export function AlternativeDataView({ borrowerId }: { borrowerId: string }) {
    const { can, me } = usePerm();
    const { showToast } = useToast();
    const data = useApi<AlternativeData>(`/lending/customers/${borrowerId}/alternative-data`);
    const [panel, setPanel] = useState<{ kind: 'grant'; source?: string } | { kind: 'capture' } | null>(null);
    const [revoke, setRevoke] = useState<{ consent: ConsentEntry; reason: string } | null>(null);
    const [reject, setReject] = useState<{ record: AltRecord; reason: string } | null>(null);
    const { busy, error, run, clearError } = useAction();
    const reload = () => data.reload();

    const doRevoke = async () => {
        if (!revoke) return;
        const res = await run('revoke', () => api.post(`/lending/consents/${revoke.consent.id}/revoke`, { reason: revoke.reason.trim() }));
        if (res) { setRevoke(null); showToast('Consent withdrawn', 'success'); reload(); }
    };
    const decide = async (r: AltRecord, approve: boolean, reason?: string) => {
        const res = await run(`${r.id}-${approve}`, () => api.post(`/lending/alternative-data/${r.id}/decision`, clean({ approve, reason })));
        if (res) { setReject(null); showToast(approve ? 'Record verified' : 'Record rejected', 'success'); reload(); }
    };

    const d = data.data;
    const inForce = new Map((d?.inForce ?? []).map((f) => [f.source, f]));

    return (
        <LendingShell
            title="Alternative data & consent"
            subtitle="Consent is recorded per source and is append-only. Alternative data only reaches a score while consent is in force and the record is verified."
            back={{ href: `/borrowers/${borrowerId}`, label: 'Customer profile' }}
            actions={<>
                {can('alt_data.record') && <Btn onClick={() => setPanel(panel?.kind === 'capture' ? null : { kind: 'capture' })}><Plus size={14} /> Capture data</Btn>}
                {can('alt_data.consent.manage') && <Btn variant="primary" onClick={() => setPanel(panel?.kind === 'grant' ? null : { kind: 'grant' })}><ShieldCheck size={14} /> Record consent</Btn>}
            </>}
        >
            {data.error && <ErrorBox error={data.error} />}
            {d && panel?.kind === 'grant' && (
                <GrantForm key={panel.source ?? 'any'} borrowerId={borrowerId} sources={d.sources} preset={panel.source} onClose={() => setPanel(null)}
                    onDone={() => { setPanel(null); showToast('Consent recorded', 'success'); reload(); }} />
            )}
            {d && panel?.kind === 'capture' && (
                <CaptureForm borrowerId={borrowerId} kinds={d.kinds} onClose={() => setPanel(null)} onDone={() => { setPanel(null); showToast('Record saved — awaiting verification', 'success'); reload(); }} />
            )}
            <ErrorBox error={error} onDismiss={clearError} />

            {data.loading && !d ? <Spinner /> : d && (
                <>
                    <Card title="Consent in force" subtitle="One row per data source." bodyClass="p-0">
                        <Table>
                            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Source</th><th className={th}>Status</th><th className={th}>Expires</th><th className={th} /></tr></thead>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                {d.sources.map((s) => {
                                    const f = inForce.get(s);
                                    return (
                                        <tr key={s}>
                                            <td className={td}>{sourceLabel(s)}<div className="font-mono text-[11px] text-[#697386]">{s}</div></td>
                                            <td className={td}>{f ? <StatusBadge status="ACTIVE" /> : <span className="text-[12px] text-[#697386]">no consent</span>}{f && !f.grantId && <div className="text-[11px] text-[#697386]">no grant needed</div>}</td>
                                            <td className={`${td} whitespace-nowrap`}>{f?.expiresAt ? fmtDateTime(f.expiresAt) : '—'}</td>
                                            <td className={`${td} text-right`}>
                                                {can('alt_data.consent.manage') && (
                                                    <Btn size="sm" variant="ghost" onClick={() => setPanel({ kind: 'grant', source: s })}>{f ? 'Renew' : 'Record consent'}</Btn>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </Table>
                    </Card>

                    {revoke && (
                        <ActionPanel title={`Withdraw consent — ${sourceLabel(revoke.consent.source)}`} onClose={() => setRevoke(null)}>
                            <Field label="Reason" hint="At least 3 characters. The grant stays in the history."><TextInput value={revoke.reason} onChange={(r) => setRevoke({ ...revoke, reason: r })} /></Field>
                            <Btn variant="danger" busy={busy === 'revoke'} disabled={revoke.reason.trim().length < 3} onClick={doRevoke}>Withdraw consent</Btn>
                        </ActionPanel>
                    )}

                    <Card title="Consent history" subtitle="Every grant and withdrawal, newest first. Entries are never edited." bodyClass="p-0">
                        {d.consents.length === 0 ? <Empty>No consent recorded.</Empty> : (
                            <Table>
                                <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>When</th><th className={th}>Action</th><th className={th}>Source</th><th className={th}>Purpose / reason</th><th className={th}>Method</th><th className={th}>Effective</th><th className={th}>Expires</th><th className={th}>By</th><th className={th} /></tr></thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {d.consents.map((c) => (
                                        <tr key={c.id} className={c.revoked ? 'text-[#697386]' : ''}>
                                            <td className={`${td} whitespace-nowrap`}>{fmtDateTime(c.createdAt)}</td>
                                            <td className={td}><StatusBadge status={c.action === 'GRANT' ? (c.revoked ? 'REVOKED' : 'APPROVED') : 'WITHDRAWN'} /><div className="text-[11px] text-[#697386]">{c.action.toLowerCase()}</div></td>
                                            <td className={td}>{sourceLabel(c.source)}</td>
                                            <td className={td}>{c.action === 'GRANT' ? c.purpose : c.reason}{c.scope && <div className="text-[11px] text-[#697386]">{c.scope}</div>}</td>
                                            <td className={td}>{c.method.toLowerCase().replace(/_/g, ' ')}{c.documentId && <div className="font-mono text-[11px] text-[#697386]">doc {shortId(c.documentId)}</div>}</td>
                                            <td className={`${td} whitespace-nowrap`}>{fmtDateTime(c.effectiveAt)}</td>
                                            <td className={`${td} whitespace-nowrap`}>{fmtDateTime(c.expiresAt)}</td>
                                            <td className={td}><span className="font-mono text-[11px]">{shortId(c.recordedBy)}</span></td>
                                            <td className={`${td} text-right`}>
                                                {c.action === 'GRANT' && !c.revoked && can('alt_data.consent.manage') && (
                                                    <Btn size="sm" variant="danger" onClick={() => setRevoke({ consent: c, reason: '' })}>Withdraw</Btn>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Card>

                    {reject && (
                        <ActionPanel title={`Reject ${KIND_LABELS[reject.record.kind] ?? reject.record.kind} record`} onClose={() => setReject(null)}>
                            <Field label="Reason"><TextInput value={reject.reason} onChange={(r) => setReject({ ...reject, reason: r })} /></Field>
                            <Btn variant="danger" busy={busy === `${reject.record.id}-false`} disabled={!reject.reason.trim()} onClick={() => decide(reject.record, false, reject.reason.trim())}>Reject</Btn>
                        </ActionPanel>
                    )}

                    <Card title="Captured data" subtitle="Officer-captured evidence. Only verified records are used by a scorecard." bodyClass="p-0">
                        {d.records.length === 0 ? <Empty>No alternative data captured.</Empty> : (
                            <Table>
                                <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Kind</th><th className={th}>Period</th><th className={th}>Data</th><th className={th}>Evidence</th><th className={th}>Status</th><th className={th}>Recorded / verified</th><th className={th} /></tr></thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {d.records.map((r) => {
                                        const own = !!me && r.recordedBy === me;
                                        return (
                                            <tr key={r.id}>
                                                <td className={td}>{KIND_LABELS[r.kind] ?? r.kind}</td>
                                                <td className={`${td} whitespace-nowrap`}>{r.periodFrom.slice(0, 10)} – {r.periodTo.slice(0, 10)}</td>
                                                <td className={td}>{recordSummary(r)}{r.note && <div className="text-[11px] text-[#697386]">{r.note}</div>}</td>
                                                <td className={td}>{r.document ? <>{r.document.title}<div className="font-mono text-[11px] text-[#697386]">{r.document.typeCode}</div></> : <span className="font-mono text-[11px]">{shortId(r.documentId)}</span>}</td>
                                                <td className={td}><StatusBadge status={r.status} />{r.rejectionReason && <div className="text-[11px] text-red-700">{r.rejectionReason}</div>}</td>
                                                <td className={td}>
                                                    <span className="font-mono text-[11px]">{shortId(r.recordedBy)}</span><span className="text-[11px] text-[#697386]"> · {fmtDateTime(r.createdAt)}</span>
                                                    {r.verifiedBy && <div><span className="font-mono text-[11px]">{shortId(r.verifiedBy)}</span><span className="text-[11px] text-[#697386]"> · {fmtDateTime(r.verifiedAt)}</span></div>}
                                                </td>
                                                <td className={`${td} text-right whitespace-nowrap`}>
                                                    {r.status === 'PENDING' && can('alt_data.verify') && (
                                                        <div className="flex justify-end gap-1.5">
                                                            <Btn size="sm" variant="primary" disabled={own} reason={own ? 'You captured this record; another officer must verify it.' : undefined} busy={busy === `${r.id}-true`} onClick={() => decide(r, true)}>Verify</Btn>
                                                            <Btn size="sm" variant="danger" disabled={own} reason={own ? 'You captured this record.' : undefined} onClick={() => setReject({ record: r, reason: '' })}>Reject</Btn>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </Table>
                        )}
                    </Card>
                </>
            )}
        </LendingShell>
    );
}
