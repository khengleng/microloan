"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { LendingShell, useLendingHref } from '@/components/lending/LendingShell';
import { StatusBadge } from '@/components/lending/StatusBadge';
import { MoneyCell } from '@/components/lending/MoneyCell';
import { fmtDateTime } from '@/components/lending/format';
import type { RestructureCase } from '@/components/lending/types';
import { Btn, Card, Disclosure, Empty, ErrorBox, JsonBlock, KV, Notice, Spinner, Table, Tabs, td, th } from '@/components/lending/ui';
import { useApi } from '@/components/lending/useAsync';
import { CaseStepper } from '@/components/lending/restructure/CaseStepper';
import { EvidencePanel } from '@/components/lending/restructure/EvidencePanel';
import { AffordabilityForm } from '@/components/lending/restructure/AffordabilityForm';
import { AffordabilityResult, SpecialistBanner } from '@/components/lending/restructure/AffordabilityResult';
import { CompareOptions } from '@/components/lending/restructure/CompareOptions';
import { ProposalCard } from '@/components/lending/restructure/ProposalCard';
import { CaseActions, ConditionsPanel } from '@/components/lending/restructure/CaseActions';
import { DIFFICULTY_TYPES, HARDSHIP_CATEGORIES, labelOf } from '@/components/lending/restructure/labels';

type Tab = 'overview' | 'affordability' | 'options' | 'proposals' | 'monitoring';

/** Statuses during which staff can still assess, simulate and propose. */
const WORKING = ['REQUESTED', 'MORE_INFO_REQUIRED', 'AFFORDABILITY_ASSESSED', 'SPECIALIST_REVIEW', 'OPTIONS_PROPOSED'];

/** Best guess of how far a terminated case progressed, for the stepper. */
function lastActive(c: RestructureCase): string {
    if ((c.amendments ?? []).length) return 'MONITORING';
    const st = (c.proposals ?? []).map((p) => p.status);
    if (st.includes('ACCEPTED') || st.includes('EXECUTED')) return 'CUSTOMER_ACCEPTED';
    if (st.includes('APPROVED')) return 'APPROVED';
    if (st.length) return 'OPTIONS_PROPOSED';
    if ((c.assessments ?? []).length) return 'AFFORDABILITY_ASSESSED';
    return 'REQUESTED';
}

export default function RestructureCasePage() {
    const { id } = useParams<{ id: string }>();
    const href = useLendingHref();
    const { data: c, error, loading, reload } = useApi<RestructureCase>(id ? `/lending/restructures/${id}` : null);
    const [tab, setTab] = useState<Tab>('overview');
    const [assessing, setAssessing] = useState(false);

    if (loading && !c) return <LendingShell title="Restructure case" back={{ href: '/lending/restructures', label: 'Restructures' }}><Spinner /></LendingShell>;
    if (!c) return <LendingShell title="Restructure case" back={{ href: '/lending/restructures', label: 'Restructures' }}><ErrorBox error={error ?? { message: 'Case not found' }} /></LendingShell>;

    const working = WORKING.includes(c.status);
    const assessments = c.assessments ?? [];
    const latest = assessments[assessments.length - 1];
    const specialist = c.status === 'SPECIALIST_REVIEW' || (c as { specialistReview?: boolean }).specialistReview || latest?.result?.specialistReview;
    const proposals = [...(c.proposals ?? [])].sort((a, b) => b.version - a.version);
    const relief = c.requestedRelief ?? {};
    const outstanding = (c.conditions ?? []).filter((x) => x.status === 'OUTSTANDING').length;
    const openTasks = (c.tasks ?? []).filter((t) => t.status === 'OPEN').length;

    const tabs: { value: Tab; label: string }[] = [
        { value: 'overview', label: 'Overview & evidence' },
        { value: 'affordability', label: `Affordability (${assessments.length})` },
        { value: 'options', label: 'Options simulator' },
        { value: 'proposals', label: `Proposals (${proposals.length})` },
        { value: 'monitoring', label: `Conditions & monitoring${outstanding + openTasks ? ` (${outstanding + openTasks})` : ''}` },
    ];

    return (
        <LendingShell
            title={<span className="flex items-center gap-3">Case <span className="font-mono">{c.reference}</span> <StatusBadge status={c.status} /></span>}
            subtitle={<>Loan <Link href={href(`/lending/loans/${c.loanAccountId}`)} className="font-mono text-[#635BFF] hover:underline">{c.loanAccountId}</Link></>}
            back={{ href: '/lending/restructures', label: 'Restructures' }}
            actions={<Btn onClick={reload} busy={loading}>Refresh</Btn>}
        >
            {error && <ErrorBox error={error} />}
            <Card><CaseStepper status={c.status} lastActiveStatus={lastActive(c)} /></Card>
            {specialist && <SpecialistBanner />}
            {c.status === 'MORE_INFO_REQUIRED' && <Notice tone="warn" title="More information required">Waiting for the customer to provide more information before assessment can continue.</Notice>}
            {c.previousRestructures > 0 && (
                <Notice tone="warn" title={`Repeat restructure (${c.previousRestructures} previous)`}>This loan has been restructured before. Repeated restructuring may indicate the problem is not temporary.</Notice>
            )}

            <Tabs tabs={tabs} value={tab} onChange={setTab} />

            {tab === 'overview' && (
                <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5 items-start">
                    <div className="space-y-5">
                        <Card title="Request">
                            <div className="space-y-4">
                                <KV cols={3} items={[
                                    ['Trigger', c.trigger.replace(/_/g, ' ')],
                                    ['Hardship', labelOf(HARDSHIP_CATEGORIES, c.hardshipCategory)],
                                    ['Difficulty', labelOf(DIFFICULTY_TYPES, c.difficultyType)],
                                    ['Expected recovery', c.expectedRecoveryDate ?? '—'],
                                    ['Consent', c.consentRecorded ? <span key="c" className="text-emerald-700 font-semibold">Recorded{c.consentReference ? ` · ${c.consentReference}` : ''}</span> : <span key="c" className="text-amber-700">Not recorded</span>],
                                    ['Opened', fmtDateTime(c.createdAt)],
                                ]} />
                                <div>
                                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">Customer statement</p>
                                    <p className="text-[13px] text-[#1A1F36] mt-0.5 whitespace-pre-wrap">{c.customerStatement || '—'}</p>
                                </div>
                                <div>
                                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-1">Relief requested</p>
                                    <KV cols={4} items={[
                                        ['Lower instalment', relief.lowerInstalment ? <MoneyCell key="l" value={relief.lowerInstalment} /> : '—'],
                                        ['Longer term', relief.longerTermMonths ? `${relief.longerTermMonths} months` : '—'],
                                        ['Payment break', relief.paymentBreakMonths ? `${relief.paymentBreakMonths} months` : '—'],
                                        ['Note', relief.note || '—'],
                                    ]} />
                                </div>
                            </div>
                        </Card>
                        <EvidencePanel caseId={c.id} evidence={c.evidence ?? []} editable={working} onChanged={reload} />
                    </div>
                    <CaseActions c={c} onChanged={reload} />
                </div>
            )}

            {tab === 'affordability' && (
                <div className="space-y-5">
                    {working && (
                        <Card
                            title="New affordability assessment"
                            subtitle="Assessments are immutable. Record a new one when figures change."
                            actions={<Btn size="sm" onClick={() => setAssessing((a) => !a)}>{assessing ? 'Hide form' : 'Start assessment'}</Btn>}
                        >
                            {assessing ? (
                                <AffordabilityForm caseId={c.id} onDone={() => { setAssessing(false); reload(); }} />
                            ) : <p className="text-[12px] text-[#697386]">Choose Individual, Household, Business or Seasonal to capture income, expenses and debts.</p>}
                        </Card>
                    )}
                    {assessments.length === 0 ? <Card><Empty>No affordability assessment yet.</Empty></Card> : (
                        [...assessments].reverse().map((a, i) => (
                            <Card key={a.id} title={`${i === 0 ? 'Latest assessment' : 'Earlier assessment'} · ${a.template}`} subtitle={a.createdAt ? fmtDateTime(a.createdAt) : undefined}>
                                <AffordabilityResult assessment={a} />
                            </Card>
                        ))
                    )}
                </div>
            )}

            {tab === 'options' && (
                <div className="space-y-4">
                    {!working && <Notice tone="info">This case is {c.status.replace(/_/g, ' ')}; you can still simulate, but new proposals are not accepted.</Notice>}
                    {working && !latest && <Notice tone="warn">No affordability assessment yet — simulations cannot say whether an option fits the customer&apos;s budget.</Notice>}
                    <CompareOptions caseId={c.id} canPropose={working} onProposed={() => { reload(); setTab('proposals'); }} />
                </div>
            )}

            {tab === 'proposals' && (
                <div className="space-y-5">
                    {proposals.length === 0 ? <Card><Empty>No proposals yet. Use the options simulator to create one.</Empty></Card> : (
                        proposals.map((p, i) => <ProposalCard key={p.id} caseId={c.id} proposal={p} onChanged={reload} defaultOpen={i === 0} />)
                    )}
                    <CaseActions c={c} onChanged={reload} />
                </div>
            )}

            {tab === 'monitoring' && (
                <div className="space-y-5">
                    <ConditionsPanel c={c} onChanged={reload} />
                    <Card title="Monitoring tasks" bodyClass="p-0">
                        {(c.tasks ?? []).length === 0 ? <Empty>No tasks.</Empty> : (
                            <Table>
                                <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Type</th><th className={th}>Due</th><th className={th}>Status</th><th className={th}>Detail</th></tr></thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {c.tasks.map((t) => (
                                        <tr key={t.id}>
                                            <td className={`${td} font-semibold`}>{t.type.replace(/_/g, ' ')}</td>
                                            <td className={`${td} whitespace-nowrap`}>{t.dueDate}</td>
                                            <td className={td}><StatusBadge status={t.status} /></td>
                                            <td className={`${td} font-mono text-[11px] break-all`}>{t.detail ? JSON.stringify(t.detail) : '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Card>
                    <Card title="Loan amendments" subtitle="Executed changes to the loan agreement." bodyClass="p-0">
                        {(c.amendments ?? []).length === 0 ? <Empty>Nothing executed yet.</Empty> : (
                            <div className="divide-y divide-[#F0F2F5]">
                                {c.amendments.map((a) => {
                                    const x = a as typeof a & { fromAgreementVersion?: number; toAgreementVersion?: number; financialEventId?: string; reversalEventId?: string | null; executedBy?: string };
                                    return (
                                        <div key={x.id} className="px-5 py-3 space-y-2">
                                            <KV cols={4} items={[
                                                ['Status', <StatusBadge key="s" status={x.status ?? 'EXECUTED'} />],
                                                ['Agreement version', x.fromAgreementVersion !== undefined ? `v${x.fromAgreementVersion} → v${x.toAgreementVersion}` : x.agreementVersion ?? '—'],
                                                ['Effective', String(x.effectiveDate ?? '').slice(0, 10) || '—'],
                                                ['Executed', `${fmtDateTime(x.createdAt)}${x.executedBy ? ` · ${x.executedBy}` : ''}`],
                                                ['Financial event', x.financialEventId ? <span key="f" className="font-mono text-[11px]">{x.financialEventId}</span> : '—'],
                                                ['Reversal event', x.reversalEventId ? <span key="r" className="font-mono text-[11px]">{x.reversalEventId}</span> : '—'],
                                            ]} />
                                            <Disclosure summary="Raw amendment"><JsonBlock value={x} /></Disclosure>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </Card>
                </div>
            )}
        </LendingShell>
    );
}
