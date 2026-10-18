"use client";

import { useState } from 'react';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { Btn, Card, Empty, ErrorBox, Field, TextInput, th, td } from '../ui';
import { clean, useAction } from '../useAsync';
import { FinancialMark, PermissionPicker, groupByCategory, type TabProps } from './common';

export function RolesTab({ data, reload }: TabProps) {
    const { roles, permissions } = data;
    const groups = groupByCategory(permissions);
    const [showForm, setShowForm] = useState(false);
    const t = useTranslations('LendingAccess.roles');

    return (
        <div className="space-y-5">
            <Card
                title={t('matrixTitle')}
                subtitle={t('matrixSubtitle')}
                actions={<Btn variant="primary" size="sm" onClick={() => setShowForm((s) => !s)}>{showForm ? t('closeForm') : t('newRole')}</Btn>}
                bodyClass="p-0"
            >
                {roles.length === 0 ? <Empty>{t('none')}</Empty> : (
                    <div className="overflow-auto max-h-[70vh]">
                        <table data-tour="access-role-matrix" className="min-w-full border-collapse">
                            <thead className="sticky top-0 bg-white z-10">
                                <tr className="border-b border-[#E3E8EE]">
                                    <th className={`${th} sticky left-0 bg-white`}>{t('permission')}</th>
                                    {roles.map((r) => (
                                        <th key={r.id} className={`${th} text-center align-bottom`} title={r.description ?? r.name}>
                                            <div className="flex flex-col items-center gap-1 normal-case tracking-normal">
                                                <span className="font-mono text-[11px] text-[#1A1F36]">{r.code}</span>
                                                <span className="text-[10px] font-normal text-[#697386] max-w-[110px] truncate">{r.name}</span>
                                                <span className="flex gap-1">
                                                    {r.isSystem && <span className="text-[9px] px-1 rounded bg-slate-100 text-slate-600 border border-slate-200">{t('system')}</span>}
                                                    {r.sensitive && <span className="text-[9px] px-1 rounded bg-red-50 text-red-700 border border-red-200">{t('sensitive')}</span>}
                                                </span>
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {groups.map(([cat, perms]) => (
                                    <CategoryRows key={cat} category={cat} colSpan={roles.length + 1}>
                                        {perms.map((p) => (
                                            <tr key={p.code} className="border-b border-[#F0F2F5] hover:bg-slate-50">
                                                <td className={`${td} sticky left-0 bg-white whitespace-nowrap`} title={p.description}>
                                                    <span className="font-mono text-[12px]">{p.code}</span>
                                                    {p.financial && <FinancialMark />}
                                                    {!p.platformAllowed && <span className="ml-1 text-[10px] text-[#8792A2]" title={t('tenantOnlyHint')}>{t('tenantOnly')}</span>}
                                                </td>
                                                {roles.map((r) => (
                                                    <td key={r.id} className={`${td} text-center`}>
                                                        {r.permissions.includes(p.code)
                                                            ? <Check size={14} className={`inline ${p.financial ? 'text-amber-600' : 'text-[#635BFF]'}`} aria-label={t('granted')} />
                                                            : <span className="text-[#E3E8EE]">·</span>}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </CategoryRows>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {showForm && <CreateRoleForm data={data} reload={reload} onDone={() => setShowForm(false)} />}
        </div>
    );
}

function CategoryRows({ category, colSpan, children }: { category: string; colSpan: number; children: React.ReactNode }) {
    return (
        <>
            <tr className="bg-[#F7FAFC] border-b border-[#E3E8EE]">
                <td colSpan={colSpan} className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-[#697386] sticky left-0">{category}</td>
            </tr>
            {children}
        </>
    );
}

function CreateRoleForm({ data, reload, onDone }: TabProps & { onDone: () => void }) {
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const [code, setCode] = useState('');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [perms, setPerms] = useState<string[]>([]);
    const t = useTranslations('LendingAccess.roles');

    const codeErr = code && !/^[A-Z][A-Z0-9_]{2,39}$/.test(code) ? t('codeRule') : undefined;
    const valid = code && !codeErr && name.trim() && perms.length > 0;

    const submit = async () => {
        const r = await run('create', () => api.post('/lending/access/roles', clean({ code, name: name.trim(), description: description.trim(), permissions: perms })));
        if (r) {
            showToast(t('created', { code }), 'success');
            reload();
            onDone();
        }
    };

    return (
        <Card title={t('createTitle')} subtitle={t('createSubtitle')}>
            <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Field label={t('code')} error={codeErr} hint={t('codeHint')}>
                        <TextInput value={code} onChange={(v) => setCode(v.toUpperCase())} maxLength={40} />
                    </Field>
                    <Field label={t('name')}><TextInput value={name} onChange={setName} maxLength={80} /></Field>
                    <Field label={t('descriptionOptional')}><TextInput value={description} onChange={setDescription} maxLength={300} /></Field>
                </div>
                <Field label={t('permissions')}>
                    <PermissionPicker permissions={data.permissions} value={perms} onChange={setPerms} max={60} />
                </Field>
                <ErrorBox error={error} onDismiss={clearError} />
                <div className="flex justify-end gap-2">
                    <Btn onClick={onDone}>{t('cancel')}</Btn>
                    <Btn variant="primary" busy={busy === 'create'} disabled={!valid} reason={!valid ? t('required') : undefined} onClick={submit}>{t('create')}</Btn>
                </div>
            </div>
        </Card>
    );
}
