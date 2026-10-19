"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Copy, KeyRound } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Btn, Card, Checkbox, Empty, ErrorBox, Field, Spinner, Table, TextInput, th, td } from '../ui';
import { StatusBadge } from '../StatusBadge';
import { useAction, useApi } from '../useAsync';
import { fmtDateTime } from '../format';
import type { ServiceAccount } from '../types';
import { Chip } from './common';
import { Person } from '../People';
import { useWorkspace } from '@/lib/workspace';

const SCOPES = ['loan.repayment.post', 'loan.read'];

interface CreatedAccount { id: string; name: string; scopes: string[]; expiresAt: string; key: string; warning?: string }

/** A service account waiting for its second person, or for its requester to collect the key. */
interface AccountRequest {
    id: string; serviceAccountId: string; name: string; scopes: string[]; expiresInDays: number;
    status: 'PENDING' | 'APPROVED' | 'EXECUTED' | 'REJECTED'; makerId: string; decidedBy: string | null;
    decidedAt: string | null; comment: string | null; createdAt: string;
}

export function ServiceAccountsTab() {
    const { showToast } = useToast();
    const confirm = useConfirm();
    const { data, error: loadError, loading, reload } = useApi<ServiceAccount[]>('/lending/access/service-accounts');
    const { busy, error, run, clearError } = useAction();
    const [created, setCreated] = useState<CreatedAccount | null>(null);
    const { can } = useWorkspace();
    const tg = useTranslations('Governance.sa');
    const t = useTranslations('LendingAccess.serviceAccounts');
    const canManage = can('access_policy.manage');
    const [requests, setRequests] = useState(0);

    const disable = async (sa: ServiceAccount) => {
        const ok = await confirm({ title: t('disableTitle'), message: t('disableConfirm', { name: sa.name }), confirmLabel: t('disable'), variant: 'danger' });
        if (!ok) return;
        const r = await run(`disable-${sa.id}`, () => api.post(`/lending/access/service-accounts/${sa.id}/disable`, {}));
        if (r) { showToast(t('disabled'), 'success'); reload(); }
    };

    const status = (sa: ServiceAccount) => sa.status ?? (sa.isActive === false ? 'DISABLED' : sa.isActive ? 'ACTIVE' : undefined);

    return (
        <div className="space-y-5">
            {created && <OneTimeKey account={created} onDismiss={() => setCreated(null)} />}
            <Card title={t('title')} subtitle={t('subtitle')} bodyClass="p-0">
                <div className="p-4 pb-0 space-y-2"><ErrorBox error={loadError} /><ErrorBox error={error} onDismiss={clearError} /></div>
                {loading && !data ? <Spinner /> : !data || data.length === 0 ? <Empty>{t('none')}</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE]">
                                <th className={th}>{t('colName')}</th><th className={th}>{t('colKeyPrefix')}</th><th className={th}>{t('colScopes')}</th><th className={th}>{t('colStatus')}</th>
                                <th className={th}>{t('colExpires')}</th><th className={th}>{t('colLastUsed')}</th><th className={th}>{t('colCreated')}</th><th className={th}></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {data.map((sa) => {
                                const st = status(sa);
                                const expired = !!sa.expiresAt && new Date(sa.expiresAt).getTime() < new Date().getTime();
                                return (
                                    <tr key={sa.id}>
                                        <td className={td}><span className="font-semibold text-[#1A1F36]">{sa.name}</span></td>
                                        <td className={td}><span className="font-mono text-[12px]">{sa.keyPrefix ? `${sa.keyPrefix}.…` : '—'}</span></td>
                                        <td className={td}><div className="flex flex-wrap gap-1">{sa.scopes.map((s) => <Chip key={s}>{s}</Chip>)}</div></td>
                                        <td className={td}><StatusBadge status={expired && st === 'ACTIVE' ? 'EXPIRED' : st} /></td>
                                        <td className={`${td} text-[12px]`}>{fmtDateTime(sa.expiresAt)}</td>
                                        <td className={`${td} text-[12px]`}>{sa.lastUsedAt ? fmtDateTime(sa.lastUsedAt) : t('never')}</td>
                                        <td className={`${td} text-[12px]`}>{fmtDateTime(sa.createdAt)}</td>
                                        <td className={`${td} text-right`}>
                                            {st !== 'DISABLED' && <Btn size="sm" variant="danger" busy={busy === `disable-${sa.id}`} disabled={!!busy || !canManage} reason={!canManage ? tg('needManage') : undefined} onClick={() => disable(sa)}>{t('disable')}</Btn>}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Table>
                )}
            </Card>
            <RequestsCard version={requests} onIssued={(a) => { setCreated(a); reload(); }} />
            {canManage && <CreateForm onRequested={() => setRequests((n) => n + 1)} />}
        </div>
    );
}

function OneTimeKey({ account, onDismiss }: { account: CreatedAccount; onDismiss: () => void }) {
    const { showToast } = useToast();
    const t = useTranslations('LendingAccess.serviceAccounts');
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(account.key);
            showToast(t('copied'), 'success');
        } catch {
            showToast(t('copyFailed'), 'error');
        }
    };
    return (
        <div className="border-2 border-amber-400 bg-amber-50 rounded-lg p-5 space-y-3" role="alert">
            <p className="flex items-center gap-2 font-bold text-amber-900"><KeyRound size={16} /> {t('createdTitle', { name: account.name })}</p>
            <p className="text-[13px] text-amber-900 font-semibold">
                {t('createdBody')}
            </p>
            <div className="flex items-stretch gap-2">
                <code className="flex-1 font-mono text-[13px] bg-white border border-amber-300 rounded px-3 py-2 break-all select-all">{account.key}</code>
                <Btn variant="primary" onClick={copy}><Copy size={13} /> {t('copy')}</Btn>
            </div>
            <p className="text-[12px] text-amber-800">{t('createdMeta', { scopes: account.scopes.join(', '), expires: fmtDateTime(account.expiresAt) })}</p>
            <div className="flex justify-end"><Btn onClick={onDismiss}>{t('stored')}</Btn></div>
        </div>
    );
}

function CreateForm({ onRequested }: { onRequested: () => void }) {
    const { showToast } = useToast();
    const tg = useTranslations('Governance.sa');
    const { busy, error, run, clearError } = useAction();
    const [name, setName] = useState('');
    const [scopes, setScopes] = useState<string[]>(['loan.repayment.post']);
    const [days, setDays] = useState('');
    const t = useTranslations('LendingAccess.serviceAccounts');

    const daysErr = days && (!/^\d+$/.test(days) || Number(days) < 1 || Number(days) > 365) ? t('daysRule') : undefined;
    const valid = name.trim().length >= 2 && scopes.length > 0 && !daysErr;

    const submit = async () => {
        const body: { name: string; scopes: string[]; expiresInDays?: number } = { name: name.trim(), scopes };
        if (days) body.expiresInDays = Number(days);
        const r = await run('create', () => api.post<AccountRequest>('/lending/access/service-accounts', body));
        if (r) {
            showToast(tg('requested'), 'success');
            setName(''); setDays('');
            onRequested();
        }
    };

    return (
        <Card title={tg('requestTitle')} subtitle={tg('requestSubtitle')}>
            <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Field label={t('colName')} error={name && name.trim().length < 2 ? t('minChars') : undefined}><TextInput value={name} onChange={setName} maxLength={80} placeholder="core-banking-repayments" /></Field>
                    <Field label={t('expiresDays')} error={daysErr} hint={t('expiresDaysHint')}><TextInput value={days} onChange={setDays} inputMode="numeric" /></Field>
                    <Field label={t('colScopes')}>
                        <div className="flex flex-col gap-1 pt-1">
                            {SCOPES.map((s) => (
                                <Checkbox key={s} checked={scopes.includes(s)} onChange={(on) => setScopes((cur) => (on ? SCOPES.filter((x) => x === s || cur.includes(x)) : cur.filter((x) => x !== s)))} label={<span className="font-mono text-[12px]">{s}</span>} />
                            ))}
                        </div>
                    </Field>
                </div>
                <ErrorBox error={error} onDismiss={clearError} />
                <div className="flex justify-end">
                    <Btn variant="primary" busy={busy === 'create'} disabled={!valid} reason={!valid ? t('required') : undefined} onClick={submit}>{tg('requestButton')}</Btn>
                </div>
            </div>
        </Card>
    );
}

/** Requests: a second person approves or rejects; the requester then collects the key once. */
function RequestsCard({ version, onIssued }: { version: number; onIssued: (a: CreatedAccount) => void }) {
    const tg = useTranslations('Governance.sa');
    const { showToast } = useToast();
    const { access, can, reloadWork } = useWorkspace();
    const me = access?.principal.id;
    // `version` changes when a new request is made on this page, which refetches.
    const { data, error: loadError, reload } = useApi<AccountRequest[]>(`/lending/access/service-account-requests${version ? `?v=${version}` : ''}`);
    const { busy, error, run, clearError } = useAction();
    const canApprove = can('access_policy.approve');
    const canManage = can('access_policy.manage');

    const decide = async (r: AccountRequest, approve: boolean) => {
        const ok = await run(`decide-${r.id}`, () => api.post(`/lending/access/service-account-requests/${r.id}/decision`, { approve }));
        if (ok) { showToast(approve ? tg('approved') : tg('rejected'), 'success'); reload(); reloadWork(); }
    };
    const collect = async (r: AccountRequest) => {
        const res = await run(`issue-${r.id}`, () => api.post<CreatedAccount>(`/lending/access/service-account-requests/${r.id}/issue`, {}));
        if (res) { onIssued(res.data); reload(); reloadWork(); }
    };

    const open = (data ?? []).filter((r) => r.status === 'PENDING' || r.status === 'APPROVED');
    const decided = (data ?? []).filter((r) => r.status === 'EXECUTED' || r.status === 'REJECTED').slice(0, 10);
    return (
        <Card title={tg('requestsTitle')} subtitle={tg('requestsSubtitle')} bodyClass="p-0">
            <div className="p-4 pb-0 space-y-2"><ErrorBox error={loadError} /><ErrorBox error={error} onDismiss={clearError} /></div>
            {!data ? <Spinner /> : open.length + decided.length === 0 ? <Empty>{tg('noRequests')}</Empty> : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE]">
                            <th className={th}>{tg('colName')}</th><th className={th}>{tg('colScopes')}</th><th className={th}>{tg('colRequestedBy')}</th>
                            <th className={th}>{tg('colStatus')}</th><th className={th}>{tg('colDecidedBy')}</th><th className={th}></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {[...open, ...decided].map((r) => {
                            const mine = !!me && r.makerId === me;
                            return (
                                <tr key={r.id}>
                                    <td className={td}><span className="font-semibold text-[#1A1F36]">{r.name}</span><div className="text-[11px] text-[#8792A2]">{tg('expiresIn', { days: r.expiresInDays })} · {fmtDateTime(r.createdAt)}</div></td>
                                    <td className={td}><div className="flex flex-wrap gap-1">{r.scopes.map((s) => <Chip key={s}>{s}</Chip>)}</div></td>
                                    <td className={td}><Person id={r.makerId} /></td>
                                    <td className={td}><StatusBadge status={r.status} />{r.comment && <div className="text-[11px] text-[#8792A2]">{r.comment}</div>}</td>
                                    <td className={td}>{r.decidedBy ? <Person id={r.decidedBy} /> : '—'}</td>
                                    <td className={`${td} text-right whitespace-nowrap space-x-1`}>
                                        {r.status === 'PENDING' && (
                                            <>
                                                <Btn size="sm" variant="primary" busy={busy === `decide-${r.id}`} disabled={!!busy || !canApprove || mine} reason={!canApprove ? tg('needApprove') : mine ? tg('ownRequest') : undefined} onClick={() => decide(r, true)}>{tg('approve')}</Btn>
                                                <Btn size="sm" variant="ghost" disabled={!!busy || !canApprove || mine} reason={!canApprove ? tg('needApprove') : mine ? tg('ownRequest') : undefined} onClick={() => decide(r, false)}>{tg('reject')}</Btn>
                                            </>
                                        )}
                                        {r.status === 'APPROVED' && (
                                            <Btn size="sm" variant="primary" busy={busy === `issue-${r.id}`} disabled={!!busy || !mine || !canManage} reason={!mine ? tg('onlyRequester') : !canManage ? tg('needManage') : undefined} onClick={() => collect(r)}>{tg('collect')}</Btn>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </Table>
            )}
        </Card>
    );
}
