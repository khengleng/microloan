"use client";

import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { Btn, Card, Disclosure, ErrorBox, Field, JsonBlock, Notice, SelectInput, TextInput } from '../ui';
import { DecisionExplain } from '../DecisionExplain';
import { clean, useAction } from '../useAsync';
import type { PolicySimulation } from '../types';
import { MONEY_RE, UUID_RE, groupByCategory, type TabProps } from './common';

const RESOURCE_TYPES = ['APPLICATION', 'LOAN_ACCOUNT', 'PRODUCT_VERSION', 'TENANT'];

export function SimulatorTab({ data }: TabProps) {
    const { busy, error, run, clearError } = useAction();
    const [userId, setUserId] = useState('');
    const [action, setAction] = useState('');
    const [resourceType, setResourceType] = useState('APPLICATION');
    const [resourceId, setResourceId] = useState('');
    const [assurance, setAssurance] = useState('');
    const [amount, setAmount] = useState('');
    const [result, setResult] = useState<PolicySimulation | null>(null);
    const t = useTranslations('LendingAccess.simulator');

    const idErr = resourceId && !UUID_RE.test(resourceId.trim()) ? t('uuidRule') : undefined;
    const amountErr = amount && !MONEY_RE.test(amount.trim()) ? t('amountRule') : undefined;
    const valid = userId && action && !idErr && !amountErr;

    const simulate = async () => {
        const body = clean({
            userId, action, resourceType,
            resourceId: resourceType === 'TENANT' ? undefined : resourceId.trim(),
            assurance, amount: amount.trim(),
        });
        const r = await run('sim', () => api.post<PolicySimulation>('/lending/access/simulate', body));
        if (r) setResult(r.data);
    };

    const groups = groupByCategory(data.permissions);

    return (
        <div className="space-y-5">
            <Notice tone="info" title={t('noticeTitle')}>
                {t('noticeBody')}
            </Notice>
            <Card title={t('title')}>
                <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Field label={t('user')}><SelectInput value={userId} onChange={setUserId} options={data.users.map((u) => ({ value: u.id, label: u.isActive ? `${u.email} (${u.role})` : t('userInactive', { email: u.email, role: u.role }) }))} placeholder={t('selectUser')} /></Field>
                        <Field label={t('action')}>
                            <select value={action} onChange={(e) => setAction(e.target.value)} className="w-full rounded border border-[#E3E8EE] bg-white px-2.5 py-1.5 text-[13px] text-[#1A1F36] focus:outline-none focus:ring-2 focus:ring-[#635BFF]/30">
                                <option value="">{t('selectAction')}</option>
                                {groups.map(([cat, perms]) => (
                                    <optgroup key={cat} label={cat}>{perms.map((p) => <option key={p.code} value={p.code}>{p.code}</option>)}</optgroup>
                                ))}
                            </select>
                        </Field>
                        <Field label={t('resourceType')}><SelectInput value={resourceType} onChange={setResourceType} options={RESOURCE_TYPES} /></Field>
                        <Field label={t('resourceId')} error={idErr} hint={resourceType === 'TENANT' ? t('resourceIdTenant') : t('resourceIdHint')}>
                            <TextInput value={resourceType === 'TENANT' ? '' : resourceId} onChange={setResourceId} disabled={resourceType === 'TENANT'} placeholder="uuid" />
                        </Field>
                        <Field label={t('assurance')}><SelectInput value={assurance} onChange={setAssurance} options={['MFA', 'SINGLE_FACTOR']} placeholder={t('sessionDefault')} /></Field>
                        <Field label={t('amount')} error={amountErr}><TextInput value={amount} onChange={setAmount} inputMode="decimal" placeholder={t('amountPlaceholder')} /></Field>
                    </div>
                    <ErrorBox error={error} onDismiss={clearError} />
                    <div className="flex justify-end">
                        <Btn data-tour="access-simulator-run" variant="primary" busy={busy === 'sim'} disabled={!valid} reason={!valid ? t('required') : undefined} onClick={simulate}><FlaskConical size={13} /> {t('simulate')}</Btn>
                    </div>
                </div>
            </Card>

            {result && (
                <Card title={t('result')}>
                    <div className="space-y-5">
                        <div className="flex flex-col md:flex-row md:items-center gap-4">
                            <div className={`shrink-0 w-28 h-28 rounded-xl flex items-center justify-center text-4xl font-black text-white ${result.answer === 'YES' ? 'bg-emerald-600' : 'bg-red-600'}`}>
                                {result.answer === 'YES' ? t('yes') : result.answer === 'NO' ? t('no') : result.answer}
                            </div>
                            <p className="text-[15px] text-[#1A1F36] font-semibold">{result.question}</p>
                        </div>
                        <div>
                            <p className="text-[12px] font-bold uppercase tracking-wide text-[#8792A2] mb-2">{t('checks')}</p>
                            <DecisionExplain checks={result.decision.checks} />
                        </div>
                        <Disclosure summary={t('flagsEvaluated', { count: Array.isArray(result.decision.flags) ? result.decision.flags.length : 0 })}>
                            <JsonBlock value={result.decision.flags} />
                        </Disclosure>
                        <Disclosure summary={t('subject')}>
                            <JsonBlock value={result.subject} />
                        </Disclosure>
                    </div>
                </Card>
            )}
        </div>
    );
}
