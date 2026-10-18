"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { ActionPanel, Btn, Card, Empty, ErrorBox, Field, Table, TextArea, td, th } from '../ui';
import { Person } from '../People';
import { useAction } from '../useAsync';
import { fmtDateTime } from '../format';
import { StatusBadge } from '../StatusBadge';
import type { FacilityCondition, FacilityTranche } from './types';

type Pending = { kind: 'satisfy' | 'waive'; condition: FacilityCondition };

const who = (id: string | null | undefined) => (id ? <Person id={id} className="text-[12px]" /> : null);

/**
 * Conditions precedent gating staged tranches. Satisfying one is backed by
 * evidence; waiving one is a credit concession and needs its own permission.
 */
export function ConditionsCard({ facilityId, conditions, tranches, releasedTranches, onDone }: {
    facilityId: string; conditions: FacilityCondition[]; tranches: FacilityTranche[]; releasedTranches: string[]; onDone: (msg: string) => void;
}) {
    const t = useTranslations('LendingFacilities.conditions');
    const { busy, error, run, clearError } = useAction();
    const [pending, setPending] = useState<Pending | null>(null);
    const [text, setText] = useState('');
    const [problem, setProblem] = useState('');

    const open = (p: Pending) => { setPending(p); setText(''); setProblem(''); clearError(); };
    const close = () => { setPending(null); setText(''); setProblem(''); };

    const submit = async () => {
        if (!pending) return;
        const c = pending.condition;
        const value = text.trim();
        if (!value) { setProblem(pending.kind === 'satisfy' ? t('problems.evidence') : t('problems.reason')); return; }
        setProblem('');
        const body = pending.kind === 'satisfy' ? { evidence: value } : { reason: value };
        const res = await run(`${pending.kind}-${c.id}`, () => api.post(`/lending/facilities/${facilityId}/conditions/${c.id}/${pending.kind}`, body));
        if (res) {
            close();
            onDone(pending.kind === 'satisfy' ? t('toast.satisfied', { code: c.code }) : t('toast.waived', { code: c.code }));
        }
    };

    const trancheCodes = Array.from(new Set([...tranches.map((t) => t.code), ...conditions.map((c) => c.trancheCode)]));

    return (
        <Card title={t('title')} subtitle={t('subtitle')} bodyClass="p-0">
            {pending && (
                <div className="p-4 border-b border-[#E3E8EE]">
                    <ActionPanel title={t(pending.kind === 'satisfy' ? 'panel.satisfyTitle' : 'panel.waiveTitle', { code: pending.condition.code, label: pending.condition.label })} onClose={close}>
                        {pending.kind === 'waive' && (
                            <p className="text-[12px] text-amber-800">{t('panel.waiveNotice')}</p>
                        )}
                        <Field label={pending.kind === 'satisfy' ? t('fields.evidence') : t('fields.waiverReason')} hint={pending.kind === 'satisfy' ? t('fields.evidenceHint') : undefined} error={problem || undefined}>
                            <TextArea value={text} onChange={setText} maxLength={500} rows={2} />
                        </Field>
                        <ErrorBox error={error} onDismiss={clearError} />
                        <Btn variant={pending.kind === 'satisfy' ? 'primary' : 'danger'} onClick={submit} busy={busy === `${pending.kind}-${pending.condition.id}`}>
                            {pending.kind === 'satisfy' ? t('actions.markSatisfied') : t('actions.waiveCondition')}
                        </Btn>
                    </ActionPanel>
                </div>
            )}
            {conditions.length === 0 ? <Empty>{t('empty')}</Empty> : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>{t('columns.tranche')}</th>
                            <th className={th}>{t('columns.condition')}</th>
                            <th className={th}>{t('columns.status')}</th>
                            <th className={th}>{t('columns.evidence')}</th>
                            <th className={th}>{t('columns.by')}</th>
                            <th className={th}></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {trancheCodes.flatMap((code) => conditions.filter((c) => c.trancheCode === code).map((c) => (
                            <tr key={c.id}>
                                <td className={`${td} whitespace-nowrap`}>
                                    <span className="font-mono text-[12px]">{c.trancheCode}</span>
                                    {releasedTranches.includes(c.trancheCode) && <span className="ml-1.5 text-[10px] font-bold uppercase text-emerald-700">{t('released')}</span>}
                                </td>
                                <td className={td}>
                                    <div className="font-semibold text-[#1A1F36]">{c.label}</div>
                                    <div className="font-mono text-[11px] text-[#8792A2]">{c.code}</div>
                                </td>
                                <td className={td}><StatusBadge status={c.status} /></td>
                                <td className={`${td} max-w-[280px]`}>{c.evidence ?? c.waiverReason ?? '—'}</td>
                                <td className={`${td} whitespace-nowrap text-[12px]`}>
                                    {c.satisfiedBy && <div>{who(c.satisfiedBy)} <span className="text-[11px] text-[#697386]">{fmtDateTime(c.satisfiedAt)}</span></div>}
                                    {c.waivedBy && <div>{who(c.waivedBy)} <span className="text-[11px] text-[#697386]">{fmtDateTime(c.waivedAt)}</span></div>}
                                    {!c.satisfiedBy && !c.waivedBy && '—'}
                                </td>
                                <td className={`${td} whitespace-nowrap`}>
                                    {c.status === 'PENDING' && (
                                        <div className="flex justify-end gap-1.5">
                                            <Btn size="sm" variant="primary" onClick={() => open({ kind: 'satisfy', condition: c })}>{t('actions.satisfy')}</Btn>
                                            <Btn size="sm" variant="danger" onClick={() => open({ kind: 'waive', condition: c })}>{t('actions.waive')}</Btn>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        )))}
                    </tbody>
                </Table>
            )}
        </Card>
    );
}
