"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useWorkspace } from '@/lib/workspace';
import { Pager } from '../Pager';
import { addDaysIso } from '../useBusinessDate';
import Link from 'next/link';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, Field, Notice, Spinner, Table, TextInput, td, tdR, th, thR } from '../ui';
import { qs, useAction, useApi } from '../useAsync';
import { addDecimal } from '../format';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import type { LoanSummary, Paged } from '../types';
import { RestructuredBadge } from './LoansList';
import { NoticesCard } from './NoticesCard';
import { WorkQueueCard } from './WorkQueueCard';

const PAGE_SIZE = 50;

function BusinessDateCard({ onChanged }: { onChanged: () => void }) {
    const { showToast } = useToast();
    const confirm = useConfirm();
    const bd = useApi<{ businessDate: string }>('/lending/ops/business-date');
    const [next, setNext] = useState('');
    const [result, setResult] = useState<{ businessDate: string; processed: number; failed: { id: string; error: string }[] | number } | null>(null);
    const { busy, error, run, clearError } = useAction();
    const { can } = useWorkspace();
    const canDate = can('business_date.manage');
    const canBatch = can('servicing.batch.run');

    const advance = async () => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return;
        const ok = await confirm({
            title: 'Change business date',
            message: `Move the tenant business date from ${bd.data?.businessDate ?? '—'} to ${next}? This affects accrual, value-date checks and delinquency for every loan.`,
            confirmLabel: 'Change date',
            variant: 'warning',
        });
        if (!ok) return;
        const res = await run('date', () => api.post<{ businessDate: string }>('/lending/ops/business-date', { businessDate: next }));
        if (res) {
            showToast(`Business date is now ${res.data?.businessDate ?? next}`, 'success');
            setNext('');
            bd.reload();
        }
    };

    const batch = async () => {
        const ok = await confirm({
            title: 'Run end-of-day batch',
            message: `Accrue interest, assess penalties and recompute delinquency for all active loans as of ${bd.data?.businessDate ?? 'the business date'}?`,
            confirmLabel: 'Run batch',
        });
        if (!ok) return;
        const res = await run('batch', () => api.post<{ businessDate: string; processed: number; failed: { id: string; error: string }[] | number }>('/lending/loans/batch/run', {}));
        if (res) {
            setResult(res.data);
            showToast('End-of-day batch finished', 'success');
            onChanged();
        }
    };

    const failedList = result && Array.isArray(result.failed) ? result.failed : [];
    const failedCount = result ? (Array.isArray(result.failed) ? result.failed.length : result.failed) : 0;

    return (
        <Card title="Business date & end-of-day">
            <div data-tour="coll-business-date" className="flex flex-wrap items-end gap-4">
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">Current business date</p>
                    <p className="text-xl font-bold text-[#1A1F36] tabular-nums">{bd.loading && !bd.data ? '…' : bd.data?.businessDate ?? '—'}</p>
                </div>
                {canDate && (
                    <Field label="New business date">
                        <TextInput type="date" value={next} onChange={setNext} min={bd.data?.businessDate ? addDaysIso(bd.data.businessDate, 1) : undefined} className="w-44" />
                    </Field>
                )}
                {canDate && <Btn onClick={advance} busy={busy === 'date'} disabled={!next} reason={!next ? 'Pick a date first' : undefined}>Set business date</Btn>}
                {canBatch && <Btn variant="primary" onClick={batch} busy={busy === 'batch'}>Run end-of-day batch</Btn>}
            </div>
            <div className="mt-3 space-y-2">
                <ErrorBox error={bd.error} />
                <ErrorBox error={error} onDismiss={clearError} />
                {result && (
                    <Notice tone={failedCount ? 'warn' : 'success'} title={`Batch for ${result.businessDate}: ${result.processed} processed, ${failedCount} failed`}>
                        {failedList.length > 0 && (
                            <ul className="mt-1 space-y-0.5">
                                {failedList.map((f) => <li key={f.id}><span className="font-mono text-[11px]">{f.id}</span> — {f.error}</li>)}
                            </ul>
                        )}
                    </Notice>
                )}
            </div>
        </Card>
    );
}

export function CollectionsView() {
    const href = useLendingHref();
    const t = useTranslations('Servicing.collections');
    // Paged and filtered on the server, worst first: the whole book is never loaded.
    const [page, setPage] = useState(1);
    const loans = useApi<Paged<LoanSummary>>(`/lending/loans${qs({ pastDue: 1, page })}`);
    const overdue = loans.data?.data ?? [];
    const total = loans.data?.total ?? 0;

    return (
        <LendingShell title="Collections" subtitle="Loans past due, worst first. Run the end-of-day batch to refresh delinquency.">
            <BusinessDateCard onChanged={loans.reload} />
            <WorkQueueCard />
            <NoticesCard />
            <Card
                title="Past-due loans"
                subtitle={loans.data ? t('pastDueCount', { count: total }) : undefined}
                actions={<Btn variant="ghost" onClick={loans.reload}>Refresh</Btn>}
                bodyClass="p-0"
            >
                {loans.error && <div className="p-4"><ErrorBox error={loans.error} /></div>}
                {loans.loading && !loans.data ? <Spinner /> : overdue.length === 0 ? (
                    !loans.error && <Empty>No loans are past due.</Empty>
                ) : (
                    <>
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>Reference</th>
                                <th className={thR}>DPD</th>
                                <th className={th}>Bucket</th>
                                <th className={th}>Stage</th>
                                <th className={thR}>Principal o/s</th>
                                <th className={thR}>Interest + fees + penalty</th>
                                <th className={thR}>Total outstanding</th>
                                <th className={th}>Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {overdue.map((l) => {
                                const charges = addDecimal(l.interestReceivable, l.feesReceivable, l.penaltyReceivable);
                                return (
                                    <tr key={l.id} className="hover:bg-[#F7FAFC]">
                                        <td className={td}>
                                            <div className="flex items-center gap-1.5">
                                                <Link data-tour="coll-past-due-link" href={href(`/lending/loans/${l.id}`)} className="font-mono text-[12px] font-semibold text-[#635BFF] hover:underline">{l.reference}</Link>
                                                {l.isRestructured && <RestructuredBadge />}
                                            </div>
                                        </td>
                                        <td className={`${tdR} text-red-600 font-semibold`}>{l.daysPastDue}</td>
                                        <td className={td}><StatusBadge status={l.delinquencyBucket} /></td>
                                        <td className={td}>{l.collectionStage ?? '—'}</td>
                                        <td className={tdR}><MoneyCell value={l.principalOutstanding} currency={l.currency} /></td>
                                        <td className={tdR}><MoneyCell value={charges} /></td>
                                        <td className={tdR}><MoneyCell value={addDecimal(l.principalOutstanding, charges)} strong /></td>
                                        <td className={td}><StatusBadge status={l.status} /></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Table>
                    <div className="p-3 border-t border-[#E3E8EE]"><Pager page={page} total={total} pageSize={PAGE_SIZE} onPage={setPage} /></div>
                    </>
                )}
            </Card>
        </LendingShell>
    );
}
