"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ActionPanel, Btn, Card, Disclosure, Empty, ErrorBox, Field, Notice, SelectInput, Table, TextInput, td, tdR, th, thR } from '../ui';
import { clean, useAction, useApi } from '../useAsync';
import { fmtDateTime, fmtMoney, fmtRate } from '../format';
import { Money, MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';

interface ClassConfig { code: string; label: string; kind: 'INVENTORY' | 'RECEIVABLES'; advanceRate: string; maxAgeDays: number | null; concentrationLimit: string | null }
interface ClassResult { code: string; label: string; kind: string; advanceRate: string; gross: string; ineligible: string; agedOut: string; concentrationExcess: string; eligible: string; advance: string }
interface Availability {
    limit: string; borrowingBase: string | null; drawingCap: string; outstanding: string; available: string;
    certificateAsOf: string | null; certificateValidThrough: string | null; stale: boolean; reason: string | null;
}
interface Certificate {
    id: string; sequence: number; asOfDate: string; status: string; grossValue: string; ineligibleValue: string; eligibleValue: string;
    borrowingBase: string; notes: string; submittedBy: string; submittedAt: string; decidedBy: string | null; decidedAt: string | null;
    decisionReason: string | null; classes: ClassResult[];
}
interface Overview { businessDate: string; currency: string; classes: ClassConfig[]; certificateMaxAgeDays: number; availability: Availability; current: Certificate | null; certificates: Certificate[] }
interface Preview { gross: string; ineligible: string; eligible: string; borrowingBase: string; classes: ClassResult[]; explanation: string[] }

type Line = { classCode: string; description: string; counterparty: string; grossValue: string; ineligibleAmount: string; ineligibleReason: string; ageDays: string };

const MONEY_RE = /^\d+(\.\d{1,4})?$/;
const blank = (classCode: string): Line => ({ classCode, description: '', counterparty: '', grossValue: '', ineligibleAmount: '', ineligibleReason: '', ageDays: '' });

/** Eligibility by class: gross → ineligibles → eligible × advance rate. */
function ClassBreakdown({ classes, currency }: { classes: ClassResult[]; currency: string }) {
    return (
        <Table>
            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Class</th><th className={thR}>Gross</th><th className={thR}>Ineligible</th><th className={thR}>Aged out</th><th className={thR}>Over concentration</th><th className={thR}>Eligible</th><th className={th}>Advance rate</th><th className={thR}>Borrowing base</th></tr></thead>
            <tbody className="divide-y divide-[#F0F2F5]">
                {classes.map((c) => (
                    <tr key={c.code}>
                        <td className={td}>{c.label}<div className="text-[11px] text-[#8792A2]">{c.kind.toLowerCase()}</div></td>
                        <td className={tdR}><MoneyCell value={c.gross} currency={currency} /></td>
                        <td className={tdR}><MoneyCell value={c.ineligible} highlightNonZero /></td>
                        <td className={tdR}><MoneyCell value={c.agedOut} highlightNonZero /></td>
                        <td className={tdR}><MoneyCell value={c.concentrationExcess} highlightNonZero /></td>
                        <td className={tdR}><MoneyCell value={c.eligible} /></td>
                        <td className={td}>{fmtRate(c.advanceRate)}</td>
                        <td className={tdR}><MoneyCell value={c.advance} strong /></td>
                    </tr>
                ))}
            </tbody>
        </Table>
    );
}

function CertificateForm({ facilityId, data, onDone, onClose }: { facilityId: string; data: Overview; onDone: (m: string) => void; onClose: () => void }) {
    const [asOfDate, setAsOfDate] = useState(data.businessDate);
    const [notes, setNotes] = useState('');
    const [lines, setLines] = useState<Line[]>(data.classes.map((c) => blank(c.code)));
    const [preview, setPreview] = useState<Preview | null>(null);
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const cur = data.currency;
    const classOf = (code: string) => data.classes.find((c) => c.code === code);

    const payload = () => {
        const used = lines.filter((l) => l.grossValue.trim() || l.description.trim());
        if (!used.length) { setProblem('Add at least one line.'); return null; }
        for (const l of used) {
            if (!l.description.trim() || !MONEY_RE.test(l.grossValue.trim())) { setProblem('Every line needs a description and a gross value.'); return null; }
            if (l.ineligibleAmount && !MONEY_RE.test(l.ineligibleAmount)) { setProblem('Ineligible amounts are decimals.'); return null; }
            if (l.ageDays && !/^\d+$/.test(l.ageDays)) { setProblem('Age is a whole number of days.'); return null; }
        }
        setProblem('');
        return used.map((l) => clean({ ...l, description: l.description.trim(), counterparty: l.counterparty.trim(), ageDays: l.ageDays ? Number(l.ageDays) : undefined }));
    };
    const doPreview = async () => {
        const p = payload();
        if (!p) return;
        const r = await run('preview', () => api.post<Preview>(`/lending/facilities/${facilityId}/borrowing-base/preview`, { lines: p }));
        if (r) setPreview(r.data);
    };
    const submit = async () => {
        const p = payload();
        if (!p) return;
        const r = await run('submit', () => api.post<Certificate>(`/lending/facilities/${facilityId}/borrowing-base/certificates`, clean({ asOfDate, lines: p, notes: notes.trim() })));
        if (r) onDone(`Certificate #${r.data.sequence} submitted — base ${cur} ${fmtMoney(r.data.borrowingBase)}; a second person must accept it`);
    };
    const set = (i: number, k: keyof Line) => (v: string) => { const next = [...lines]; next[i] = { ...next[i], [k]: v }; setLines(next); setPreview(null); };

    return (
        <ActionPanel title="New borrowing-base certificate" onClose={onClose}>
            <div className="flex flex-wrap items-end gap-3">
                <Field label="As of" hint={`Supports drawings for ${data.certificateMaxAgeDays} days`}><TextInput type="date" value={asOfDate} onChange={setAsOfDate} max={data.businessDate} className="w-44" /></Field>
                <Field label="Notes" className="flex-1 min-w-[200px]"><TextInput value={notes} onChange={setNotes} maxLength={500} placeholder="e.g. month-end stock count, aged debtors report" /></Field>
            </div>
            <div className="space-y-2">
                {lines.map((l, i) => {
                    const cls = classOf(l.classCode);
                    return (
                        <div key={i} className="grid grid-cols-2 md:grid-cols-7 gap-2 items-end border-b border-[#F0F2F5] pb-2">
                            <Field label="Class"><SelectInput value={l.classCode} onChange={set(i, 'classCode')} options={data.classes.map((c) => ({ value: c.code, label: c.label }))} /></Field>
                            <Field label="Description"><TextInput value={l.description} onChange={set(i, 'description')} maxLength={200} /></Field>
                            <Field label={cls?.kind === 'RECEIVABLES' ? 'Debtor' : 'Location / supplier'}><TextInput value={l.counterparty} onChange={set(i, 'counterparty')} maxLength={120} /></Field>
                            <Field label={`Gross (${cur})`}><TextInput value={l.grossValue} onChange={set(i, 'grossValue')} inputMode="decimal" /></Field>
                            <Field label="Ineligible"><TextInput value={l.ineligibleAmount} onChange={set(i, 'ineligibleAmount')} inputMode="decimal" placeholder="0" /></Field>
                            <Field label="Reason"><TextInput value={l.ineligibleReason} onChange={set(i, 'ineligibleReason')} maxLength={200} placeholder="obsolete, disputed…" /></Field>
                            <Field label="Age (days)" hint={cls?.maxAgeDays ? `ineligible over ${cls.maxAgeDays}` : undefined}><TextInput value={l.ageDays} onChange={set(i, 'ageDays')} inputMode="numeric" /></Field>
                        </div>
                    );
                })}
                <div className="flex gap-2">
                    <Btn size="sm" onClick={() => setLines([...lines, blank(data.classes[0].code)])}>Add line</Btn>
                    {lines.length > 1 && <Btn size="sm" variant="ghost" onClick={() => setLines(lines.slice(0, -1))}>Remove last</Btn>}
                </div>
            </div>
            {problem && <p className="text-[12px] text-red-600">{problem}</p>}
            {preview && (
                <div className="space-y-2">
                    <p className="text-[13px]">Gross {cur} {fmtMoney(preview.gross)} − ineligible {fmtMoney(preview.ineligible)} = eligible {fmtMoney(preview.eligible)} → <strong>borrowing base {cur} {fmtMoney(preview.borrowingBase)}</strong></p>
                    <ClassBreakdown classes={preview.classes} currency={cur} />
                </div>
            )}
            <ErrorBox error={error} onDismiss={clearError} />
            <div className="flex gap-2">
                <Btn onClick={doPreview} busy={busy === 'preview'}>Work out the base</Btn>
                <Btn variant="primary" onClick={submit} busy={busy === 'submit'} disabled={!preview} reason={!preview ? 'Work out the base first' : undefined}>Submit for acceptance</Btn>
            </div>
        </ActionPanel>
    );
}

/** Borrowing base on a revolving line (LT-14): what can be drawn, and the certificates behind it. */
export function BorrowingBaseCard({ facilityId, onDone }: { facilityId: string; onDone: (msg: string) => void }) {
    const confirm = useConfirm();
    const res = useApi<Overview>(`/lending/facilities/${facilityId}/borrowing-base`);
    const [entering, setEntering] = useState(false);
    const [rejecting, setRejecting] = useState<{ id: string; reason: string } | null>(null);
    const { busy, error, run, clearError } = useAction();
    const d = res.data;
    if (!d) return res.error ? <ErrorBox error={res.error} /> : null;
    const a = d.availability;
    const cur = d.currency;
    const done = (m: string) => { setEntering(false); setRejecting(null); res.reload(); onDone(m); };
    const decide = async (c: Certificate, outcome: 'ACCEPT' | 'REJECT', reason?: string) => {
        if (outcome === 'ACCEPT') {
            const ok = await confirm({ title: 'Accept certificate', message: `Accept certificate #${c.sequence} as of ${c.asOfDate}? Drawings will be limited to the lower of the limit and ${cur} ${fmtMoney(c.borrowingBase)}.`, confirmLabel: 'Accept' });
            if (!ok) return;
        }
        const r = await run(`${outcome}-${c.id}`, () => api.post<{ status: string; overAdvance: string }>(`/lending/facilities/${facilityId}/borrowing-base/certificates/${c.id}/decision`, clean({ outcome, reason })));
        if (r) done(r.data.status === 'ACCEPTED' && r.data.overAdvance !== '0' ? `Certificate accepted — the line is ${cur} ${fmtMoney(r.data.overAdvance)} over its base and must be reduced` : `Certificate ${r.data.status.toLowerCase()}`);
    };
    const pending = d.certificates.filter((c) => c.status === 'SUBMITTED');

    return (
        <Card
            title="Borrowing base"
            subtitle="Drawings are limited to the lower of the limit and the base certified by the borrower; a certificate older than its maximum age supports nothing."
            actions={!entering ? <Btn variant="primary" onClick={() => setEntering(true)} disabled={pending.length > 0} reason={pending.length ? 'A certificate is awaiting a decision' : undefined}>New certificate</Btn> : undefined}
        >
            <div className="space-y-4">
                {a.stale && <Notice tone="warn" title={a.certificateAsOf ? 'Certificate out of date' : 'No accepted certificate'}>{a.reason}</Notice>}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                        ['Limit', <Money key="l" value={a.limit} currency={cur} />, null],
                        ['Borrowing base', a.borrowingBase ? <Money key="b" value={a.borrowingBase} currency={cur} /> : '—', a.certificateAsOf ? `as of ${a.certificateAsOf}` : null],
                        ['Drawing cap', <Money key="c" value={a.drawingCap} currency={cur} />, 'lower of limit and base'],
                        ['Drawn', <Money key="o" value={a.outstanding} currency={cur} />, null],
                        ['Available now', <Money key="v" value={a.available} currency={cur} />, a.certificateValidThrough ? `certificate valid through ${a.certificateValidThrough}` : null],
                    ].map(([label, value, hint], i) => (
                        <div key={i} className="border border-[#E3E8EE] rounded-md px-3 py-2">
                            <p className="text-[11px] font-bold uppercase text-[#8792A2]">{label}</p>
                            <p className="text-[16px] font-bold">{value}</p>
                            {hint && <p className="text-[11px] text-[#697386]">{hint}</p>}
                        </div>
                    ))}
                </div>

                {entering && <CertificateForm facilityId={facilityId} data={d} onDone={done} onClose={() => setEntering(false)} />}

                {pending.map((c) => (
                    <div key={c.id} className="border border-[#C9D7FF] bg-[#F8F9FF] rounded-md p-3 space-y-2">
                        <p className="text-[13px] font-bold">Certificate #{c.sequence} as of {c.asOfDate} awaits acceptance — base {cur} {fmtMoney(c.borrowingBase)}</p>
                        <p className="text-[12px] text-[#697386]">Submitted {fmtDateTime(c.submittedAt)}{c.notes ? ` · ${c.notes}` : ''}. The person who submitted it cannot accept it.</p>
                        <ClassBreakdown classes={c.classes} currency={cur} />
                        <div className="flex flex-wrap items-center gap-2">
                            <Btn variant="primary" size="sm" onClick={() => decide(c, 'ACCEPT')} busy={busy === `ACCEPT-${c.id}`}>Accept</Btn>
                            {rejecting?.id === c.id ? (
                                <>
                                    <TextInput value={rejecting.reason} onChange={(v) => setRejecting({ id: c.id, reason: v })} placeholder="Reason for rejecting" maxLength={500} className="w-72" />
                                    <Btn variant="danger" size="sm" onClick={() => decide(c, 'REJECT', rejecting.reason.trim())} busy={busy === `REJECT-${c.id}`} disabled={!rejecting.reason.trim()}>Reject</Btn>
                                </>
                            ) : (
                                <Btn variant="ghost" size="sm" onClick={() => setRejecting({ id: c.id, reason: '' })}>Reject…</Btn>
                            )}
                        </div>
                    </div>
                ))}

                {d.current && (
                    <div>
                        <p className="text-[13px] font-bold text-[#1A1F36] mb-2">Current certificate #{d.current.sequence} (as of {d.current.asOfDate})</p>
                        <ClassBreakdown classes={d.current.classes} currency={cur} />
                    </div>
                )}

                <Disclosure summary={`Certificate history (${d.certificates.length})`}>
                    {d.certificates.length === 0 ? <Empty>No certificates yet.</Empty> : (
                        <Table>
                            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>#</th><th className={th}>As of</th><th className={thR}>Gross</th><th className={thR}>Eligible</th><th className={thR}>Base</th><th className={th}>Status</th><th className={th}>Decided</th></tr></thead>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                {d.certificates.map((c) => (
                                    <tr key={c.id}>
                                        <td className={td}>{c.sequence}</td>
                                        <td className={td}>{c.asOfDate}</td>
                                        <td className={tdR}><MoneyCell value={c.grossValue} /></td>
                                        <td className={tdR}><MoneyCell value={c.eligibleValue} /></td>
                                        <td className={tdR}><MoneyCell value={c.borrowingBase} strong /></td>
                                        <td className={td}><StatusBadge status={c.status} /></td>
                                        <td className={td}>{c.decidedAt ? fmtDateTime(c.decidedAt) : '—'}{c.decisionReason ? <div className="text-[11px] text-[#697386]">{c.decisionReason}</div> : null}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    )}
                </Disclosure>
                <ErrorBox error={error ?? res.error} onDismiss={clearError} />
            </div>
        </Card>
    );
}
