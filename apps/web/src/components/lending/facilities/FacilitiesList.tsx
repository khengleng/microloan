"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, SelectInput, Spinner, Table, TextInput, td, tdR, th, thR } from '../ui';
import { qs, useApi } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import type { Paged } from '../types';
import { FACILITY_STATUSES, FACILITY_TYPES, type FacilitySummary } from './types';

const PAGE_SIZE = 50;

export function FacilityTypeLabel({ type }: { type: string }) {
    const t = useTranslations('LendingFacilities.list');
    const label = t.has(`types.${type}`) ? t(`types.${type}`) : type.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
    return <span className="text-[12px] font-semibold text-[#3C4257]">{label}</span>;
}

export function FacilitiesList() {
    const t = useTranslations('LendingFacilities.list');
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
                title={t('title')}
                subtitle={data ? t('count', { count: total }) : undefined}
                bodyClass="p-0"
                actions={
                    <div className="flex flex-wrap items-center gap-2">
                        <SelectInput value={type} onChange={(v) => { setType(v); setPage(1); }} options={FACILITY_TYPES.map((v) => ({ value: v, label: t(`types.${v}`) }))} placeholder={t('allTypes')} className="w-44" />
                        <SelectInput value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={FACILITY_STATUSES} placeholder={t('allStatuses')} className="w-40" />
                        <TextInput
                            value={search}
                            onChange={setSearch}
                            placeholder={t('searchPlaceholder')}
                            className="w-48"
                            onKeyDown={(e) => { if (e.key === 'Enter') { setQuery(search.trim()); setPage(1); } }}
                        />
                        <Btn onClick={() => { setQuery(search.trim()); setPage(1); }}>{t('search')}</Btn>
                        <Btn variant="ghost" onClick={reload}>{t('refresh')}</Btn>
                    </div>
                }
            >
                {error && <div className="p-4"><ErrorBox error={error} /></div>}
                {loading && !data ? <Spinner /> : rows.length === 0 ? (
                    !error && <Empty>{t('empty')}</Empty>
                ) : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>{t('columns.reference')}</th>
                                <th className={th}>{t('columns.type')}</th>
                                <th className={th}>{t('columns.borrower')}</th>
                                <th className={th}>{t('columns.status')}</th>
                                <th className={thR}>{t('columns.limit')}</th>
                                <th className={thR}>{t('columns.totalDrawn')}</th>
                                <th className={thR}>{t('columns.charges')}</th>
                                <th className={th}>{t('columns.availableTo')}</th>
                                <th className={th}>{t('columns.maturity')}</th>
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
                        {t('footnote')}
                    </p>
                )}
                {pages > 1 && (
                    <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#E3E8EE] text-[12px] text-[#697386]">
                        <Btn size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t('previous')}</Btn>
                        {t('page', { page, pages })}
                        <Btn size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{t('next')}</Btn>
                    </div>
                )}
            </Card>
        </LendingShell>
    );
}
