"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { LendingShell, useLendingHref } from '@/components/lending/LendingShell';
import { StatusBadge } from '@/components/lending/StatusBadge';
import { fmtDateTime } from '@/components/lending/format';
import type { RestructureCaseSummary, RestructureTask } from '@/components/lending/types';
import { ActionPanel, Btn, Card, Empty, ErrorBox, Field, SelectInput, Spinner, Table, TextInput, td, th } from '@/components/lending/ui';
import { qs, useAction, useApi } from '@/components/lending/useAsync';
import { RequestRestructureForm } from '@/components/lending/restructure/RequestRestructureForm';
import { LoanPicker } from '@/components/lending/LoanPicker';
import { useWorkspace } from '@/lib/workspace';
import { CASE_STATUSES, DIFFICULTY_TYPES, HARDSHIP_CATEGORIES, useRestructureLabels } from '@/components/lending/restructure/labels';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function TasksPanel() {
    const t = useTranslations('LendingRestructure');
    const L = useRestructureLabels();
    const href = useLendingHref();
    const { showToast } = useToast();
    const { data, error, loading, reload } = useApi<RestructureTask[]>('/lending/restructures/tasks?status=OPEN');
    const action = useAction();
    const [closing, setClosing] = useState<string | null>(null);
    const [note, setNote] = useState('');

    const close = async (id: string) => {
        const res = await action.run(id, () => api.post(`/lending/restructures/tasks/${id}/close`, { note: note.trim() }));
        if (res) { showToast(t('tasks.toastClosed'), 'success'); setClosing(null); setNote(''); reload(); }
    };

    return (
        <Card title={t('tasks.title')} subtitle={t('tasks.subtitle')} bodyClass="p-0">
            {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorBox error={error} /></div> : !data?.length ? <Empty>{t('tasks.empty')}</Empty> : (
                <div className="divide-y divide-[#F0F2F5]">
                    {data.map((task) => (
                        <div key={task.id} className="px-5 py-3 space-y-2">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="text-[13px] font-semibold text-[#1A1F36]">{L.label('taskType', task.type)} <span className="text-[12px] font-normal text-[#697386]">{t('tasks.due', { date: task.dueDate })}</span></p>
                                    {task.case && (
                                        <p className="text-[12px] text-[#697386]">
                                            {t.rich('tasks.caseLine', {
                                                reference: task.case.reference,
                                                ref: (c) => <span className="font-mono">{c}</span>,
                                                badge: () => <StatusBadge status={task.case!.status} />,
                                                loan: (c) => <Link className="text-[#635BFF] hover:underline" href={href(`/lending/loans/${task.case!.loanAccountId}`)}>{c}</Link>,
                                            })}
                                        </p>
                                    )}
                                    {task.detail !== null && task.detail !== undefined && typeof task.detail === 'object' && Object.keys(task.detail as object).length > 0 && (
                                        <p className="text-[11px] font-mono text-[#8792A2] break-all">{JSON.stringify(task.detail)}</p>
                                    )}
                                </div>
                                <Btn size="sm" onClick={() => { action.clearError(); setNote(''); setClosing(closing === task.id ? null : task.id); }}>{t('tasks.closeOpen')}</Btn>
                            </div>
                            {closing === task.id && (
                                <ActionPanel title={t('tasks.closeTitle')} onClose={() => setClosing(null)}>
                                    <Field label={t('tasks.outcomeNote')} hint={t('common.atLeast3')}><TextInput value={note} onChange={setNote} maxLength={500} /></Field>
                                    <ErrorBox error={action.error} onDismiss={action.clearError} />
                                    <Btn variant="primary" busy={action.busy === task.id} disabled={note.trim().length < 3} onClick={() => close(task.id)}>{t('tasks.closeTask')}</Btn>
                                </ActionPanel>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </Card>
    );
}

export default function RestructuresPage() {
    const t = useTranslations('LendingRestructure');
    const L = useRestructureLabels();
    const href = useLendingHref();
    const router = useRouter();
    const [status, setStatus] = useState('');
    const [requesting, setRequesting] = useState(false);
    const [loanId, setLoanId] = useState('');
    const { can } = useWorkspace();
    const { data, error, loading } = useApi<RestructureCaseSummary[]>(`/lending/restructures${qs({ status })}`);
    const loanOk = UUID_RE.test(loanId.trim());
    const tw = useTranslations('Workspace.nav');
    const tp = useTranslations('LendingPages');

    return (
        <LendingShell
            title={tw('restructures')}
            subtitle={tp('restructures')}
            actions={can('restructure.request') && <Btn variant="primary" onClick={() => setRequesting((r) => !r)}>{t('list.requestBtn')}</Btn>}
        >
            {requesting && (
                <Card title={t('list.requestTitle')} actions={<Btn size="sm" variant="ghost" onClick={() => setRequesting(false)}>{t('common.close')}</Btn>}>
                    <div className="space-y-4">
                        <Field label={t('common.loan')} className="max-w-md" hint={t('list.loanHint')}>
                            <LoanPicker value={loanId} onChange={(id) => setLoanId(id)} status="ACTIVE" />
                        </Field>
                        {loanOk && (
                            <RequestRestructureForm
                                key={loanId.trim()}
                                loanId={loanId.trim()}
                                onCreated={(id) => router.push(href(`/lending/restructures/${id}`))}
                                onCancel={() => setRequesting(false)}
                            />
                        )}
                    </div>
                </Card>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-5 items-start">
                <Card
                    title={t('list.cases')}
                    actions={
                        <div className="w-56">
                            <SelectInput value={status} onChange={setStatus} placeholder={t('list.allStatuses')} options={CASE_STATUSES.map((s) => ({ value: s, label: L.status(s) }))} />
                        </div>
                    }
                    bodyClass="p-0"
                >
                    {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorBox error={error} /></div> : !data?.length ? <Empty>{status ? t('list.emptyWithStatus', { status: L.status(status) }) : t('list.empty')}</Empty> : (
                        <Table>
                            <thead>
                                <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                    <th className={th}>{t('list.reference')}</th><th className={th}>{t('common.status')}</th><th className={th}>{t('common.trigger')}</th>
                                    <th className={th}>{t('common.hardship')}</th><th className={th}>{t('common.difficulty')}</th><th className={th}>{t('common.loan')}</th>
                                    <th className={th}>{t('list.previous')}</th><th className={th}>{t('common.opened')}</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                {data.map((c) => (
                                    <tr key={c.id} className="hover:bg-[#F7FAFC]">
                                        <td className={td}><Link href={href(`/lending/restructures/${c.id}`)} className="font-mono font-semibold text-[#635BFF] hover:underline">{c.reference}</Link></td>
                                        <td className={td}><StatusBadge status={c.status} /></td>
                                        <td className={`${td} text-[12px]`}>{L.label('trigger', c.trigger)}</td>
                                        <td className={`${td} text-[12px]`}>{L.label('hardship', c.hardshipCategory, HARDSHIP_CATEGORIES)}</td>
                                        <td className={`${td} text-[12px]`}>{L.label('difficulty', c.difficultyType, DIFFICULTY_TYPES)}</td>
                                        <td className={td}><Link href={href(`/lending/loans/${c.loanAccountId}`)} className="font-mono text-[11px] text-[#635BFF] hover:underline">{c.loanReference ?? `${c.loanAccountId.slice(0, 8)}…`}</Link></td>
                                        <td className={td}>{c.previousRestructures > 0 ? <span className="font-bold text-amber-700">{c.previousRestructures}</span> : 0}</td>
                                        <td className={`${td} whitespace-nowrap text-[12px]`}>{fmtDateTime(c.createdAt)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    )}
                </Card>
                <TasksPanel />
            </div>
        </LendingShell>
    );
}
