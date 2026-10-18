"use client";

import { useState } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, SelectInput, Spinner, Table, TextInput, td, tdR, th, thR } from '../ui';
import { qs, useApi } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import type { LoanSummary, Paged } from '../types';

export const LOAN_STATUSES = ['BOOKED', 'ACTIVE', 'CLOSED', 'WRITTEN_OFF'];
const PAGE_SIZE = 50;

export function RestructuredBadge() {
    return <span className="inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold tracking-wide bg-amber-50 text-amber-800 border-amber-200">RESTRUCTURED</span>;
}

export function LoansList() {
    const href = useLendingHref();
    const [status, setStatus] = useState('');
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');
    const [page, setPage] = useState(1);
    const { data, error, loading, reload } = useApi<Paged<LoanSummary>>(`/lending/loans${qs({ status, search: query, page })}`);
    const rows = data?.data ?? [];
    const total = data?.total ?? 0;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return (
        <LendingShell
            title="Loans"
            subtitle="Booked loan accounts with live sub-ledger balances."
            actions={
                <a href="/api/proxy/lending/loans/export.csv" className="inline-flex items-center gap-1.5 rounded font-semibold shadow-sm text-[13px] px-3.5 py-1.5 bg-white hover:bg-slate-50 text-[#3C4257] border border-[#E3E8EE]">
                    <Download size={14} /> Export CSV
                </a>
            }
        >
            <Card
                title="Loan accounts"
                subtitle={data ? `${total} account${total === 1 ? '' : 's'}` : undefined}
                bodyClass="p-0"
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <SelectInput data-tour="loan-list-status-filter" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={LOAN_STATUSES} placeholder="All statuses" className="w-40" />
                        <TextInput
                            value={search}
                            onChange={setSearch}
                            placeholder="Search reference…"
                            className="w-48"
                            onKeyDown={(e) => { if (e.key === 'Enter') { setQuery(search.trim()); setPage(1); } }}
                        />
                        <Btn onClick={() => { setQuery(search.trim()); setPage(1); }}>Search</Btn>
                        <Btn variant="ghost" onClick={reload}>Refresh</Btn>
                    </div>
                }
            >
                {error && <div className="p-4"><ErrorBox error={error} /></div>}
                {loading && !data ? <Spinner /> : rows.length === 0 ? (
                    !error && <Empty>No loan accounts match these filters.</Empty>
                ) : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>Reference</th>
                                <th className={th}>Status</th>
                                <th className={thR}>Booked</th>
                                <th className={thR}>Principal o/s</th>
                                <th className={thR}>Interest</th>
                                <th className={thR}>Fees</th>
                                <th className={thR}>Penalty</th>
                                <th className={thR}>DPD</th>
                                <th className={th}>Bucket / stage</th>
                                <th className={th}>Maturity</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {rows.map((l) => (
                                <tr key={l.id} className="hover:bg-[#F7FAFC]">
                                    <td className={td}>
                                        <div className="flex items-center gap-1.5">
                                            <Link data-tour="loan-list-row-link" href={href(`/lending/loans/${l.id}`)} className="font-mono text-[12px] font-semibold text-[#635BFF] hover:underline">{l.reference}</Link>
                                            {l.isRestructured && <RestructuredBadge />}
                                        </div>
                                    </td>
                                    <td className={td}><StatusBadge status={l.status} /></td>
                                    <td className={tdR}><MoneyCell value={l.bookedPrincipal} currency={l.currency} /></td>
                                    <td className={tdR}><MoneyCell value={l.principalOutstanding} strong /></td>
                                    <td className={tdR}><MoneyCell value={l.interestReceivable} /></td>
                                    <td className={tdR}><MoneyCell value={l.feesReceivable} /></td>
                                    <td className={tdR}><MoneyCell value={l.penaltyReceivable} highlightNonZero /></td>
                                    <td className={`${tdR} ${l.daysPastDue > 0 ? 'text-red-600 font-semibold' : ''}`}>{l.daysPastDue}</td>
                                    <td className={td}>
                                        <StatusBadge status={l.delinquencyBucket} />
                                        {l.collectionStage && <div className="text-[11px] text-[#697386] mt-0.5">{l.collectionStage}</div>}
                                    </td>
                                    <td className={`${td} whitespace-nowrap`}>{l.maturityDate?.slice(0, 10) ?? '—'}</td>
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
