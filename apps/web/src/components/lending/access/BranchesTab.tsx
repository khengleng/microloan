"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useWorkspace } from '@/lib/workspace';
import { Btn, Card, Checkbox, Empty, ErrorBox, Field, Spinner, Table, TextInput, th, td } from '../ui';
import { StatusBadge } from '../StatusBadge';
import { useAction, useApi } from '../useAsync';

interface BranchRow { id: string; name: string; code: string | null; isActive: boolean; users: number }

/**
 * The organisation's branches (GET/POST/PUT /lending/access/branches).
 * Changing a branch grants nobody access — scope comes from approved
 * assignments — so one administrator (access_policy.manage) may do it; every
 * change is audited.
 */
export function BranchesTab({ onChanged }: { onChanged: () => void }) {
    const t = useTranslations('Governance.branches');
    const { showToast } = useToast();
    const { can } = useWorkspace();
    const canManage = can('access_policy.manage');
    const { data, error: loadError, loading, reload } = useApi<BranchRow[]>('/lending/access/branches');
    const { busy, error, run, clearError } = useAction();
    const [editing, setEditing] = useState<{ id: string; name: string; code: string; isActive: boolean } | null>(null);
    const [form, setForm] = useState({ name: '', code: '' });

    const nameErr = (v: string) => (v && v.trim().length < 2 ? t('nameTooShort') : undefined);
    const codeErr = (v: string) => (v && !/^[A-Za-z0-9_-]{2,12}$/.test(v.trim()) ? t('codeInvalid') : undefined);

    const create = async () => {
        const r = await run('create', () => api.post('/lending/access/branches', { name: form.name.trim(), ...(form.code.trim() ? { code: form.code.trim() } : {}) }));
        if (r) { showToast(t('created'), 'success'); setForm({ name: '', code: '' }); reload(); onChanged(); }
    };
    const save = async () => {
        if (!editing) return;
        const r = await run(`save-${editing.id}`, () => api.put(`/lending/access/branches/${editing.id}`, { name: editing.name.trim(), code: editing.code.trim() || null, isActive: editing.isActive }));
        if (r) { showToast(t('saved'), 'success'); setEditing(null); reload(); onChanged(); }
    };

    return (
        <div className="space-y-5">
            <Card title={t('title')} subtitle={t('subtitle')} bodyClass="p-0">
                <div className="p-4 pb-0 space-y-2"><ErrorBox error={loadError} /><ErrorBox error={error} onDismiss={clearError} /></div>
                {loading && !data ? <Spinner /> : !data?.length ? <Empty>{t('none')}</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE]">
                                <th className={th}>{t('name')}</th><th className={th}>{t('code')}</th><th className={th}>{t('users')}</th><th className={th}>{t('status')}</th><th className={th}></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {data.map((b) => editing?.id === b.id ? (
                                <tr key={b.id} className="align-top">
                                    <td className={td}><Field label={t('name')} error={nameErr(editing.name)}><TextInput value={editing.name} onChange={(name) => setEditing({ ...editing, name })} maxLength={80} /></Field></td>
                                    <td className={td}><Field label={t('code')} error={codeErr(editing.code)}><TextInput value={editing.code} onChange={(code) => setEditing({ ...editing, code })} maxLength={12} /></Field></td>
                                    <td className={td}>{b.users}</td>
                                    <td className={td}><Checkbox checked={editing.isActive} onChange={(isActive) => setEditing({ ...editing, isActive })} label={t('active')} /></td>
                                    <td className={`${td} text-right whitespace-nowrap space-x-1`}>
                                        <Btn size="sm" variant="primary" busy={busy === `save-${b.id}`} disabled={!!nameErr(editing.name) || !!codeErr(editing.code) || editing.name.trim().length < 2} onClick={save}>{t('save')}</Btn>
                                        <Btn size="sm" variant="ghost" onClick={() => setEditing(null)}>{t('cancel')}</Btn>
                                    </td>
                                </tr>
                            ) : (
                                <tr key={b.id}>
                                    <td className={td}><span className="font-semibold text-[#1A1F36]">{b.name}</span></td>
                                    <td className={td}><span className="font-mono text-[12px]">{b.code ?? '—'}</span></td>
                                    <td className={td}>{b.users}</td>
                                    <td className={td}><StatusBadge status={b.isActive ? 'ACTIVE' : 'INACTIVE'} /></td>
                                    <td className={`${td} text-right`}>
                                        <Btn size="sm" disabled={!canManage || !!busy} reason={!canManage ? t('needManage') : undefined} onClick={() => setEditing({ id: b.id, name: b.name, code: b.code ?? '', isActive: b.isActive })}>{t('edit')}</Btn>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Card>
            {canManage && (
                <Card title={t('addTitle')}>
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Field label={t('name')} error={nameErr(form.name)}><TextInput value={form.name} onChange={(name) => setForm({ ...form, name })} maxLength={80} placeholder={t('namePlaceholder')} /></Field>
                            <Field label={t('codeOptional')} error={codeErr(form.code)} hint={t('codeHint')}><TextInput value={form.code} onChange={(code) => setForm({ ...form, code })} maxLength={12} placeholder="KPT" /></Field>
                        </div>
                        <div className="flex justify-end">
                            <Btn variant="primary" busy={busy === 'create'} disabled={form.name.trim().length < 2 || !!codeErr(form.code)} onClick={create}>{t('add')}</Btn>
                        </div>
                    </div>
                </Card>
            )}
        </div>
    );
}
