"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, SelectInput, Spinner, Table, td, tdR, th, thR } from '../ui';
import { qs, useApi } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import type { Paged } from '../types';
import type { CardSummary } from './types';

const PAGE_SIZE = 50;

/** Credit cards (LT-07): each one rides on a revolving facility booked from a card product. */
export function CardsList() {
    const tc = useTranslations('LendingCards');
    const ts = useTranslations('Status');
    const tw = useTranslations('Workspace.nav');
    const tp = useTranslations('LendingPages');
    const href = useLendingHref();
    const [status, setStatus] = useState('');
    const [page, setPage] = useState(1);
    const { data, error, loading, reload } = useApi<Paged<CardSummary>>(`/lending/cards${qs({ status, page })}`);
    const rows = data?.data ?? [];
    const total = data?.total ?? 0;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return (
        <LendingShell title={tw('cards')} subtitle={tp('cards')}>
            <Card
                title={tc('common.cards')}
                subtitle={data ? tc('list.count', { count: total }) : undefined}
                bodyClass="p-0"
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <SelectInput value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={['ACTIVE', 'BLOCKED', 'CLOSED'].map((v) => ({ value: v, label: ts.has(v) ? ts(v) : tc(`list.status.${v}`) }))} placeholder={tc('list.allStatuses')} className="w-40" />
                        <Btn variant="ghost" onClick={reload}>{tc('common.refresh')}</Btn>
                    </div>
                }
            >
                {error && <div className="p-4"><ErrorBox error={error} /></div>}
                {loading && !data ? <Spinner /> : rows.length === 0 ? (
                    !error && <Empty>{tc('list.empty')}</Empty>
                ) : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>{tc('list.col.card')}</th>
                                <th className={th}>{tc('list.col.number')}</th>
                                <th className={th}>{tc('list.col.line')}</th>
                                <th className={th}>{tc('list.col.status')}</th>
                                <th className={thR}>{tc('list.col.limit')}</th>
                                <th className={thR}>{tc('list.col.purchases')}</th>
                                <th className={thR}>{tc('list.col.cashAdvances')}</th>
                                <th className={thR}>{tc('list.col.plans')}</th>
                                <th className={th}>{tc('list.col.statedTo')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {rows.map((c) => (
                                <tr key={c.id} className="hover:bg-[#F7FAFC]">
                                    <td className={td}>
                                        <Link href={href(`/lending/cards/${c.id}`)} className="font-mono text-[12px] font-semibold text-[#635BFF] hover:underline">{c.reference}</Link>
                                    </td>
                                    <td className={`${td} font-mono text-[12px]`}>{c.maskedNumber}</td>
                                    <td className={td}>
                                        <Link href={href(`/lending/facilities/${c.facilityId}`)} className="font-mono text-[11px] text-[#635BFF] hover:underline">{c.facilityReference}</Link>
                                    </td>
                                    <td className={td}><StatusBadge status={c.status} /></td>
                                    <td className={tdR}><MoneyCell value={c.limitAmount} currency={c.currency} strong /></td>
                                    <td className={tdR}><MoneyCell value={c.purchaseBalance} /></td>
                                    <td className={tdR}><MoneyCell value={c.cashBalance} /></td>
                                    <td className={tdR}><MoneyCell value={c.planBalance} /></td>
                                    <td className={`${td} whitespace-nowrap`}>{c.lastStatementTo ?? '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
                {pages > 1 && (
                    <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#E3E8EE] text-[12px] text-[#697386]">
                        <Btn size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{tc('list.previous')}</Btn>
                        {tc('list.page', { page, pages })}
                        <Btn size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{tc('list.next')}</Btn>
                    </div>
                )}
            </Card>
        </LendingShell>
    );
}
