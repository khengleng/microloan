"use client";

import { useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, Disclosure, Empty, ErrorBox, JsonBlock, KV, Notice, Spinner, Table, td, tdR, th, thR } from '../ui';
import { useAction, useApi, useCapabilities } from '../useAsync';
import { fmtDateTime, fmtRate, fullName } from '../format';
import { Money, MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import type { ProductConfig, SimulationResult, Terms } from '../types';
import { WhyBlocked } from './WhyBlocked';
import { SimulationResultView } from '../SimulationResultView';
import { ApplicationScoreCard } from '../scoring/ApplicationScoreCard';
import {
    BookForm, CollateralForm, ConditionForm, DecisionForm, DocumentUploadForm, EditTermsForm, GuaranteeForm,
    type DecisionMode, type RequiredDocument,
} from './ApplicationForms';

/* Shapes as returned by GET /lending/applications/:id (Decimal → string, DateTime → ISO). */
interface AppDoc { id: string; code: string; fileName: string; mimeType: string; sizeBytes: number; sha256?: string; uploadedBy?: string; createdAt: string }
interface AppDecision { id: string; type: string; decidedBy: string; amount: string; currency: string; rationale: string; createdAt: string; policyDecision?: unknown; assessment?: unknown }
interface AppCondition { id?: string; code: string; label: string; status: string; evidence?: string | null; resolvedBy?: string | null; resolvedAt?: string | null }
interface AppGuarantee { id: string; guarantorName: string; type: string; amount: string; currency: string; createdAt?: string }
interface AppPledge {
    id: string; status: string; createdAt?: string;
    collateral: { id: string; type: string; description: string; currency: string; valuations: { id: string; valuationDate: string; marketValue: string; valuer: string; method: string }[] } | null;
}
interface AppDetail {
    id: string; reference: string; status: string; currency: string; requestedAmount: string; createdAt: string; submittedAt?: string | null; decidedAt?: string | null;
    borrowerId: string; borrower?: { firstName?: string; lastName?: string } | null; productId: string; productVersionId: string; channel?: string;
    terms: Partial<Terms> & Record<string, unknown>; purpose?: string | null;
    product: { id: string; code: string; name: string } | null;
    productVersion: { id: string; version: number; status: string } | null;
    documents: AppDoc[]; decisions: AppDecision[]; conditions: AppCondition[]; guarantees: AppGuarantee[]; pledges: AppPledge[];
    agreement: { id?: string; reference?: string; account: { id: string; reference: string; status: string } | null } | null;
}

const ACTIONS = [
    { code: 'loan_application.update', label: 'Edit terms / upload documents' },
    { code: 'loan_application.submit', label: 'Submit' },
    { code: 'collateral.manage', label: 'Manage collateral & guarantees' },
    { code: 'credit_decision.recommend', label: 'Recommend' },
    { code: 'credit_decision.approve', label: 'Approve' },
    { code: 'credit_decision.reject', label: 'Reject' },
    { code: 'loan.agreement.book', label: 'Book agreement' },
    { code: 'condition.satisfy', label: 'Satisfy condition' },
    { code: 'condition.waive', label: 'Waive condition' },
];

const TERMINAL = ['REJECTED', 'WITHDRAWN', 'BOOKED'];

type Panel =
    | { kind: 'terms' } | { kind: 'document' } | { kind: 'collateral' } | { kind: 'guarantee' } | { kind: 'book' }
    | { kind: 'decision'; mode: DecisionMode }
    | { kind: 'condition'; code: string; label: string; resolution: 'SATISFIED' | 'WAIVED' };

function fmtBytes(n: number | undefined): string {
    if (n === undefined || n === null) return '—';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function ApplicationDetailView({ id }: { id: string }) {
    const href = useLendingHref();
    const { showToast } = useToast();
    const confirm = useConfirm();
    const app = useApi<AppDetail>(`/lending/applications/${id}`);
    const caps = useCapabilities('APPLICATION', id);
    const pv = useApi<{ config?: ProductConfig }>(app.data?.productVersionId ? `/lending/product-versions/${app.data.productVersionId}` : null);
    const [panel, setPanel] = useState<Panel | null>(null);
    const [sim, setSim] = useState<SimulationResult | null>(null);
    const action = useAction();

    const a = app.data;
    if (!a) {
        return (
            <LendingShell title="Application" back={{ href: '/lending/applications', label: 'Applications' }}>
                {app.error ? <ErrorBox error={app.error} /> : <Spinner />}
            </LendingShell>
        );
    }

    const refresh = (msg: string) => {
        showToast(msg, 'success');
        setPanel(null);
        app.reload();
        caps.reload();
    };

    const ops = (pv.data?.config?.operations ?? {}) as { requiredDocuments?: RequiredDocument[] };
    const requiredDocs = Array.isArray(ops.requiredDocuments) ? ops.requiredDocuments : null;
    const haveDocs = new Set(a.documents.map((d) => d.code));
    const open = !TERMINAL.includes(a.status);
    const c = (code: string) => caps.can(code);
    const account = a.agreement?.account ?? null;

    const submit = async () => {
        const ok = await confirm({ title: 'Submit application', message: `Submit ${a.reference} for credit review? Terms can no longer be edited after submission.`, confirmLabel: 'Submit' });
        if (!ok) return;
        const res = await action.run('submit', () => api.post(`/lending/applications/${id}/submit`, {}));
        if (res) refresh('Application submitted');
    };

    const simulate = async () => {
        const res = await action.run('simulate', () => api.post<SimulationResult>(`/lending/applications/${id}/simulate`, {}));
        if (res) setSim(res.data);
    };

    const btn = (label: string, code: string, onClick: () => void, opts: { variant?: 'primary' | 'secondary' | 'danger'; busy?: boolean } = {}) => {
        const k = c(code);
        return (
            <Btn variant={opts.variant ?? 'secondary'} onClick={onClick} disabled={!k.allowed} reason={k.reason} busy={opts.busy}>
                {label}
            </Btn>
        );
    };

    const t = a.terms ?? {};

    return (
        <LendingShell
            title={<span className="flex items-center gap-2">{a.reference} <StatusBadge status={a.status} /></span>}
            subtitle={`${fullName(a.borrower)} · ${a.product ? `${a.product.name} (${a.product.code})` : a.productId}${a.productVersion ? ` · v${a.productVersion.version}` : ''}`}
            back={{ href: '/lending/applications', label: 'Applications' }}
            actions={<Btn variant="ghost" onClick={() => { app.reload(); caps.reload(); }}>Refresh</Btn>}
        >
            {app.error && <ErrorBox error={app.error} />}

            {account && (
                <Notice tone="success" title="Booked">
                    Loan account{' '}
                    <Link href={href(`/lending/loans/${account.id}`)} className="font-mono font-semibold underline">{account.reference}</Link>{' '}
                    <StatusBadge status={account.status} />
                </Notice>
            )}

            <Card title="Actions" subtitle="Buttons reflect your permissions, policies and limits. The server re-checks every action.">
                <div className="space-y-3">
                    <div data-tour="app-actions" className="flex flex-wrap gap-2">
                        {a.status === 'DRAFT' && btn('Edit terms', 'loan_application.update', () => setPanel({ kind: 'terms' }))}
                        {open && btn('Upload document', 'loan_application.update', () => setPanel({ kind: 'document' }))}
                        {open && btn('Add collateral', 'collateral.manage', () => setPanel({ kind: 'collateral' }))}
                        {open && btn('Add guarantee', 'collateral.manage', () => setPanel({ kind: 'guarantee' }))}
                        <Btn data-tour="app-simulate" onClick={simulate} busy={action.busy === 'simulate'}>Simulate</Btn>
                        {a.status === 'DRAFT' && btn('Submit', 'loan_application.submit', submit, { variant: 'primary', busy: action.busy === 'submit' })}
                        {a.status === 'SUBMITTED' && btn('Recommend', 'credit_decision.recommend', () => setPanel({ kind: 'decision', mode: 'recommend' }), { variant: 'primary' })}
                        {a.status === 'RECOMMENDED' && btn('Approve', 'credit_decision.approve', () => setPanel({ kind: 'decision', mode: 'approve' }), { variant: 'primary' })}
                        {(a.status === 'SUBMITTED' || a.status === 'RECOMMENDED') && btn('Reject', 'credit_decision.reject', () => setPanel({ kind: 'decision', mode: 'reject' }), { variant: 'danger' })}
                        {a.status === 'APPROVED' && btn('Book agreement', 'loan.agreement.book', () => setPanel({ kind: 'book' }), { variant: 'primary' })}
                    </div>
                    <ErrorBox error={action.error} onDismiss={action.clearError} />
                    <WhyBlocked caps={caps.caps} actions={ACTIONS} />

                    {panel?.kind === 'terms' && (
                        <EditTermsForm appId={id} terms={a.terms} purpose={a.purpose} currency={a.currency} onDone={() => refresh('Terms updated')} onClose={() => setPanel(null)} />
                    )}
                    {panel?.kind === 'document' && (
                        <DocumentUploadForm appId={id} required={requiredDocs} onDone={() => refresh('Document uploaded')} onClose={() => setPanel(null)} />
                    )}
                    {panel?.kind === 'collateral' && (
                        <CollateralForm appId={id} currency={a.currency} onDone={() => refresh('Collateral added')} onClose={() => setPanel(null)} />
                    )}
                    {panel?.kind === 'guarantee' && (
                        <GuaranteeForm appId={id} currency={a.currency} onDone={() => refresh('Guarantee added')} onClose={() => setPanel(null)} />
                    )}
                    {panel?.kind === 'decision' && (
                        <DecisionForm key={panel.mode} appId={id} mode={panel.mode} onDone={() => refresh('Decision recorded')} onClose={() => setPanel(null)} />
                    )}
                    {panel?.kind === 'book' && (
                        <BookForm appId={id} onBooked={() => refresh('Loan account booked')} onClose={() => setPanel(null)} />
                    )}
                    {panel?.kind === 'condition' && (
                        <ConditionForm
                            key={`${panel.code}-${panel.resolution}`}
                            appId={id} code={panel.code} label={panel.label} resolution={panel.resolution}
                            onDone={() => refresh('Condition resolved')} onClose={() => setPanel(null)}
                        />
                    )}
                </div>
            </Card>

            {sim && (
                <Card title="Simulation" actions={<Btn variant="ghost" size="sm" onClick={() => setSim(null)}>Hide</Btn>}>
                    <SimulationResultView result={sim} currency={a.currency} />
                </Card>
            )}

            <Card title="Application">
                <KV
                    cols={4}
                    items={[
                        ['Requested', <Money key="r" value={a.requestedAmount} currency={a.currency} />],
                        ['Principal', <Money key="p" value={t.principal} currency={a.currency} />],
                        ['Instalments', t.numberOfInstalments ?? 'product default'],
                        ['Annual rate', t.annualRate ? fmtRate(String(t.annualRate)) : 'product default'],
                        ['Disbursement date', t.disbursementDate ?? '—'],
                        ['First due date', t.firstDueDate ?? '—'],
                        ['Purpose', a.purpose || '—'],
                        ['Channel', a.channel ?? '—'],
                        ['Created', fmtDateTime(a.createdAt)],
                        ['Submitted', fmtDateTime(a.submittedAt)],
                        ['Decided', fmtDateTime(a.decidedAt)],
                        ['Borrower ID', <span key="b" className="font-mono text-[11px]">{a.borrowerId}</span>],
                    ]}
                />
                <div className="mt-3"><Disclosure summary="Raw terms"><JsonBlock value={a.terms} /></Disclosure></div>
            </Card>

            <ApplicationScoreCard applicationId={id} status={a.status} currency={a.currency} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <Card title="Documents" subtitle={requiredDocs ? `${requiredDocs.filter((d) => d.mandatory).length} mandatory by product` : undefined} bodyClass="p-0">
                    {requiredDocs && requiredDocs.length > 0 && (
                        <div data-tour="app-required-docs" className="px-5 py-3 border-b border-[#E3E8EE] flex flex-wrap gap-1.5">
                            {requiredDocs.map((d) => (
                                <span key={d.code} className={`text-[11px] px-1.5 py-0.5 rounded border ${haveDocs.has(d.code) ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : d.mandatory ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                                    {haveDocs.has(d.code) ? '✓ ' : ''}{d.label}{d.stage ? ` · ${d.stage}` : ''}
                                </span>
                            ))}
                        </div>
                    )}
                    {a.documents.length === 0 ? <Empty>No documents uploaded.</Empty> : (
                        <Table>
                            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Code</th><th className={th}>File</th><th className={thR}>Size</th><th className={th}>Uploaded</th></tr></thead>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                {a.documents.map((d) => (
                                    <tr key={d.id}>
                                        <td className={td}><span className="font-mono text-[12px]">{d.code}</span></td>
                                        <td className={td}>{d.fileName}<div className="text-[11px] text-[#8792A2]">{d.mimeType}</div></td>
                                        <td className={tdR}>{fmtBytes(d.sizeBytes)}</td>
                                        <td className={`${td} whitespace-nowrap`}>{fmtDateTime(d.createdAt)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    )}
                </Card>

                <Card title="Conditions precedent" bodyClass="p-0">
                    {a.conditions.length === 0 ? <Empty>No conditions recorded.</Empty> : (
                        <Table>
                            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Condition</th><th className={th}>Status</th><th className={th}>Evidence</th><th className={th} /></tr></thead>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                {a.conditions.map((cp) => {
                                    const sat = c('condition.satisfy');
                                    const waive = c('condition.waive');
                                    return (
                                        <tr key={cp.code}>
                                            <td className={td}>{cp.label}<div className="font-mono text-[10px] text-[#8792A2]">{cp.code}</div></td>
                                            <td className={td}><StatusBadge status={cp.status} /></td>
                                            <td className={td}>{cp.evidence || '—'}</td>
                                            <td className={`${td} whitespace-nowrap`}>
                                                {cp.status === 'OUTSTANDING' && (
                                                    <div className="flex gap-1.5">
                                                        <Btn size="sm" disabled={!sat.allowed} reason={sat.reason} onClick={() => setPanel({ kind: 'condition', code: cp.code, label: cp.label, resolution: 'SATISFIED' })}>Satisfy</Btn>
                                                        <Btn size="sm" variant="ghost" disabled={!waive.allowed} reason={waive.reason} onClick={() => setPanel({ kind: 'condition', code: cp.code, label: cp.label, resolution: 'WAIVED' })}>Waive</Btn>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </Table>
                    )}
                </Card>

                <Card title="Collateral" bodyClass="p-0">
                    {a.pledges.length === 0 ? <Empty>No collateral pledged.</Empty> : (
                        <Table>
                            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Type</th><th className={th}>Description</th><th className={thR}>Latest value</th><th className={th}>Valuation</th><th className={th}>Pledge</th></tr></thead>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                {a.pledges.map((p) => {
                                    const v = p.collateral?.valuations?.[0];
                                    return (
                                        <tr key={p.id}>
                                            <td className={td}><span className="font-mono text-[12px]">{p.collateral?.type ?? '—'}</span></td>
                                            <td className={td}>{p.collateral?.description ?? '—'}</td>
                                            <td className={tdR}>{v ? <MoneyCell value={v.marketValue} currency={p.collateral?.currency} /> : '—'}</td>
                                            <td className={td}>{v ? <>{v.valuationDate.slice(0, 10)}<div className="text-[11px] text-[#8792A2]">{v.valuer} · {v.method}</div></> : '—'}</td>
                                            <td className={td}><StatusBadge status={p.status} /></td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </Table>
                    )}
                </Card>

                <Card title="Guarantees" bodyClass="p-0">
                    {a.guarantees.length === 0 ? <Empty>No guarantees.</Empty> : (
                        <Table>
                            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Guarantor</th><th className={th}>Type</th><th className={thR}>Amount</th></tr></thead>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                {a.guarantees.map((g) => (
                                    <tr key={g.id}>
                                        <td className={td}>{g.guarantorName}</td>
                                        <td className={td}>{g.type}</td>
                                        <td className={tdR}><MoneyCell value={g.amount} currency={g.currency} /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    )}
                </Card>
            </div>

            <Card title="Credit decisions" subtitle="Full history, oldest first" bodyClass="p-0">
                {a.decisions.length === 0 ? <Empty>No decisions yet.</Empty> : (
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>When</th><th className={th}>Type</th><th className={thR}>Amount</th><th className={th}>Rationale</th><th className={th}>By</th><th className={th}>Detail</th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {a.decisions.map((d) => (
                                <tr key={d.id} data-tour="app-decision-row">
                                    <td className={`${td} whitespace-nowrap`}>{fmtDateTime(d.createdAt)}</td>
                                    <td className={td}><StatusBadge status={d.type} /></td>
                                    <td className={tdR}><MoneyCell value={d.amount} currency={d.currency} /></td>
                                    <td className={td}>{d.rationale}</td>
                                    <td className={td}><span className="font-mono text-[11px]">{d.decidedBy?.slice(0, 8)}</span></td>
                                    <td className={td}>
                                        {(d.assessment !== undefined || d.policyDecision !== undefined) && (
                                            <Disclosure summary="assessment"><JsonBlock value={{ assessment: d.assessment, policyDecision: d.policyDecision }} /></Disclosure>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Card>
        </LendingShell>
    );
}
