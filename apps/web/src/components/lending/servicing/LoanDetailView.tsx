"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/toast';
import { useTranslations } from 'next-intl';
import { Person } from '../People';
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
import { PayoffLettersPanel } from './PayoffLettersPanel';
import { ArrearsRemediesPanel } from './ArrearsRemediesPanel';
import { ReverseEventForm } from './ReverseEvent';
import { WriteOffPanel } from './WriteOffPanel';
import { EventsTable } from './EventsTable';
import { AdvanceRefundPanel } from './AdvanceRefundPanel';
import { NegotiatedSettlementPanel } from './NegotiatedSettlementPanel';
import { RecoveryPanel } from './RecoveryPanel';
import { GroupContributionsPanel } from '../groups/GroupContributionsPanel';
import { LoanHolidayPanel } from '../relief/LoanHolidayPanel';
import { RateResetsPanel } from '../relief/RateResetsPanel';
import { FeeWaiverPanel } from './FeeWaiverPanel';
import { CoolingOffPanel, type CoolingOffStatus } from './CoolingOffPanel';
import { LoanCollateralCard } from './LoanCollateralCard';
import { LoanDocumentsCard } from './LoanDocumentsCard';
import { CovenantsCard } from './CovenantsCard';
import { ProjectFinanceCard } from '../projects/ProjectFinanceCard';
import { LoanRecoveryCard } from '../recovery/LoanRecoveryCard';
import { LoanMandatesCard } from '../channels/LoanMandatesCard';
import { PurchaseLinkedCard } from './PurchaseLinkedCard';

const ACTIONS = [
    { code: 'loan.disbursement.prepare', key: 'prepareDisbursement' },
    { code: 'loan.disbursement.approve', key: 'approveDisbursement' },
    { code: 'loan.disbursement.execute', key: 'executeDisbursement' },
    { code: 'loan.repayment.post', key: 'postRepayment' },
    { code: 'loan.repayment.reverse', key: 'reverseRepayment' },
    { code: 'loan.writeoff.propose', key: 'proposeWriteOff' },
    { code: 'loan.writeoff.approve', key: 'approveWriteOff' },
    { code: 'restructure.request', key: 'requestRestructure' },
    { code: 'loan.settlement.negotiate', key: 'negotiatedSettlement' },
    { code: 'loan.recovery.post', key: 'postRecovery' },
    { code: 'loan.advance_refund.propose', key: 'proposeAdvanceRefund' },
    { code: 'loan.advance_refund.approve', key: 'approveAdvanceRefund' },
    { code: 'loan.cooling_off.request', key: 'requestCoolingOff' },
    { code: 'loan.cooling_off.approve', key: 'approveCoolingOff' },
];

type Panel = 'disburse' | 'repay' | 'settle' | 'payoff' | 'remedies' | 'writeoff' | 'restructure' | 'advance-refund' | 'negotiated' | 'recovery' | 'group-repay' | 'holiday' | 'rate-resets' | 'fee-waiver' | 'cooling-off' | { reverse: FinancialEvent };

export function LoanDetailView({ id }: { id: string }) {
    const href = useLendingHref();
    const router = useRouter();
    const { showToast } = useToast();
    const loan = useApi<LoanDetail>(`/lending/loans/${id}`);
    const caps = useCapabilities('LOAN_ACCOUNT', id);
    // Group loans take one repayment split by member (UC-22).
    const groupInfo = useApi<{ group: boolean }>(`/lending/loans/${id}/group-members`);
    // A guarantor demand can stay open after the loan cures; it must stay reachable.
    const demands = useApi<{ demands: { status: string }[] }>(`/lending/loans/${id}/guarantor-demands`);
    // The cooling-off window (D-125): the cancel action shows while it is open or a request is in flight.
    const coolingOff = useApi<CoolingOffStatus>(`/lending/loans/${id}/cooling-off`);
    const ts = useTranslations('Servicing.loan');
    const tl = useTranslations('LendingServicing.loanDetail');
    const tw = useTranslations('Workspace.nav');
    const [panel, setPanel] = useState<Panel | null>(null);

    const d = loan.data;
    if (!d) {
        return (
            <LendingShell title={tl('loadingTitle')} back={{ href: '/lending/loans', label: tw('loanAccounts') }}>
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
        coolingOff.reload();
    };
    const coolingOffShown = isCoolingOffShown(coolingOff.data);
    const close = () => setPanel(null);

    const disbTasks = d.tasks.filter((t) => t.action.includes('DISBURSE') && (t.status === 'PENDING' || t.status === 'APPROVED'));
    const woTasks = d.tasks.filter((t) => t.action.includes('WRITE_OFF') && t.status === 'PENDING');
    const pendingTasks = d.tasks.filter((t) => t.status === 'PENDING' || t.status === 'APPROVED');
    const isBooked = acc.status === 'BOOKED';
    const isActive = acc.status === 'ACTIVE';
    const isWrittenOff = acc.status === 'WRITTEN_OFF';
    const advanceHeld = Number(acc.advanceBalance ?? 0) > 0;
    const advanceTasks = d.tasks.filter((t) => t.action === 'ADVANCE_REFUND' && t.status === 'PENDING');
    const openSetOff = d.tasks.some((t) => t.action === 'SET_OFF' && t.status === 'PENDING');
    const openDemand = (demands.data?.demands ?? []).some((x) => x.status === 'OPEN');
    // A facility's account is drawn through the facility, never disbursed.
    const facilityAccount = !!d.facility;

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
            subtitle={tl('subtitle', { product: d.productCode, version: d.agreementVersion, status: d.productVersionStatus })}
            back={{ href: '/lending/loans', label: tw('loanAccounts') }}
            actions={<Btn variant="ghost" onClick={() => { loan.reload(); caps.reload(); }}>{tl('refresh')}</Btn>}
        >
            {loan.error && <ErrorBox error={loan.error} />}

            <Card title={tl('account.title')}>
                <KV
                    cols={4}
                    items={[
                        [tl('account.bookedPrincipal'), <Money key="bp" value={acc.bookedPrincipal} currency={cur} />],
                        [tl('account.principalOutstanding'), <Money key="po" value={acc.principalOutstanding} currency={cur} />],
                        [tl('account.interestReceivable'), <Money key="ir" value={acc.interestReceivable} currency={cur} />],
                        [tl('account.feesReceivable'), <Money key="fr" value={acc.feesReceivable} currency={cur} />],
                        [tl('account.penaltyReceivable'), <Money key="pr" value={acc.penaltyReceivable} currency={cur} />],
                        [tl('account.heldOnAdvance'), <Money key="adv" value={acc.advanceBalance ?? '0'} currency={cur} />],
                        [tl('account.interestAccrual'), acc.nonAccrual
                            ? <span key="na" className="text-amber-700 font-semibold" title={tl('account.nonAccrualHint')}>{tl('account.nonAccrualSince', { date: acc.nonAccrualSince?.slice(0, 10) ?? '—' })}</span>
                            : tl('account.accruing')],
                        [tl('account.interestInSuspense'), <Money key="sus" value={acc.interestInSuspense ?? '0'} currency={cur} />],
                        [tl('account.classification'), acc.classification ? (acc.impairmentStage ? tl('account.classificationStage', { classification: acc.classification.replace(/_/g, ' ').toLowerCase(), stage: acc.impairmentStage }) : acc.classification.replace(/_/g, ' ').toLowerCase()) : tl('account.notClassified')],
                        [tl('account.lossAllowance'), <Money key="allow" value={acc.allowance ?? '0'} currency={cur} />],
                        [tl('account.instalment'), <Money key="in" value={acc.instalmentAmount} currency={cur} />],
                        [tl('account.daysPastDue'), <span key="dpd" className={acc.daysPastDue > 0 ? 'text-red-600 font-semibold' : ''}>{acc.daysPastDue}</span>],
                        [tl('account.delinquencyBucket'), <StatusBadge key="b" status={acc.delinquencyBucket} />],
                        [tl('account.collectionStage'), acc.collectionStage ?? '—'],
                        [tl('account.disbursed'), acc.disbursementDate?.slice(0, 10) ?? '—'],
                        [tl('account.maturity'), acc.maturityDate?.slice(0, 10) ?? '—'],
                        [tl('account.lastAccrual'), acc.lastAccrualDate?.slice(0, 10) ?? '—'],
                        [tl('account.restructured'), acc.isRestructured ? tl('account.restructuredYes', { count: acc.restructureCount }) : tl('account.restructuredNo')],
                        [tl('account.probationRemaining'), acc.probationRemaining > 0 ? tl('account.probationInstalments', { count: acc.probationRemaining }) : '—'],
                        [tl('account.delinquencyFloor'), acc.delinquencyFloorBucket ?? '—'],
                        [tl('account.application'), acc.applicationId ? <Link key="app" href={href(`/lending/applications/${acc.applicationId}`)} className="text-[#635BFF] hover:underline">{tl('account.openApplication')}</Link> : '—'],
                    ]}
                />
            </Card>

            <Card title={tl('actionsCard.title')} subtitle={tl('actionsCard.subtitle')}>
                <div className="space-y-3">
                    <div data-tour="loan-servicing-actions" className="flex flex-wrap gap-2">
                        {(isBooked || disbTasks.length > 0) && !facilityAccount && actionBtn(tl('buttons.disbursement'), 'disburse', ['loan.disbursement.prepare', 'loan.disbursement.approve', 'loan.disbursement.execute'], 'primary')}
                        {isActive && actionBtn(tl('buttons.postRepayment'), 'repay', ['loan.repayment.post'], 'primary')}
                        {isActive && groupInfo.data?.group && actionBtn(tl('buttons.groupRepayment'), 'group-repay', ['loan.repayment.post'])}
                        {isActive && actionBtn(tl('buttons.earlySettlement'), 'settle', ['loan.repayment.post'])}
                        {isActive && actionBtn(tl('buttons.payoffLetters'), 'payoff', ['loan.repayment.post'])}
                        {((isActive && acc.daysPastDue > 0) || openSetOff || openDemand) && actionBtn(tl('buttons.guarantorSetOff'), 'remedies', ['loan.guarantor_demand.issue', 'loan.repayment.post', 'loan.set_off.propose', 'loan.set_off.approve'])}
                        {(isActive || woTasks.length > 0) && actionBtn(woTasks.length ? tl('buttons.writeOffDecision') : tl('buttons.proposeWriteOff'), 'writeoff', ['loan.writeoff.propose', 'loan.writeoff.approve'], 'danger')}
                        {isActive && actionBtn(tl('buttons.requestRestructure'), 'restructure', ['restructure.request'])}
                        {isActive && actionBtn(tl('buttons.negotiatedSettlement'), 'negotiated', ['loan.settlement.negotiate'])}
                        {(advanceHeld || advanceTasks.length > 0) && actionBtn(advanceTasks.length ? tl('buttons.advanceRefundDecision') : tl('buttons.refundAdvance'), 'advance-refund', ['loan.advance_refund.propose', 'loan.advance_refund.approve'])}
                        {isWrittenOff && actionBtn(tl('buttons.recordRecovery'), 'recovery', ['loan.recovery.post'], 'primary')}
                        {isActive && actionBtn(tl('buttons.feeWaiver'), 'fee-waiver', ['loan.fee_waiver.propose', 'loan.fee_waiver.approve'])}
                        {isActive && coolingOffShown && actionBtn(tl('buttons.coolingOff'), 'cooling-off', ['loan.cooling_off.request', 'loan.cooling_off.approve', 'loan.repayment.post'], 'danger')}
                        {isActive && c('payment_holiday.grant').allowed && actionBtn(tl('buttons.paymentHoliday'), 'holiday', ['payment_holiday.grant'])}
                        {isActive && c('loan.rate_reset.apply').allowed && actionBtn(tl('buttons.rateResets'), 'rate-resets', ['loan.rate_reset.apply'])}
                    </div>
                    {facilityAccount && d.facility && (
                        <p className="text-[12px] text-[#697386]">{ts('facilityAccount', { reference: d.facility.reference })} <Link href={href(`/lending/facilities/${d.facility.id}`)} className="font-semibold text-[#635BFF] hover:underline">{ts('openFacility')}</Link></p>
                    )}
                    {!isBooked && !isActive && !isWrittenOff && !advanceHeld && <p className="text-[12px] text-[#697386]">{tl('noActions', { status: acc.status.replace(/_/g, ' ').toLowerCase() })}</p>}
                    <WhyBlocked caps={caps.caps} actions={ACTIONS.map((a) => ({ code: a.code, label: tl(`whyBlocked.${a.key}`) }))} />

                    {panel === 'disburse' && <DisbursementPanel loanId={id} currency={cur} account={acc} tasks={d.tasks} can={c} onDone={done} onClose={close} />}
                    {panel === 'repay' && <RepaymentForm loanId={id} currency={cur} can={c} onDone={done} onClose={close} />}
                    {panel === 'settle' && <SettlementPanel loanId={id} can={c} onDone={done} onClose={close} />}
                    {panel === 'payoff' && <PayoffLettersPanel loanId={id} can={c} onDone={done} onClose={close} />}
                    {panel === 'remedies' && <ArrearsRemediesPanel loanId={id} currency={cur} tasks={d.tasks} can={c} onDone={(m) => { demands.reload(); done(m); }} onClose={() => { demands.reload(); close(); }} />}
                    {panel === 'writeoff' && <WriteOffPanel loanId={id} currency={cur} tasks={d.tasks} can={c} onDone={done} onClose={close} />}
                    {panel === 'group-repay' && (
                        <div className="space-y-2">
                            <GroupContributionsPanel loanId={id} currency={cur} onDone={done} />
                            <Btn variant="ghost" onClick={close}>{tl('close')}</Btn>
                        </div>
                    )}
                    {panel === 'holiday' && <LoanHolidayPanel loanId={id} onDone={done} onClose={close} />}
                    {panel === 'rate-resets' && <RateResetsPanel loanId={id} onDone={done} onClose={close} />}
                    {panel === 'fee-waiver' && <FeeWaiverPanel loanId={id} tasks={d.tasks} can={c} onDone={done} onClose={close} />}
                    {panel === 'cooling-off' && <CoolingOffPanel loanId={id} can={c} onDone={done} onClose={close} />}
                    {panel === 'negotiated' && <NegotiatedSettlementPanel loanId={id} currency={cur} can={c} onDone={done} onClose={close} />}
                    {panel === 'advance-refund' && <AdvanceRefundPanel loanId={id} currency={cur} held={acc.advanceBalance ?? '0'} tasks={d.tasks} can={c} onDone={done} onClose={close} />}
                    {panel === 'recovery' && <RecoveryPanel loanId={id} currency={cur} can={c} onDone={done} onClose={close} />}
                    {panel === 'restructure' && (
                        <RequestRestructureForm
                            loanId={id}
                            onCreated={(caseId) => router.push(href(`/lending/restructures/${caseId}`))}
                            onCancel={close}
                        />
                    )}
                </div>
            </Card>

            <PurchaseLinkedCard loanId={id} detail={d} onDone={done} />

            {acc.status !== 'BOOKED' && <LoanDocumentsCard loanId={id} closed={acc.status === 'CLOSED'} />}
            {d.specialised?.kind === 'PROJECT_FINANCE' && <ProjectFinanceCard loanId={id} can={c} onDone={done} />}
            {['BOOKED', 'ACTIVE'].includes(acc.status) && <CovenantsCard loanId={id} can={c} />}

            {isActive && (
                <Card>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <p className="text-[13px] font-bold text-[#1A1F36]">{tl('refinance.title')}</p>
                            <p className="text-[12px] text-[#697386]">{tl('refinance.body')}</p>
                        </div>
                        <Link href={href(`/lending/applications?refinance=${id}`)} className="text-[13px] font-semibold text-[#635BFF] hover:underline">{tl('refinance.start')}</Link>
                    </div>
                </Card>
            )}

            <LoanCollateralCard loanId={id} currency={cur} status={acc.status} can={c} />
            <LoanRecoveryCard loanId={id} currency={cur} can={c} onChanged={() => { loan.reload(); caps.reload(); }} />

            <LoanMandatesCard loanId={id} status={acc.status} can={c} />

            {pendingTasks.length > 0 && (
                <Card title={tl('openTasks.title')} bodyClass="p-0">
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{tl('openTasks.action')}</th><th className={th}>{tl('openTasks.status')}</th><th className={thR}>{tl('openTasks.amount')}</th><th className={th}>{tl('openTasks.maker')}</th><th className={th}>{tl('openTasks.created')}</th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {pendingTasks.map((t) => (
                                <tr key={t.id}>
                                    <td className={td}><span className="font-mono text-[12px]">{t.action}</span></td>
                                    <td className={td}><StatusBadge status={t.status} /></td>
                                    <td className={tdR}>{t.amount ? <MoneyCell value={t.amount} currency={t.currency ?? cur} /> : '—'}</td>
                                    <td className={td}>{t.makerEmail ? <span className="text-[12px]">{t.makerEmail}</span> : <Person id={t.makerId} className="text-[12px]" />}</td>
                                    <td className={`${td} whitespace-nowrap`}>{fmtDateTime(t.createdAt)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </Card>
            )}

            <Card title={tl('schedule.title')} subtitle={tl('schedule.subtitle')}>
                {versions.length === 0 ? <Empty>{tl('schedule.empty')}</Empty> : (
                    <div className="space-y-4">
                        {versions.map((v) => {
                            const meta = versionMeta.get(v);
                            const lines = d.schedule.filter((l) => l.agreementVersion === v);
                            const label = meta
                                ? tl('schedule.versionLabelMeta', { version: v, reason: meta.reason, date: meta.effectiveDate, count: lines.length })
                                : tl('schedule.versionLabel', { version: v, count: lines.length });
                            const table = <ScheduleTable rows={rowsFromLoan(lines)} currency={cur} />;
                            return v === d.agreementVersion ? (
                                <div key={v}>
                                    <p className="text-[12px] font-bold text-[#1A1F36] mb-2">{label} <span className="ml-1 text-[10px] font-bold uppercase text-emerald-700">{tl('current')}</span></p>
                                    {table}
                                </div>
                            ) : (
                                <Disclosure key={v} summary={label}>{table}</Disclosure>
                            );
                        })}
                    </div>
                )}
            </Card>

            <Card title={tl('versions.title')} bodyClass="p-0">
                {d.agreementVersions.length === 0 ? <Empty>{tl('versions.empty')}</Empty> : (
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{tl('versions.version')}</th><th className={th}>{tl('versions.reason')}</th><th className={th}>{tl('versions.effective')}</th><th className={th}>{tl('versions.policies')}</th><th className={th}>{tl('versions.engine')}</th><th className={th}>{tl('versions.configHash')}</th><th className={th}>{tl('versions.created')}</th><th className={th}>{tl('versions.by')}</th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {[...d.agreementVersions].reverse().map((v) => (
                                <tr key={v.version} className={v.version === d.agreementVersion ? 'bg-emerald-50/30' : ''}>
                                    <td className={td}>v{v.version}{v.version === d.agreementVersion && <span className="ml-1 text-[10px] font-bold uppercase text-emerald-700">{tl('current')}</span>}</td>
                                    <td className={td}>{v.reason}</td>
                                    <td className={`${td} whitespace-nowrap`}>{v.effectiveDate?.slice(0, 10)}</td>
                                    <td className={td}>
                                        {v.policies?.length
                                            ? v.policies.map((p) => (
                                                <span key={p.kind} className="block text-[12px]" title={JSON.stringify(p.parameters)}>
                                                    {p.kind.replace(/_/g, ' ').toLowerCase()}: <b>{p.code}</b> v{p.version}
                                                    {Object.keys(p.parameters).length > 0 && <span className="text-[#697386]"> ({Object.entries(p.parameters).map(([k, val]) => `${k}=${val}`).join(', ')})</span>}
                                                </span>
                                            ))
                                            : <span className="text-[#697386]">{tl('versions.productTerms')}</span>}
                                    </td>
                                    <td className={td}><span className="font-mono text-[11px]">{v.engineVersion}</span></td>
                                    <td className={td}><span className="font-mono text-[11px]" title={v.configHash}>{v.configHash?.slice(0, 12)}</span></td>
                                    <td className={`${td} whitespace-nowrap`}>{fmtDateTime(v.createdAt)}</td>
                                    <td className={td}><Person id={v.createdBy} className="text-[12px]" /></td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Card>

            <Card title={tl('events.title')} subtitle={tl('events.subtitle')} bodyClass="p-0">
                {panel && typeof panel === 'object' && (
                    <div className="p-4 border-b border-[#E3E8EE]">
                        <ReverseEventForm key={panel.reverse.id} loanId={id} event={panel.reverse} can={c} onDone={done} onClose={close} />
                    </div>
                )}
                {d.events.length === 0 ? <Empty>{tl('events.empty')}</Empty> : (
                    <EventsTable events={[...d.events].reverse()} currency={cur} reverseAllowed={reverseAllowed} onReverse={(e) => setPanel({ reverse: e })} />
                )}
            </Card>
            {d.events.some((e) => e.status === 'REVERSED') && (
                <Notice tone="info">{tl('events.reversedNotice')}</Notice>
            )}
        </LendingShell>
    );
}

/** Show the cooling-off action while the window is open or a request is pending or approved. */
function isCoolingOffShown(s: CoolingOffStatus | null | undefined): boolean {
    if (!s) return false;
    return s.open || s.tasks.some((t) => t.status === 'PENDING' || t.status === 'APPROVED');
}
