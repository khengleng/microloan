"use client";

import { useState } from 'react';
import Link from 'next/link';
import { ShieldAlert, ShieldCheck, Search, Flag, FileWarning } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useWorkspace } from '@/lib/workspace';
import { useLendingHref } from '../LendingShell';
import { ActionPanel, Btn, Card, Checkbox, ErrorBox, Field, KV, Notice, TextArea, TextInput } from '../ui';
import { clean, useAction, useApi } from '../useAsync';
import { StatusBadge } from '../StatusBadge';
import { fmtDateTime } from '../format';
import { useAmlText, usePeople } from './i18n';
import { STR_INDICATORS, type AmlSummary } from './types';

type Panel = 'clear' | 'flag' | 'edd' | 'str' | null;

/**
 * A customer's AML/CFT standing on their profile: status, risk rating, the
 * lending gate, open screening case, clearance awaiting approval and
 * enhanced due diligence, with the actions the signed-in user may take.
 * Hidden for users who may not see AML data (the API refuses them).
 */
export function AmlCustomerPanel({ borrowerId, onChange }: { borrowerId: string; onChange?: () => void }) {
    const { t, factor } = useAmlText();
    const { showToast } = useToast();
    const ws = useWorkspace();
    const href = useLendingHref();
    const me = ws.access?.principal.id ?? null;
    const data = useApi<AmlSummary>(`/lending/aml/customers/${borrowerId}`);
    const s = data.data;
    const person = usePeople([s?.amlStatusChangedBy, s?.pendingClearance?.proposedBy, ...(s?.edd ?? []).flatMap((e) => [e.makerId, e.checkerId])]);
    const [panel, setPanel] = useState<Panel>(null);
    const [reason, setReason] = useState('');
    const [edd, setEdd] = useState({ sourceOfFunds: '', sourceOfWealth: '', documentReference: '' });
    const [str, setStr] = useState<{ grounds: string; indicators: string[] }>({ grounds: '', indicators: [] });
    const [raised, setRaised] = useState<string | null>(null);
    const { busy, error, run, clearError } = useAction();

    if (data.error && (data.error.status === 403 || data.error.status === 404)) return null;
    if (!s) return data.error ? <ErrorBox error={data.error} /> : null;

    const done = (msg: string) => { setPanel(null); setReason(''); showToast(msg, 'success'); data.reload(); onChange?.(); };
    const post = async (name: string, url: string, body: unknown, msg: string) => {
        const res = await run(name, () => api.post(url, body));
        if (res) done(msg);
        return res;
    };
    const pendingEdd = s.edd.find((e) => e.status === 'PENDING');
    const approvedEdd = s.edd.find((e) => e.status === 'APPROVED');

    return (
        <Card
            title={<span className="flex items-center gap-2">{s.gate.clear ? <ShieldCheck size={16} className="text-emerald-600" /> : <ShieldAlert size={16} className="text-red-600" />}{t('panel.title')}</span>}
            subtitle={t('panel.subtitle')}
            actions={
                <div className="flex flex-wrap gap-2">
                    <StatusBadge status={s.amlStatus} />
                    {s.amlRiskRating && <span className="text-[11px] font-semibold text-[#697386]">{t('panel.risk')} <StatusBadge status={s.amlRiskRating} /></span>}
                    {s.pep && <StatusBadge status="PEP" />}
                </div>
            }
        >
            <div className="space-y-4">
                {s.gate.clear ? (
                    <Notice tone="success">{t('panel.gateClear')}</Notice>
                ) : (
                    <Notice tone="danger" title={t('panel.gateBlocked')}>
                        <ul className="list-disc pl-4">{s.gate.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                    </Notice>
                )}
                <KV
                    cols={4}
                    items={[
                        [t('panel.kyc'), <StatusBadge key="k" status={s.kycStatus} />],
                        [t('panel.lastScreened'), s.amlScreenedAt ? fmtDateTime(s.amlScreenedAt) : t('panel.never')],
                        [t('panel.statusChanged'), s.amlStatusChangedAt ? `${fmtDateTime(s.amlStatusChangedAt)} · ${person(s.amlStatusChangedBy)}` : '—'],
                        [t('panel.nextReview'), s.amlNextReviewOn ? <span key="r" className={s.reviewDue ? 'text-red-600 font-semibold' : ''}>{s.amlNextReviewOn}{s.reviewDue ? ` · ${t('panel.reviewDue')}` : ''}</span> : '—'],
                        [t('panel.score'), s.amlRiskScore ?? '—'],
                        [t('panel.nationality'), s.nationality ?? '—'],
                        [t('panel.edd'), approvedEdd ? <StatusBadge key="e" status="APPROVED" /> : pendingEdd ? <StatusBadge key="e" status="PENDING" /> : s.eddRequired ? <StatusBadge key="e" status="MISSING" /> : t('panel.notRequired')],
                    ]}
                />
                {s.amlRiskFactors && s.amlRiskFactors.some((f) => f.present) && (
                    <div>
                        <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">{t('panel.factors')}</p>
                        <ul className="mt-1 text-[12px] text-[#3C4257] list-disc pl-4">
                            {s.amlRiskFactors.filter((f) => f.present).map((f) => <li key={f.code}>{factor(f.code)} (+{f.weight}) — {f.detail}</li>)}
                        </ul>
                    </div>
                )}
                {s.openCase && (
                    <Notice tone="warn" title={t('panel.openCase', { reference: s.openCase.reference })}>
                        <Link className="font-semibold text-[#635BFF] hover:underline" href={href(`/lending/aml?tab=cases&case=${s.openCase.id}`)}>{t('panel.reviewCase')}</Link>
                    </Notice>
                )}
                {s.pendingClearance && (
                    <Notice tone="info" title={t('panel.clearancePending', { who: person(s.pendingClearance.proposedBy) })}>
                        {s.pendingClearance.reason && <p>{s.pendingClearance.reason}</p>}
                        {s.you.mayApproveClearance && s.pendingClearance.proposedBy !== me && (
                            <div className="flex gap-2 mt-2">
                                <Btn size="sm" variant="primary" busy={busy === 'approve'} onClick={() => post('approve', `/lending/aml/customers/${borrowerId}/clearance/decision`, { approve: true }, t('toast.cleared'))}>{t('panel.approveClearance')}</Btn>
                                <Btn size="sm" variant="danger" busy={busy === 'refuse'} disabled={reason.trim().length < 3} onClick={() => post('refuse', `/lending/aml/customers/${borrowerId}/clearance/decision`, { approve: false, comment: reason.trim() }, t('toast.refused'))}>{t('panel.refuseClearance')}</Btn>
                                <TextInput value={reason} onChange={setReason} placeholder={t('panel.refuseReason')} />
                            </div>
                        )}
                    </Notice>
                )}
                {pendingEdd && (
                    <Notice tone="info" title={t('panel.eddPending', { who: person(pendingEdd.makerId) })}>
                        <p><b>{t('edd.sourceOfFunds')}:</b> {pendingEdd.sourceOfFunds}</p>
                        <p><b>{t('edd.sourceOfWealth')}:</b> {pendingEdd.sourceOfWealth}</p>
                        <p><b>{t('edd.documentReference')}:</b> {pendingEdd.documentReference}</p>
                        {s.you.mayApproveEdd && pendingEdd.makerId !== me && (
                            <div className="flex gap-2 mt-2">
                                <Btn size="sm" variant="primary" busy={busy === 'eddOk'} onClick={() => post('eddOk', `/lending/aml/edd/${pendingEdd.id}/decision`, { approve: true }, t('toast.eddApproved'))}>{t('panel.approveEdd')}</Btn>
                                <Btn size="sm" variant="danger" busy={busy === 'eddNo'} disabled={reason.trim().length < 3} onClick={() => post('eddNo', `/lending/aml/edd/${pendingEdd.id}/decision`, { approve: false, comment: reason.trim() }, t('toast.refused'))}>{t('panel.rejectEdd')}</Btn>
                                <TextInput value={reason} onChange={setReason} placeholder={t('panel.refuseReason')} />
                            </div>
                        )}
                    </Notice>
                )}
                {raised && <Notice tone="success">{t('str.raised', { reference: raised })}</Notice>}

                <div className="flex flex-wrap gap-2">
                    {s.you.mayScreen && (
                        <>
                            <Btn size="sm" busy={busy === 'screen'} onClick={async () => {
                                const r = await run('screen', () => api.post<{ hits: number }>(`/lending/aml/customers/${borrowerId}/screen`));
                                if (r) done(r.data.hits ? t('toast.hits', { count: r.data.hits }) : t('toast.noHits'));
                            }}><Search size={13} /> {t('panel.screenNow')}</Btn>
                            <Btn size="sm" busy={busy === 'rate'} onClick={() => post('rate', `/lending/aml/customers/${borrowerId}/risk-rating`, {}, t('toast.rated'))}>{t('panel.rerate')}</Btn>
                            {s.amlStatus !== 'CLEAR' && !s.pendingClearance && <Btn size="sm" variant="primary" onClick={() => { clearError(); setPanel('clear'); }}><ShieldCheck size={13} /> {t('panel.proposeClear')}</Btn>}
                            {s.amlStatus !== 'FLAGGED' && <Btn size="sm" variant="danger" onClick={() => { clearError(); setPanel('flag'); }}><Flag size={13} /> {t('panel.flag')}</Btn>}
                            {!pendingEdd && <Btn size="sm" onClick={() => { clearError(); setPanel('edd'); }}>{t('panel.recordEdd')}</Btn>}
                        </>
                    )}
                    {s.you.mayRaiseStr && <Btn size="sm" variant="ghost" onClick={() => { clearError(); setPanel('str'); }}><FileWarning size={13} /> {t('panel.raiseStr')}</Btn>}
                </div>

                {(panel === 'clear' || panel === 'flag') && (
                    <ActionPanel title={panel === 'clear' ? t('panel.proposeClear') : t('panel.flag')} onClose={() => setPanel(null)}>
                        <p className="text-[12px] text-[#697386]">{panel === 'clear' ? t('panel.clearHint') : t('panel.flagHint')}</p>
                        <Field label={t('panel.reason')}><TextArea value={reason} onChange={setReason} /></Field>
                        <ErrorBox error={error} />
                        <Btn variant={panel === 'clear' ? 'primary' : 'danger'} busy={busy === panel} disabled={reason.trim().length < 5}
                            onClick={() => post(panel, `/lending/aml/customers/${borrowerId}/status`, { status: panel === 'clear' ? 'CLEAR' : 'FLAGGED', reason: reason.trim() }, panel === 'clear' ? t('toast.clearProposed') : t('toast.flagged'))}>
                            {panel === 'clear' ? t('panel.proposeClear') : t('panel.flag')}
                        </Btn>
                    </ActionPanel>
                )}
                {panel === 'edd' && (
                    <ActionPanel title={t('panel.recordEdd')} onClose={() => setPanel(null)}>
                        <Field label={t('edd.sourceOfFunds')}><TextArea value={edd.sourceOfFunds} onChange={(v) => setEdd((e) => ({ ...e, sourceOfFunds: v }))} /></Field>
                        <Field label={t('edd.sourceOfWealth')}><TextArea value={edd.sourceOfWealth} onChange={(v) => setEdd((e) => ({ ...e, sourceOfWealth: v }))} /></Field>
                        <Field label={t('edd.documentReference')} hint={t('edd.documentHint')}><TextInput value={edd.documentReference} onChange={(v) => setEdd((e) => ({ ...e, documentReference: v }))} /></Field>
                        <ErrorBox error={error} />
                        <Btn variant="primary" busy={busy === 'edd'} disabled={edd.sourceOfFunds.trim().length < 5 || edd.sourceOfWealth.trim().length < 5 || edd.documentReference.trim().length < 2}
                            onClick={async () => { if (await post('edd', `/lending/aml/customers/${borrowerId}/edd`, clean(edd), t('toast.eddRecorded'))) setEdd({ sourceOfFunds: '', sourceOfWealth: '', documentReference: '' }); }}>
                            {t('panel.recordEdd')}
                        </Btn>
                    </ActionPanel>
                )}
                {panel === 'str' && (
                    <ActionPanel title={t('panel.raiseStr')} onClose={() => setPanel(null)}>
                        <Notice tone="warn">{t('str.tippingOff')}</Notice>
                        <Field label={t('str.grounds')} hint={t('str.groundsHint')}><TextArea rows={4} value={str.grounds} onChange={(v) => setStr((x) => ({ ...x, grounds: v }))} /></Field>
                        <div className="flex flex-wrap gap-3">
                            {STR_INDICATORS.map((i) => (
                                <Checkbox key={i} label={t(`indicators.${i}`)} checked={str.indicators.includes(i)}
                                    onChange={(on) => setStr((x) => ({ ...x, indicators: on ? [...x.indicators, i] : x.indicators.filter((y) => y !== i) }))} />
                            ))}
                        </div>
                        <ErrorBox error={error} />
                        <Btn variant="primary" busy={busy === 'str'} disabled={str.grounds.trim().length < 10} onClick={async () => {
                            const r = await run('str', () => api.post<{ reference: string }>('/lending/aml/str', { borrowerId, grounds: str.grounds.trim(), indicators: str.indicators }));
                            if (r) { setRaised(r.data.reference); setStr({ grounds: '', indicators: [] }); setPanel(null); }
                        }}>{t('panel.raiseStr')}</Btn>
                    </ActionPanel>
                )}
                {s.edd.length > 0 && (
                    <div>
                        <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">{t('panel.eddHistory')}</p>
                        <ul className="text-[12px] text-[#3C4257] mt-1 space-y-0.5">
                            {s.edd.map((e) => <li key={e.id}><StatusBadge status={e.status} /> {fmtDateTime(e.createdAt)} · {person(e.makerId)}{e.checkerId ? ` → ${person(e.checkerId)}` : ''}{e.comment ? ` — ${e.comment}` : ''}</li>)}
                        </ul>
                    </div>
                )}
            </div>
        </Card>
    );
}
