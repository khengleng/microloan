"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import type { RestructureProposal } from '../types';
import { StatusBadge } from '../StatusBadge';
import { fmtDateTime } from '../format';
import { ActionPanel, Btn, Card, Disclosure, ErrorBox, Field, KV, SelectInput, TextArea, TextInput } from '../ui';
import { clean, useAction } from '../useAsync';
import { AcceptanceTimeline } from './AcceptanceTimeline';
import { ApprovalTimeline } from './ApprovalTimeline';
import { SimulationView, WarningsView, ComparisonTable } from './SimulationView';
import { shortHash } from './labels';

/** One proposal version: terms, approval and acceptance timelines, and its actions. */
export function ProposalCard({ caseId, proposal: p, onChanged, defaultOpen }: {
    caseId: string; proposal: RestructureProposal; onChanged: () => void; defaultOpen?: boolean;
}) {
    const { showToast } = useToast();
    const { busy, error, run, clearError } = useAction();
    const [panel, setPanel] = useState<'none' | 'approve' | 'accept'>('none');
    const [note, setNote] = useState('');
    const [method, setMethod] = useState('SIGNED_FORM');
    const [evidence, setEvidence] = useState('');
    const [now] = useState(() => Date.now());

    const approvals = p.approvals ?? [];
    const acceptances = p.acceptances ?? [];
    const approvedCount = approvals.filter((a) => (a.decision ?? 'APPROVE') === 'APPROVE').length;
    const expired = !!p.expiresAt && new Date(p.expiresAt).getTime() < now;
    const canApprove = p.status === 'PROPOSED' && !expired;
    const canAccept = p.status === 'APPROVED' && !expired;
    const exceptions = p.policyExceptions ?? [];

    const approve = async () => {
        const res = await run('approve', () => api.post(`/lending/restructures/${caseId}/proposals/${p.id}/approve`, { note: note.trim() }));
        if (res) { showToast(`Approval recorded for v${p.version}`, 'success'); setNote(''); setPanel('none'); onChanged(); }
    };
    const accept = async () => {
        const body = clean({ proposalHash: p.proposalHash, method, evidence: evidence.trim() });
        const res = await run('accept', () => api.post(`/lending/restructures/${caseId}/proposals/${p.id}/acceptance`, body));
        if (res) { showToast(`Customer acceptance recorded for v${p.version}`, 'success'); setEvidence(''); setPanel('none'); onChanged(); }
    };

    return (
        <Card
            title={<span className="flex items-center gap-2">Proposal v{p.version} <StatusBadge status={p.status} />{expired && p.status !== 'EXECUTED' && <StatusBadge status="EXPIRED" />}</span>}
            subtitle={<span>Effective {p.effectiveDate} · hash <span className="font-mono">{shortHash(p.proposalHash)}</span></span>}
            actions={
                <>
                    {canApprove && <Btn size="sm" variant="primary" onClick={() => setPanel(panel === 'approve' ? 'none' : 'approve')}>Approve…</Btn>}
                    {canAccept && <Btn size="sm" variant="primary" onClick={() => setPanel(panel === 'accept' ? 'none' : 'accept')}>Record customer acceptance…</Btn>}
                </>
            }
        >
            <div className="space-y-4">
                <KV cols={4} items={[
                    ['Status', <StatusBadge key="s" status={p.status} />],
                    ['Effective date', p.effectiveDate],
                    ['Expires', p.expiresAt ? <span key="e" className={expired ? 'text-red-700 font-semibold' : ''}>{fmtDateTime(p.expiresAt)}</span> : '—'],
                    ['Approvals', <span key="a" className={approvedCount >= (p.approvalsRequired ?? 1) ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>{approvedCount} of {p.approvalsRequired ?? 1} required</span>],
                    ['Proposed by', p.makerId ?? (p as { proposedBy?: string }).proposedBy ?? '—'],
                    ['Created', fmtDateTime(p.createdAt)],
                    ['Policy exceptions', exceptions.length ? <span key="x" className="text-red-700 font-semibold">{exceptions.length}</span> : 'none'],
                    ['Full hash', <span key="h" className="font-mono text-[10px] break-all">{p.proposalHash}</span>],
                ]} />

                {panel === 'approve' && (
                    <ActionPanel title={`Approve proposal v${p.version}`} onClose={() => setPanel('none')}>
                        <p className="text-[12px] text-[#697386]">Approval is a credit decision on these exact terms. The customer must still accept them separately.</p>
                        <Field label="Approval comment" hint="At least 3 characters."><TextArea value={note} onChange={setNote} rows={2} maxLength={500} /></Field>
                        <ErrorBox error={error} onDismiss={clearError} />
                        <Btn variant="primary" busy={busy === 'approve'} disabled={note.trim().length < 3} onClick={approve}>Approve</Btn>
                    </ActionPanel>
                )}
                {panel === 'accept' && (
                    <ActionPanel title={`Record customer acceptance of v${p.version} (branch)`} onClose={() => setPanel('none')}>
                        <p className="text-[12px] text-[#697386]">
                            Confirm the customer was shown the comparison, total cost and new schedule. The acceptance is bound to hash{' '}
                            <span className="font-mono">{shortHash(p.proposalHash)}</span>.
                        </p>
                        {p.comparison?.lowerInstalmentHigherCost && <WarningsView sim={{ ...p, affordability: null, requiredFlags: [] }} />}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <Field label="Method">
                                <SelectInput value={method} onChange={setMethod} options={[
                                    { value: 'SIGNED_FORM', label: 'Signed form' },
                                    { value: 'WITNESSED_VERBAL', label: 'Witnessed verbal acceptance' },
                                ]} />
                            </Field>
                            <Field label="Evidence" hint="Form number, witness name, recording id…"><TextInput value={evidence} onChange={setEvidence} maxLength={500} /></Field>
                        </div>
                        <ErrorBox error={error} onDismiss={clearError} />
                        <Btn variant="primary" busy={busy === 'accept'} disabled={evidence.trim().length < 3} reason={evidence.trim().length < 3 ? 'Evidence is required' : undefined} onClick={accept}>Record acceptance</Btn>
                    </ActionPanel>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border border-[#E3E8EE] rounded-md p-4 bg-[#FBFCFE]">
                    <ApprovalTimeline approvals={approvals} required={p.approvalsRequired ?? 1} />
                    <div className="md:border-l md:border-[#E3E8EE] md:pl-4">
                        <AcceptanceTimeline acceptances={acceptances} currentHash={p.proposalHash} />
                    </div>
                </div>

                {p.comparison && <ComparisonTable comparison={p.comparison} currency={p.snapshot?.currency} />}
                <Disclosure summary="Full terms: snapshot, warnings, calculation and schedule" defaultOpen={defaultOpen}>
                    {p.calculation && p.comparison ? (
                        <SimulationView sim={{ snapshot: p.snapshot, calculation: p.calculation, comparison: p.comparison, policyExceptions: exceptions, requiredFlags: (p as { requiredFlags?: string[] }).requiredFlags, concessions: p.concessions }} />
                    ) : <p className="text-[12px] text-[#697386]">No calculation stored.</p>}
                </Disclosure>
            </div>
        </Card>
    );
}
