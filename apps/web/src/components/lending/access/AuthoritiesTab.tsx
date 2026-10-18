"use client";

import { useState } from 'react';
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
    const pending = rows.filter((a) => a.status === 'PENDING');

    const decide = async (a: AuthorityRow, approve: boolean) => {
        const r = await run(`decide-${a.id}`, () => api.post(`/lending/access/authorities/${a.id}/decision`, { approve }));
        if (r) { showToast(approve ? 'Authority approved' : 'Authority rejected', 'success'); reload(); }
    };

    return (
        <div className="space-y-5">
            {pending.length > 0 && (
                <Notice tone="warn" title={`${pending.length} authority request(s) pending`}>
                    Approval limits follow maker-checker: the requester (and the user receiving the authority) cannot approve it.
                </Notice>
            )}
            <Card title="Approval authorities" subtitle="Monetary limits up to which a role or user may approve an action." bodyClass="p-0">
                <div className="p-4 pb-0"><ErrorBox error={error} onDismiss={clearError} /></div>
                {rows.length === 0 ? <Empty>No approval authorities configured.</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE]">
                                <th className={th}>Holder</th><th className={th}>Permission</th><th className={thR}>Max amount</th>
                                <th className={th}>Family</th><th className={th}>Status</th><th className={th}></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {rows.map((a) => (
                                <tr key={a.id} className={a.status === 'PENDING' ? 'bg-amber-50/60' : ''}>
                                    <td className={td}>
                                        {a.roleId
                                            ? <><span className="text-[10px] font-bold text-[#8792A2] mr-1">ROLE</span><span className="font-mono text-[12px]">{a.role?.code ?? a.roleId}</span></>
                                            : <><span className="text-[10px] font-bold text-[#8792A2] mr-1">USER</span>{userName(a.userId)}</>}
                                    </td>
                                    <td className={td}><span className="font-mono text-[12px]">{a.permission}</span></td>
                                    <td className={tdR}><MoneyCell value={a.maxAmount} currency={a.currency} /></td>
                                    <td className={td}>{a.familyCode ?? 'All'}</td>
                                    <td className={td}><StatusBadge status={a.status} /></td>
                                    <td className={`${td} whitespace-nowrap`}>
                                        {a.status === 'PENDING' && (
                                            <div className="flex gap-1.5 justify-end">
                                                <Btn size="sm" variant="primary" busy={busy === `decide-${a.id}`} disabled={!!busy || (!!me && (a.requestedBy === me || a.userId === me))} reason={me && (a.requestedBy === me || a.userId === me) ? 'Maker-checker: a different admin must approve' : undefined} onClick={() => decide(a, true)}>Approve</Btn>
                                                <Btn size="sm" variant="danger" disabled={!!busy} onClick={() => decide(a, false)}>Reject</Btn>
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

    const amountErr = maxAmount && !MONEY_RE.test(maxAmount.trim()) ? 'Decimal with up to 4 places' : undefined;
    const ccyErr = currency && !/^[A-Z]{3}$/.test(currency) ? '3-letter code' : undefined;
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
            showToast('Authority requested — awaiting approval', 'success');
            setRoleId(''); setUserId(''); setPermission(''); setMaxAmount(''); setFamilyCode('');
            reload();
        }
    };

    return (
        <Card title="Request approval authority">
            <div className="space-y-4">
                <div className="flex gap-5 text-[13px] text-[#3C4257]">
                    <label className="inline-flex items-center gap-2 cursor-pointer"><input type="radio" className="accent-[#635BFF]" checked={holder === 'role'} onChange={() => setHolder('role')} /> Grant to a role</label>
                    <label className="inline-flex items-center gap-2 cursor-pointer"><input type="radio" className="accent-[#635BFF]" checked={holder === 'user'} onChange={() => setHolder('user')} /> Grant to a user</label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {holder === 'role'
                        ? <Field label="Role"><SelectInput value={roleId} onChange={setRoleId} options={data.roles.map((r) => ({ value: r.id, label: `${r.code} — ${r.name}` }))} placeholder="Select role…" /></Field>
                        : <Field label="User"><SelectInput value={userId} onChange={setUserId} options={userOptions(data.users)} placeholder="Select user…" /></Field>}
                    <Field label="Permission">
                        <select value={permission} onChange={(e) => setPermission(e.target.value)} className="w-full rounded border border-[#E3E8EE] bg-white px-2.5 py-1.5 text-[13px] text-[#1A1F36] focus:outline-none focus:ring-2 focus:ring-[#635BFF]/30">
                            <option value="">Select permission…</option>
                            <optgroup label="Financial">{financial.map((p) => <option key={p.code} value={p.code}>{p.code}</option>)}</optgroup>
                            <optgroup label="Other">{others.map((p) => <option key={p.code} value={p.code}>{p.code}</option>)}</optgroup>
                        </select>
                    </Field>
                    <Field label="Family code (optional)" hint="Restrict to one product family"><TextInput value={familyCode} onChange={setFamilyCode} maxLength={40} /></Field>
                    <Field label="Currency" error={ccyErr}><TextInput value={currency} onChange={(v) => setCurrency(v.toUpperCase())} maxLength={3} placeholder="USD" /></Field>
                    <Field label="Max amount" error={amountErr}><TextInput value={maxAmount} onChange={setMaxAmount} inputMode="decimal" placeholder="e.g. 50000.00" /></Field>
                </div>
                <ErrorBox error={error} onDismiss={clearError} />
                <div className="flex justify-end">
                    <Btn data-tour="access-authority-request" variant="primary" busy={busy === 'create'} disabled={!valid} reason={!valid ? 'Holder, permission, currency and amount are required' : undefined} onClick={submit}>Request authority</Btn>
                </div>
            </div>
        </Card>
    );
}
