"use client";

import { useState } from 'react';
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
import { CASE_STATUSES, HARDSHIP_CATEGORIES, labelOf } from '@/components/lending/restructure/labels';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function TasksPanel() {
    const href = useLendingHref();
    const { showToast } = useToast();
    const { data, error, loading, reload } = useApi<RestructureTask[]>('/lending/restructures/tasks?status=OPEN');
    const action = useAction();
    const [closing, setClosing] = useState<string | null>(null);
    const [note, setNote] = useState('');

    const close = async (id: string) => {
        const res = await action.run(id, () => api.post(`/lending/restructures/tasks/${id}/close`, { note: note.trim() }));
        if (res) { showToast('Task closed', 'success'); setClosing(null); setNote(''); reload(); }
    };

    return (
        <Card title="Open monitoring tasks" subtitle="Follow-ups raised by the monitoring batch. Closing a task never changes the loan." bodyClass="p-0">
            {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorBox error={error} /></div> : !data?.length ? <Empty>No open tasks.</Empty> : (
                <div className="divide-y divide-[#F0F2F5]">
                    {data.map((t) => (
                        <div key={t.id} className="px-5 py-3 space-y-2">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="text-[13px] font-semibold text-[#1A1F36]">{t.type.replace(/_/g, ' ')} <span className="text-[12px] font-normal text-[#697386]">due {t.dueDate}</span></p>
                                    {t.case && (
                                        <p className="text-[12px] text-[#697386]">
                                            Case <span className="font-mono">{t.case.reference}</span> <StatusBadge status={t.case.status} /> ·{' '}
                                            <Link className="text-[#635BFF] hover:underline" href={href(`/lending/loans/${t.case.loanAccountId}`)}>loan</Link>
                                        </p>
                                    )}
                                    {t.detail !== null && t.detail !== undefined && typeof t.detail === 'object' && Object.keys(t.detail as object).length > 0 && (
                                        <p className="text-[11px] font-mono text-[#8792A2] break-all">{JSON.stringify(t.detail)}</p>
                                    )}
                                </div>
                                <Btn size="sm" onClick={() => { action.clearError(); setNote(''); setClosing(closing === t.id ? null : t.id); }}>Close…</Btn>
                            </div>
                            {closing === t.id && (
                                <ActionPanel title="Close task" onClose={() => setClosing(null)}>
                                    <Field label="Outcome note" hint="At least 3 characters."><TextInput value={note} onChange={setNote} maxLength={500} /></Field>
                                    <ErrorBox error={action.error} onDismiss={action.clearError} />
                                    <Btn variant="primary" busy={action.busy === t.id} disabled={note.trim().length < 3} onClick={() => close(t.id)}>Close task</Btn>
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
    const href = useLendingHref();
    const router = useRouter();
    const [status, setStatus] = useState('');
    const [requesting, setRequesting] = useState(false);
    const [loanId, setLoanId] = useState('');
    const { data, error, loading } = useApi<RestructureCaseSummary[]>(`/lending/restructures${qs({ status })}`);
    const loanOk = UUID_RE.test(loanId.trim());

    return (
        <LendingShell
            title="Restructuring & hardship"
            subtitle="Hardship cases, affordability assessments, proposals and monitoring."
            actions={<Btn variant="primary" onClick={() => setRequesting((r) => !r)}>Request restructure</Btn>}
        >
            {requesting && (
                <Card title="Request a restructure" actions={<Btn size="sm" variant="ghost" onClick={() => setRequesting(false)}>Close</Btn>}>
                    <div className="space-y-4">
                        <Field label="Loan account id" className="max-w-md" error={loanId && !loanOk ? 'Enter the loan account UUID' : undefined}>
                            <TextInput value={loanId} onChange={setLoanId} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
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
                    title="Cases"
                    actions={
                        <div className="w-56">
                            <SelectInput value={status} onChange={setStatus} placeholder="All statuses" options={CASE_STATUSES.map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))} />
                        </div>
                    }
                    bodyClass="p-0"
                >
                    {loading && !data ? <Spinner /> : error ? <div className="p-4"><ErrorBox error={error} /></div> : !data?.length ? <Empty>No restructure cases{status ? ` with status ${status.replace(/_/g, ' ')}` : ''}.</Empty> : (
                        <Table>
                            <thead>
                                <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                    <th className={th}>Reference</th><th className={th}>Status</th><th className={th}>Trigger</th>
                                    <th className={th}>Hardship</th><th className={th}>Difficulty</th><th className={th}>Loan</th>
                                    <th className={th}>Prev.</th><th className={th}>Opened</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                {data.map((c) => (
                                    <tr key={c.id} className="hover:bg-[#F7FAFC]">
                                        <td className={td}><Link href={href(`/lending/restructures/${c.id}`)} className="font-mono font-semibold text-[#635BFF] hover:underline">{c.reference}</Link></td>
                                        <td className={td}><StatusBadge status={c.status} /></td>
                                        <td className={`${td} text-[12px]`}>{c.trigger.replace(/_/g, ' ')}</td>
                                        <td className={`${td} text-[12px]`}>{labelOf(HARDSHIP_CATEGORIES, c.hardshipCategory)}</td>
                                        <td className={`${td} text-[12px]`}>{c.difficultyType}</td>
                                        <td className={td}><Link href={href(`/lending/loans/${c.loanAccountId}`)} className="font-mono text-[11px] text-[#635BFF] hover:underline">{c.loanAccountId.slice(0, 8)}…</Link></td>
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
