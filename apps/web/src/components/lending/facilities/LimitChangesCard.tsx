"use client";

import { type ReactNode, useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import { Person } from '../People';
import { useMyId } from '../access/common';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ActionPanel, Btn, Card, Empty, ErrorBox, Field, SelectInput, Table, TextArea, TextInput, td, tdR, th, thR } from '../ui';
import { clean, useAction } from '../useAsync';
import { compareDecimal, fmtDateTime } from '../format';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { LIMIT_CHANGE_TYPES, MONEY_RE, type FacilityLimitChange } from './types';

const who = (id: string | null | undefined) => (id ? <Person id={id} className="text-[12px]" /> : null);

/** Request form for a change to the committed limit (maker side). */
export function LimitChangePanel({ facilityId, currency, currentLimit, onDone, onClose }: {
    facilityId: string; currency: string; currentLimit: string; onDone: (msg: string) => void; onClose: () => void;
}) {
    const [newLimit, setNewLimit] = useState('');
    const [changeType, setChangeType] = useState('');
    const [reason, setReason] = useState('');
    const [effectiveDate, setEffectiveDate] = useState('');
    const [renewalMonths, setRenewalMonths] = useState('12');
    const [problem, setProblem] = useState<{ newLimit?: string; changeType?: string; reason?: string; renewalMonths?: string }>({});
    const t = useTranslations('Servicing.facility');
    const tl = useTranslations('LendingFacilities.limitChanges');
    const renewal = changeType === 'RENEWAL';
    const typeOptions = LIMIT_CHANGE_TYPES.map((v) => ({ value: v, label: t(`changeType.${v}`) }));
    const { busy, error, run, clearError } = useAction();

    // Suggest the change type from the direction of the new limit.
    const onLimit = (v: string) => {
        setNewLimit(v);
        const t = v.trim();
        if (!changeType && MONEY_RE.test(t)) {
            const cmp = compareDecimal(t, currentLimit);
            if (cmp > 0) setChangeType('INCREASE');
            else if (cmp < 0) setChangeType('DECREASE');
        }
    };

    const submit = async () => {
        const p: typeof problem = {};
        const l = newLimit.trim();
        if (!MONEY_RE.test(l) || !/[1-9]/.test(l)) p.newLimit = tl('problems.newLimit');
        if (!changeType) p.changeType = tl('problems.changeType');
        if (!reason.trim()) p.reason = tl('problems.reason');
        const months = Number(renewalMonths);
        if (renewal && !(Number.isInteger(months) && months >= 1 && months <= 120)) p.renewalMonths = t('renewalMonthsInvalid');
        setProblem(p);
        if (Object.keys(p).length) return;
        const body = clean({ newLimit: l, changeType, reason: reason.trim(), effectiveDate, ...(renewal ? { renewalMonths: months } : {}) });
        const res = await run('limit', () => api.post(`/lending/facilities/${facilityId}/limit-changes`, body));
        if (res) onDone(tl('toast.requested'));
    };

    return (
        <ActionPanel title={tl('panel.title')} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Field label={tl('fields.newLimit', { currency })} hint={tl('fields.newLimitHint', { currency, amount: currentLimit })} error={problem.newLimit}>
                    <TextInput value={newLimit} onChange={onLimit} inputMode="decimal" />
                </Field>
                <Field label={tl('fields.changeType')} error={problem.changeType}>
                    <SelectInput value={changeType} onChange={(v) => { setChangeType(v); if (v === 'RENEWAL' && !newLimit.trim()) setNewLimit(currentLimit); }} options={typeOptions} placeholder={tl('fields.select')} />
                </Field>
                {renewal && (
                    <Field label={t('renewalMonths')} hint={t('renewalMonthsHint')} error={problem.renewalMonths}>
                        <TextInput value={renewalMonths} onChange={setRenewalMonths} inputMode="numeric" />
                    </Field>
                )}
                <Field label={tl('fields.effectiveDate')} hint={tl('fields.effectiveDateHint')}>
                    <TextInput type="date" value={effectiveDate} onChange={setEffectiveDate} />
                </Field>
            </div>
            <Field label={tl('fields.reason')} error={problem.reason}>
                <TextArea value={reason} onChange={setReason} maxLength={500} rows={2} />
            </Field>
            <p className="text-[11px] text-[#697386]">{tl('panel.note')}</p>
            <p className="text-[11px] text-[#697386]">{t('limitChangeScope')}</p>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={submit} busy={busy === 'limit'}>{tl('actions.requestChange')}</Btn>
        </ActionPanel>
    );
}

/** History of limit changes, with the checker's approve / reject on the open one. */
export function LimitChangesCard({ facilityId, currency, changes, actions, onDone }: {
    facilityId: string; currency: string; changes: FacilityLimitChange[]; actions?: ReactNode; onDone: (msg: string) => void;
}) {
    const confirm = useConfirm();
    const { busy, error, run, clearError } = useAction();
    const t = useTranslations('Servicing.facility');
    const tl = useTranslations('LendingFacilities.limitChanges');
    const canDecide = useWorkspace().can('facility.limit.approve');
    const me = useMyId();
    const typeLabel = (v: string) => (t.has(`changeType.${v}`) ? t(`changeType.${v}`) : v.replace(/_/g, ' ').toLowerCase());

    const decide = async (c: FacilityLimitChange, outcome: 'APPROVE' | 'REJECT') => {
        const approve = outcome === 'APPROVE';
        const ok = await confirm({
            title: approve ? tl('confirm.approveTitle') : tl('confirm.rejectTitle'),
            message: tl(approve ? 'confirm.approveMessage' : 'confirm.rejectMessage', { type: typeLabel(c.changeType), currency, from: c.previousLimit, to: c.newLimit }),
            confirmLabel: approve ? tl('actions.approve') : tl('actions.reject'),
            variant: approve ? 'default' : 'danger',
        });
        if (!ok) return;
        const res = await run(`${outcome}-${c.id}`, () => api.post(`/lending/facilities/${facilityId}/limit-changes/${c.id}/decide`, { outcome }));
        if (res) onDone(approve ? tl('toast.changed', { currency, amount: c.newLimit }) : tl('toast.rejected'));
    };

    return (
        <Card title={tl('title')} subtitle={tl('subtitle')} actions={actions} bodyClass="p-0">
            {error && <div className="p-4 border-b border-[#E3E8EE]"><ErrorBox error={error} onDismiss={clearError} /></div>}
            {changes.length === 0 ? <Empty>{tl('empty')}</Empty> : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>{tl('columns.type')}</th>
                            <th className={th}>{tl('columns.status')}</th>
                            <th className={thR}>{tl('columns.from')}</th>
                            <th className={thR}>{tl('columns.to')}</th>
                            <th className={th}>{tl('columns.effective')}</th>
                            <th className={th}>{tl('columns.reason')}</th>
                            <th className={th}>{tl('columns.requested')}</th>
                            <th className={th}>{tl('columns.decided')}</th>
                            <th className={th}></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {changes.map((c) => (
                            <tr key={c.id} className={c.status === 'REQUESTED' ? 'bg-[#F8F9FF]' : ''}>
                                <td className={td}>{typeLabel(c.changeType)}{c.renewalMonths ? <div className="text-[11px] text-[#697386]">{t('renewalBy', { months: c.renewalMonths })}</div> : null}</td>
                                <td className={td}><StatusBadge status={c.status} /></td>
                                <td className={tdR}><MoneyCell value={c.previousLimit} /></td>
                                <td className={tdR}><MoneyCell value={c.newLimit} strong /></td>
                                <td className={`${td} whitespace-nowrap`}>{c.effectiveDate ?? '—'}</td>
                                <td className={`${td} max-w-[260px]`}>{c.reason}</td>
                                <td className={`${td} whitespace-nowrap`}>
                                    {who(c.requestedBy)}
                                    <div className="text-[11px] text-[#697386]">{fmtDateTime(c.createdAt)}</div>
                                </td>
                                <td className={`${td} whitespace-nowrap text-[12px]`}>
                                    {c.approvedBy && <div>{who(c.approvedBy)} <span className="text-[11px] text-[#697386]">{fmtDateTime(c.approvedAt)}</span></div>}
                                    {c.rejectedBy && <div>{who(c.rejectedBy)} <span className="text-[11px] text-[#697386]">{fmtDateTime(c.rejectedAt)}</span></div>}
                                    {!c.approvedBy && !c.rejectedBy && '—'}
                                </td>
                                <td className={`${td} whitespace-nowrap`}>
                                    {c.status === 'REQUESTED' && canDecide && c.requestedBy !== me && (
                                        <div className="flex justify-end gap-1.5">
                                            <Btn size="sm" variant="primary" onClick={() => decide(c, 'APPROVE')} busy={busy === `APPROVE-${c.id}`}>{tl('actions.approve')}</Btn>
                                            <Btn size="sm" variant="danger" onClick={() => decide(c, 'REJECT')} busy={busy === `REJECT-${c.id}`}>{tl('actions.reject')}</Btn>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
        </Card>
    );
}
