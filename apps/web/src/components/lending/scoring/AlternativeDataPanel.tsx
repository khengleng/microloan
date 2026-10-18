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
import { usePeople, useScoringText } from './i18n';
import { shortId, sourceLabel, withIssuePaths } from './types';
import type { AltRecord, AltRecordKind, AlternativeData, ConsentEntry } from './types';

const METHODS = ['SIGNED_FORM', 'RECORDED_VERBAL', 'BORROWER_PORTAL'];

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
    const { t } = useScoringText();
    const lib = useApi<Library>(`/lending/customers/${borrowerId}/documents`);
    const options = (lib.data?.documents ?? [])
        .filter((d) => d.status === 'ACTIVE')
        .map((d) => ({ value: d.id, label: `${d.title} · ${d.typeCode}${d.reviewStatus === 'PENDING_REVIEW' ? ` ${t('altData.awaitingReview')}` : ''}` }));
    return { options, loading: lib.loading, error: lib.error };
}

function DocumentPicker({ borrowerId, value, onChange, label, hint }: { borrowerId: string; value: string; onChange: (v: string) => void; label?: string; hint?: string }) {
    const { t } = useScoringText();
    const href = useLendingHref();
    const docs = useDocumentOptions(borrowerId);
    return (
        <Field label={label ?? t('altData.evidenceDocument')} hint={hint ?? t('altData.fromLibrary')} error={docs.error?.message}>
            <SelectInput value={value} onChange={onChange} options={docs.options} placeholder={docs.loading ? t('common.loading') : docs.options.length ? t('altData.chooseDocument') : t('altData.noDocuments')} />
            {!docs.loading && docs.options.length === 0 && (
                <Link href={href(`/lending/customers/${borrowerId}/documents`)} className="text-[11px] font-semibold text-[#635BFF] hover:underline">{t('altData.openLibrary')}</Link>
            )}
        </Field>
    );
}

function GrantForm({ borrowerId, sources, preset, onDone, onClose }: { borrowerId: string; sources: string[]; preset?: string; onDone: () => void; onClose: () => void }) {
    const { t, source, method } = useScoringText();
    const [form, setForm] = useState({ source: preset ?? sources[0] ?? '', purpose: t('altData.defaultPurpose'), scope: '', method: 'SIGNED_FORM', documentId: '', effectiveAt: '', expiresAt: defaultExpiry() });
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
        <ActionPanel title={t('altData.recordConsent')} onClose={onClose}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label={t('altData.source')}><SelectInput value={form.source} onChange={set('source')} options={sources.map((s) => ({ value: s, label: source(s) }))} /></Field>
                <Field label={t('altData.howGiven')}><SelectInput value={form.method} onChange={set('method')} options={METHODS.map((m) => ({ value: m, label: method(m) }))} /></Field>
                <Field label={t('altData.purpose')} hint={t('altData.purposeHint')} className="md:col-span-2"><TextInput value={form.purpose} onChange={set('purpose')} /></Field>
                <Field label={t('altData.scope')} hint={t('altData.scopeHint')} className="md:col-span-2"><TextInput value={form.scope} onChange={set('scope')} /></Field>
                <DocumentPicker borrowerId={borrowerId} value={form.documentId} onChange={set('documentId')} label={needsDoc ? t('altData.signedForm') : t('altData.supportingDocument')} />
                <div />
                <Field label={t('altData.effectiveFrom')} hint={t('altData.effectiveHint')}><TextInput type="datetime-local" value={form.effectiveAt} onChange={set('effectiveAt')} /></Field>
                <Field label={t('altData.expires')} hint={t('altData.expiresHint')}><TextInput type="datetime-local" value={form.expiresAt} onChange={set('expiresAt')} /></Field>
            </div>
            <ErrorBox error={withIssuePaths(error)} />
            <Btn variant="primary" busy={busy === 'grant'} onClick={save} disabled={!form.source || form.purpose.trim().length < 5 || !form.expiresAt || (needsDoc && !form.documentId)}>
                <ShieldCheck size={14} /> {t('altData.recordConsent')}
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
    const { t, kind: kindLabel } = useScoringText();
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

    const months = (k: string, label: string) => <Field label={label} hint={t('altData.monthsHint')}><TextInput inputMode="numeric" value={data[k] ?? ''} onChange={setD(k)} /></Field>;

    return (
        <ActionPanel title={t('altData.captureTitle')} onClose={onClose}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label={t('altData.kind')}><SelectInput value={kind} onChange={changeKind} options={kinds.map((k) => ({ value: k, label: kindLabel(k) }))} /></Field>
                <Field label={t('altData.periodFrom')}><TextInput type="date" value={meta.periodFrom} onChange={setM('periodFrom')} /></Field>
                <Field label={t('altData.periodTo')}><TextInput type="date" value={meta.periodTo} onChange={setM('periodTo')} /></Field>

                {kind === 'UTILITY_BILLS' && (<>
                    <Field label={t('altData.utility')}><SelectInput value={data.utility} onChange={setD('utility')} options={[{ value: 'ELECTRICITY', label: t('altData.electricity') }, { value: 'WATER', label: t('altData.water') }]} /></Field>
                    <Field label={t('altData.issuer')} hint={t('altData.issuerHint')}><TextInput value={data.issuer} onChange={setD('issuer')} /></Field>
                    <Field label={t('altData.accountReference')}><TextInput value={data.accountReference} onChange={setD('accountReference')} /></Field>
                    {months('monthsObserved', t('altData.monthsObserved'))}
                    {months('monthsOnTime', t('altData.monthsOnTime'))}
                </>)}
                {kind === 'TELCO_STATEMENT' && (<>
                    <Field label={t('altData.operator')}><TextInput value={data.operator} onChange={setD('operator')} /></Field>
                    {months('monthsObserved', t('altData.monthsObserved'))}
                    {months('monthsWithTopUp', t('altData.monthsWithTopUp'))}
                </>)}
                {kind === 'RENT_HISTORY' && (<>
                    <Field label={t('altData.landlord')}><TextInput value={data.landlord} onChange={setD('landlord')} /></Field>
                    {months('monthsObserved', t('altData.monthsObserved'))}
                    {months('monthsOnTime', t('altData.monthsOnTime'))}
                </>)}
                {kind === 'BUSINESS_CASH_FLOW' && (<>
                    <Field label={t('altData.cashFlowMethod')}><SelectInput value={data.method} onChange={setD('method')} options={['SITE_VISIT', 'BANK_STATEMENT', 'SALES_RECORDS', 'OTHER'].map((m) => ({ value: m, label: t(`altData.cashFlowMethods.${m}`) }))} /></Field>
                    {months('monthsObserved', t('altData.monthsObserved'))}
                    <Field label={t('altData.currency')}><SelectInput value={data.currency} onChange={setD('currency')} options={['USD', 'KHR']} /></Field>
                    <Field label={t('altData.inflow')}><TextInput inputMode="decimal" value={data.averageMonthlyInflow} onChange={setD('averageMonthlyInflow')} placeholder="0.00" /></Field>
                    <Field label={t('altData.outflow')}><TextInput inputMode="decimal" value={data.averageMonthlyOutflow} onChange={setD('averageMonthlyOutflow')} placeholder="0.00" /></Field>
                </>)}

                <DocumentPicker borrowerId={borrowerId} value={meta.documentId} onChange={setM('documentId')} hint={t('altData.evidenceHint')} />
                <Field label={t('altData.note')} className="md:col-span-2"><TextInput value={meta.note} onChange={setM('note')} /></Field>
            </div>
            <Notice>{t('altData.unverifiedNotice')}</Notice>
            <ErrorBox error={withIssuePaths(error)} />
            <Btn variant="primary" busy={busy === 'capture'} onClick={save} disabled={!meta.periodFrom || !meta.periodTo || !meta.documentId}>{t('altData.saveRecord')}</Btn>
        </ActionPanel>
    );
}

function recordSummary(r: AltRecord, t: ReturnType<typeof useScoringText>['t']): string {
    const d = r.data as Record<string, string | number | undefined>;
    const s = (v: unknown) => String(v ?? '');
    switch (r.kind) {
        case 'UTILITY_BILLS': return t('altData.summary.utility', { utility: s(d.utility).toLowerCase(), issuer: s(d.issuer), onTime: s(d.monthsOnTime), observed: s(d.monthsObserved) });
        case 'TELCO_STATEMENT': return t('altData.summary.telco', { operator: s(d.operator), topUp: s(d.monthsWithTopUp), observed: s(d.monthsObserved) });
        case 'RENT_HISTORY': return t('altData.summary.rent', { landlord: s(d.landlord), onTime: s(d.monthsOnTime), observed: s(d.monthsObserved) });
        case 'BUSINESS_CASH_FLOW': return t('altData.summary.cashFlow', {
            method: t.has(`altData.cashFlowMethods.${s(d.method)}`) ? t(`altData.cashFlowMethods.${s(d.method)}`) : s(d.method).toLowerCase().replace(/_/g, ' '),
            inflow: fmtMoney(s(d.averageMonthlyInflow)), outflow: fmtMoney(s(d.averageMonthlyOutflow)), currency: s(d.currency), observed: s(d.monthsObserved),
        });
        default: return JSON.stringify(r.data);
    }
}

/** Alternative data and consent for one customer: consent ledger, officer-captured records and their verification. */
export function AlternativeDataView({ borrowerId }: { borrowerId: string }) {
    const { can, me } = usePerm();
    const { t, source, kind: kindLabel, method } = useScoringText();
    const { showToast } = useToast();
    const data = useApi<AlternativeData>(`/lending/customers/${borrowerId}/alternative-data`);
    const person = usePeople([...(data.data?.consents ?? []).map((c) => c.recordedBy), ...(data.data?.records ?? []).flatMap((r) => [r.recordedBy, r.verifiedBy])]);
    const [panel, setPanel] = useState<{ kind: 'grant'; source?: string } | { kind: 'capture' } | null>(null);
    const [revoke, setRevoke] = useState<{ consent: ConsentEntry; reason: string } | null>(null);
    const [reject, setReject] = useState<{ record: AltRecord; reason: string } | null>(null);
    const { busy, error, run, clearError } = useAction();
    const reload = () => data.reload();

    const doRevoke = async () => {
        if (!revoke) return;
        const res = await run('revoke', () => api.post(`/lending/consents/${revoke.consent.id}/revoke`, { reason: revoke.reason.trim() }));
        if (res) { setRevoke(null); showToast(t('altData.consentWithdrawn'), 'success'); reload(); }
    };
    const decide = async (r: AltRecord, approve: boolean, reason?: string) => {
        const res = await run(`${r.id}-${approve}`, () => api.post(`/lending/alternative-data/${r.id}/decision`, clean({ approve, reason })));
        if (res) { setReject(null); showToast(approve ? t('altData.recordVerified') : t('altData.recordRejected'), 'success'); reload(); }
    };

    const d = data.data;
    const inForce = new Map((d?.inForce ?? []).map((f) => [f.source, f]));

    return (
        <LendingShell
            title={t('altData.title')}
            subtitle={t('altData.subtitle')}
            back={{ href: `/borrowers/${borrowerId}`, label: t('altData.customerProfile') }}
            actions={<>
                {can('alt_data.record') && <Btn onClick={() => setPanel(panel?.kind === 'capture' ? null : { kind: 'capture' })}><Plus size={14} /> {t('altData.captureData')}</Btn>}
                {can('alt_data.consent.manage') && <Btn variant="primary" onClick={() => setPanel(panel?.kind === 'grant' ? null : { kind: 'grant' })}><ShieldCheck size={14} /> {t('altData.recordConsent')}</Btn>}
            </>}
        >
            {data.error && <ErrorBox error={data.error} />}
            {d && panel?.kind === 'grant' && (
                <GrantForm key={panel.source ?? 'any'} borrowerId={borrowerId} sources={d.sources} preset={panel.source} onClose={() => setPanel(null)}
                    onDone={() => { setPanel(null); showToast(t('altData.consentRecorded'), 'success'); reload(); }} />
            )}
            {d && panel?.kind === 'capture' && (
                <CaptureForm borrowerId={borrowerId} kinds={d.kinds} onClose={() => setPanel(null)} onDone={() => { setPanel(null); showToast(t('altData.recordSaved'), 'success'); reload(); }} />
            )}
            <ErrorBox error={error} onDismiss={clearError} />

            {data.loading && !d ? <Spinner /> : d && (
                <>
                    <Card title={t('altData.inForceTitle')} subtitle={t('altData.inForceSubtitle')} bodyClass="p-0">
                        <Table>
                            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('altData.source')}</th><th className={th}>{t('altData.colStatus')}</th><th className={th}>{t('altData.expires')}</th><th className={th} /></tr></thead>
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
                                                    <Btn size="sm" variant="ghost" onClick={() => setPanel({ kind: 'grant', source: s })}>{f ? t('altData.renew') : t('altData.recordConsent')}</Btn>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </Table>
                    </Card>

                    {revoke && (
                        <ActionPanel title={t('altData.withdrawTitle', { source: source(revoke.consent.source) })} onClose={() => setRevoke(null)}>
                            <Field label={t('altData.reason')} hint={t('altData.withdrawHint')}><TextInput value={revoke.reason} onChange={(r) => setRevoke({ ...revoke, reason: r })} /></Field>
                            <Btn variant="danger" busy={busy === 'revoke'} disabled={revoke.reason.trim().length < 3} onClick={doRevoke}>{t('altData.withdrawConsent')}</Btn>
                        </ActionPanel>
                    )}

                    <Card title={t('altData.historyTitle')} subtitle={t('altData.historySubtitle')} bodyClass="p-0">
                        {d.consents.length === 0 ? <Empty>{t('altData.noConsent')}</Empty> : (
                            <Table>
                                <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('altData.colWhen')}</th><th className={th}>{t('altData.colAction')}</th><th className={th}>{t('altData.source')}</th><th className={th}>{t('altData.colPurposeReason')}</th><th className={th}>{t('altData.colMethod')}</th><th className={th}>{t('altData.colEffective')}</th><th className={th}>{t('altData.expires')}</th><th className={th}>{t('altData.colBy')}</th><th className={th} /></tr></thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {d.consents.map((c) => (
                                        <tr key={c.id} className={c.revoked ? 'text-[#697386]' : ''}>
                                            <td className={`${td} whitespace-nowrap`}>{fmtDateTime(c.createdAt)}</td>
                                            <td className={td}><StatusBadge status={c.action === 'GRANT' ? (c.revoked ? 'REVOKED' : 'APPROVED') : 'WITHDRAWN'} /><div className="text-[11px] text-[#697386]">{c.action === 'GRANT' ? t('altData.actionGrant') : t('altData.actionWithdraw')}</div></td>
                                            <td className={td}>{source(c.source)}</td>
                                            <td className={td}>{c.action === 'GRANT' ? c.purpose : c.reason}{c.scope && <div className="text-[11px] text-[#697386]">{c.scope}</div>}</td>
                                            <td className={td}>{method(c.method)}{c.documentId && <div className="font-mono text-[11px] text-[#697386]">{t('altData.docRef', { id: shortId(c.documentId) })}</div>}</td>
                                            <td className={`${td} whitespace-nowrap`}>{fmtDateTime(c.effectiveAt)}</td>
                                            <td className={`${td} whitespace-nowrap`}>{fmtDateTime(c.expiresAt)}</td>
                                            <td className={td}><span className="text-[12px]" title={c.recordedBy}>{person(c.recordedBy)}</span></td>
                                            <td className={`${td} text-right`}>
                                                {c.action === 'GRANT' && !c.revoked && can('alt_data.consent.manage') && (
                                                    <Btn size="sm" variant="danger" onClick={() => setRevoke({ consent: c, reason: '' })}>{t('altData.withdraw')}</Btn>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Card>

                    {reject && (
                        <ActionPanel title={t('altData.rejectTitle', { kind: kindLabel(reject.record.kind) })} onClose={() => setReject(null)}>
                            <Field label={t('altData.reason')}><TextInput value={reject.reason} onChange={(r) => setReject({ ...reject, reason: r })} /></Field>
                            <Btn variant="danger" busy={busy === `${reject.record.id}-false`} disabled={!reject.reason.trim()} onClick={() => decide(reject.record, false, reject.reason.trim())}>{t('altData.reject')}</Btn>
                        </ActionPanel>
                    )}

                    <Card title={t('altData.capturedTitle')} subtitle={t('altData.capturedSubtitle')} bodyClass="p-0">
                        {d.records.length === 0 ? <Empty>{t('altData.noRecords')}</Empty> : (
                            <Table>
                                <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('altData.kind')}</th><th className={th}>{t('altData.colPeriod')}</th><th className={th}>{t('altData.colData')}</th><th className={th}>{t('altData.colEvidence')}</th><th className={th}>{t('altData.colStatus')}</th><th className={th}>{t('altData.colRecordedVerified')}</th><th className={th} /></tr></thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {d.records.map((r) => {
                                        const own = !!me && r.recordedBy === me;
                                        return (
                                            <tr key={r.id}>
                                                <td className={td}>{kindLabel(r.kind)}</td>
                                                <td className={`${td} whitespace-nowrap`}>{r.periodFrom.slice(0, 10)} – {r.periodTo.slice(0, 10)}</td>
                                                <td className={td}>{recordSummary(r, t)}{r.note && <div className="text-[11px] text-[#697386]">{r.note}</div>}</td>
                                                <td className={td}>{r.document ? <>{r.document.title}<div className="font-mono text-[11px] text-[#697386]">{r.document.typeCode}</div></> : <span className="font-mono text-[11px]">{shortId(r.documentId)}</span>}</td>
                                                <td className={td}><StatusBadge status={r.status} />{r.rejectionReason && <div className="text-[11px] text-red-700">{r.rejectionReason}</div>}</td>
                                                <td className={td}>
                                                    <span className="text-[12px]" title={r.recordedBy}>{person(r.recordedBy)}</span><span className="text-[11px] text-[#697386]"> · {fmtDateTime(r.createdAt)}</span>
                                                    {r.verifiedBy && <div><span className="text-[12px]" title={r.verifiedBy}>{person(r.verifiedBy)}</span><span className="text-[11px] text-[#697386]"> · {fmtDateTime(r.verifiedAt)}</span></div>}
                                                </td>
                                                <td className={`${td} text-right whitespace-nowrap`}>
                                                    {r.status === 'PENDING' && can('alt_data.verify') && (
                                                        <div className="flex justify-end gap-1.5">
                                                            <Btn size="sm" variant="primary" disabled={own} reason={own ? t('altData.ownVerify') : undefined} busy={busy === `${r.id}-true`} onClick={() => decide(r, true)}>{t('altData.verify')}</Btn>
                                                            <Btn size="sm" variant="danger" disabled={own} reason={own ? t('altData.ownRecord') : undefined} onClick={() => setReject({ record: r, reason: '' })}>{t('altData.reject')}</Btn>
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
