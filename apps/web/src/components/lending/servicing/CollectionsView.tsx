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
    const tl = useTranslations('LendingServicing.collections');
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
            title: tl('changeTitle'),
            message: tl('changeDatePrompt', { from: bd.data?.businessDate ?? '—', to: next }),
            confirmLabel: tl('changeConfirm'),
            variant: 'warning',
        });
        if (!ok) return;
        const res = await run('date', () => api.post<{ businessDate: string }>('/lending/ops/business-date', { businessDate: next }));
        if (res) {
            showToast(tl('dateChanged', { date: res.data?.businessDate ?? next }), 'success');
            setNext('');
            bd.reload();
        }
    };

    const batch = async () => {
        const ok = await confirm({
            title: tl('batchTitle'),
            message: bd.data?.businessDate ? tl('batchMessage', { date: bd.data.businessDate }) : tl('batchMessageNoDate'),
            confirmLabel: tl('batchConfirm'),
        });
        if (!ok) return;
        const res = await run('batch', () => api.post<{ businessDate: string; processed: number; failed: { id: string; error: string }[] | number }>('/lending/loans/batch/run', {}));
        if (res) {
            setResult(res.data);
            showToast(tl('batchFinished'), 'success');
            onChanged();
        }
    };

    const failedList = result && Array.isArray(result.failed) ? result.failed : [];
    const failedCount = result ? (Array.isArray(result.failed) ? result.failed.length : result.failed) : 0;

    return (
        <Card title={tl('businessDateTitle')}>
            <div data-tour="coll-business-date" className="flex flex-wrap items-end gap-4">
                <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">{tl('currentBusinessDate')}</p>
                    <p className="text-xl font-bold text-[#1A1F36] tabular-nums">{bd.loading && !bd.data ? '…' : bd.data?.businessDate ?? '—'}</p>
                </div>
                {canDate && (
                    <Field label={tl('newBusinessDate')}>
                        <TextInput type="date" value={next} onChange={setNext} min={bd.data?.businessDate ? addDaysIso(bd.data.businessDate, 1) : undefined} className="w-44" />
                    </Field>
                )}
                {canDate && <Btn onClick={advance} busy={busy === 'date'} disabled={!next} reason={!next ? tl('pickDateFirst') : undefined}>{tl('setBusinessDate')}</Btn>}
                {canBatch && <Btn variant="primary" onClick={batch} busy={busy === 'batch'}>{tl('runBatch')}</Btn>}
            </div>
            <div className="mt-3 space-y-2">
                <ErrorBox error={bd.error} />
                <ErrorBox error={error} onDismiss={clearError} />
                {result && (
                    <Notice tone={failedCount ? 'warn' : 'success'} title={tl('batchResult', { date: result.businessDate, processed: result.processed, failed: failedCount })}>
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
    const tl = useTranslations('LendingServicing.collections');
    const tw = useTranslations('Workspace.nav');
    const tp = useTranslations('LendingPages');
    // Paged and filtered on the server, worst first: the whole book is never loaded.
    const [page, setPage] = useState(1);
    const loans = useApi<Paged<LoanSummary>>(`/lending/loans${qs({ pastDue: 1, page })}`);
    const overdue = loans.data?.data ?? [];
    const total = loans.data?.total ?? 0;

    return (
        <LendingShell title={tw('collections')} subtitle={tp('collections')}>
            <BusinessDateCard onChanged={loans.reload} />
            <WorkQueueCard />
            <NoticesCard />
            <Card
                title={tl('pastDueTitle')}
                subtitle={loans.data ? t('pastDueCount', { count: total }) : undefined}
                actions={<Btn variant="ghost" onClick={loans.reload}>{tl('refresh')}</Btn>}
                bodyClass="p-0"
            >
                {loans.error && <div className="p-4"><ErrorBox error={loans.error} /></div>}
                {loans.loading && !loans.data ? <Spinner /> : overdue.length === 0 ? (
                    !loans.error && <Empty>{tl('empty')}</Empty>
                ) : (
                    <>
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>{tl('columns.reference')}</th>
                                <th className={thR}>DPD</th>
                                <th className={th}>{tl('columns.bucket')}</th>
                                <th className={th}>{tl('columns.stage')}</th>
                                <th className={thR}>{tl('columns.principal')}</th>
                                <th className={thR}>{tl('columns.charges')}</th>
                                <th className={thR}>{tl('columns.total')}</th>
                                <th className={th}>{tl('columns.status')}</th>
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
