"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, SelectInput, Spinner, Table, TextInput, td, tdR, th, thR } from '../ui';
import { qs, useApi } from '../useAsync';
import { fmtDateTime, fullName } from '../format';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import type { ApplicationSummary, Paged } from '../types';
import { NewApplicationForm } from './NewApplicationForm';

export const APPLICATION_STATUSES = ['DRAFT', 'SUBMITTED', 'RECOMMENDED', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'BOOKED'];
const PAGE_SIZE = 50;

export function ApplicationsList() {
    const href = useLendingHref();
    const router = useRouter();
    const [status, setStatus] = useState('');
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');
    const [page, setPage] = useState(1);
    const [creating, setCreating] = useState(false);

    const { data, error, loading, reload } = useApi<Paged<ApplicationSummary>>(`/lending/applications${qs({ status, search: query, page })}`);
    const rows = data?.data ?? [];
    const total = data?.total ?? 0;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    return (
        <LendingShell
            title="Applications"
            subtitle="Origination pipeline: draft → submitted → recommended → approved → booked."
            actions={<Btn variant="primary" onClick={() => setCreating(true)} disabled={creating}>New application</Btn>}
        >
            {creating && (
                <NewApplicationForm
                    onClose={() => setCreating(false)}
                    onCreated={(id) => router.push(href(`/lending/applications/${id}`))}
                />
            )}
            <Card
                title="Applications"
                subtitle={data ? `${total} application${total === 1 ? '' : 's'}` : undefined}
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <SelectInput
                            value={status}
                            onChange={(v) => { setStatus(v); setPage(1); }}
                            options={APPLICATION_STATUSES}
                            placeholder="All statuses"
                            className="w-40"
                        />
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
                bodyClass="p-0"
            >
                {error && <div className="p-4"><ErrorBox error={error} /></div>}
                {loading && !data ? <Spinner /> : rows.length === 0 ? (
                    !error && <Empty>No applications match these filters.</Empty>
                ) : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>Reference</th>
                                <th className={th}>Borrower</th>
                                <th className={th}>Status</th>
                                <th className={thR}>Requested</th>
                                <th className={th}>Created</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {rows.map((a) => (
                                <tr key={a.id} className="hover:bg-[#F7FAFC]">
                                    <td className={td}>
                                        <Link href={href(`/lending/applications/${a.id}`)} className="font-mono text-[12px] font-semibold text-[#635BFF] hover:underline">{a.reference}</Link>
                                    </td>
                                    <td className={td}>{fullName(a.borrower)}</td>
                                    <td className={td}><StatusBadge status={a.status} /></td>
                                    <td className={tdR}><MoneyCell value={a.requestedAmount} currency={a.currency} /></td>
                                    <td className={`${td} whitespace-nowrap`}>{fmtDateTime(a.createdAt)}</td>
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
