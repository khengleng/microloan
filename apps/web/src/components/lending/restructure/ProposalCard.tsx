"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import type { RestructureProposal } from '../types';
import { StatusBadge } from '../StatusBadge';
import { fmtDateTime } from '../format';
import { Person } from '../People';
import { ActionPanel, Btn, Card, Disclosure, ErrorBox, Field, KV, SelectInput, TextArea, TextInput } from '../ui';
import { clean, useAction } from '../useAsync';
import { AcceptanceTimeline } from './AcceptanceTimeline';
import { ApprovalTimeline } from './ApprovalTimeline';
import { SimulationView, WarningsView, ComparisonTable } from './SimulationView';
import { shortHash, useRestructureLabels } from './labels';
import { useBusinessDate } from '../useBusinessDate';

/** One proposal version: terms, approval and acceptance timelines, and its actions. */
export function ProposalCard({ caseId, proposal: p, onChanged, defaultOpen }: {
    caseId: string; proposal: RestructureProposal; onChanged: () => void; defaultOpen?: boolean;
}) {
    const t = useTranslations('LendingRestructure');
    const L = useRestructureLabels();
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const [panel, setPanel] = useState<'none' | 'approve' | 'accept'>('none');
    const [note, setNote] = useState('');
    const [method, setMethod] = useState('SIGNED_FORM');
    const [evidence, setEvidence] = useState('');
    // Expiry is a business date, as the API measures it: expired once the business date is past it.
    const businessDate = useBusinessDate();

    const approvals = p.approvals ?? [];
    const acceptances = p.acceptances ?? [];
    const approvedCount = approvals.filter((a) => (a.decision ?? 'APPROVE') === 'APPROVE').length;
    const expiresOn = p.expiresAt ? p.expiresAt.slice(0, 10) : null;
    const expired = !!expiresOn && expiresOn < businessDate;
    const canApprove = p.status === 'PROPOSED' && !expired;
    const canAccept = p.status === 'APPROVED' && !expired;
    const exceptions = p.policyExceptions ?? [];

    const approve = async () => {
        const res = await run('approve', () => api.post(`/lending/restructures/${caseId}/proposals/${p.id}/approve`, { note: note.trim() }));
        if (res) { showToast(t('proposal.toastApproved', { version: p.version }), 'success'); setNote(''); setPanel('none'); onChanged(); }
    };
    const accept = async () => {
        const body = clean({ proposalHash: p.proposalHash, method, evidence: evidence.trim() });
        const res = await run('accept', () => api.post(`/lending/restructures/${caseId}/proposals/${p.id}/acceptance`, body));
        if (res) { showToast(t('proposal.toastAccepted', { version: p.version }), 'success'); setEvidence(''); setPanel('none'); onChanged(); }
    };

    return (
        <Card
            title={<span className="flex items-center gap-2">{t('proposal.title', { version: p.version })} <StatusBadge status={p.status} />{expired && p.status !== 'EXECUTED' && <StatusBadge status="EXPIRED" />}</span>}
            subtitle={<span>{t.rich('proposal.subtitle', { date: p.effectiveDate, hash: shortHash(p.proposalHash), h: (c) => <span className="font-mono">{c}</span> })}</span>}
            actions={
                <>
                    {canApprove && <Btn size="sm" variant="primary" onClick={() => setPanel(panel === 'approve' ? 'none' : 'approve')}>{t('proposal.approveOpen')}</Btn>}
                    {canAccept && <Btn size="sm" variant="primary" onClick={() => setPanel(panel === 'accept' ? 'none' : 'accept')}>{t('proposal.acceptOpen')}</Btn>}
                </>
            }
        >
            <div className="space-y-4">
                <KV cols={4} items={[
                    [t('common.status'), <StatusBadge key="s" status={p.status} />],
                    [t('common.effectiveDate'), p.effectiveDate],
                    [t('proposal.expires'), p.expiresAt ? <span key="e" className={expired ? 'text-red-700 font-semibold' : ''}>{expiresOn}</span> : '—'],
                    [t('proposal.approvals'), <span key="a" className={approvedCount >= (p.approvalsRequired ?? 1) ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>{t('proposal.approvalsValue', { count: approvedCount, required: p.approvalsRequired ?? 1 })}</span>],
                    [t('proposal.proposedBy'), p.makerId ?? (p as { proposedBy?: string }).proposedBy ? <Person key="pb" id={p.makerId ?? (p as { proposedBy?: string }).proposedBy} /> : '—'],
                    [t('proposal.created'), fmtDateTime(p.createdAt)],
                    [t('proposal.policyExceptions'), exceptions.length ? <span key="x" className="text-red-700 font-semibold">{exceptions.length}</span> : t('common.none')],
                    [t('proposal.fullHash'), <span key="h" className="font-mono text-[10px] break-all">{p.proposalHash}</span>],
                ]} />

                {panel === 'approve' && (
                    <ActionPanel title={t('proposal.approveTitle', { version: p.version })} onClose={() => setPanel('none')}>
                        <p className="text-[12px] text-[#697386]">{t('proposal.approveBody')}</p>
                        <Field label={t('proposal.approvalComment')} hint={t('common.atLeast3')}><TextArea value={note} onChange={setNote} rows={2} maxLength={500} /></Field>
                        <ErrorBox error={error} onDismiss={clearError} />
                        <Btn variant="primary" busy={busy === 'approve'} disabled={note.trim().length < 3} onClick={approve}>{t('proposal.approve')}</Btn>
                    </ActionPanel>
                )}
                {panel === 'accept' && (
                    <ActionPanel title={t('proposal.acceptTitle', { version: p.version })} onClose={() => setPanel('none')}>
                        <p className="text-[12px] text-[#697386]">
                            {t.rich('proposal.acceptBody', { hash: shortHash(p.proposalHash), h: (c) => <span className="font-mono">{c}</span> })}
                        </p>
                        {p.comparison?.lowerInstalmentHigherCost && <WarningsView sim={{ ...p, affordability: null, requiredFlags: [] }} />}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <Field label={t('common.method')}>
                                <SelectInput value={method} onChange={setMethod} options={L.options('acceptForm', ['SIGNED_FORM', 'WITNESSED_VERBAL'])} />
                            </Field>
                            <Field label={t('common.evidence')} hint={t('proposal.evidenceHint')}><TextInput value={evidence} onChange={setEvidence} maxLength={500} /></Field>
                        </div>
                        <ErrorBox error={error} onDismiss={clearError} />
                        <Btn variant="primary" busy={busy === 'accept'} disabled={evidence.trim().length < 3} reason={evidence.trim().length < 3 ? t('proposal.evidenceRequired') : undefined} onClick={accept}>{t('proposal.recordAcceptance')}</Btn>
                    </ActionPanel>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border border-[#E3E8EE] rounded-md p-4 bg-[#FBFCFE]">
                    <ApprovalTimeline approvals={approvals} required={p.approvalsRequired ?? 1} />
                    <div className="md:border-l md:border-[#E3E8EE] md:pl-4">
                        <AcceptanceTimeline acceptances={acceptances} currentHash={p.proposalHash} />
                    </div>
                </div>

                {p.comparison && <ComparisonTable comparison={p.comparison} currency={p.snapshot?.currency} />}
                <Disclosure summary={t('proposal.fullTerms')} defaultOpen={defaultOpen}>
                    {p.calculation && p.comparison ? (
                        <SimulationView sim={{ snapshot: p.snapshot, calculation: p.calculation, comparison: p.comparison, policyExceptions: exceptions, requiredFlags: (p as { requiredFlags?: string[] }).requiredFlags, concessions: p.concessions }} />
                    ) : <p className="text-[12px] text-[#697386]">{t('proposal.noCalculation')}</p>}
                </Disclosure>
            </div>
        </Card>
    );
}
