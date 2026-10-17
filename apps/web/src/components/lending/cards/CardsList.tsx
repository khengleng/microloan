"use client";

import { useState } from 'react';
import Link from 'next/link';
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
    const href = useLendingHref();
    const [status, setStatus] = useState('');
    const [page, setPage] = useState(1);
    const { data, error, loading, reload } = useApi<Paged<CardSummary>>(`/lending/cards${qs({ status, page })}`);
    const rows = data?.data ?? [];
    const total = data?.total ?? 0;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return (
        <LendingShell title="Cards" subtitle="Credit cards: purchases, cash advances and instalment plans on a revolving line.">
            <Card
                title="Cards"
                subtitle={data ? `${total} card${total === 1 ? '' : 's'}` : undefined}
                bodyClass="p-0"
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <SelectInput value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={['ACTIVE', 'BLOCKED', 'CLOSED']} placeholder="All statuses" className="w-40" />
                        <Btn variant="ghost" onClick={reload}>Refresh</Btn>
                    </div>
                }
            >
                {error && <div className="p-4"><ErrorBox error={error} /></div>}
                {loading && !data ? <Spinner /> : rows.length === 0 ? (
                    !error && <Empty>No cards yet. Book an application on a credit-card product to issue one.</Empty>
                ) : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>Card</th>
                                <th className={th}>Number</th>
                                <th className={th}>Line</th>
                                <th className={th}>Status</th>
                                <th className={thR}>Limit</th>
                                <th className={thR}>Purchases</th>
                                <th className={thR}>Cash advances</th>
                                <th className={thR}>Plans</th>
                                <th className={th}>Stated to</th>
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
                        <Btn size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Btn>
                        Page {page} of {pages}
                        <Btn size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Btn>
                    </div>
                )}
            </Card>
        </LendingShell>
    );
}
