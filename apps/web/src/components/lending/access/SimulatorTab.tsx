"use client";

import { useState } from 'react';
import { FlaskConical } from 'lucide-react';
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

    const idErr = resourceId && !UUID_RE.test(resourceId.trim()) ? 'Must be a UUID' : undefined;
    const amountErr = amount && !MONEY_RE.test(amount.trim()) ? 'Decimal with up to 4 places' : undefined;
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
            <Notice tone="info" title="Simulation is side-effect free — nothing is changed or audited as an action.">
                Ask “can this user perform this action on this resource, and why?”. The same policy engine and inputs as a real request are used.
            </Notice>
            <Card title="Policy simulator">
                <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Field label="User"><SelectInput value={userId} onChange={setUserId} options={data.users.map((u) => ({ value: u.id, label: `${u.email} (${u.role})${u.isActive ? '' : ' — inactive'}` }))} placeholder="Select user…" /></Field>
                        <Field label="Action">
                            <select value={action} onChange={(e) => setAction(e.target.value)} className="w-full rounded border border-[#E3E8EE] bg-white px-2.5 py-1.5 text-[13px] text-[#1A1F36] focus:outline-none focus:ring-2 focus:ring-[#635BFF]/30">
                                <option value="">Select action…</option>
                                {groups.map(([cat, perms]) => (
                                    <optgroup key={cat} label={cat}>{perms.map((p) => <option key={p.code} value={p.code}>{p.code}</option>)}</optgroup>
                                ))}
                            </select>
                        </Field>
                        <Field label="Resource type"><SelectInput value={resourceType} onChange={setResourceType} options={RESOURCE_TYPES} /></Field>
                        <Field label="Resource ID (optional)" error={idErr} hint={resourceType === 'TENANT' ? 'Not used for TENANT' : 'UUID of the application, loan or product version'}>
                            <TextInput value={resourceType === 'TENANT' ? '' : resourceId} onChange={setResourceId} disabled={resourceType === 'TENANT'} placeholder="uuid" />
                        </Field>
                        <Field label="Assurance (optional)"><SelectInput value={assurance} onChange={setAssurance} options={['MFA', 'SINGLE_FACTOR']} placeholder="(session default)" /></Field>
                        <Field label="Amount (optional)" error={amountErr}><TextInput value={amount} onChange={setAmount} inputMode="decimal" placeholder="e.g. 25000.00" /></Field>
                    </div>
                    <ErrorBox error={error} onDismiss={clearError} />
                    <div className="flex justify-end">
                        <Btn data-tour="access-simulator-run" variant="primary" busy={busy === 'sim'} disabled={!valid} reason={!valid ? 'Select a user and action' : undefined} onClick={simulate}><FlaskConical size={13} /> Simulate</Btn>
                    </div>
                </div>
            </Card>

            {result && (
                <Card title="Result">
                    <div className="space-y-5">
                        <div className="flex flex-col md:flex-row md:items-center gap-4">
                            <div className={`shrink-0 w-28 h-28 rounded-xl flex items-center justify-center text-4xl font-black text-white ${result.answer === 'YES' ? 'bg-emerald-600' : 'bg-red-600'}`}>
                                {result.answer}
                            </div>
                            <p className="text-[15px] text-[#1A1F36] font-semibold">{result.question}</p>
                        </div>
                        <div>
                            <p className="text-[12px] font-bold uppercase tracking-wide text-[#8792A2] mb-2">Decision checks</p>
                            <DecisionExplain checks={result.decision.checks} />
                        </div>
                        <Disclosure summary={`Feature flags evaluated (${Array.isArray(result.decision.flags) ? result.decision.flags.length : 0})`}>
                            <JsonBlock value={result.decision.flags} />
                        </Disclosure>
                        <Disclosure summary="Subject: roles, grants, authorities, cohorts">
                            <JsonBlock value={result.subject} />
                        </Disclosure>
                    </div>
                </Card>
            )}
        </div>
    );
}
