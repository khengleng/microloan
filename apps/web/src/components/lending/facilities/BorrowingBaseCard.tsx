"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
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
    const tl = useTranslations('LendingFacilities.borrowingBase');
    return (
        <Table>
            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{tl('columns.class')}</th><th className={thR}>{tl('columns.gross')}</th><th className={thR}>{tl('columns.ineligible')}</th><th className={thR}>{tl('columns.agedOut')}</th><th className={thR}>{tl('columns.overConcentration')}</th><th className={thR}>{tl('columns.eligible')}</th><th className={th}>{tl('columns.advanceRate')}</th><th className={thR}>{tl('columns.borrowingBase')}</th></tr></thead>
            <tbody className="divide-y divide-[#F0F2F5]">
                {classes.map((c) => (
                    <tr key={c.code}>
                        <td className={td}>{c.label}<div className="text-[11px] text-[#8792A2]">{tl.has(`kinds.${c.kind}`) ? tl(`kinds.${c.kind}`) : c.kind.toLowerCase()}</div></td>
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
    const tl = useTranslations('LendingFacilities.borrowingBase.form');
    const cur = data.currency;
    const classOf = (code: string) => data.classes.find((c) => c.code === code);

    const payload = () => {
        const used = lines.filter((l) => l.grossValue.trim() || l.description.trim());
        if (!used.length) { setProblem(tl('errors.noLines')); return null; }
        for (const l of used) {
            if (!l.description.trim() || !MONEY_RE.test(l.grossValue.trim())) { setProblem(tl('errors.lineIncomplete')); return null; }
            if (l.ineligibleAmount && !MONEY_RE.test(l.ineligibleAmount)) { setProblem(tl('errors.ineligibleDecimal')); return null; }
            if (l.ageDays && !/^\d+$/.test(l.ageDays)) { setProblem(tl('errors.ageWhole')); return null; }
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
        if (r) onDone(tl('submitted', { sequence: r.data.sequence, currency: cur, base: fmtMoney(r.data.borrowingBase) }));
    };
    const set = (i: number, k: keyof Line) => (v: string) => { const next = [...lines]; next[i] = { ...next[i], [k]: v }; setLines(next); setPreview(null); };

    return (
        <ActionPanel title={tl('title')} onClose={onClose}>
            <div className="flex flex-wrap items-end gap-3">
                <Field label={tl('asOf')} hint={tl('asOfHint', { days: data.certificateMaxAgeDays })}><TextInput type="date" value={asOfDate} onChange={setAsOfDate} max={data.businessDate} className="w-44" /></Field>
                <Field label={tl('notes')} className="flex-1 min-w-[200px]"><TextInput value={notes} onChange={setNotes} maxLength={500} placeholder={tl('notesPlaceholder')} /></Field>
            </div>
            <div className="space-y-2">
                {lines.map((l, i) => {
                    const cls = classOf(l.classCode);
                    return (
                        <div key={i} className="grid grid-cols-2 md:grid-cols-7 gap-2 items-end border-b border-[#F0F2F5] pb-2">
                            <Field label={tl('class')}><SelectInput value={l.classCode} onChange={set(i, 'classCode')} options={data.classes.map((c) => ({ value: c.code, label: c.label }))} /></Field>
                            <Field label={tl('description')}><TextInput value={l.description} onChange={set(i, 'description')} maxLength={200} /></Field>
                            <Field label={cls?.kind === 'RECEIVABLES' ? tl('debtor') : tl('locationSupplier')}><TextInput value={l.counterparty} onChange={set(i, 'counterparty')} maxLength={120} /></Field>
                            <Field label={tl('gross', { currency: cur })}><TextInput value={l.grossValue} onChange={set(i, 'grossValue')} inputMode="decimal" /></Field>
                            <Field label={tl('ineligible')}><TextInput value={l.ineligibleAmount} onChange={set(i, 'ineligibleAmount')} inputMode="decimal" placeholder="0" /></Field>
                            <Field label={tl('reason')}><TextInput value={l.ineligibleReason} onChange={set(i, 'ineligibleReason')} maxLength={200} placeholder={tl('reasonPlaceholder')} /></Field>
                            <Field label={tl('ageDays')} hint={cls?.maxAgeDays ? tl('ageHint', { days: cls.maxAgeDays }) : undefined}><TextInput value={l.ageDays} onChange={set(i, 'ageDays')} inputMode="numeric" /></Field>
                        </div>
                    );
                })}
                <div className="flex gap-2">
                    <Btn size="sm" onClick={() => setLines([...lines, blank(data.classes[0].code)])}>{tl('addLine')}</Btn>
                    {lines.length > 1 && <Btn size="sm" variant="ghost" onClick={() => setLines(lines.slice(0, -1))}>{tl('removeLast')}</Btn>}
                </div>
            </div>
            {problem && <p className="text-[12px] text-red-600">{problem}</p>}
            {preview && (
                <div className="space-y-2">
                    <p className="text-[13px]">{tl.rich('previewSummary', { currency: cur, gross: fmtMoney(preview.gross), ineligible: fmtMoney(preview.ineligible), eligible: fmtMoney(preview.eligible), base: fmtMoney(preview.borrowingBase), strong: (chunks) => <strong>{chunks}</strong> })}</p>
                    <ClassBreakdown classes={preview.classes} currency={cur} />
                </div>
            )}
            <ErrorBox error={error} onDismiss={clearError} />
            <div className="flex gap-2">
                <Btn onClick={doPreview} busy={busy === 'preview'}>{tl('workOut')}</Btn>
                <Btn variant="primary" onClick={submit} busy={busy === 'submit'} disabled={!preview} reason={!preview ? tl('workOutFirst') : undefined}>{tl('submit')}</Btn>
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
    const tl = useTranslations('LendingFacilities.borrowingBase');
    const ts = useTranslations('Status');
    const d = res.data;
    if (!d) return res.error ? <ErrorBox error={res.error} /> : null;
    const a = d.availability;
    const cur = d.currency;
    const done = (m: string) => { setEntering(false); setRejecting(null); res.reload(); onDone(m); };
    const decide = async (c: Certificate, outcome: 'ACCEPT' | 'REJECT', reason?: string) => {
        if (outcome === 'ACCEPT') {
            const ok = await confirm({ title: tl('acceptConfirm.title'), message: tl('acceptConfirm.message', { sequence: c.sequence, date: c.asOfDate, currency: cur, base: fmtMoney(c.borrowingBase) }), confirmLabel: tl('acceptConfirm.confirm') });
            if (!ok) return;
        }
        const r = await run(`${outcome}-${c.id}`, () => api.post<{ status: string; overAdvance: string }>(`/lending/facilities/${facilityId}/borrowing-base/certificates/${c.id}/decision`, clean({ outcome, reason })));
        if (r) done(r.data.status === 'ACCEPTED' && r.data.overAdvance !== '0' ? tl('acceptedOverAdvance', { currency: cur, amount: fmtMoney(r.data.overAdvance) }) : tl('decided', { status: ts.has(r.data.status) ? ts(r.data.status) : r.data.status.toLowerCase() }));
    };
    const pending = d.certificates.filter((c) => c.status === 'SUBMITTED');

    return (
        <Card
            title={tl('title')}
            subtitle={tl('subtitle')}
            actions={!entering ? <Btn variant="primary" onClick={() => setEntering(true)} disabled={pending.length > 0} reason={pending.length ? tl('pendingReason') : undefined}>{tl('newCertificate')}</Btn> : undefined}
        >
            <div className="space-y-4">
                {a.stale && <Notice tone="warn" title={a.certificateAsOf ? tl('staleTitle') : tl('noAcceptedTitle')}>{a.reason}</Notice>}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                        [tl('tiles.limit'), <Money key="l" value={a.limit} currency={cur} />, null],
                        [tl('tiles.borrowingBase'), a.borrowingBase ? <Money key="b" value={a.borrowingBase} currency={cur} /> : '—', a.certificateAsOf ? tl('tiles.asOf', { date: a.certificateAsOf }) : null],
                        [tl('tiles.drawingCap'), <Money key="c" value={a.drawingCap} currency={cur} />, tl('tiles.drawingCapHint')],
                        [tl('tiles.drawn'), <Money key="o" value={a.outstanding} currency={cur} />, null],
                        [tl('tiles.availableNow'), <Money key="v" value={a.available} currency={cur} />, a.certificateValidThrough ? tl('tiles.validThrough', { date: a.certificateValidThrough }) : null],
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
                        <p className="text-[13px] font-bold">{tl('pendingTitle', { sequence: c.sequence, date: c.asOfDate, currency: cur, base: fmtMoney(c.borrowingBase) })}</p>
                        <p className="text-[12px] text-[#697386]">{c.notes ? tl('submittedAtNotes', { at: fmtDateTime(c.submittedAt), notes: c.notes }) : tl('submittedAt', { at: fmtDateTime(c.submittedAt) })}</p>
                        <ClassBreakdown classes={c.classes} currency={cur} />
                        <div className="flex flex-wrap items-center gap-2">
                            <Btn variant="primary" size="sm" onClick={() => decide(c, 'ACCEPT')} busy={busy === `ACCEPT-${c.id}`}>{tl('accept')}</Btn>
                            {rejecting?.id === c.id ? (
                                <>
                                    <TextInput value={rejecting.reason} onChange={(v) => setRejecting({ id: c.id, reason: v })} placeholder={tl('rejectPlaceholder')} maxLength={500} className="w-72" />
                                    <Btn variant="danger" size="sm" onClick={() => decide(c, 'REJECT', rejecting.reason.trim())} busy={busy === `REJECT-${c.id}`} disabled={!rejecting.reason.trim()}>{tl('reject')}</Btn>
                                </>
                            ) : (
                                <Btn variant="ghost" size="sm" onClick={() => setRejecting({ id: c.id, reason: '' })}>{tl('rejectEllipsis')}</Btn>
                            )}
                        </div>
                    </div>
                ))}

                {d.current && (
                    <div>
                        <p className="text-[13px] font-bold text-[#1A1F36] mb-2">{tl('currentTitle', { sequence: d.current.sequence, date: d.current.asOfDate })}</p>
                        <ClassBreakdown classes={d.current.classes} currency={cur} />
                    </div>
                )}

                <Disclosure summary={tl('history', { count: d.certificates.length })}>
                    {d.certificates.length === 0 ? <Empty>{tl('noCertificates')}</Empty> : (
                        <Table>
                            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>#</th><th className={th}>{tl('historyColumns.asOf')}</th><th className={thR}>{tl('historyColumns.gross')}</th><th className={thR}>{tl('historyColumns.eligible')}</th><th className={thR}>{tl('historyColumns.base')}</th><th className={th}>{tl('historyColumns.status')}</th><th className={th}>{tl('historyColumns.decided')}</th></tr></thead>
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
