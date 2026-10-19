"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useBorrowerNames } from '../groups/borrowers';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, Disclosure, Empty, ErrorBox, JsonBlock, KV, Notice, Spinner, Table, td, tdR, th, thR } from '../ui';
import { useAction, useApi, useCapabilities } from '../useAsync';
import { fmtDateTime, fmtRate, fullName } from '../format';
import { Money, MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { Person } from '../People';
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
    groupId?: string | null;
    terms: Partial<Terms> & Record<string, unknown>; purpose?: string | null;
    product: { id: string; code: string; name: string } | null;
    productVersion: { id: string; version: number; status: string } | null;
    documents: AppDoc[]; decisions: AppDecision[]; conditions: AppCondition[]; guarantees: AppGuarantee[]; pledges: AppPledge[];
    agreement: { id?: string; reference?: string; account: { id: string; reference: string; status: string } | null } | null;
}

/* Labels are message keys under LendingOrigination.detail.actionLabels. */
const ACTIONS = [
    { code: 'loan_application.update', key: 'update' },
    { code: 'loan_application.submit', key: 'submit' },
    { code: 'collateral.manage', key: 'collateral' },
    { code: 'credit_decision.recommend', key: 'recommend' },
    { code: 'credit_decision.approve', key: 'approve' },
    { code: 'credit_decision.reject', key: 'reject' },
    { code: 'loan.agreement.book', key: 'book' },
    { code: 'condition.satisfy', key: 'satisfy' },
    { code: 'condition.waive', key: 'waive' },
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
    const tr = useTranslations('LendingOrigination');
    const href = useLendingHref();
    const { showToast } = useToast();
    const confirm = useConfirm();
    const app = useApi<AppDetail>(`/lending/applications/${id}`);
    const caps = useCapabilities('APPLICATION', id);
    const pv = useApi<{ config?: ProductConfig }>(app.data?.productVersionId ? `/lending/product-versions/${app.data.productVersionId}` : null);
    const groupName = useApi<{ name: string }>(app.data?.groupId ? `/lending/applications/groups/${app.data.groupId}` : null);
    const [panel, setPanel] = useState<Panel | null>(null);
    const [sim, setSim] = useState<SimulationResult | null>(null);
    const action = useAction();

    const a = app.data;
    if (!a) {
        return (
            <LendingShell title={tr('detail.loadingTitle')} back={{ href: '/lending/applications', label: 'Applications' }}>
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
        const ok = await confirm({ title: tr('detail.submitTitle'), message: tr('detail.submitMessage', { reference: a.reference }), confirmLabel: tr('detail.submit') });
        if (!ok) return;
        const res = await action.run('submit', () => api.post(`/lending/applications/${id}/submit`, {}));
        if (res) refresh(tr('toast.submitted'));
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
            actions={<Btn variant="ghost" onClick={() => { app.reload(); caps.reload(); }}>{tr('common.refresh')}</Btn>}
        >
            {app.error && <ErrorBox error={app.error} />}

            {account && (
                <Notice tone="success" title={tr('detail.booked')}>
                    {tr.rich('detail.loanAccount', { reference: account.reference, link: (chunks) => <Link href={href(`/lending/loans/${account.id}`)} className="font-mono font-semibold underline">{chunks}</Link> })}{' '}
                    <StatusBadge status={account.status} />
                </Notice>
            )}

            <Card title={tr('detail.actions')} subtitle={tr('detail.actionsHint')}>
                <div className="space-y-3">
                    <div data-tour="app-actions" className="flex flex-wrap gap-2">
                        {a.status === 'DRAFT' && btn(tr('detail.editTerms'), 'loan_application.update', () => setPanel({ kind: 'terms' }))}
                        {open && btn(tr('detail.uploadDocument'), 'loan_application.update', () => setPanel({ kind: 'document' }))}
                        {open && btn(tr('forms.addCollateral'), 'collateral.manage', () => setPanel({ kind: 'collateral' }))}
                        {open && btn(tr('forms.addGuarantee'), 'collateral.manage', () => setPanel({ kind: 'guarantee' }))}
                        <Btn data-tour="app-simulate" onClick={simulate} busy={action.busy === 'simulate'}>{tr('detail.simulate')}</Btn>
                        {a.status === 'DRAFT' && btn(tr('detail.submit'), 'loan_application.submit', submit, { variant: 'primary', busy: action.busy === 'submit' })}
                        {a.status === 'SUBMITTED' && btn(tr('detail.recommend'), 'credit_decision.recommend', () => setPanel({ kind: 'decision', mode: 'recommend' }), { variant: 'primary' })}
                        {a.status === 'RECOMMENDED' && btn(tr('detail.approve'), 'credit_decision.approve', () => setPanel({ kind: 'decision', mode: 'approve' }), { variant: 'primary' })}
                        {(a.status === 'SUBMITTED' || a.status === 'RECOMMENDED') && btn(tr('detail.reject'), 'credit_decision.reject', () => setPanel({ kind: 'decision', mode: 'reject' }), { variant: 'danger' })}
                        {a.status === 'APPROVED' && btn(tr('forms.bookAgreement'), 'loan.agreement.book', () => setPanel({ kind: 'book' }), { variant: 'primary' })}
                    </div>
                    <ErrorBox error={action.error} onDismiss={action.clearError} />
                    <WhyBlocked caps={caps.caps} actions={ACTIONS.map((x) => ({ code: x.code, label: tr(`detail.actionLabels.${x.key}`) }))} />

                    {panel?.kind === 'terms' && (
                        <EditTermsForm appId={id} terms={a.terms} purpose={a.purpose} currency={a.currency} productVersionId={a.productVersionId} onDone={() => refresh(tr('toast.termsUpdated'))} onClose={() => setPanel(null)} />
                    )}
                    {panel?.kind === 'document' && (
                        <DocumentUploadForm appId={id} required={requiredDocs} onDone={() => refresh(tr('toast.documentUploaded'))} onClose={() => setPanel(null)} />
                    )}
                    {panel?.kind === 'collateral' && (
                        <CollateralForm appId={id} currency={a.currency} onDone={() => refresh(tr('toast.collateralAdded'))} onClose={() => setPanel(null)} />
                    )}
                    {panel?.kind === 'guarantee' && (
                        <GuaranteeForm appId={id} currency={a.currency} onDone={() => refresh(tr('toast.guaranteeAdded'))} onClose={() => setPanel(null)} />
                    )}
                    {panel?.kind === 'decision' && (
                        <DecisionForm key={panel.mode} appId={id} mode={panel.mode} onDone={() => refresh(tr('toast.decisionRecorded'))} onClose={() => setPanel(null)} />
                    )}
                    {panel?.kind === 'book' && (
                        <BookForm appId={id} onBooked={() => refresh(tr('toast.booked'))} onClose={() => setPanel(null)} />
                    )}
                    {panel?.kind === 'condition' && (
                        <ConditionForm
                            key={`${panel.code}-${panel.resolution}`}
                            appId={id} code={panel.code} label={panel.label} resolution={panel.resolution}
                            onDone={() => refresh(tr('toast.conditionResolved'))} onClose={() => setPanel(null)}
                        />
                    )}
                </div>
            </Card>

            {sim && (
                <Card title={tr('detail.simulation')} actions={<Btn variant="ghost" size="sm" onClick={() => setSim(null)}>{tr('detail.hide')}</Btn>}>
                    <SimulationResultView result={sim} currency={a.currency} />
                </Card>
            )}

            <Card title={tr('detail.application')}>
                <KV
                    cols={4}
                    items={[
                        [tr('detail.requested'), <Money key="r" value={a.requestedAmount} currency={a.currency} />],
                        [tr('terms.principal'), <Money key="p" value={t.principal} currency={a.currency} />],
                        [tr('detail.instalments'), t.numberOfInstalments ?? tr('common.productDefault')],
                        [tr('detail.annualRate'), t.annualRate ? fmtRate(String(t.annualRate)) : tr('common.productDefault')],
                        [tr('terms.disbursementDate'), t.disbursementDate ?? '—'],
                        [tr('terms.firstDueDate'), t.firstDueDate ?? '—'],
                        [tr('common.purpose'), a.purpose || '—'],
                        [tr('detail.channel'), a.channel ?? '—'],
                        [tr('detail.created'), fmtDateTime(a.createdAt)],
                        [tr('detail.submitted'), fmtDateTime(a.submittedAt)],
                        [tr('detail.decided'), fmtDateTime(a.decidedAt)],
                        [tr('detail.borrower'), <BorrowerName key="b" id={a.borrowerId} borrower={a.borrower} />],
                        ...(a.groupId ? [[tr('detail.group'), <Link key="g" href={href(`/lending/groups/${a.groupId}`)} className="font-semibold text-[#635BFF] hover:underline">{groupName.data?.name ?? tr('detail.group')}</Link>] as [string, React.ReactNode]] : []),
                        ...(t.policies && Object.keys(t.policies).length
                            ? [[tr('detail.policies'), <span key="pol" className="text-[12px]">{Object.entries(t.policies).map(([k, v]) => `${k}: ${v?.code ?? tr('detail.policyDefault')}${v?.parameters ? ` (${Object.entries(v.parameters).map(([n, x]) => `${n}=${x}`).join(', ')})` : ''}`).join(' · ')}</span>] as [string, React.ReactNode]]
                            : []),
                    ]}
                />
                <div className="mt-3"><Disclosure summary={tr('detail.rawTerms')}><JsonBlock value={a.terms} /></Disclosure></div>
            </Card>

            <ApplicationScoreCard applicationId={id} status={a.status} currency={a.currency} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <Card title={tr('detail.documents')} subtitle={requiredDocs ? tr('detail.mandatoryCount', { count: requiredDocs.filter((d) => d.mandatory).length }) : undefined} bodyClass="p-0">
                    {requiredDocs && requiredDocs.length > 0 && (
                        <div data-tour="app-required-docs" className="px-5 py-3 border-b border-[#E3E8EE] flex flex-wrap gap-1.5">
                            {requiredDocs.map((d) => (
                                <span key={d.code} className={`text-[11px] px-1.5 py-0.5 rounded border ${haveDocs.has(d.code) ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : d.mandatory ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                                    {haveDocs.has(d.code) ? '✓ ' : ''}{d.label}{d.stage ? ` · ${d.stage}` : ''}
                                </span>
                            ))}
                        </div>
                    )}
                    {a.documents.length === 0 ? <Empty>{tr('detail.noDocuments')}</Empty> : (
                        <Table>
                            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{tr('detail.colCode')}</th><th className={th}>{tr('forms.file')}</th><th className={thR}>{tr('detail.colSize')}</th><th className={th}>{tr('detail.colUploaded')}</th></tr></thead>
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

                <Card title={tr('detail.conditions')} bodyClass="p-0">
                    {a.conditions.length === 0 ? <Empty>{tr('detail.noConditions')}</Empty> : (
                        <Table>
                            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{tr('detail.colCondition')}</th><th className={th}>{tr('list.colStatus')}</th><th className={th}>{tr('forms.evidence')}</th><th className={th} /></tr></thead>
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
                                                        <Btn size="sm" disabled={!sat.allowed} reason={sat.reason} onClick={() => setPanel({ kind: 'condition', code: cp.code, label: cp.label, resolution: 'SATISFIED' })}>{tr('detail.satisfy')}</Btn>
                                                        <Btn size="sm" variant="ghost" disabled={!waive.allowed} reason={waive.reason} onClick={() => setPanel({ kind: 'condition', code: cp.code, label: cp.label, resolution: 'WAIVED' })}>{tr('detail.waive')}</Btn>
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

                <Card title={tr('detail.collateral')} bodyClass="p-0">
                    {a.pledges.length === 0 ? <Empty>{tr('detail.noCollateral')}</Empty> : (
                        <Table>
                            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{tr('forms.type')}</th><th className={th}>{tr('forms.description')}</th><th className={thR}>{tr('detail.colLatestValue')}</th><th className={th}>{tr('detail.colValuation')}</th><th className={th}>{tr('detail.colPledge')}</th></tr></thead>
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

                <Card title={tr('detail.guarantees')} bodyClass="p-0">
                    {a.guarantees.length === 0 ? <Empty>{tr('detail.noGuarantees')}</Empty> : (
                        <Table>
                            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{tr('detail.colGuarantor')}</th><th className={th}>{tr('forms.type')}</th><th className={thR}>{tr('forms.amount')}</th></tr></thead>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                {a.guarantees.map((g) => (
                                    <tr key={g.id}>
                                        <td className={td}>{g.guarantorName}</td>
                                        <td className={td}>{tr.has(`forms.guaranteeTypes.${g.type}`) ? tr(`forms.guaranteeTypes.${g.type}`) : g.type}</td>
                                        <td className={tdR}><MoneyCell value={g.amount} currency={g.currency} /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    )}
                </Card>
            </div>

            <Card title={tr('detail.decisions')} subtitle={tr('detail.decisionsHint')} bodyClass="p-0">
                {a.decisions.length === 0 ? <Empty>{tr('detail.noDecisions')}</Empty> : (
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{tr('detail.colWhen')}</th><th className={th}>{tr('forms.type')}</th><th className={thR}>{tr('forms.amount')}</th><th className={th}>{tr('forms.rationale')}</th><th className={th}>{tr('detail.colBy')}</th><th className={th}>{tr('detail.colDetail')}</th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {a.decisions.map((d) => (
                                <tr key={d.id} data-tour="app-decision-row">
                                    <td className={`${td} whitespace-nowrap`}>{fmtDateTime(d.createdAt)}</td>
                                    <td className={td}><StatusBadge status={d.type} /></td>
                                    <td className={tdR}><MoneyCell value={d.amount} currency={d.currency} /></td>
                                    <td className={td}>{d.rationale}</td>
                                    <td className={td}><Person id={d.decidedBy} /></td>
                                    <td className={td}>
                                        {(d.assessment !== undefined || d.policyDecision !== undefined) && (
                                            <Disclosure summary={tr('detail.assessment')}><JsonBlock value={{ assessment: d.assessment, policyDecision: d.policyDecision }} /></Disclosure>
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

/** The applicant by name, linked to their profile (the id only while the name loads or is out of reach). */
function BorrowerName({ id, borrower }: { id: string; borrower?: { firstName?: string; lastName?: string } | null }) {
    const { locale } = useParams();
    const nameOf = useBorrowerNames(borrower ? [] : [id]);
    const label = borrower ? fullName(borrower) : nameOf(id);
    return <Link href={`/${locale}/borrowers/${id}`} className="font-semibold text-[#635BFF] hover:underline">{label}</Link>;
}
