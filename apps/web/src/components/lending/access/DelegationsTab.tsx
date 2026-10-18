"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Btn, Card, Empty, ErrorBox, Field, Notice, SelectInput, Table, TextInput, th, td } from '../ui';
import { StatusBadge } from '../StatusBadge';
import { Money } from '../MoneyCell';
import { clean, useAction } from '../useAsync';
import { fmtDateTime, localToIso } from '../format';
import type { Delegation } from '../types';
import { Chip, MONEY_RE, PermissionPicker, useMyId, useUserName, userOptions, type TabProps } from './common';

type DelegationRow = Delegation & { createdBy?: string };

export function DelegationsTab({ data, reload }: TabProps) {
    const { showToast } = useToast();
    const confirm = useConfirm();
    const { busy, error, run, clearError } = useAction();
    const userName = useUserName(data.users);
    const me = useMyId();
    const rows = data.delegations as DelegationRow[];
    const pending = rows.filter((d) => d.status === 'PENDING');

    const decide = async (d: DelegationRow, approve: boolean) => {
        const r = await run(`decide-${d.id}`, () => api.post(`/lending/access/delegations/${d.id}/decision`, { approve }));
        if (r) { showToast(approve ? 'Delegation approved' : 'Delegation rejected', 'success'); reload(); }
    };
    const revoke = async (d: DelegationRow) => {
        const ok = await confirm({ title: 'Revoke delegation', message: `Revoke the delegation to ${userName(d.toUserId)}? The delegated permissions stop immediately.`, confirmLabel: 'Revoke', variant: 'danger' });
        if (!ok) return;
        const r = await run(`revoke-${d.id}`, () => api.post(`/lending/access/delegations/${d.id}/revoke`, {}));
        if (r) { showToast('Delegation revoked', 'success'); reload(); }
    };

    return (
        <div className="space-y-5">
            {pending.length > 0 && (
                <Notice tone="warn" title={`${pending.length} delegation(s) awaiting approval`}>
                    Delegations need approval from an admin other than the one who requested them.
                </Notice>
            )}
            <Card title="Delegations" subtitle="Temporary grants of permissions from one user to another (max 30 days)." bodyClass="p-0">
                <div className="p-4 pb-0"><ErrorBox error={error} onDismiss={clearError} /></div>
                {rows.length === 0 ? <Empty>No delegations.</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE]">
                                <th className={th}>From</th><th className={th}>To</th><th className={th}>Permissions</th><th className={th}>Window</th>
                                <th className={th}>Limit</th><th className={th}>Status</th><th className={th}>Reason</th><th className={th}></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {rows.map((d) => {
                                const maker = d.createdBy ?? d.requestedBy ?? d.fromUserId;
                                const own = !!me && maker === me;
                                return (
                                    <tr key={d.id} className={d.status === 'PENDING' ? 'bg-amber-50/60' : ''}>
                                        <td className={td}>{userName(d.fromUserId)}</td>
                                        <td className={td}>{userName(d.toUserId)}</td>
                                        <td className={td}><div className="flex flex-wrap gap-1 max-w-[260px]">{d.permissions.map((p) => <Chip key={p}>{p}</Chip>)}</div></td>
                                        <td className={`${td} text-[12px] whitespace-nowrap`}>{fmtDateTime(d.validFrom)}<br />→ {fmtDateTime(d.validTo)}</td>
                                        <td className={td}>{d.maxAmount ? <Money value={d.maxAmount} currency={d.currency ?? undefined} /> : '—'}</td>
                                        <td className={td}><StatusBadge status={d.status} /></td>
                                        <td className={`${td} text-[12px]`}>{d.reason ?? '—'}</td>
                                        <td className={`${td} whitespace-nowrap`}>
                                            <div className="flex gap-1.5 justify-end">
                                                {d.status === 'PENDING' && (
                                                    <>
                                                        <Btn size="sm" variant="primary" busy={busy === `decide-${d.id}`} disabled={own || !!busy} reason={own ? 'You requested this — a second admin must approve' : undefined} onClick={() => decide(d, true)}>Approve</Btn>
                                                        <Btn size="sm" variant="danger" disabled={own || !!busy} reason={own ? 'You requested this — a second admin must decide' : undefined} onClick={() => decide(d, false)}>Reject</Btn>
                                                    </>
                                                )}
                                                {(d.status === 'ACTIVE' || d.status === 'PENDING') && (
                                                    <Btn size="sm" busy={busy === `revoke-${d.id}`} disabled={!!busy} onClick={() => revoke(d)}>Revoke</Btn>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Table>
                )}
            </Card>
            <DelegationForm data={data} reload={reload} />
        </div>
    );
}

function DelegationForm({ data, reload }: TabProps) {
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const [toUserId, setToUserId] = useState('');
    const [perms, setPerms] = useState<string[]>([]);
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [maxAmount, setMaxAmount] = useState('');
    const [currency, setCurrency] = useState('');
    const [reason, setReason] = useState('');

    // The lender's limit from the API (lending settings); the API enforces it too.
    const maxDays = data.limits?.maxDelegationDays;
    const fromIso = localToIso(from);
    const toIso = localToIso(to);
    let windowErr: string | undefined;
    if (fromIso && toIso) {
        const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
        if (ms <= 0) windowErr = 'Valid to must be after valid from';
        else if (maxDays && ms > maxDays * 86_400_000) windowErr = `Delegations may last at most ${maxDays} days`;
    }
    const amountErr = maxAmount && !MONEY_RE.test(maxAmount.trim()) ? 'Decimal with up to 4 places, e.g. 5000.00' : undefined;
    const ccyErr = currency && !/^[A-Z]{3}$/.test(currency) ? '3-letter code' : maxAmount && !currency ? 'Currency recommended with a max amount' : undefined;
    const reasonErr = reason && reason.trim().length < 3 ? 'At least 3 characters' : undefined;
    const valid = toUserId && perms.length > 0 && fromIso && toIso && !windowErr && !amountErr && !(currency && !/^[A-Z]{3}$/.test(currency)) && reason.trim().length >= 3;

    const submit = async () => {
        const body = clean({ toUserId, permissions: perms, validFrom: fromIso, validTo: toIso, maxAmount: maxAmount.trim(), currency, reason: reason.trim() });
        const r = await run('create', () => api.post('/lending/access/delegations', body));
        if (r) {
            showToast('Delegation requested', 'success');
            setToUserId(''); setPerms([]); setFrom(''); setTo(''); setMaxAmount(''); setCurrency(''); setReason('');
            reload();
        }
    };

    return (
        <Card title="Request delegation" subtitle="Delegate some of your permissions to another user for up to 30 days.">
            <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Field label="Delegate to"><SelectInput value={toUserId} onChange={setToUserId} options={userOptions(data.users)} placeholder="Select user…" /></Field>
                    <Field label="Valid from"><TextInput type="datetime-local" value={from} onChange={setFrom} /></Field>
                    <Field label="Valid to" error={windowErr}><TextInput type="datetime-local" value={to} onChange={setTo} /></Field>
                    <Field label="Max amount (optional)" error={amountErr}><TextInput value={maxAmount} onChange={setMaxAmount} inputMode="decimal" placeholder="e.g. 10000.00" /></Field>
                    <Field label="Currency (optional)" error={ccyErr}><TextInput value={currency} onChange={(v) => setCurrency(v.toUpperCase())} maxLength={3} placeholder="USD" /></Field>
                    <Field label="Reason" error={reasonErr}><TextInput value={reason} onChange={setReason} maxLength={300} /></Field>
                </div>
                <Field label="Permissions (max 20)">
                    <PermissionPicker permissions={data.permissions} value={perms} onChange={setPerms} max={20} />
                </Field>
                <ErrorBox error={error} onDismiss={clearError} />
                <div className="flex justify-end">
                    <Btn variant="primary" busy={busy === 'create'} disabled={!valid} reason={!valid ? 'Fill user, window, permissions and reason' : undefined} onClick={submit}>Request delegation</Btn>
                </div>
            </div>
        </Card>
    );
}
