"use client";

import { type ReactNode, useState } from 'react';
import api from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ActionPanel, Btn, Card, Empty, ErrorBox, Field, SelectInput, Table, TextArea, TextInput, td, tdR, th, thR } from '../ui';
import { clean, useAction } from '../useAsync';
import { compareDecimal, fmtDateTime } from '../format';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { LIMIT_CHANGE_TYPES, MONEY_RE, type FacilityLimitChange } from './types';

const who = (id: string | null | undefined) => (id ? <span className="font-mono text-[11px]" title={id}>{id.slice(0, 8)}</span> : null);

/** Request form for a change to the committed limit (maker side). */
export function LimitChangePanel({ facilityId, currency, currentLimit, onDone, onClose }: {
    facilityId: string; currency: string; currentLimit: string; onDone: (msg: string) => void; onClose: () => void;
}) {
    const [newLimit, setNewLimit] = useState('');
    const [changeType, setChangeType] = useState('');
    const [reason, setReason] = useState('');
    const [effectiveDate, setEffectiveDate] = useState('');
    const [problem, setProblem] = useState<{ newLimit?: string; changeType?: string; reason?: string }>({});
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
        if (!MONEY_RE.test(l) || !/[1-9]/.test(l)) p.newLimit = 'Enter a positive decimal amount (up to 4 decimals).';
        if (!changeType) p.changeType = 'Choose the kind of change.';
        if (!reason.trim()) p.reason = 'Give a reason for the limit change.';
        setProblem(p);
        if (Object.keys(p).length) return;
        const body = clean({ newLimit: l, changeType, reason: reason.trim(), effectiveDate });
        const res = await run('limit', () => api.post(`/lending/facilities/${facilityId}/limit-changes`, body));
        if (res) onDone('Limit change requested — awaiting approval');
    };

    return (
        <ActionPanel title="Request limit change" onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Field label={`New limit (${currency})`} hint={`Current: ${currency} ${currentLimit}`} error={problem.newLimit}>
                    <TextInput value={newLimit} onChange={onLimit} inputMode="decimal" />
                </Field>
                <Field label="Change type" error={problem.changeType}>
                    <SelectInput value={changeType} onChange={setChangeType} options={LIMIT_CHANGE_TYPES} placeholder="Select…" />
                </Field>
                <Field label="Effective date" hint="Recorded on the change; the new limit applies when approved">
                    <TextInput type="date" value={effectiveDate} onChange={setEffectiveDate} />
                </Field>
            </div>
            <Field label="Reason" error={problem.reason}>
                <TextArea value={reason} onChange={setReason} maxLength={500} rows={2} />
            </Field>
            <p className="text-[11px] text-[#697386]">The limit cannot be cut below what is already drawn. Only one change can await a decision at a time.</p>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={submit} busy={busy === 'limit'}>Request change</Btn>
        </ActionPanel>
    );
}

/** History of limit changes, with the checker's approve / reject on the open one. */
export function LimitChangesCard({ facilityId, currency, changes, actions, onDone }: {
    facilityId: string; currency: string; changes: FacilityLimitChange[]; actions?: ReactNode; onDone: (msg: string) => void;
}) {
    const confirm = useConfirm();
    const { busy, error, run, clearError } = useAction();

    const decide = async (c: FacilityLimitChange, outcome: 'APPROVE' | 'REJECT') => {
        const approve = outcome === 'APPROVE';
        const ok = await confirm({
            title: approve ? 'Approve limit change' : 'Reject limit change',
            message: `${approve ? 'Approve' : 'Reject'} the ${c.changeType.toLowerCase()} from ${currency} ${c.previousLimit} to ${currency} ${c.newLimit}?${approve ? ' The new limit applies immediately.' : ''}`,
            confirmLabel: approve ? 'Approve' : 'Reject',
            variant: approve ? 'default' : 'danger',
        });
        if (!ok) return;
        const res = await run(`${outcome}-${c.id}`, () => api.post(`/lending/facilities/${facilityId}/limit-changes/${c.id}/decide`, { outcome }));
        if (res) onDone(approve ? `Limit changed to ${currency} ${c.newLimit}` : 'Limit change rejected');
    };

    return (
        <Card title="Limit changes" subtitle="Maker-checker: the requester cannot decide their own change. Latest 24." actions={actions} bodyClass="p-0">
            {error && <div className="p-4 border-b border-[#E3E8EE]"><ErrorBox error={error} onDismiss={clearError} /></div>}
            {changes.length === 0 ? <Empty>No limit changes.</Empty> : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>Type</th>
                            <th className={th}>Status</th>
                            <th className={thR}>From</th>
                            <th className={thR}>To</th>
                            <th className={th}>Effective</th>
                            <th className={th}>Reason</th>
                            <th className={th}>Requested</th>
                            <th className={th}>Decided</th>
                            <th className={th}></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {changes.map((c) => (
                            <tr key={c.id} className={c.status === 'REQUESTED' ? 'bg-[#F8F9FF]' : ''}>
                                <td className={td}><span className="font-mono text-[12px]">{c.changeType}</span></td>
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
                                    {c.status === 'REQUESTED' && (
                                        <div className="flex justify-end gap-1.5">
                                            <Btn size="sm" variant="primary" onClick={() => decide(c, 'APPROVE')} busy={busy === `APPROVE-${c.id}`}>Approve</Btn>
                                            <Btn size="sm" variant="danger" onClick={() => decide(c, 'REJECT')} busy={busy === `REJECT-${c.id}`}>Reject</Btn>
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
