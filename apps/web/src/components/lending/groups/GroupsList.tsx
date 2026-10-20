"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { LendingShell, useLendingHref } from '../LendingShell';
import { ActionPanel, Btn, Card, Empty, ErrorBox, Field, SelectInput, Spinner, Table, TextInput, td, tdR, th, thR } from '../ui';
import { clean, qs, useAction, useApi } from '../useAsync';
import { StatusBadge } from '../StatusBadge';
import { shortId } from './borrowers';
import type { BorrowerGroup, CreateGroupBody } from './types';
import type { Paged } from '../types';

export const GROUP_STATUSES = ['FORMING', 'ACTIVE', 'DORMANT', 'DISBANDED'];
const PAGE_SIZE = 50;
const CODE_RE = /^[A-Z0-9][A-Z0-9_.-]{1,47}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function GroupsList() {
    const t = useTranslations('LendingGroups');
    const ts = useTranslations('Status');
    const tw = useTranslations('Workspace.nav');
    const tp = useTranslations('LendingPages');
    const href = useLendingHref();
    const [status, setStatus] = useState('');
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');
    const [page, setPage] = useState(1);
    const [creating, setCreating] = useState(false);
    const { data, error, loading, reload } = useApi<Paged<BorrowerGroup>>(`/lending/applications/groups${qs({ status, search: query, page })}`);
    const rows = data?.data ?? [];
    const total = data?.total ?? 0;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return (
        <LendingShell
            title={tw('groups')}
            subtitle={tp('groups')}
            actions={<Btn variant="primary" onClick={() => setCreating(true)}><Plus size={14} /> {t('list.newGroup')}</Btn>}
        >
            {creating && <NewGroupForm onClose={() => setCreating(false)} />}
            <Card
                title={t('list.cardTitle')}
                subtitle={data ? t('list.count', { count: total }) : undefined}
                bodyClass="p-0"
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <SelectInput value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={GROUP_STATUSES.map((s) => ({ value: s, label: ts.has(s) ? ts(s) : s }))} placeholder={t('list.allStatuses')} className="w-40" />
                        <TextInput
                            value={search}
                            onChange={setSearch}
                            placeholder={t('list.searchPlaceholder')}
                            className="w-48"
                            onKeyDown={(e) => { if (e.key === 'Enter') { setQuery(search.trim()); setPage(1); } }}
                        />
                        <Btn onClick={() => { setQuery(search.trim()); setPage(1); }}>{t('common.search')}</Btn>
                        <Btn variant="ghost" onClick={reload}>{t('common.refresh')}</Btn>
                    </div>
                }
            >
                {error && <div className="p-4"><ErrorBox error={error} /></div>}
                {loading && !data ? <Spinner /> : rows.length === 0 ? (
                    !error && <Empty>{t('list.empty')}</Empty>
                ) : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>{t('common.code')}</th>
                                <th className={th}>{t('common.name')}</th>
                                <th className={th}>{t('common.branch')}</th>
                                <th className={th}>{t('common.status')}</th>
                                <th className={thR}>{t('common.members')}</th>
                                <th className={th}>{t('common.formedOn')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {rows.map((g) => (
                                <tr key={g.id} className="hover:bg-[#F7FAFC]">
                                    <td className={td}>
                                        <Link href={href(`/lending/groups/${g.id}`)} className="font-mono text-[12px] font-semibold text-[#635BFF] hover:underline">{g.code}</Link>
                                    </td>
                                    <td className={td}>{g.name}</td>
                                    <td className={`${td} font-mono text-[12px]`} title={g.branchId ?? undefined}>{shortId(g.branchId)}</td>
                                    <td className={td}><StatusBadge status={g.status} /></td>
                                    <td className={tdR}>{g.memberCount}</td>
                                    <td className={`${td} whitespace-nowrap`}>{g.formedOn ?? '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
                {pages > 1 && (
                    <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#E3E8EE] text-[12px] text-[#697386]">
                        <Btn size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t('common.previous')}</Btn>
                        {t('list.pageOf', { page, pages })}
                        <Btn size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{t('common.next')}</Btn>
                    </div>
                )}
            </Card>
        </LendingShell>
    );
}

function NewGroupForm({ onClose }: { onClose: () => void }) {
    const t = useTranslations('LendingGroups');
    const href = useLendingHref();
    const router = useRouter();
    const { showToast } = useToast();
    const [code, setCode] = useState('');
    const [name, setName] = useState('');
    const [branchId, setBranchId] = useState('');
    const [formedOn, setFormedOn] = useState('');
    const [problems, setProblems] = useState<Record<string, string>>({});
    const { busy, error, run, clearError } = useAction();

    const submit = async () => {
        const p: Record<string, string> = {};
        const c = code.trim().toUpperCase();
        if (!CODE_RE.test(c)) p.code = t('newGroup.errCode');
        if (name.trim().length < 2 || name.trim().length > 120) p.name = t('newGroup.errName');
        if (branchId.trim() && !UUID_RE.test(branchId.trim())) p.branchId = t('newGroup.errBranch');
        setProblems(p);
        if (Object.keys(p).length) return;
        const body: CreateGroupBody = clean({ code: c, name: name.trim(), branchId: branchId.trim(), formedOn });
        const res = await run('create', () => api.post<BorrowerGroup>('/lending/applications/groups', body));
        if (res) {
            showToast(t('newGroup.created', { code: res.data.code }), 'success');
            router.push(href(`/lending/groups/${res.data.id}`));
        }
    };

    return (
        <ActionPanel title={t('newGroup.title')} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Field label={t('common.code')} error={problems.code} hint={t('newGroup.codeHint')}>
                    <TextInput value={code} onChange={(v) => setCode(v.toUpperCase())} maxLength={48} />
                </Field>
                <Field label={t('common.name')} error={problems.name}>
                    <TextInput value={name} onChange={setName} maxLength={120} />
                </Field>
                <Field label={t('newGroup.branchId')} error={problems.branchId} hint={t('newGroup.branchHint')}>
                    <TextInput value={branchId} onChange={setBranchId} placeholder="uuid" />
                </Field>
                <Field label={t('common.formedOn')} hint={t('newGroup.formedOnHint')}>
                    <TextInput type="date" value={formedOn} onChange={setFormedOn} />
                </Field>
            </div>
            <p className="text-[11px] text-[#697386]">{t('newGroup.note')}</p>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={submit} busy={busy === 'create'}>{t('newGroup.submit')}</Btn>
        </ActionPanel>
    );
}
