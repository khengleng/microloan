"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/toast';
import { RequestRestructureForm } from '@/components/lending/restructure/RequestRestructureForm';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, Disclosure, Empty, ErrorBox, KV, Notice, Spinner, Table, td, tdR, th, thR } from '../ui';
import { useApi, useCapabilities } from '../useAsync';
import { fmtDateTime } from '../format';
import { Money, MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { ScheduleTable, rowsFromLoan } from '../ScheduleTable';
import type { FinancialEvent, LoanDetail } from '../types';
import { WhyBlocked } from '../origination/WhyBlocked';
import { RestructuredBadge } from './LoansList';
import { DisbursementPanel } from './DisbursementPanel';
import { RepaymentForm } from './RepaymentForm';
import { SettlementPanel } from './SettlementPanel';
import { ReverseEventForm } from './ReverseEvent';
import { WriteOffPanel } from './WriteOffPanel';
import { EventsTable } from './EventsTable';

const ACTIONS = [
    { code: 'loan.disbursement.prepare', label: 'Prepare disbursement' },
    { code: 'loan.disbursement.approve', label: 'Approve disbursement' },
    { code: 'loan.disbursement.execute', label: 'Execute disbursement' },
    { code: 'loan.repayment.post', label: 'Post repayment / settle' },
    { code: 'loan.repayment.reverse', label: 'Reverse repayment' },
    { code: 'loan.writeoff.propose', label: 'Propose write-off' },
    { code: 'loan.writeoff.approve', label: 'Approve write-off' },
    { code: 'restructure.request', label: 'Request restructure' },
];

type Panel = 'disburse' | 'repay' | 'settle' | 'writeoff' | 'restructure' | { reverse: FinancialEvent };

export function LoanDetailView({ id }: { id: string }) {
    const href = useLendingHref();
    const router = useRouter();
    const { showToast } = useToast();
    const loan = useApi<LoanDetail>(`/lending/loans/${id}`);
    const caps = useCapabilities('LOAN_ACCOUNT', id);
    const [panel, setPanel] = useState<Panel | null>(null);

    const d = loan.data;
    if (!d) {
        return (
            <LendingShell title="Loan" back={{ href: '/lending/loans', label: 'Loans' }}>
                {loan.error ? <ErrorBox error={loan.error} /> : <Spinner />}
            </LendingShell>
        );
    }

    const acc = d.account;
    const cur = acc.currency;
    const c = caps.can;
    const done = (msg: string) => {
        showToast(msg, 'success');
        setPanel(null);
        loan.reload();
        caps.reload();
    };
    const close = () => setPanel(null);

    const disbTasks = d.tasks.filter((t) => t.action.includes('DISBURSE') && (t.status === 'PENDING' || t.status === 'APPROVED'));
    const woTasks = d.tasks.filter((t) => t.action.includes('WRITE_OFF') && t.status === 'PENDING');
    const pendingTasks = d.tasks.filter((t) => t.status === 'PENDING' || t.status === 'APPROVED');
    const isBooked = acc.status === 'BOOKED';
    const isActive = acc.status === 'ACTIVE';

    const actionBtn = (label: string, p: Panel, codes: string[], variant: 'primary' | 'secondary' | 'danger' = 'secondary') => {
        const blocked = codes.map((code) => c(code)).filter((r) => !r.allowed);
        const allowed = blocked.length < codes.length; // usable if any of the involved actions is permitted
        return (
            <Btn variant={variant} onClick={() => setPanel(p)} disabled={!allowed} reason={allowed ? undefined : blocked.map((b) => b.reason).join('\n')}>
                {label}
            </Btn>
        );
    };

    // Schedule grouped by agreement version: current first, older versions collapsed.
    const versions = Array.from(new Set(d.schedule.map((l) => l.agreementVersion))).sort((a, b) => b - a);
    const versionMeta = new Map(d.agreementVersions.map((v) => [v.version, v]));
    const reverseAllowed = c('loan.repayment.reverse');

    return (
        <LendingShell
            title={<span className="flex items-center gap-2">{acc.reference} <StatusBadge status={acc.status} /> {acc.isRestructured && <RestructuredBadge />}</span>}
            subtitle={`${d.productCode} · agreement v${d.agreementVersion} · product version ${d.productVersionStatus}`}
            back={{ href: '/lending/loans', label: 'Loans' }}
            actions={<Btn variant="ghost" onClick={() => { loan.reload(); caps.reload(); }}>Refresh</Btn>}
        >
            {loan.error && <ErrorBox error={loan.error} />}

            <Card title="Account">
                <KV
                    cols={4}
                    items={[
                        ['Booked principal', <Money key="bp" value={acc.bookedPrincipal} currency={cur} />],
                        ['Principal outstanding', <Money key="po" value={acc.principalOutstanding} currency={cur} />],
                        ['Interest receivable', <Money key="ir" value={acc.interestReceivable} currency={cur} />],
                        ['Fees receivable', <Money key="fr" value={acc.feesReceivable} currency={cur} />],
                        ['Penalty receivable', <Money key="pr" value={acc.penaltyReceivable} currency={cur} />],
                        ['Instalment', <Money key="in" value={acc.instalmentAmount} currency={cur} />],
                        ['Days past due', <span key="dpd" className={acc.daysPastDue > 0 ? 'text-red-600 font-semibold' : ''}>{acc.daysPastDue}</span>],
                        ['Delinquency bucket', <StatusBadge key="b" status={acc.delinquencyBucket} />],
                        ['Collection stage', acc.collectionStage ?? '—'],
                        ['Disbursed', acc.disbursementDate?.slice(0, 10) ?? '—'],
                        ['Maturity', acc.maturityDate?.slice(0, 10) ?? '—'],
                        ['Last accrual', acc.lastAccrualDate?.slice(0, 10) ?? '—'],
                        ['Restructured', acc.isRestructured ? `Yes (${acc.restructureCount}×)` : 'No'],
                        ['Probation remaining', acc.probationRemaining > 0 ? `${acc.probationRemaining} instalment(s)` : '—'],
                        ['Delinquency floor', acc.delinquencyFloorBucket ?? '—'],
                        ['Application', acc.applicationId ? <Link key="app" href={href(`/lending/applications/${acc.applicationId}`)} className="text-[#635BFF] hover:underline">open application</Link> : '—'],
                    ]}
                />
            </Card>

            <Card title="Servicing actions" subtitle="Buttons reflect your permissions, policies and limits. The server re-checks every action.">
                <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                        {(isBooked || disbTasks.length > 0) && actionBtn('Disbursement', 'disburse', ['loan.disbursement.prepare', 'loan.disbursement.approve', 'loan.disbursement.execute'], 'primary')}
                        {isActive && actionBtn('Post repayment', 'repay', ['loan.repayment.post'], 'primary')}
                        {isActive && actionBtn('Early settlement', 'settle', ['loan.repayment.post'])}
                        {(isActive || woTasks.length > 0) && actionBtn(woTasks.length ? 'Write-off decision' : 'Propose write-off', 'writeoff', ['loan.writeoff.propose', 'loan.writeoff.approve'], 'danger')}
                        {isActive && actionBtn('Request restructure', 'restructure', ['restructure.request'])}
                    </div>
                    {!isBooked && !isActive && <p className="text-[12px] text-[#697386]">This account is {acc.status.replace(/_/g, ' ').toLowerCase()}; no servicing actions are available.</p>}
                    <WhyBlocked caps={caps.caps} actions={ACTIONS} />

                    {panel === 'disburse' && <DisbursementPanel loanId={id} currency={cur} tasks={d.tasks} can={c} onDone={done} onClose={close} />}
                    {panel === 'repay' && <RepaymentForm loanId={id} currency={cur} can={c} onDone={done} onClose={close} />}
                    {panel === 'settle' && <SettlementPanel loanId={id} can={c} onDone={done} onClose={close} />}
                    {panel === 'writeoff' && <WriteOffPanel loanId={id} currency={cur} tasks={d.tasks} can={c} onDone={done} onClose={close} />}
                    {panel === 'restructure' && (
                        <RequestRestructureForm
                            loanId={id}
                            onCreated={(caseId) => router.push(href(`/lending/restructures/${caseId}`))}
                            onCancel={close}
                        />
                    )}
                </div>
            </Card>

            <Card className="opacity-80">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <p className="text-[13px] font-bold text-slate-500">Refinancing / negotiated settlement — not available</p>
                        <p className="text-[12px] text-[#697386]">These servicing flows are not implemented in this release. See the capability matrix for status.</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Btn disabled reason="Not implemented — see capability matrix">Refinance</Btn>
                        <Link href={href('/lending/catalogue')} className="text-[12px] font-semibold text-[#635BFF] hover:underline">Capability matrix →</Link>
                    </div>
                </div>
            </Card>

            {pendingTasks.length > 0 && (
                <Card title="Open tasks" bodyClass="p-0">
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Action</th><th className={th}>Status</th><th className={thR}>Amount</th><th className={th}>Maker</th><th className={th}>Created</th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {pendingTasks.map((t) => (
                                <tr key={t.id}>
                                    <td className={td}><span className="font-mono text-[12px]">{t.action}</span></td>
                                    <td className={td}><StatusBadge status={t.status} /></td>
                                    <td className={tdR}>{t.amount ? <MoneyCell value={t.amount} currency={t.currency ?? cur} /> : '—'}</td>
                                    <td className={td}><span className="font-mono text-[11px]">{t.makerId.slice(0, 8)}</span></td>
                                    <td className={`${td} whitespace-nowrap`}>{fmtDateTime(t.createdAt)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </Card>
            )}

            <Card title="Schedule" subtitle="Grouped by agreement version. Superseded versions are kept — history is never erased.">
                {versions.length === 0 ? <Empty>No schedule lines.</Empty> : (
                    <div className="space-y-4">
                        {versions.map((v) => {
                            const meta = versionMeta.get(v);
                            const lines = d.schedule.filter((l) => l.agreementVersion === v);
                            const label = `Agreement v${v}${meta ? ` · ${meta.reason} · effective ${meta.effectiveDate}` : ''} · ${lines.length} line${lines.length === 1 ? '' : 's'}`;
                            const table = <ScheduleTable rows={rowsFromLoan(lines)} currency={cur} />;
                            return v === d.agreementVersion ? (
                                <div key={v}>
                                    <p className="text-[12px] font-bold text-[#1A1F36] mb-2">{label} <span className="ml-1 text-[10px] font-bold uppercase text-emerald-700">current</span></p>
                                    {table}
                                </div>
                            ) : (
                                <Disclosure key={v} summary={label}>{table}</Disclosure>
                            );
                        })}
                    </div>
                )}
            </Card>

            <Card title="Agreement versions" bodyClass="p-0">
                {d.agreementVersions.length === 0 ? <Empty>No agreement versions.</Empty> : (
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Version</th><th className={th}>Reason</th><th className={th}>Effective</th><th className={th}>Engine</th><th className={th}>Config hash</th><th className={th}>Created</th><th className={th}>By</th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {[...d.agreementVersions].reverse().map((v) => (
                                <tr key={v.version} className={v.version === d.agreementVersion ? 'bg-emerald-50/30' : ''}>
                                    <td className={td}>v{v.version}{v.version === d.agreementVersion && <span className="ml-1 text-[10px] font-bold uppercase text-emerald-700">current</span>}</td>
                                    <td className={td}>{v.reason}</td>
                                    <td className={`${td} whitespace-nowrap`}>{v.effectiveDate?.slice(0, 10)}</td>
                                    <td className={td}><span className="font-mono text-[11px]">{v.engineVersion}</span></td>
                                    <td className={td}><span className="font-mono text-[11px]" title={v.configHash}>{v.configHash?.slice(0, 12)}</span></td>
                                    <td className={`${td} whitespace-nowrap`}>{fmtDateTime(v.createdAt)}</td>
                                    <td className={td}><span className="font-mono text-[11px]">{v.createdBy?.slice(0, 8)}</span></td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Card>

            <Card title="Financial events" subtitle="Newest first. Expand a row for journal lines, allocation and components." bodyClass="p-0">
                {panel && typeof panel === 'object' && (
                    <div className="p-4 border-b border-[#E3E8EE]">
                        <ReverseEventForm key={panel.reverse.id} loanId={id} event={panel.reverse} can={c} onDone={done} onClose={close} />
                    </div>
                )}
                {d.events.length === 0 ? <Empty>No financial events yet.</Empty> : (
                    <EventsTable events={[...d.events].reverse()} currency={cur} reverseAllowed={reverseAllowed} onReverse={(e) => setPanel({ reverse: e })} />
                )}
            </Card>
            {d.events.some((e) => e.status === 'REVERSED') && (
                <Notice tone="info">Reversed events stay in the history; each reversal is posted as its own compensating event.</Notice>
            )}
        </LendingShell>
    );
}
