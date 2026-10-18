"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useTranslations } from 'next-intl';
import { ActionPanel, Btn, ErrorBox, Field, TextArea } from '../ui';
import { useAction } from '../useAsync';
import { JsonDiff } from '../JsonDiff';
import { jsonDiff } from './types';
import type { LendingPolicy, LendingPolicyVersion } from './types';
import { LocalProblems, PolicyDefinitionEditor, checkDraft, draftFrom } from './PolicyDefinitionEditor';
import type { DefinitionDraft } from './PolicyDefinitionEditor';

/** Add a DRAFT version to an existing policy, starting from the latest version. */
export function NewVersionForm({ policy, onCreated, onClose }: {
    policy: LendingPolicy; onCreated: (v: LendingPolicyVersion) => void; onClose: () => void;
}) {
    const t = useTranslations('LendingPolicies');
    const latest = policy.versions[0];
    const [draft, setDraft] = useState<DefinitionDraft>(() => draftFrom(latest?.parameters, latest?.body));
    const [changeSummary, setChangeSummary] = useState('');
    const [problems, setProblems] = useState<string[]>([]);
    const { busy, error, run, clearError } = useAction();

    const preview = (() => {
        if (!latest) return null;
        const c = checkDraft(t, policy.kind, draft);
        if (!c.body) return null;
        return jsonDiff({ parameters: latest.parameters ?? {}, body: latest.body }, { parameters: c.parameters ?? latest.parameters ?? {}, body: c.body });
    })();

    const submit = async () => {
        const checked = checkDraft(t, policy.kind, draft);
        setProblems(checked.problems);
        if (checked.problems.length) return;
        const res = await run('version', () => api.post<LendingPolicyVersion>(`/lending/policies/${policy.id}/versions`, {
            parameters: checked.parameters ?? {},
            body: checked.body,
            ...(changeSummary.trim() ? { changeSummary: changeSummary.trim() } : {}),
        }));
        if (res) onCreated(res.data);
    };

    return (
        <ActionPanel title={latest ? t('newVersion.titleFrom', { code: policy.code, version: latest.version }) : t('newVersion.title', { code: policy.code })} onClose={onClose}>
            <Field label={t('changeSummary')} hint={t('newVersion.changeSummaryHint')}>
                <TextArea value={changeSummary} onChange={setChangeSummary} rows={2} maxLength={500} />
            </Field>
            <PolicyDefinitionEditor kind={policy.kind} value={draft} onChange={setDraft} />
            {latest && (
                <div>
                    <p className="text-[12px] font-semibold text-[#3C4257] mb-1">{t('changesFrom', { version: latest.version })}</p>
                    <JsonDiff diff={preview} emptyLabel={preview ? t('newVersion.noChanges') : t('newVersion.fixJson')} />
                </div>
            )}
            <LocalProblems problems={problems} />
            <ErrorBox error={error} onDismiss={clearError} />
            <div className="flex items-center gap-2">
                <Btn variant="primary" onClick={submit} busy={busy === 'version'}>{t('newVersion.save')}</Btn>
                <Btn variant="ghost" onClick={onClose}>{t('cancel')}</Btn>
            </div>
        </ActionPanel>
    );
}
