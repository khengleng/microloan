"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Btn, Card, Empty, ErrorBox, Field, Notice, SelectInput, Table, TextInput, th, thR, td, tdR } from '../ui';
import { StatusBadge } from '../StatusBadge';
import { MoneyCell } from '../MoneyCell';
import { clean, useAction } from '../useAsync';
import type { Authority } from '../types';
import { MONEY_RE, useMyId, useUserName, userOptions, type TabProps } from './common';

type AuthorityRow = Authority & { requestedBy?: string | null };

export function AuthoritiesTab({ data, reload }: TabProps) {
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const userName = useUserName(data.users);
    const me = useMyId();
    const rows = data.authorities as AuthorityRow[];
    const t = useTranslations('LendingAccess.authorities');
    const pending = rows.filter((a) => a.status === 'PENDING');

    const decide = async (a: AuthorityRow, approve: boolean) => {
        const r = await run(`decide-${a.id}`, () => api.post(`/lending/access/authorities/${a.id}/decision`, { approve }));
        if (r) { showToast(approve ? t('approved') : t('rejected'), 'success'); reload(); }
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
                                <th className={th}>{t('colHolder')}</th><th className={th}>{t('colPermission')}</th><th className={thR}>{t('colMaxAmount')}</th>
                                <th className={th}>{t('colFamily')}</th><th className={th}>{t('colStatus')}</th><th className={th}></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {rows.map((a) => (
                                <tr key={a.id} className={a.status === 'PENDING' ? 'bg-amber-50/60' : ''}>
                                    <td className={td}>
                                        {a.roleId
                                            ? <><span className="text-[10px] font-bold text-[#8792A2] mr-1">{t('role')}</span><span className="font-mono text-[12px]">{a.role?.code ?? a.roleId}</span></>
                                            : <><span className="text-[10px] font-bold text-[#8792A2] mr-1">{t('user')}</span>{userName(a.userId)}</>}
                                    </td>
                                    <td className={td}><span className="font-mono text-[12px]">{a.permission}</span></td>
                                    <td className={tdR}><MoneyCell value={a.maxAmount} currency={a.currency} /></td>
                                    <td className={td}>{a.familyCode ?? t('allFamilies')}</td>
                                    <td className={td}><StatusBadge status={a.status} /></td>
                                    <td className={`${td} whitespace-nowrap`}>
                                        {a.status === 'PENDING' && (
                                            <div className="flex gap-1.5 justify-end">
                                                <Btn size="sm" variant="primary" busy={busy === `decide-${a.id}`} disabled={!!busy || (!!me && (a.requestedBy === me || a.userId === me))} reason={me && (a.requestedBy === me || a.userId === me) ? t('makerChecker') : undefined} onClick={() => decide(a, true)}>{t('approve')}</Btn>
                                                <Btn size="sm" variant="danger" disabled={!!busy} onClick={() => decide(a, false)}>{t('reject')}</Btn>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Card>
            <AuthorityForm data={data} reload={reload} />
        </div>
    );
}

function AuthorityForm({ data, reload }: TabProps) {
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const [holder, setHolder] = useState<'role' | 'user'>('role');
    const [roleId, setRoleId] = useState('');
    const [userId, setUserId] = useState('');
    const [permission, setPermission] = useState('');
    const [currency, setCurrency] = useState('');
    const [maxAmount, setMaxAmount] = useState('');
    const [familyCode, setFamilyCode] = useState('');
    const t = useTranslations('LendingAccess.authorities');

    const amountErr = maxAmount && !MONEY_RE.test(maxAmount.trim()) ? t('amountRule') : undefined;
    const ccyErr = currency && !/^[A-Z]{3}$/.test(currency) ? t('currencyRule') : undefined;
    const holderOk = holder === 'role' ? !!roleId : !!userId;
    const valid = holderOk && permission && /^[A-Z]{3}$/.test(currency) && MONEY_RE.test(maxAmount.trim());

    const financial = data.permissions.filter((p) => p.financial);
    const others = data.permissions.filter((p) => !p.financial);

    const submit = async () => {
        const body = clean({
            roleId: holder === 'role' ? roleId : undefined,
            userId: holder === 'user' ? userId : undefined,
            permission, currency, maxAmount: maxAmount.trim(), familyCode: familyCode.trim(),
        });
        const r = await run('create', () => api.post('/lending/access/authorities', body));
        if (r) {
            showToast(t('requested'), 'success');
            setRoleId(''); setUserId(''); setPermission(''); setMaxAmount(''); setFamilyCode('');
            reload();
        }
    };

    return (
        <Card title={t('requestTitle')}>
            <div className="space-y-4">
                <div className="flex gap-5 text-[13px] text-[#3C4257]">
                    <label className="inline-flex items-center gap-2 cursor-pointer"><input type="radio" className="accent-[#635BFF]" checked={holder === 'role'} onChange={() => setHolder('role')} /> {t('grantRole')}</label>
                    <label className="inline-flex items-center gap-2 cursor-pointer"><input type="radio" className="accent-[#635BFF]" checked={holder === 'user'} onChange={() => setHolder('user')} /> {t('grantUser')}</label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {holder === 'role'
                        ? <Field label={t('roleLabel')}><SelectInput value={roleId} onChange={setRoleId} options={data.roles.map((r) => ({ value: r.id, label: `${r.code} — ${r.name}` }))} placeholder={t('selectRole')} /></Field>
                        : <Field label={t('userLabel')}><SelectInput value={userId} onChange={setUserId} options={userOptions(data.users)} placeholder={t('selectUser')} /></Field>}
                    <Field label={t('colPermission')}>
                        <select value={permission} onChange={(e) => setPermission(e.target.value)} className="w-full rounded border border-[#E3E8EE] bg-white px-2.5 py-1.5 text-[13px] text-[#1A1F36] focus:outline-none focus:ring-2 focus:ring-[#635BFF]/30">
                            <option value="">{t('selectPermission')}</option>
                            <optgroup label={t('financial')}>{financial.map((p) => <option key={p.code} value={p.code}>{p.code}</option>)}</optgroup>
                            <optgroup label={t('other')}>{others.map((p) => <option key={p.code} value={p.code}>{p.code}</option>)}</optgroup>
                        </select>
                    </Field>
                    <Field label={t('familyOptional')} hint={t('familyHint')}><TextInput value={familyCode} onChange={setFamilyCode} maxLength={40} /></Field>
                    <Field label={t('currency')} error={ccyErr}><TextInput value={currency} onChange={(v) => setCurrency(v.toUpperCase())} maxLength={3} placeholder="USD" /></Field>
                    <Field label={t('colMaxAmount')} error={amountErr}><TextInput value={maxAmount} onChange={setMaxAmount} inputMode="decimal" placeholder={t('amountPlaceholder')} /></Field>
                </div>
                <ErrorBox error={error} onDismiss={clearError} />
                <div className="flex justify-end">
                    <Btn data-tour="access-authority-request" variant="primary" busy={busy === 'create'} disabled={!valid} reason={!valid ? t('required') : undefined} onClick={submit}>{t('request')}</Btn>
                </div>
            </div>
        </Card>
    );
}
