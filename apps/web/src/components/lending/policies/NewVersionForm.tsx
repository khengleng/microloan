"use client";

import { useState } from 'react';
import api from '@/lib/api';
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
    const latest = policy.versions[0];
    const [draft, setDraft] = useState<DefinitionDraft>(() => draftFrom(latest?.parameters, latest?.body));
    const [changeSummary, setChangeSummary] = useState('');
    const [problems, setProblems] = useState<string[]>([]);
    const { busy, error, run, clearError } = useAction();

    const preview = (() => {
        if (!latest) return null;
        const c = checkDraft(policy.kind, draft);
        if (!c.body) return null;
        return jsonDiff({ parameters: latest.parameters ?? {}, body: latest.body }, { parameters: c.parameters ?? latest.parameters ?? {}, body: c.body });
    })();

    const submit = async () => {
        const checked = checkDraft(policy.kind, draft);
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
        <ActionPanel title={`New version of ${policy.code}${latest ? ` (from v${latest.version})` : ''}`} onClose={onClose}>
            <Field label="Change summary" hint="What changes and why — shown to the checker">
                <TextArea value={changeSummary} onChange={setChangeSummary} rows={2} maxLength={500} />
            </Field>
            <PolicyDefinitionEditor kind={policy.kind} value={draft} onChange={setDraft} />
            {latest && (
                <div>
                    <p className="text-[12px] font-semibold text-[#3C4257] mb-1">Changes from v{latest.version}</p>
                    <JsonDiff diff={preview} emptyLabel={preview ? 'No changes yet.' : 'Fix the JSON to see the changes.'} />
                </div>
            )}
            <LocalProblems problems={problems} />
            <ErrorBox error={error} onDismiss={clearError} />
            <div className="flex items-center gap-2">
                <Btn variant="primary" onClick={submit} busy={busy === 'version'}>Save draft version</Btn>
                <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
            </div>
        </ActionPanel>
    );
}
