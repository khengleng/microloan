"use client";

import { type ReactNode, useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/ui/toast';
import { useTranslations } from 'next-intl';
import { useWorkspace } from '@/lib/workspace';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, ErrorBox, KV, Notice, Spinner, Table, td, tdR, th, thR } from '../ui';
import { useApi, useCapabilities } from '../useAsync';
import { fmtRate, fullName, isPositive } from '../format';
import { Money, MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { FacilityTypeLabel } from './FacilitiesList';
import { DrawdownRequestPanel } from './DrawdownRequestPanel';
import { DrawdownsCard } from './DrawdownsCard';
import { ConditionsCard } from './ConditionsCard';
import { LimitChangePanel, LimitChangesCard } from './LimitChangesCard';
import { StatementsCard } from './StatementsCard';
import { FacilityRepaymentPanel, StatementPanel, StatusPanel, TermOutPanel, availableStatusMoves } from './FacilityPanels';
import { SculptingPanel } from './SculptingPanel';
import { BorrowingBaseCard } from './BorrowingBaseCard';
import type { FacilityDetail } from './types';

type Panel = 'drawdown' | 'repay' | 'statement' | 'limit' | 'status' | 'termout';

function Kpi({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
    return (
        <div className="bg-white border border-[#E3E8EE] rounded-lg shadow-sm px-4 py-3 min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">{label}</p>
            <div className="text-[18px] font-bold text-[#1A1F36] mt-0.5 truncate">{children}</div>
            {hint && <div className="text-[11px] text-[#697386] mt-0.5">{hint}</div>}
        </div>
    );
}

function UtilizationBar({ value }: { value: string }) {
    // Display only: the fraction is already computed exactly by the server.
    const pct = Math.max(0, Math.min(100, Number(value) * 100 || 0));
    const over = Number(value) > 1;
    return (
        <div className="h-1.5 rounded bg-slate-100 overflow-hidden mt-1.5">
            <div className={`h-full ${over ? 'bg-red-500' : pct >= 85 ? 'bg-amber-500' : 'bg-[#635BFF]'}`} style={{ width: `${pct}%` }} />
        </div>
    );
}

export function FacilityDetailView({ id }: { id: string }) {
    const href = useLendingHref();
    const { showToast } = useToast();
    const res = useApi<FacilityDetail>(`/lending/facilities/${id}`);
    const d = res.data;
    // Repayments are authorized against the facility's loan account, so its capability map applies.
    const loanCaps = useCapabilities('LOAN_ACCOUNT', d?.loanAccountId ?? null);
    const borrower = useApi<{ firstName?: string | null; lastName?: string | null }>(d ? `/borrowers/${d.facility.borrowerId}` : null);
    const [panel, setPanel] = useState<Panel | null>(null);
    const { can } = useWorkspace();
    const tf = useTranslations('Servicing.facility');
    const tl = useTranslations('LendingFacilities.detail');
    const ts = useTranslations('Status');
    const tw = useTranslations('Workspace.nav');
    const statusLabel = (s: string) => (ts.has(s) ? ts(s) : s.toLowerCase().replace(/_/g, ' '));

    if (!d) {
        return (
            <LendingShell title={tl('loadingTitle')} back={{ href: '/lending/facilities', label: tw('facilities') }}>
                {res.error ? <ErrorBox error={res.error} /> : <Spinner />}
            </LendingShell>
        );
    }

    const f = d.facility;
    const t = d.terms;
    const p = d.position;
    const cur = f.currency;
    const staged = f.facilityType === 'STAGED_DRAWDOWN';
    const status = f.status;

    const done = (msg: string) => {
        showToast(msg, 'success');
        setPanel(null);
        res.reload();
        loanCaps.reload();
    };
    const close = () => setPanel(null);
    const toggle = (pn: Panel) => setPanel((cur2) => (cur2 === pn ? null : pn));

    // Mirror what the API accepts: a card moves money, statements and term-out
    // through the card; a receivables line draws and is repaid through its
    // register; each action needs its permission (the server re-checks).
    const card = !!d.card;
    const receivables = !!d.receivablesKind;
    const canDraw = status === 'ACTIVE' && !card && !receivables && can('facility.drawdown.request');
    const canRepay = !['CLOSED', 'CANCELLED'].includes(status) && !card && !receivables && can('loan.repayment.post');
    const canStatement = ['ACTIVE', 'SUSPENDED', 'EXPIRED'].includes(status) && !card && can('facility.statement.generate');
    const canLimit = ['PENDING', 'ACTIVE', 'SUSPENDED'].includes(status) && can('facility.limit.request');
    const statusMoves = can('facility.manage') ? availableStatusMoves(status) : [];
    const canTermOut = ['ACTIVE', 'EXPIRED'].includes(status) && !card && can('facility.manage');
    // Statement periods never overlap: the next one starts where the last ended.
    const nextPeriodStart = d.statements[0]?.periodEnd ?? f.availabilityFrom ?? '';
    const repayCap = loanCaps.can('loan.repayment.post');
    const openDrawdowns = d.drawdowns.filter((x) => x.status === 'REQUESTED' || x.status === 'APPROVED');
    const borrowerName = borrower.data ? fullName(borrower.data) : null;

    return (
        <LendingShell
            title={<span className="flex items-center gap-2">{f.reference} <StatusBadge status={status} /></span>}
            subtitle={<span className="flex flex-wrap items-center gap-1.5">{tl.rich('subtitle', { type: () => <FacilityTypeLabel type={f.facilityType} />, currency: cur, rate: fmtRate(t.annualRate), created: f.createdAt?.slice(0, 10) ?? '' })}</span>}
            back={{ href: '/lending/facilities', label: tw('facilities') }}
            actions={
                <>
                    <Link href={href(`/lending/loans/${d.loanAccountId}`)} className="inline-flex items-center gap-1.5 rounded font-semibold shadow-sm text-[13px] px-3.5 py-1.5 bg-white hover:bg-slate-50 text-[#3C4257] border border-[#E3E8EE]">
                        {tl('loanAccountLink')}
                    </Link>
                    <Btn variant="ghost" onClick={() => { res.reload(); loanCaps.reload(); }}>{tl('refresh')}</Btn>
                </>
            }
        >
            {res.error && <ErrorBox error={res.error} />}

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <Kpi label={tl('kpi.limit')}><Money value={t.limitAmount} currency={cur} /></Kpi>
                <Kpi label={tl('kpi.drawnBalance')} hint={tl('kpi.totalDrawnHint', { currency: cur, amount: p.totalDrawn })}><Money value={p.outstanding} currency={cur} /></Kpi>
                {d.borrowingBase ? (
                    <Kpi label={tl('kpi.available')} hint={d.borrowingBase.stale ? tl('kpi.staleHint') : tl('kpi.baseHint', { currency: cur, amount: d.borrowingBase.borrowingBase ?? '—' })}><Money value={d.borrowingBase.available} currency={cur} /></Kpi>
                ) : (
                    <Kpi label={tl('kpi.available')} hint={staged ? tl('kpi.stagedHint') : tl('kpi.revolvingHint')}><Money value={p.available} currency={cur} /></Kpi>
                )}
                <Kpi label={tl('kpi.utilization')} hint={<UtilizationBar value={p.utilization} />}>{fmtRate(p.utilization, 2)}</Kpi>
                <Kpi label={tl('kpi.status')}><StatusBadge status={status} /></Kpi>
                <Kpi label={tl('kpi.availabilityEnds')} hint={tl('kpi.maturityHint', { date: t.maturityDate })}>{t.availabilityEnd}</Kpi>
            </div>

            {isPositive(p.overlimit) && (
                <Notice tone="danger" title={tl('overLimit.title')}>
                    {tl.rich('overLimit.body', { amount: () => <Money value={p.overlimit} currency={cur} /> })}
                    {t.overlimitRate ? <> {tl('overLimit.rate', { rate: fmtRate(t.overlimitRate) })}</> : null}
                </Notice>
            )}
            {d.card && (
                <Notice title={tl('card.title', { reference: d.card.reference })}>
                    {tl('card.body')}{' '}
                    <Link href={href(`/lending/cards/${d.card.id}`)} className="font-semibold text-[#635BFF] hover:underline">{tl('card.open')}</Link>
                </Notice>
            )}
            {d.project && (
                <Notice title={tl('project.title', { status: statusLabel(d.project.status) })}>
                    {d.project.capitalizeConstructionInterest ? <>{tl('project.capitalize')} </> : ''}
                    {tl.rich('project.body', { dscr: d.project.targetDscr, link: (chunks) => <Link href={href(`/lending/loans/${d.loanAccountId}`)} className="font-semibold text-[#635BFF] hover:underline">{chunks}</Link> })}
                </Notice>
            )}
            {status === 'SUSPENDED' && <Notice tone="warn" title={tl('suspended.title')}>{tl('suspended.body')}</Notice>}

            <Card title={tl('actions.title')} subtitle={tl('actions.subtitle')}>
                <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                        {canDraw && <Btn variant="primary" onClick={() => toggle('drawdown')}>{tl('actions.requestDrawdown')}</Btn>}
                        {canRepay && <Btn variant="primary" onClick={() => toggle('repay')} disabled={!repayCap.allowed} reason={repayCap.reason}>{tl('actions.postRepayment')}</Btn>}
                        {canStatement && <Btn onClick={() => toggle('statement')}>{tl('actions.generateStatement')}</Btn>}
                        {canLimit && <Btn onClick={() => toggle('limit')}>{tl('actions.requestLimitChange')}</Btn>}
                        {statusMoves.length > 0 && <Btn variant="danger" onClick={() => toggle('status')}>{tl('actions.changeStatus')}</Btn>}
                        {(canTermOut || (d.project && status !== 'TERMED_OUT' && can('facility.manage'))) && <Btn variant="danger" onClick={() => toggle('termout')}>{d.project ? tl('actions.sculptedTermOut') : tl('actions.termOut')}</Btn>}
                    </div>
                    {!canDraw && !canRepay && !canStatement && !canLimit && statusMoves.length === 0 && (
                        <p className="text-[12px] text-[#697386]">{tf('noActions')}</p>
                    )}
                    {receivables && <p className="text-[12px] text-[#697386]">{tf('receivablesNote')} <Link href={href(`/lending/trade/invoices/${id}`)} className="font-semibold text-[#635BFF] hover:underline">{tf('openRegister')}</Link></p>}
                    {openDrawdowns.length > 0 && (
                        <p className="text-[12px] text-[#697386]">{tl('actions.openDrawdowns', { count: openDrawdowns.length })}</p>
                    )}

                    {panel === 'drawdown' && <DrawdownRequestPanel facilityId={id} terms={t} onDone={done} onClose={close} />}
                    {panel === 'repay' && <FacilityRepaymentPanel facilityId={id} currency={cur} outstanding={p.outstanding} can={loanCaps.can} onDone={done} onClose={close} />}
                    {panel === 'statement' && <StatementPanel facilityId={id} currency={cur} periodStart={nextPeriodStart} onDone={done} onClose={close} />}
                    {panel === 'limit' && <LimitChangePanel facilityId={id} currency={cur} currentLimit={t.limitAmount} onDone={done} onClose={close} />}
                    {panel === 'status' && <StatusPanel facilityId={id} status={status} onDone={done} onClose={close} />}
                    {panel === 'termout' && !d.project && <TermOutPanel facilityId={id} currency={cur} availabilityEnd={t.availabilityEnd} maturityDate={t.maturityDate} onDone={done} onClose={close} />}
                    {panel === 'termout' && d.project && <SculptingPanel facilityId={id} currency={cur} availabilityEnd={t.availabilityEnd} maturityDate={t.maturityDate} canTermOut={canTermOut} onDone={done} onClose={close} />}
                </div>
            </Card>

            <Card title={tl('facility.title')}>
                <KV
                    cols={4}
                    items={[
                        [tl('facility.borrower'), <Link key="b" href={href(`/borrowers/${f.borrowerId}`)} className="text-[#635BFF] hover:underline">{borrowerName && borrowerName !== '—' ? borrowerName : <span className="font-mono text-[12px]">{f.borrowerId.slice(0, 8)}</span>}</Link>],
                        [tl('facility.loanAccount'), <Link key="la" href={href(`/lending/loans/${d.loanAccountId}`)} className="text-[#635BFF] hover:underline">{tl('facility.openLoanAccount')}</Link>],
                        [tl('facility.availableFrom'), t.availabilityStart],
                        [tl('facility.availableTo'), t.availabilityEnd],
                        [tl('facility.maturity'), t.maturityDate],
                        [tl('facility.annualRate'), fmtRate(t.annualRate)],
                        [tl('facility.dayCount'), t.dayCount],
                        [tl('facility.totalRepaid'), <Money key="tr" value={p.totalRepaid} currency={cur} />],
                        [tl('facility.chargesRaised'), <Money key="cr" value={f.chargesRaised} currency={cur} />],
                        [tl('facility.minimumDrawdown'), t.minimumDrawdown ? <Money key="mn" value={t.minimumDrawdown} currency={cur} /> : tl('facility.noFloor')],
                        [tl('facility.maximumDrawdown'), t.maximumDrawdown ? <Money key="mx" value={t.maximumDrawdown} currency={cur} /> : tl('facility.upToAvailable')],
                        [tl('facility.commitmentFee'), t.commitmentFeeRate ? tl('facility.commitmentFeeValue', { rate: fmtRate(t.commitmentFeeRate) }) : tl('facility.none')],
                        [tl('facility.overLimit'), t.overlimitRate ? tl('facility.overLimitPriced', { rate: fmtRate(t.overlimitRate) }) : tl('facility.overLimitRefused')],
                        ...(f.facilityType === 'OVERDRAFT'
                            ? [[tl('facility.minimumPayment'), t.minimumPaymentFloor ? tl('facility.minimumPaymentFloor', { rate: fmtRate(t.minimumPaymentRate), currency: cur, floor: t.minimumPaymentFloor }) : tl('facility.minimumPaymentValue', { rate: fmtRate(t.minimumPaymentRate) })] as [string, string]]
                            : []),
                        [tl('facility.lastStatementTo'), d.statements[0]?.periodEnd ?? tl('facility.noneYet')],
                    ]}
                />
            </Card>

            {staged && (
                <Card title={tl('tranches.title')} bodyClass="p-0">
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>{tl('tranches.columns.tranche')}</th>
                                <th className={thR}>{tl('tranches.columns.amount')}</th>
                                <th className={th}>{tl('tranches.columns.availableFrom')}</th>
                                <th className={th}>{tl('tranches.columns.conditions')}</th>
                                <th className={th}>{tl('tranches.columns.state')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {t.tranches.map((tr) => {
                                const conds = d.conditions.filter((c) => c.trancheCode === tr.code);
                                const met = conds.filter((c) => c.status !== 'PENDING').length;
                                const released = p.releasedTranches.includes(tr.code);
                                return (
                                    <tr key={tr.code}>
                                        <td className={td}><span className="font-mono text-[12px] font-semibold">{tr.code}</span></td>
                                        <td className={tdR}><MoneyCell value={tr.amount} currency={cur} /></td>
                                        <td className={`${td} whitespace-nowrap`}>{tr.availableFrom}</td>
                                        <td className={td}>{conds.length ? tl('tranches.metOf', { met, total: conds.length }) : tr.conditions.length ? tr.conditions.join(', ') : tl('tranches.none')}</td>
                                        <td className={td}><StatusBadge status={released ? 'RELEASED' : conds.length && met < conds.length ? 'PENDING' : 'OPEN'} /></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Table>
                </Card>
            )}

            {d.borrowingBase && <BorrowingBaseCard facilityId={id} onDone={done} />}

            <DrawdownsCard
                facilityId={id}
                loanAccountId={d.loanAccountId}
                drawdowns={d.drawdowns}
                onDone={done}
                actions={canDraw && panel !== 'drawdown' ? <Btn size="sm" onClick={() => setPanel('drawdown')}>{tl('newRequest')}</Btn> : undefined}
            />

            {(staged || d.conditions.length > 0) && (
                <ConditionsCard facilityId={id} conditions={d.conditions} tranches={t.tranches} releasedTranches={p.releasedTranches} onDone={done} />
            )}

            <LimitChangesCard facilityId={id} currency={cur} changes={d.limitChanges} onDone={done} />

            <StatementsCard statements={d.statements} currency={cur} />

            <Notice tone="info">
                {tl.rich('servicedNote', { link: (chunks) => <Link href={href(`/lending/loans/${d.loanAccountId}`)} className="font-semibold text-[#635BFF] hover:underline">{chunks}</Link> })}
            </Notice>
        </LendingShell>
    );
}
