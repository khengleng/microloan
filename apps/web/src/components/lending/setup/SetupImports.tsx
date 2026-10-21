"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download, Upload } from 'lucide-react';
import api from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import {
    BRANCHES_TEMPLATE, STAFF_TEMPLATE, checkBranchesCsv, checkStaffCsv, csvCell, temporaryPassword,
    type BranchRow, type ImportIssue, type StaffRow,
} from '@/lib/setup-import';
import { Btn, Card, Notice, Table, Tabs, td, th } from '../ui';
import { toApiError, useApi } from '../useAsync';
import type { AccessOverview, BranchRef } from '../types';

function download(name: string, text: string) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function useIssueText() {
    const t = useTranslations('GoLiveSetup.imports.issues');
    return (i: ImportIssue) => (t.has(i.code) ? t(i.code, i.params ?? {}) : i.code);
}

/**
 * Bulk helpers for a new lender (D-175): a staff CSV (email, name, roles,
 * branch) and a branches CSV, checked in the browser, then sent row by row
 * through the normal API calls — the Team page's account creation and the
 * Access page's role-assignment request (sensitive roles still wait for a
 * second administrator) and branch creation.
 */
export function SetupImports({ onDone }: { onDone: () => void }) {
    const t = useTranslations('GoLiveSetup.imports');
    const { can, legacyCan } = useWorkspace();
    const canBranches = can('access_policy.manage');
    const canStaff = canBranches && legacyCan('USER_CREATE');
    const [tab, setTab] = useState<'staff' | 'branches'>(canStaff ? 'staff' : 'branches');
    if (!canBranches) return null;
    return (
        <Card title={t('title')} subtitle={t('subtitle')}>
            <div className="space-y-4">
                <Tabs
                    value={tab}
                    onChange={setTab}
                    tabs={[...(canStaff ? [{ value: 'staff' as const, label: t('staffTab') }] : []), { value: 'branches' as const, label: t('branchesTab') }]}
                />
                {tab === 'staff' && canStaff && <StaffImport onDone={onDone} />}
                {tab === 'branches' && <BranchImport onDone={onDone} />}
            </div>
        </Card>
    );
}

function FilePicker({ onText, label }: { onText: (text: string) => void; label: string }) {
    return (
        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-semibold rounded border border-[#E3E8EE] bg-white text-[#3C4257] hover:bg-slate-50 cursor-pointer">
            <Upload size={14} /> {label}
            <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void file.text().then(onText);
                    e.target.value = '';
                }}
            />
        </label>
    );
}

interface StaffResult { row: StaffRow; password: string | null; error: string | null; requested: number; failedRoles: string[] }

function StaffImport({ onDone }: { onDone: () => void }) {
    const t = useTranslations('GoLiveSetup.imports');
    const issueText = useIssueText();
    const overview = useApi<AccessOverview>('/lending/access');
    const branches = useApi<BranchRef[]>('/lending/access/branches');
    const [checked, setChecked] = useState<ReturnType<typeof checkStaffCsv> | null>(null);
    const [running, setRunning] = useState(false);
    const [results, setResults] = useState<StaffResult[] | null>(null);
    const ready = !!overview.data && !!branches.data;

    const onText = (text: string) => {
        if (!overview.data || !branches.data) return;
        setResults(null);
        setChecked(checkStaffCsv(text, {
            roleCodes: overview.data.roles.map((r) => r.code),
            branches: branches.data,
            existingEmails: overview.data.users.map((u) => u.email),
        }));
    };

    const valid = checked?.rows.filter((r) => !r.issues.length) ?? [];
    const invite = async () => {
        if (!overview.data) return;
        const roleId = new Map(overview.data.roles.map((r) => [r.code, r.id]));
        setRunning(true);
        const out: StaffResult[] = [];
        for (const row of valid) {
            const password = temporaryPassword((n) => crypto.getRandomValues(new Uint8Array(n)));
            try {
                const created = await api.post<{ id: string }>('/users', {
                    email: row.email, password, role: row.staffRole, ...(row.branchId ? { branchId: row.branchId } : {}),
                });
                let requested = 0;
                const failedRoles: string[] = [];
                // An administrator's staff role already carries the tenant administrator role.
                for (const code of row.roles.filter((c) => !(c === 'TENANT_ADMIN' && row.staffRole === 'ADMIN'))) {
                    try {
                        await api.post('/lending/access/assignments', {
                            userId: created.data.id,
                            roleId: roleId.get(code),
                            ...(row.branchId ? { branchIds: [row.branchId] } : { allBranches: true }),
                            reason: t('assignmentReason'),
                        });
                        requested += 1;
                    } catch {
                        failedRoles.push(code);
                    }
                }
                out.push({ row, password, error: null, requested, failedRoles });
            } catch (e) {
                out.push({ row, password: null, error: toApiError(e).message, requested: 0, failedRoles: [] });
            }
            setResults([...out]);
        }
        setRunning(false);
        onDone();
    };

    const credentials = () => download('staff-sign-in.csv', [
        'email,name,temporary_password,roles_requested',
        ...(results ?? []).filter((r) => r.password).map((r) => [r.row.email, r.row.name, r.password!, r.row.roles.join(';')].map(csvCell).join(',')),
    ].join('\n'));

    return (
        <div className="space-y-3">
            <p className="text-[13px] text-[#3C4257]">{t('staffHelp')}</p>
            <div className="flex flex-wrap gap-2">
                <Btn size="sm" onClick={() => download('staff-template.csv', STAFF_TEMPLATE)}><Download size={13} /> {t('template')}</Btn>
                {ready && <FilePicker onText={onText} label={t('chooseFile')} />}
            </div>
            {checked?.fileIssues.map((i, n) => <Notice key={n} tone="danger">{issueText(i)}</Notice>)}
            {checked && checked.rows.length > 0 && !results && (
                <>
                    <Table>
                        <thead><tr><th className={th}>{t('colLine')}</th><th className={th}>{t('colEmail')}</th><th className={th}>{t('colName')}</th><th className={th}>{t('colRoles')}</th><th className={th}>{t('colBranch')}</th><th className={th}>{t('colStaffRole')}</th><th className={th}>{t('colCheck')}</th></tr></thead>
                        <tbody>
                            {checked.rows.map((r) => (
                                <tr key={r.line} className="border-t border-[#E3E8EE]">
                                    <td className={td}>{r.line}</td><td className={td}>{r.email}</td><td className={td}>{r.name}</td>
                                    <td className={td}>{r.roles.join(', ')}</td><td className={td}>{r.branchLabel || t('allBranches')}</td><td className={td}>{r.staffRole}</td>
                                    <td className={td}>{r.issues.length ? <span className="text-red-700">{r.issues.map(issueText).join(' ')}</span> : <span className="text-emerald-700">{t('ok')}</span>}</td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                    <Notice tone="info">{t('staffNotice')}</Notice>
                    <Btn variant="primary" busy={running} disabled={!valid.length} onClick={invite}>{t('invite', { count: valid.length })}</Btn>
                </>
            )}
            {results && (
                <>
                    <Table>
                        <thead><tr><th className={th}>{t('colEmail')}</th><th className={th}>{t('colResult')}</th></tr></thead>
                        <tbody>
                            {results.map((r) => (
                                <tr key={r.row.line} className="border-t border-[#E3E8EE]">
                                    <td className={td}>{r.row.email}</td>
                                    <td className={td}>
                                        {r.error ? <span className="text-red-700">{t('failed', { error: r.error })}</span> : (
                                            <span className="text-emerald-700">{t('created', { count: r.requested })}{r.failedRoles.length ? ` ${t('rolesFailed', { roles: r.failedRoles.join(', ') })}` : ''}</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                    {results.some((r) => r.password) && (
                        <Notice tone="warn" title={t('credentialsTitle')}>
                            <span className="block">{t('credentialsBody')}</span>
                            <Btn size="sm" className="mt-2" onClick={credentials}><Download size={13} /> {t('credentialsDownload')}</Btn>
                        </Notice>
                    )}
                </>
            )}
        </div>
    );
}

interface BranchResult { row: BranchRow; error: string | null }

function BranchImport({ onDone }: { onDone: () => void }) {
    const t = useTranslations('GoLiveSetup.imports');
    const issueText = useIssueText();
    const branches = useApi<BranchRef[]>('/lending/access/branches');
    const [checked, setChecked] = useState<ReturnType<typeof checkBranchesCsv> | null>(null);
    const [running, setRunning] = useState(false);
    const [results, setResults] = useState<BranchResult[] | null>(null);
    const valid = checked?.rows.filter((r) => !r.issues.length) ?? [];

    const create = async () => {
        setRunning(true);
        const out: BranchResult[] = [];
        for (const row of valid) {
            try {
                await api.post('/lending/access/branches', { name: row.name, ...(row.code ? { code: row.code } : {}) });
                out.push({ row, error: null });
            } catch (e) {
                out.push({ row, error: toApiError(e).message });
            }
            setResults([...out]);
        }
        setRunning(false);
        branches.reload();
        onDone();
    };

    return (
        <div className="space-y-3">
            <p className="text-[13px] text-[#3C4257]">{t('branchesHelp')}</p>
            <div className="flex flex-wrap gap-2">
                <Btn size="sm" onClick={() => download('branches-template.csv', BRANCHES_TEMPLATE)}><Download size={13} /> {t('template')}</Btn>
                {branches.data && <FilePicker onText={(text) => { setResults(null); setChecked(checkBranchesCsv(text, { branches: branches.data! })); }} label={t('chooseFile')} />}
            </div>
            {checked?.fileIssues.map((i, n) => <Notice key={n} tone="danger">{issueText(i)}</Notice>)}
            {checked && checked.rows.length > 0 && !results && (
                <>
                    <Table>
                        <thead><tr><th className={th}>{t('colLine')}</th><th className={th}>{t('colBranchName')}</th><th className={th}>{t('colBranchCode')}</th><th className={th}>{t('colCheck')}</th></tr></thead>
                        <tbody>
                            {checked.rows.map((r) => (
                                <tr key={r.line} className="border-t border-[#E3E8EE]">
                                    <td className={td}>{r.line}</td><td className={td}>{r.name}</td><td className={td}>{r.code ?? '—'}</td>
                                    <td className={td}>{r.issues.length ? <span className="text-red-700">{r.issues.map(issueText).join(' ')}</span> : <span className="text-emerald-700">{t('ok')}</span>}</td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                    <Btn variant="primary" busy={running} disabled={!valid.length} onClick={create}>{t('createBranches', { count: valid.length })}</Btn>
                </>
            )}
            {results && (
                <ul className="space-y-1 text-[13px]">
                    {results.map((r) => (
                        <li key={r.row.line} className={r.error ? 'text-red-700' : 'text-emerald-700'}>
                            {r.row.name}: {r.error ? t('failed', { error: r.error }) : t('branchCreated')}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
