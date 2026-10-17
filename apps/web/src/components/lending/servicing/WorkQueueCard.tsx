"use client";

import { useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { useLendingHref } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, Field, SelectInput, Spinner, Table, TextInput, td, tdR, th, thR } from '../ui';
import { qs, useAction, useApi } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';

interface Task {
    id: string; loanAccountId: string; reference: string; currency: string; borrower: string; phone: string | null;
    stage: string; action: string; queue: string; daysPastDue: number; amountOverdue: string; dueOn: string;
    status: string; assignedTo: string | null; outcome: string; note: string;
}

const OUTCOMES = ['CONTACTED', 'NO_ANSWER', 'PROMISE_TO_PAY', 'VISITED', 'NOT_FOUND', 'REFUSED', 'NOTICE_SENT', 'REFER_LEGAL'];

/** Collector work queues fed by the escalation ladder at end of day (UC-58). */
export function WorkQueueCard() {
    const href = useLendingHref();
    const [queue, setQueue] = useState('');
    const [status, setStatus] = useState('OPEN');
    const r = useApi<Task[]>(`/lending/collections/tasks${qs({ queue, status })}`);
    const [working, setWorking] = useState<{ id: string; outcome: string; note: string } | null>(null);
    const { busy, error, run, clearError } = useAction();
    const queues = Array.from(new Set((r.data ?? []).map((t) => t.queue))).sort();

    const claim = async (t: Task) => { if (await run(`claim-${t.id}`, () => api.post(`/lending/collections/tasks/${t.id}/claim`))) r.reload(); };
    const complete = async () => {
        if (!working) return;
        const ok = await run(`done-${working.id}`, () => api.post(`/lending/collections/tasks/${working.id}/complete`, { outcome: working.outcome, ...(working.note.trim() ? { note: working.note.trim() } : {}) }));
        if (ok) { setWorking(null); r.reload(); }
    };

    return (
        <Card
            title="Collector work queues"
            subtitle="End of day raises one task per collection stage: reminders and notices go out at once; calls, visits and legal reviews wait here."
            actions={<Btn variant="ghost" onClick={r.reload}>Refresh</Btn>}
            bodyClass="p-0"
        >
            <div className="flex flex-wrap items-end gap-2 p-4 border-b border-[#E3E8EE]">
                <Field label="Queue"><SelectInput value={queue} onChange={setQueue} placeholder="All queues" options={queues} /></Field>
                <Field label="Status"><SelectInput value={status} onChange={setStatus} options={[{ value: 'OPEN', label: 'Open' }, { value: 'DONE', label: 'Done' }, { value: 'CANCELLED', label: 'Cancelled' }, { value: '', label: 'All' }]} /></Field>
            </div>
            {(r.error || error) && <div className="p-4"><ErrorBox error={error ?? r.error} onDismiss={clearError} /></div>}
            {r.loading && !r.data ? <Spinner /> : !r.data?.length ? <Empty>No tasks.</Empty> : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>Loan</th><th className={th}>Borrower</th><th className={th}>Task</th>
                            <th className={thR}>DPD</th><th className={thR}>Overdue</th><th className={th}>Status</th><th className={th} />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {r.data.map((t) => (
                            <tr key={t.id} className="align-top">
                                <td className={td}><Link href={href(`/lending/loans/${t.loanAccountId}`)} className="font-mono text-[12px] font-semibold text-[#635BFF] hover:underline">{t.reference}</Link></td>
                                <td className={td}>{t.borrower}<div className="text-[11px] text-[#8792A2]">{t.phone ?? ''}</div></td>
                                <td className={td}>{t.action.replace(/_/g, ' ').toLowerCase()} · {t.stage}<div className="text-[11px] text-[#8792A2]">queue {t.queue}</div></td>
                                <td className={`${tdR} text-red-600 font-semibold`}>{t.daysPastDue}</td>
                                <td className={tdR}><MoneyCell value={t.amountOverdue} currency={t.currency} /></td>
                                <td className={td}>
                                    <StatusBadge status={t.status} />
                                    {t.outcome && <div className="text-[11px] text-[#697386]">{t.outcome.replace(/_/g, ' ').toLowerCase()}{t.note ? ` — ${t.note}` : ''}</div>}
                                    {t.assignedTo && t.status === 'OPEN' && <div className="text-[11px] text-[#8792A2]">claimed</div>}
                                </td>
                                <td className={`${td} whitespace-nowrap`}>
                                    {t.status === 'OPEN' && !t.assignedTo && <Btn size="sm" onClick={() => claim(t)} busy={busy === `claim-${t.id}`}>Claim</Btn>}
                                    {t.status === 'OPEN' && working?.id !== t.id && <Btn size="sm" variant="ghost" onClick={() => setWorking({ id: t.id, outcome: 'CONTACTED', note: '' })}>Record outcome</Btn>}
                                    {working?.id === t.id && (
                                        <div className="space-y-1">
                                            <SelectInput value={working.outcome} onChange={(v) => setWorking({ ...working, outcome: v })} options={OUTCOMES.map((o) => ({ value: o, label: o.replace(/_/g, ' ').toLowerCase() }))} />
                                            <TextInput value={working.note} onChange={(v) => setWorking({ ...working, note: v })} placeholder="Note" maxLength={1000} />
                                            <div className="space-x-1">
                                                <Btn size="sm" variant="primary" onClick={complete} busy={busy === `done-${t.id}`}>Save</Btn>
                                                <Btn size="sm" variant="ghost" onClick={() => setWorking(null)}>Cancel</Btn>
                                            </div>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
        </Card>
    );
}
