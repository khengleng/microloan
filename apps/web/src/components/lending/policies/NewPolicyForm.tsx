"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useTranslations } from 'next-intl';
import { ActionPanel, Btn, ErrorBox, Field, SelectInput, TextArea, TextInput } from '../ui';
import { clean, useAction } from '../useAsync';
import { KIND_INFO, POLICY_KINDS } from './types';
import type { LendingPolicy, PolicyKind } from './types';
import { LocalProblems, PolicyDefinitionEditor, checkDraft, emptyDraft } from './PolicyDefinitionEditor';
import type { DefinitionDraft } from './PolicyDefinitionEditor';

const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{1,47}$/;

/** Create a policy and its version 1 (DRAFT). */
export function NewPolicyForm({ defaultKind, onCreated, onClose }: {
    defaultKind?: PolicyKind; onCreated: (p: LendingPolicy) => void; onClose: () => void;
}) {
    const t = useTranslations('LendingPolicies');
    const [kind, setKind] = useState<PolicyKind>(defaultKind ?? 'PREPAYMENT');
    const [code, setCode] = useState('');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [changeSummary, setChangeSummary] = useState('');
    const [draft, setDraft] = useState<DefinitionDraft>(emptyDraft);
    const [problems, setProblems] = useState<string[]>([]);
    const { busy, error, run, clearError } = useAction();

    const submit = async () => {
        const local: string[] = [];
        if (!CODE_RE.test(code)) local.push(t('newPolicy.problemCode'));
        if (name.trim().length < 2) local.push(t('newPolicy.problemName'));
        const checked = checkDraft(t, kind, draft);
        local.push(...checked.problems);
        setProblems(local);
        if (local.length) return;
        const body = clean({
            kind, code, name: name.trim(), description: description.trim(), changeSummary: changeSummary.trim(),
        });
        const res = await run('create', () => api.post<LendingPolicy>('/lending/policies', {
            ...body,
            ...(checked.parameters && Object.keys(checked.parameters).length ? { parameters: checked.parameters } : {}),
            body: checked.body,
        }));
        if (res) onCreated(res.data);
    };

    return (
        <ActionPanel title={t('newPolicy.title')} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Field label={t('newPolicy.kind')} hint={KIND_INFO[kind].path}>
                    <SelectInput value={kind} onChange={(v) => setKind(v as PolicyKind)} options={POLICY_KINDS.map((k) => ({ value: k, label: `${k} — ${t(`kind.${k}`)}` }))} />
                </Field>
                <Field label={t('newPolicy.code')} hint={t('newPolicy.codeHint')}>
                    <TextInput value={code} onChange={(v) => setCode(v.toUpperCase())} maxLength={48} className="font-mono" placeholder="P-LOCK12" />
                </Field>
                <Field label={t('newPolicy.name')} className="lg:col-span-2">
                    <TextInput value={name} onChange={setName} maxLength={120} placeholder={t('newPolicy.namePlaceholder')} />
                </Field>
                <Field label={t('newPolicy.description')} hint={t('optional')} className="sm:col-span-2">
                    <TextArea value={description} onChange={setDescription} rows={2} maxLength={1000} />
                </Field>
                <Field label={t('changeSummary')} hint={t('newPolicy.changeSummaryHint')} className="sm:col-span-2">
                    <TextArea value={changeSummary} onChange={setChangeSummary} rows={2} maxLength={500} />
                </Field>
            </div>
            <PolicyDefinitionEditor kind={kind} value={draft} onChange={setDraft} />
            <LocalProblems problems={problems} />
            <ErrorBox error={error} onDismiss={clearError} />
            <div className="flex items-center gap-2">
                <Btn variant="primary" onClick={submit} busy={busy === 'create'}>{t('newPolicy.create')}</Btn>
                <Btn variant="ghost" onClick={onClose}>{t('cancel')}</Btn>
            </div>
        </ActionPanel>
    );
}
