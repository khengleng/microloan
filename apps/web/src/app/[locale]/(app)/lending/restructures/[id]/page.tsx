"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { LendingShell, useLendingHref } from '@/components/lending/LendingShell';
import { StatusBadge } from '@/components/lending/StatusBadge';
import { MoneyCell } from '@/components/lending/MoneyCell';
import { fmtDateTime } from '@/components/lending/format';
import { Person } from '@/components/lending/People';
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
import { DIFFICULTY_TYPES, HARDSHIP_CATEGORIES, useRestructureLabels } from '@/components/lending/restructure/labels';

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
    const t = useTranslations('LendingRestructure');
    const tn = useTranslations('Workspace.nav');
    const L = useRestructureLabels();
    const { id } = useParams<{ id: string }>();
    const href = useLendingHref();
    const { data: c, error, loading, reload } = useApi<RestructureCase>(id ? `/lending/restructures/${id}` : null);
    const [tab, setTab] = useState<Tab>('overview');
    const [assessing, setAssessing] = useState(false);

    if (loading && !c) return <LendingShell title={t('detail.pageTitle')} back={{ href: '/lending/restructures', label: tn('restructures') }}><Spinner /></LendingShell>;
    if (!c) return <LendingShell title={t('detail.pageTitle')} back={{ href: '/lending/restructures', label: tn('restructures') }}><ErrorBox error={error ?? { message: t('detail.notFound') }} /></LendingShell>;

    const working = WORKING.includes(c.status);
    const assessments = c.assessments ?? [];
    const latest = assessments[assessments.length - 1];
    const specialist = c.status === 'SPECIALIST_REVIEW' || (c as { specialistReview?: boolean }).specialistReview || latest?.result?.specialistReview;
    const proposals = [...(c.proposals ?? [])].sort((a, b) => b.version - a.version);
    const relief = c.requestedRelief ?? {};
    const outstanding = (c.conditions ?? []).filter((x) => x.status === 'OUTSTANDING').length;
    const openTasks = (c.tasks ?? []).filter((t) => t.status === 'OPEN').length;

    const tabs: { value: Tab; label: string }[] = [
        { value: 'overview', label: t('detail.tabs.overview') },
        { value: 'affordability', label: t('detail.tabs.affordability', { count: assessments.length }) },
        { value: 'options', label: t('detail.tabs.options') },
        { value: 'proposals', label: t('detail.tabs.proposals', { count: proposals.length }) },
        { value: 'monitoring', label: outstanding + openTasks ? t('detail.tabs.monitoringCount', { count: outstanding + openTasks }) : t('detail.tabs.monitoring') },
    ];

    return (
        <LendingShell
            title={<span className="flex items-center gap-3">{t.rich('detail.title', { reference: c.reference, ref: (ch) => <span className="font-mono">{ch}</span>, badge: () => <StatusBadge status={c.status} /> })}</span>}
            subtitle={<>{t.rich('detail.subtitle', { id: c.loanAccountId, link: (ch) => <Link href={href(`/lending/loans/${c.loanAccountId}`)} className="font-mono text-[#635BFF] hover:underline">{ch}</Link> })}</>}
            back={{ href: '/lending/restructures', label: tn('restructures') }}
            actions={<Btn onClick={reload} busy={loading}>{t('detail.refresh')}</Btn>}
        >
            {error && <ErrorBox error={error} />}
            <Card><CaseStepper status={c.status} lastActiveStatus={lastActive(c)} /></Card>
            {specialist && <SpecialistBanner />}
            {c.status === 'MORE_INFO_REQUIRED' && <Notice tone="warn" title={t('detail.moreInfoTitle')}>{t('detail.moreInfoBody')}</Notice>}
            {c.previousRestructures > 0 && (
                <Notice tone="warn" title={t('detail.repeatTitle', { count: c.previousRestructures })}>{t('detail.repeatBody')}</Notice>
            )}

            <Tabs tabs={tabs} value={tab} onChange={setTab} />

            {tab === 'overview' && (
                <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5 items-start">
                    <div className="space-y-5">
                        <Card title={t('detail.request')}>
                            <div className="space-y-4">
                                <KV cols={3} items={[
                                    [t('common.trigger'), L.label('trigger', c.trigger)],
                                    [t('common.hardship'), L.label('hardship', c.hardshipCategory, HARDSHIP_CATEGORIES)],
                                    [t('common.difficulty'), L.label('difficulty', c.difficultyType, DIFFICULTY_TYPES)],
                                    [t('detail.expectedRecovery'), c.expectedRecoveryDate ?? '—'],
                                    [t('detail.consent'), c.consentRecorded ? <span key="c" className="text-emerald-700 font-semibold">{t('common.recorded')}{c.consentReference ? ` · ${c.consentReference}` : ''}</span> : <span key="c" className="text-amber-700">{t('detail.notRecorded')}</span>],
                                    [t('common.opened'), fmtDateTime(c.createdAt)],
                                ]} />
                                <div>
                                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">{t('common.customerStatement')}</p>
                                    <p className="text-[13px] text-[#1A1F36] mt-0.5 whitespace-pre-wrap">{c.customerStatement || '—'}</p>
                                </div>
                                <div>
                                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2] mb-1">{t('detail.reliefRequested')}</p>
                                    <KV cols={4} items={[
                                        [t('detail.lowerInstalment'), relief.lowerInstalment ? <MoneyCell key="l" value={relief.lowerInstalment} /> : '—'],
                                        [t('detail.longerTerm'), relief.longerTermMonths ? t('common.months', { count: relief.longerTermMonths }) : '—'],
                                        [t('detail.paymentBreak'), relief.paymentBreakMonths ? t('common.months', { count: relief.paymentBreakMonths }) : '—'],
                                        [t('common.note'), relief.note || '—'],
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
                            title={t('detail.newAssessmentTitle')}
                            subtitle={t('detail.newAssessmentSubtitle')}
                            actions={<Btn size="sm" onClick={() => setAssessing((a) => !a)}>{assessing ? t('detail.hideForm') : t('detail.startAssessment')}</Btn>}
                        >
                            {assessing ? (
                                <AffordabilityForm caseId={c.id} onDone={() => { setAssessing(false); reload(); }} />
                            ) : <p className="text-[12px] text-[#697386]">{t('detail.assessmentHint')}</p>}
                        </Card>
                    )}
                    {assessments.length === 0 ? <Card><Empty>{t('detail.noAssessment')}</Empty></Card> : (
                        [...assessments].reverse().map((a, i) => (
                            <Card key={a.id} title={t(i === 0 ? 'detail.latestAssessment' : 'detail.earlierAssessment', { template: L.label('template', a.template) })} subtitle={a.createdAt ? fmtDateTime(a.createdAt) : undefined}>
                                <AffordabilityResult assessment={a} />
                            </Card>
                        ))
                    )}
                </div>
            )}

            {tab === 'options' && (
                <div className="space-y-4">
                    {!working && <Notice tone="info">{t('detail.notWorking', { status: L.status(c.status) })}</Notice>}
                    {working && !latest && <Notice tone="warn">{t('detail.noAssessmentWarn')}</Notice>}
                    <CompareOptions caseId={c.id} canPropose={working} onProposed={() => { reload(); setTab('proposals'); }} />
                </div>
            )}

            {tab === 'proposals' && (
                <div className="space-y-5">
                    {proposals.length === 0 ? <Card><Empty>{t('detail.noProposals')}</Empty></Card> : (
                        proposals.map((p, i) => <ProposalCard key={p.id} caseId={c.id} proposal={p} onChanged={reload} defaultOpen={i === 0} />)
                    )}
                    <CaseActions c={c} onChanged={reload} />
                </div>
            )}

            {tab === 'monitoring' && (
                <div className="space-y-5">
                    <ConditionsPanel c={c} onChanged={reload} />
                    <Card title={t('detail.monitoringTasks')} bodyClass="p-0">
                        {(c.tasks ?? []).length === 0 ? <Empty>{t('detail.noTasks')}</Empty> : (
                            <Table>
                                <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('common.type')}</th><th className={th}>{t('common.due')}</th><th className={th}>{t('common.status')}</th><th className={th}>{t('common.detail')}</th></tr></thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {c.tasks.map((task) => (
                                        <tr key={task.id}>
                                            <td className={`${td} font-semibold`}>{L.label('taskType', task.type)}</td>
                                            <td className={`${td} whitespace-nowrap`}>{task.dueDate}</td>
                                            <td className={td}><StatusBadge status={task.status} /></td>
                                            <td className={`${td} font-mono text-[11px] break-all`}>{task.detail ? JSON.stringify(task.detail) : '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Card>
                    <Card title={t('detail.amendmentsTitle')} subtitle={t('detail.amendmentsSubtitle')} bodyClass="p-0">
                        {(c.amendments ?? []).length === 0 ? <Empty>{t('detail.nothingExecuted')}</Empty> : (
                            <div className="divide-y divide-[#F0F2F5]">
                                {c.amendments.map((a) => {
                                    const x = a as typeof a & { fromAgreementVersion?: number; toAgreementVersion?: number; financialEventId?: string; reversalEventId?: string | null; executedBy?: string };
                                    return (
                                        <div key={x.id} className="px-5 py-3 space-y-2">
                                            <KV cols={4} items={[
                                                [t('common.status'), <StatusBadge key="s" status={x.status ?? 'EXECUTED'} />],
                                                [t('detail.agreementVersion'), x.fromAgreementVersion !== undefined ? `v${x.fromAgreementVersion} → v${x.toAgreementVersion}` : x.agreementVersion ?? '—'],
                                                [t('detail.effective'), String(x.effectiveDate ?? '').slice(0, 10) || '—'],
                                                [t('detail.executed'), <span key="ex">{fmtDateTime(x.createdAt)}{x.executedBy ? <> · <Person id={x.executedBy} /></> : null}</span>],
                                                [t('detail.financialEvent'), x.financialEventId ? <span key="f" className="font-mono text-[11px]">{x.financialEventId}</span> : '—'],
                                                [t('detail.reversalEvent'), x.reversalEventId ? <span key="r" className="font-mono text-[11px]">{x.reversalEventId}</span> : '—'],
                                            ]} />
                                            <Disclosure summary={t('detail.rawAmendment')}><JsonBlock value={x} /></Disclosure>
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
