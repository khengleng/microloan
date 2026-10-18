"use client";

import { type ReactNode, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useToast } from '@/components/ui/toast';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, KV, Notice, Spinner, Table, td, tdR, th, thR } from '../ui';
import { useApi } from '../useAsync';
import { fmtRate, isPositive } from '../format';
import { Money, MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { CardPaymentPanel, CardStatementPanel, CloseCardPanel, PlanPanel, SpendPanel } from './CardPanels';
import type { CardDetail } from './types';

type Panel = 'purchase' | 'cash' | 'pay' | 'statement' | 'plan' | 'close';

function Kpi({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
    return (
        <div className="bg-white border border-[#E3E8EE] rounded-lg shadow-sm px-4 py-3 min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">{label}</p>
            <div className="text-[18px] font-bold text-[#1A1F36] mt-0.5 truncate">{children}</div>
            {hint && <div className="text-[11px] text-[#697386] mt-0.5">{hint}</div>}
        </div>
    );
}


/** A credit card (LT-07): balances by kind, statements with the grace period, plans. */
export function CardDetailView({ id }: { id: string }) {
    const tc = useTranslations('LendingCards');
    const href = useLendingHref();
    const { showToast } = useToast();
    const res = useApi<CardDetail>(`/lending/cards/${id}`);
    const [panel, setPanel] = useState<Panel | null>(null);
    const d = res.data;

    if (!d) {
        return (
            <LendingShell title={tc('detail.title')} back={{ href: '/lending/cards', label: tc('common.cards') }}>
                {res.error ? <ErrorBox error={res.error} /> : <Spinner />}
            </LendingShell>
        );
    }

    const cur = d.facility.currency;
    const p = d.position;
    const last = p.lastStatement;
    const active = d.card.status === 'ACTIVE' && d.facility.status === 'ACTIVE';
    const open = d.card.status !== 'CLOSED';
    const done = (msg: string) => { showToast(msg, 'success'); setPanel(null); res.reload(); };
    const close = () => setPanel(null);
    const toggle = (pn: Panel) => setPanel((c) => (c === pn ? null : pn));
    const statedTo = d.card.lastStatementTo;
    const offer = d.instalmentPlanTerms;
    const planned = new Set(d.plans.map((x) => x.sourceTransactionId));
    const convertible = offer
        ? d.transactions.filter((t) => t.type === 'PURCHASE' && !planned.has(t.id) && Number(t.amount) >= Number(offer.minAmount) && (!statedTo || t.transactionDate >= statedTo))
        : [];

    return (
        <LendingShell
            title={<span className="flex items-center gap-2">{d.card.reference} <span className="font-mono text-[14px] text-[#697386]">{d.card.maskedNumber}</span> <StatusBadge status={d.card.status} /></span>}
            subtitle={tc('detail.subtitle', { purchaseRate: fmtRate(d.terms.purchaseAnnualRate), cashRate: fmtRate(d.terms.cashAdvanceAnnualRate), days: d.terms.paymentDueDays })}
            back={{ href: '/lending/cards', label: tc('common.cards') }}
            actions={
                <>
                    <Link href={href(`/lending/facilities/${d.facility.id}`)} className="inline-flex items-center gap-1.5 rounded font-semibold shadow-sm text-[13px] px-3.5 py-1.5 bg-white hover:bg-slate-50 text-[#3C4257] border border-[#E3E8EE]">{tc('detail.creditLine')} →</Link>
                    <Link href={href(`/lending/loans/${d.loanAccountId}`)} className="inline-flex items-center gap-1.5 rounded font-semibold shadow-sm text-[13px] px-3.5 py-1.5 bg-white hover:bg-slate-50 text-[#3C4257] border border-[#E3E8EE]">{tc('detail.ledgerAccount')} →</Link>
                    <Btn variant="ghost" onClick={res.reload}>{tc('common.refresh')}</Btn>
                </>
            }
        >
            {res.error && <ErrorBox error={res.error} />}

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <Kpi label={tc('kpi.limit')}><Money value={d.facility.limitAmount} currency={cur} /></Kpi>
                <Kpi label={tc('kpi.available')} hint={tc('kpi.cashAvailable', { amount: `${cur} ${p.cashAvailable}` })}><Money value={p.available} currency={cur} /></Kpi>
                <Kpi label={tc('kpi.purchases')}><Money value={p.purchaseBalance} currency={cur} /></Kpi>
                <Kpi label={tc('kpi.cashAdvances')}><Money value={p.cashBalance} currency={cur} /></Kpi>
                <Kpi label={tc('kpi.instalmentPlans')}><Money value={p.planBalance} currency={cur} /></Kpi>
                <Kpi label={tc('kpi.totalOwed')} hint={tc('kpi.totalOwedHint', { interest: p.interestOwed, fees: p.feesOwed })}><Money value={p.totalOwed} currency={cur} /></Kpi>
            </div>

            {p.daysPastDue > 0 && <Notice tone="danger" title={tc('detail.daysPastDue', { days: p.daysPastDue })}>{tc('detail.minimumMissed')}</Notice>}
            {last && (
                <Notice tone={isPositive(last.toPayInFull) ? 'info' : 'success'} title={tc('detail.lastStatement', { amount: `${cur} ${last.statementBalance}`, dueDate: last.dueDate })}>
                    {tc('detail.lastStatementBody', { minimum: `${cur} ${last.minimumPayment}`, paid: `${cur} ${last.paidSinceStatement}` })}{' '}
                    {isPositive(last.toPayInFull)
                        ? <>{tc('detail.payToKeepGrace', { amount: `${cur} ${last.toPayInFull}`, dueDate: last.dueDate })}</>
                        : <>{tc('detail.paidInFull')}</>}
                </Notice>
            )}

            <Card title={tc('actions.title')} subtitle={tc('actions.subtitle')}>
                <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                        {active && <Btn variant="primary" onClick={() => toggle('purchase')}>{tc('actions.purchase')}</Btn>}
                        {active && <Btn onClick={() => toggle('cash')}>{tc('actions.cashAdvance')}</Btn>}
                        {open && <Btn variant="primary" onClick={() => toggle('pay')} disabled={!isPositive(p.totalOwed)}>{tc('actions.payment')}</Btn>}
                        {open && <Btn onClick={() => toggle('statement')}>{tc('actions.generateStatement')}</Btn>}
                        {active && offer && <Btn onClick={() => toggle('plan')} disabled={convertible.length === 0} reason={convertible.length ? undefined : tc('actions.noConvertible', { amount: `${cur} ${offer.minAmount}` })}>{tc('actions.instalmentPlan')}</Btn>}
                        {open && <Btn variant="danger" onClick={() => toggle('close')} disabled={isPositive(p.totalOwed)} reason={isPositive(p.totalOwed) ? tc('actions.repayFirst') : undefined}>{tc('actions.closeCard')}</Btn>}
                    </div>
                    {panel === 'purchase' && <SpendPanel cardId={id} currency={cur} kind="PURCHASE" available={p.available} onDone={done} onClose={close} />}
                    {panel === 'cash' && <SpendPanel cardId={id} currency={cur} kind="CASH_ADVANCE" available={p.cashAvailable} onDone={done} onClose={close} />}
                    {panel === 'pay' && <CardPaymentPanel cardId={id} currency={cur} position={p} onDone={done} onClose={close} />}
                    {panel === 'statement' && <CardStatementPanel cardId={id} currency={cur} periodStart={statedTo ?? d.facility.availabilityFrom ?? ''} businessDate={p.businessDate} onDone={done} onClose={close} />}
                    {panel === 'plan' && offer && <PlanPanel cardId={id} currency={cur} purchases={convertible} offer={offer} onDone={done} onClose={close} />}
                    {panel === 'close' && <CloseCardPanel cardId={id} onDone={done} onClose={close} />}
                </div>
            </Card>

            <Card title={tc('statements.title')} subtitle={tc('statements.subtitle')} bodyClass="p-0">
                {d.statements.length === 0 ? <Empty>{tc('statements.empty')}</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>#</th><th className={th}>{tc('statements.col.period')}</th><th className={th}>{tc('statements.col.due')}</th>
                                <th className={thR}>{tc('statements.col.balance')}</th><th className={thR}>{tc('statements.col.minimum')}</th>
                                <th className={thR}>{tc('statements.col.purchaseInterest')}</th><th className={thR}>{tc('statements.col.waived')}</th><th className={thR}>{tc('statements.col.cashInterest')}</th>
                                <th className={thR}>{tc('statements.col.planBilled')}</th><th className={th}>{tc('statements.col.grace')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {d.statements.map((s) => (
                                <tr key={s.id}>
                                    <td className={td}>{s.sequence}</td>
                                    <td className={`${td} whitespace-nowrap`}>{s.periodStart} → {s.periodEnd}</td>
                                    <td className={`${td} whitespace-nowrap`}>{s.dueDate}</td>
                                    <td className={tdR}><MoneyCell value={s.statementBalance} strong /></td>
                                    <td className={tdR}><MoneyCell value={s.minimumPayment} /></td>
                                    <td className={tdR}><MoneyCell value={s.purchaseInterest} /></td>
                                    <td className={tdR}><MoneyCell value={s.purchaseInterestWaived} muted /></td>
                                    <td className={tdR}><MoneyCell value={s.cashInterest} /></td>
                                    <td className={tdR}><MoneyCell value={s.planPrincipalBilled} /> <span className="text-[11px] text-[#697386]">+ {s.planInterest}</span></td>
                                    <td className={td}>{s.graceApplied ? <StatusBadge status="APPLIED" /> : <StatusBadge status="LOST" />}</td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Card>

            <Card title={tc('plans.title')} bodyClass="p-0">
                {d.plans.length === 0 ? <Empty>{tc('plans.empty')}</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>{tc('plans.col.status')}</th><th className={thR}>{tc('plans.col.principal')}</th><th className={th}>{tc('plans.col.term')}</th>
                                <th className={thR}>{tc('plans.col.instalment')}</th><th className={th}>{tc('plans.col.billed')}</th><th className={thR}>{tc('plans.col.remaining')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {d.plans.map((x) => (
                                <tr key={x.id}>
                                    <td className={td}><StatusBadge status={x.status} /></td>
                                    <td className={tdR}><MoneyCell value={x.principal} /></td>
                                    <td className={td}>{tc('plans.termValue', { months: x.months, rate: fmtRate(x.annualRate) })}</td>
                                    <td className={tdR}><MoneyCell value={x.instalmentAmount} /></td>
                                    <td className={td}>{tc('plans.billedValue', { billed: x.billedCount, months: x.months })}</td>
                                    <td className={tdR}><MoneyCell value={x.principalRemaining} strong /></td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Card>

            <Card title={tc('transactions.title')} subtitle={tc('transactions.subtitle')} bodyClass="p-0">
                {d.transactions.length === 0 ? <Empty>{tc('transactions.empty')}</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>{tc('transactions.col.date')}</th><th className={th}>{tc('transactions.col.type')}</th><th className={th}>{tc('transactions.col.detail')}</th>
                                <th className={thR}>{tc('transactions.col.amount')}</th><th className={thR}>{tc('transactions.col.fee')}</th><th className={thR}>{tc('transactions.col.purchases')}</th><th className={thR}>{tc('transactions.col.cash')}</th><th className={thR}>{tc('transactions.col.plans')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {d.transactions.map((t) => (
                                <tr key={t.id}>
                                    <td className={`${td} whitespace-nowrap`}>{t.transactionDate}</td>
                                    <td className={td}>{tc.has(`txn.${t.type}`) ? tc(`txn.${t.type}`) : t.type}</td>
                                    <td className={td}>{t.merchantName || t.description || '—'}</td>
                                    <td className={tdR}><MoneyCell value={t.amount} strong /></td>
                                    <td className={tdR}><MoneyCell value={t.fee} muted /></td>
                                    <td className={tdR}><MoneyCell value={t.purchaseDelta} muted /></td>
                                    <td className={tdR}><MoneyCell value={t.cashDelta} muted /></td>
                                    <td className={tdR}><MoneyCell value={t.planDelta} muted /></td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Card>

            <Card title={tc('terms.title')}>
                <KV
                    cols={4}
                    items={[
                        [tc('terms.purchaseRate'), fmtRate(d.terms.purchaseAnnualRate)],
                        [tc('terms.cashRate'), tc('terms.cashRateValue', { rate: fmtRate(d.terms.cashAdvanceAnnualRate) })],
                        [tc('terms.cashFee'), tc('terms.cashFeeValue', { rate: d.terms.cashAdvanceFeeRate ? fmtRate(d.terms.cashAdvanceFeeRate) : '—', minimum: `${cur} ${d.terms.cashAdvanceFeeMinimum ?? '0'}` })],
                        [tc('terms.cashShare'), fmtRate(d.terms.cashAdvanceLimitShare)],
                        [tc('terms.minimumPayment'), tc('terms.minimumPaymentValue', { rate: fmtRate(d.terms.minimumPaymentRate), floor: `${cur} ${d.terms.minimumPaymentFloor}` })],
                        [tc('terms.paymentDue'), tc('terms.paymentDueValue', { days: d.terms.paymentDueDays })],
                        [tc('terms.availabilityEnds'), d.facility.availabilityTo ?? '—'],
                        [tc('terms.instalmentPlans'), offer ? tc('terms.instalmentPlansValue', { months: offer.allowedMonths.join(' / '), rate: fmtRate(offer.annualRate), minimum: `${cur} ${offer.minAmount}` }) : tc('terms.notOffered')],
                    ]}
                />
            </Card>
        </LendingShell>
    );
}
