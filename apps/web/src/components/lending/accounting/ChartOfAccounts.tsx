"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useWorkspace } from '@/lib/workspace';
import { Btn, Card, Empty, ErrorBox, Field, SelectInput, Spinner, Table, TextInput, th, td } from '../ui';
import { StatusBadge } from '../StatusBadge';
import { useAction, useApi } from '../useAsync';

interface LedgerAccount { id: string; code: string; name: string; type: string; isActive: boolean }

const TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const;
const CODE_RE = /^[0-9A-Z][0-9A-Z.-]{1,15}$/;

/**
 * The tenant's chart of accounts (GET /lending/ops/ledger-accounts) and a
 * form to add an account (POST, tenant_settings.manage), so the lending
 * settings can name it. Adding an account posts nothing.
 */
export function ChartOfAccounts() {
    const t = useTranslations('Governance.coa');
    const { can } = useWorkspace();
    const { showToast } = useToast();
    const { data, error: loadError, loading, reload } = useApi<LedgerAccount[]>('/lending/ops/ledger-accounts');
    const { busy, error, run, clearError } = useAction();
    const [form, setForm] = useState({ code: '', name: '', type: 'INCOME' });
    const code = form.code.trim().toUpperCase();
    const codeErr = code && !CODE_RE.test(code) ? t('codeInvalid') : data?.some((a) => a.code === code) ? t('codeTaken') : undefined;
    const nameErr = form.name && form.name.trim().length < 2 ? t('nameTooShort') : undefined;
    const valid = !!code && !codeErr && form.name.trim().length >= 2;

    const add = async () => {
        const r = await run('add', () => api.post('/lending/ops/ledger-accounts', { code, name: form.name.trim(), type: form.type }));
        if (r) { showToast(t('added', { code }), 'success'); setForm({ code: '', name: '', type: form.type }); reload(); }
    };

    return (
        <div className="space-y-4">
            <Card title={t('title')} subtitle={t('subtitle')} bodyClass="p-0">
                <div className="p-4 pb-0"><ErrorBox error={loadError} /></div>
                {loading && !data ? <Spinner /> : !data?.length ? <Empty>{t('none')}</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE]"><th className={th}>{t('code')}</th><th className={th}>{t('name')}</th><th className={th}>{t('type')}</th><th className={th}>{t('status')}</th></tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {data.map((a) => (
                                <tr key={a.id}>
                                    <td className={td}><span className="font-mono text-[12px]">{a.code}</span></td>
                                    <td className={td}>{a.name}</td>
                                    <td className={td}>{t(`types.${a.type}`)}</td>
                                    <td className={td}><StatusBadge status={a.isActive ? 'ACTIVE' : 'INACTIVE'} /></td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Card>
            {can('tenant_settings.manage') && (
                <Card title={t('addTitle')} subtitle={t('addSubtitle')}>
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <Field label={t('code')} error={codeErr} hint={t('codeHint')}><TextInput value={form.code} onChange={(v) => setForm({ ...form, code: v.toUpperCase() })} maxLength={16} placeholder="4350" /></Field>
                            <Field label={t('name')} error={nameErr}><TextInput value={form.name} onChange={(name) => setForm({ ...form, name })} maxLength={120} /></Field>
                            <Field label={t('type')}><SelectInput value={form.type} onChange={(type) => setForm({ ...form, type })} options={TYPES.map((v) => ({ value: v, label: t(`types.${v}`) }))} /></Field>
                        </div>
                        <ErrorBox error={error} onDismiss={clearError} />
                        <div className="flex justify-end">
                            <Btn variant="primary" busy={busy === 'add'} disabled={!valid} onClick={add}>{t('add')}</Btn>
                        </div>
                    </div>
                </Card>
            )}
        </div>
    );
}
