"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
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
    const t = useTranslations('LendingAccess.delegations');

    const decide = async (d: DelegationRow, approve: boolean) => {
        const r = await run(`decide-${d.id}`, () => api.post(`/lending/access/delegations/${d.id}/decision`, { approve }));
        if (r) { showToast(approve ? t('approved') : t('rejected'), 'success'); reload(); }
    };
    const revoke = async (d: DelegationRow) => {
        const ok = await confirm({ title: t('revokeTitle'), message: t('revokeConfirm', { user: userName(d.toUserId) }), confirmLabel: t('revoke'), variant: 'danger' });
        if (!ok) return;
        const r = await run(`revoke-${d.id}`, () => api.post(`/lending/access/delegations/${d.id}/revoke`, {}));
        if (r) { showToast(t('revoked'), 'success'); reload(); }
    };

    return (
        <div className="space-y-5">
            {pending.length > 0 && (
                <Notice tone="warn" title={t('pendingTitle', { count: pending.length })}>
                    {t('pendingBody')}
                </Notice>
            )}
            <Card title={t('title')} subtitle={t('subtitle')} bodyClass="p-0">
                <div className="p-4 pb-0"><ErrorBox error={error} onDismiss={clearError} /></div>
                {rows.length === 0 ? <Empty>{t('none')}</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE]">
                                <th className={th}>{t('colFrom')}</th><th className={th}>{t('colTo')}</th><th className={th}>{t('colPermissions')}</th><th className={th}>{t('colWindow')}</th>
                                <th className={th}>{t('colLimit')}</th><th className={th}>{t('colStatus')}</th><th className={th}>{t('colReason')}</th><th className={th}></th>
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
                                                        <Btn size="sm" variant="primary" busy={busy === `decide-${d.id}`} disabled={own || !!busy} reason={own ? t('ownApprove') : undefined} onClick={() => decide(d, true)}>{t('approve')}</Btn>
                                                        <Btn size="sm" variant="danger" disabled={own || !!busy} reason={own ? t('ownDecide') : undefined} onClick={() => decide(d, false)}>{t('reject')}</Btn>
                                                    </>
                                                )}
                                                {(d.status === 'ACTIVE' || d.status === 'PENDING') && (
                                                    <Btn size="sm" busy={busy === `revoke-${d.id}`} disabled={!!busy} onClick={() => revoke(d)}>{t('revoke')}</Btn>
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
    const t = useTranslations('LendingAccess.delegations');

    // The lender's limit from the API (lending settings); the API enforces it too.
    const maxDays = data.limits?.maxDelegationDays;
    const fromIso = localToIso(from);
    const toIso = localToIso(to);
    let windowErr: string | undefined;
    if (fromIso && toIso) {
        const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
        if (ms <= 0) windowErr = t('windowOrder');
        else if (maxDays && ms > maxDays * 86_400_000) windowErr = t('windowMax', { days: maxDays });
    }
    const amountErr = maxAmount && !MONEY_RE.test(maxAmount.trim()) ? t('amountRule') : undefined;
    const ccyErr = currency && !/^[A-Z]{3}$/.test(currency) ? t('currencyRule') : maxAmount && !currency ? t('currencyRecommended') : undefined;
    const reasonErr = reason && reason.trim().length < 3 ? t('minChars') : undefined;
    const valid = toUserId && perms.length > 0 && fromIso && toIso && !windowErr && !amountErr && !(currency && !/^[A-Z]{3}$/.test(currency)) && reason.trim().length >= 3;

    const submit = async () => {
        const body = clean({ toUserId, permissions: perms, validFrom: fromIso, validTo: toIso, maxAmount: maxAmount.trim(), currency, reason: reason.trim() });
        const r = await run('create', () => api.post('/lending/access/delegations', body));
        if (r) {
            showToast(t('requested'), 'success');
            setToUserId(''); setPerms([]); setFrom(''); setTo(''); setMaxAmount(''); setCurrency(''); setReason('');
            reload();
        }
    };

    return (
        <Card title={t('requestTitle')} subtitle={t('requestSubtitle')}>
            <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Field label={t('delegateTo')}><SelectInput value={toUserId} onChange={setToUserId} options={userOptions(data.users)} placeholder={t('selectUser')} /></Field>
                    <Field label={t('validFrom')}><TextInput type="datetime-local" value={from} onChange={setFrom} /></Field>
                    <Field label={t('validTo')} error={windowErr}><TextInput type="datetime-local" value={to} onChange={setTo} /></Field>
                    <Field label={t('maxAmountOptional')} error={amountErr}><TextInput value={maxAmount} onChange={setMaxAmount} inputMode="decimal" placeholder={t('amountPlaceholder')} /></Field>
                    <Field label={t('currencyOptional')} error={ccyErr}><TextInput value={currency} onChange={(v) => setCurrency(v.toUpperCase())} maxLength={3} placeholder="USD" /></Field>
                    <Field label={t('colReason')} error={reasonErr}><TextInput value={reason} onChange={setReason} maxLength={300} /></Field>
                </div>
                <Field label={t('permissionsMax')}>
                    <PermissionPicker permissions={data.permissions} value={perms} onChange={setPerms} max={20} />
                </Field>
                <ErrorBox error={error} onDismiss={clearError} />
                <div className="flex justify-end">
                    <Btn variant="primary" busy={busy === 'create'} disabled={!valid} reason={!valid ? t('required') : undefined} onClick={submit}>{t('request')}</Btn>
                </div>
            </div>
        </Card>
    );
}
