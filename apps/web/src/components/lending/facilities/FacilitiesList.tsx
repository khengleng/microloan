"use client";

import { useState } from 'react';
import Link from 'next/link';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, SelectInput, Spinner, Table, TextInput, td, tdR, th, thR } from '../ui';
import { qs, useApi } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import type { Paged } from '../types';
import { FACILITY_STATUSES, FACILITY_TYPES, type FacilitySummary } from './types';

const PAGE_SIZE = 50;

export function FacilityTypeLabel({ type }: { type: string }) {
    return <span className="text-[12px] font-semibold text-[#3C4257]">{type.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</span>;
}

export function FacilitiesList() {
    const href = useLendingHref();
    const [status, setStatus] = useState('');
    const [type, setType] = useState('');
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');
    const [page, setPage] = useState(1);
    const { data, error, loading, reload } = useApi<Paged<FacilitySummary>>(`/lending/facilities${qs({ status, type, search: query, page })}`);
    const rows = data?.data ?? [];
    const total = data?.total ?? 0;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return (
        <LendingShell title="Facilities" subtitle="Revolving lines, overdrafts and staged drawdown facilities.">
            <Card
                title="Facilities"
                subtitle={data ? `${total} facilit${total === 1 ? 'y' : 'ies'}` : undefined}
                bodyClass="p-0"
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <SelectInput value={type} onChange={(v) => { setType(v); setPage(1); }} options={FACILITY_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, ' ') }))} placeholder="All types" className="w-44" />
                        <SelectInput value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={FACILITY_STATUSES} placeholder="All statuses" className="w-40" />
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
                    !error && <Empty>No facilities match these filters.</Empty>
                ) : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>Reference</th>
                                <th className={th}>Type</th>
                                <th className={th}>Borrower</th>
                                <th className={th}>Status</th>
                                <th className={thR}>Limit</th>
                                <th className={thR}>Total drawn</th>
                                <th className={thR}>Charges</th>
                                <th className={th}>Available to</th>
                                <th className={th}>Maturity</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {rows.map((f) => (
                                <tr key={f.id} className="hover:bg-[#F7FAFC]">
                                    <td className={td}>
                                        <Link href={href(`/lending/facilities/${f.id}`)} className="font-mono text-[12px] font-semibold text-[#635BFF] hover:underline">{f.reference}</Link>
                                    </td>
                                    <td className={td}><FacilityTypeLabel type={f.facilityType} /></td>
                                    <td className={td}>
                                        <Link href={href(`/borrowers/${f.borrowerId}`)} className="font-mono text-[11px] text-[#635BFF] hover:underline" title={f.borrowerId}>{f.borrowerId.slice(0, 8)}</Link>
                                    </td>
                                    <td className={td}><StatusBadge status={f.status} /></td>
                                    <td className={tdR}><MoneyCell value={f.limitAmount} currency={f.currency} strong /></td>
                                    <td className={tdR}><MoneyCell value={f.totalDrawn} /></td>
                                    <td className={tdR}><MoneyCell value={f.chargesRaised} /></td>
                                    <td className={`${td} whitespace-nowrap`}>{f.availabilityTo ?? '—'}</td>
                                    <td className={`${td} whitespace-nowrap`}>{f.maturityDate ?? '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
                {data && rows.length > 0 && (
                    <p className="px-4 py-2 border-t border-[#E3E8EE] text-[11px] text-[#697386]">
                        Total drawn is everything ever advanced. Outstanding balance and available headroom are computed per facility — open one to see them.
                    </p>
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
