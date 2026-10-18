"use client";

import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { LendingShell } from '@/components/lending/LendingShell';
import { Btn, Card, Empty, ErrorBox, Field, JsonBlock, SelectInput, Spinner, Table, TextInput, th, td } from '@/components/lending/ui';
import { StatusBadge } from '@/components/lending/StatusBadge';
import { DecisionExplain } from '@/components/lending/DecisionExplain';
import { Pager } from '@/components/lending/Pager';
import { qs, useApi } from '@/components/lending/useAsync';
import { fmtDateTime } from '@/components/lending/format';
import type { AuditRecord, Paged } from '@/components/lending/types';

const RESOURCE_TYPES = [
    'Application', 'LoanAccount', 'ProductVersion', 'RestructureCase', 'WorkflowVersion', 'PolicyVersion', 'AccessRole', 'RoleAssignment',
    'Delegation', 'ApprovalAuthority', 'FlagRule', 'PlatformFlagRule', 'Cohort', 'ServiceAccount', 'HolidayCalendar', 'RateObservation',
    'AffordabilityPolicy', 'Tenant',
];
const OUTCOMES = ['SUCCESS', 'FAILURE', 'ALLOW', 'DENY'];

const EMPTY = { resourceType: '', resourceId: '', action: '', outcome: '' };

function AuditDetail({ r }: { r: AuditRecord }) {
    return (
        <div data-tour="audit-event-detail" className="space-y-3">
            {r.decision?.checks && r.decision.checks.length > 0 && (
                <div data-tour="audit-event-decision">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-1">Policy decision</p>
                    <DecisionExplain checks={r.decision.checks} />
                </div>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div data-tour="audit-event-details">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-1">Details</p>
                    <JsonBlock value={r.details} />
                </div>
                <div data-tour="audit-event-config">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-1">Configuration versions in force</p>
                    <JsonBlock value={r.configVersions} />
                </div>
            </div>
            <p className="text-[11px] text-[#697386] font-mono">event {r.id} · actor {r.actorType} {r.actorId ?? '—'} · business date {r.businessDate ?? '—'}</p>
        </div>
    );
}

export default function LendingAuditPage() {
    const [filters, setFilters] = useState(EMPTY);
    const [applied, setApplied] = useState(EMPTY);
    const [page, setPage] = useState(1);
    const [open, setOpen] = useState<Record<string, boolean>>({});
    const { data, error, loading, reload } = useApi<Paged<AuditRecord>>(`/lending/ops/audit${qs({ ...applied, page })}`);
    const set = (k: keyof typeof EMPTY) => (v: string) => setFilters((f) => ({ ...f, [k]: v }));

    return (
        <LendingShell title="Audit explorer" subtitle="Every lending action and policy decision, with the configuration versions in force at the time.">
            <Card>
                <form className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end" onSubmit={(e) => { e.preventDefault(); setApplied(filters); setPage(1); }}>
                    <Field label="Resource type"><SelectInput data-tour="audit-filter-resource-type" value={filters.resourceType} onChange={set('resourceType')} options={RESOURCE_TYPES} placeholder="Any" /></Field>
                    <Field label="Resource id"><TextInput data-tour="audit-filter-resource-id" value={filters.resourceId} onChange={(v) => set('resourceId')(v.trim())} placeholder="uuid" /></Field>
                    <Field label="Action contains"><TextInput data-tour="audit-filter-action" value={filters.action} onChange={set('action')} placeholder="e.g. loan.repayment" /></Field>
                    <Field label="Outcome"><SelectInput data-tour="audit-filter-outcome" value={filters.outcome} onChange={set('outcome')} options={OUTCOMES} placeholder="Any" /></Field>
                    <div className="flex gap-2">
                        <Btn data-tour="audit-search" variant="primary" type="submit">Search</Btn>
                        <Btn onClick={() => { setFilters(EMPTY); setApplied(EMPTY); setPage(1); }}>Reset</Btn>
                        <Btn variant="ghost" onClick={reload}>↻</Btn>
                    </div>
                </form>
            </Card>

            {error && <ErrorBox error={error} />}
            {loading && !data ? <Spinner /> : data && (
                <Card bodyClass="p-0">
                    {data.data.length === 0 ? <Empty>No audit events match.</Empty> : (
                        <Table>
                            <thead>
                                <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                    <th className={th}></th><th className={th}>Time</th><th className={th}>Action</th><th className={th}>Resource</th><th className={th}>Actor</th><th className={th}>Outcome</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                {data.data.map((r) => {
                                    const isOpen = !!open[r.id];
                                    const denied = r.outcome === 'DENY' || r.outcome === 'FAILURE';
                                    return (
                                        <Fragment key={r.id}>
                                            <tr data-tour="audit-event-row" className={`cursor-pointer ${denied ? 'bg-red-50/70 hover:bg-red-50' : 'hover:bg-[#F7FAFC]'}`} onClick={() => setOpen((o) => ({ ...o, [r.id]: !o[r.id] }))}>
                                                <td className={td}>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                                                <td className={`${td} whitespace-nowrap text-[12px]`}>{fmtDateTime(r.eventTime)}</td>
                                                <td className={`${td} font-mono text-[12px]`}>{r.action}</td>
                                                <td className={td}><span className="text-[12px]">{r.resourceType}</span> <span className="font-mono text-[10px] text-[#8792A2]">{r.resourceId?.slice(0, 8) ?? ''}</span></td>
                                                <td className={`${td} text-[12px]`}>{r.actorType} <span className="font-mono text-[10px] text-[#8792A2]">{r.actorId?.slice(0, 8) ?? ''}</span></td>
                                                <td className={td}><StatusBadge status={r.outcome} /></td>
                                            </tr>
                                            {isOpen && (
                                                <tr className={denied ? 'bg-red-50/30' : ''}>
                                                    <td></td>
                                                    <td colSpan={5} className="px-3 pb-4"><AuditDetail r={r} /></td>
                                                </tr>
                                            )}
                                        </Fragment>
                                    );
                                })}
                            </tbody>
                        </Table>
                    )}
                    <div className="p-3 border-t border-[#E3E8EE]"><Pager page={page} total={data.total} pageSize={100} onPage={setPage} /></div>
                </Card>
            )}
        </LendingShell>
    );
}
