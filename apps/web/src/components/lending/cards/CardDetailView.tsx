"use client";

import { type ReactNode, useState } from 'react';
import Link from 'next/link';
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

const TXN_LABEL: Record<string, string> = {
    PURCHASE: 'Purchase',
    CASH_ADVANCE: 'Cash advance',
    PAYMENT: 'Payment',
    PLAN_CONVERSION: 'Converted to plan',
    PLAN_BILLING: 'Plan instalment billed',
};

/** A credit card (LT-07): balances by kind, statements with the grace period, plans. */
export function CardDetailView({ id }: { id: string }) {
    const href = useLendingHref();
    const { showToast } = useToast();
    const res = useApi<CardDetail>(`/lending/cards/${id}`);
    const [panel, setPanel] = useState<Panel | null>(null);
    const d = res.data;

    if (!d) {
        return (
            <LendingShell title="Card" back={{ href: '/lending/cards', label: 'Cards' }}>
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
            subtitle={`Purchases ${fmtRate(d.terms.purchaseAnnualRate)} · cash advances ${fmtRate(d.terms.cashAdvanceAnnualRate)} from day one · payment due ${d.terms.paymentDueDays} days after each statement`}
            back={{ href: '/lending/cards', label: 'Cards' }}
            actions={
                <>
                    <Link href={href(`/lending/facilities/${d.facility.id}`)} className="inline-flex items-center gap-1.5 rounded font-semibold shadow-sm text-[13px] px-3.5 py-1.5 bg-white hover:bg-slate-50 text-[#3C4257] border border-[#E3E8EE]">Credit line →</Link>
                    <Link href={href(`/lending/loans/${d.loanAccountId}`)} className="inline-flex items-center gap-1.5 rounded font-semibold shadow-sm text-[13px] px-3.5 py-1.5 bg-white hover:bg-slate-50 text-[#3C4257] border border-[#E3E8EE]">Ledger account →</Link>
                    <Btn variant="ghost" onClick={res.reload}>Refresh</Btn>
                </>
            }
        >
            {res.error && <ErrorBox error={res.error} />}

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <Kpi label="Limit"><Money value={d.facility.limitAmount} currency={cur} /></Kpi>
                <Kpi label="Available" hint={`Cash available ${cur} ${p.cashAvailable}`}><Money value={p.available} currency={cur} /></Kpi>
                <Kpi label="Purchases"><Money value={p.purchaseBalance} currency={cur} /></Kpi>
                <Kpi label="Cash advances"><Money value={p.cashBalance} currency={cur} /></Kpi>
                <Kpi label="Instalment plans"><Money value={p.planBalance} currency={cur} /></Kpi>
                <Kpi label="Total owed" hint={`Interest ${p.interestOwed} · fees ${p.feesOwed}`}><Money value={p.totalOwed} currency={cur} /></Kpi>
            </div>

            {p.daysPastDue > 0 && <Notice tone="danger" title={`${p.daysPastDue} days past due`}>A minimum payment was not received by its due date.</Notice>}
            {last && (
                <Notice tone={isPositive(last.toPayInFull) ? 'info' : 'success'} title={`Last statement: ${cur} ${last.statementBalance}, due ${last.dueDate}`}>
                    Minimum payment {cur} {last.minimumPayment}. Paid since the statement: {cur} {last.paidSinceStatement}.{' '}
                    {isPositive(last.toPayInFull)
                        ? <>Pay {cur} {last.toPayInFull} more by {last.dueDate} to keep the purchase grace period.</>
                        : <>Paid in full — purchases stay interest-free next cycle.</>}
                </Notice>
            )}

            <Card title="Card actions" subtitle="The server re-checks limits, policy and idempotency on every action.">
                <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                        {active && <Btn variant="primary" onClick={() => toggle('purchase')}>Purchase</Btn>}
                        {active && <Btn onClick={() => toggle('cash')}>Cash advance</Btn>}
                        {open && <Btn variant="primary" onClick={() => toggle('pay')} disabled={!isPositive(p.totalOwed)}>Payment</Btn>}
                        {open && <Btn onClick={() => toggle('statement')}>Generate statement</Btn>}
                        {active && offer && <Btn onClick={() => toggle('plan')} disabled={convertible.length === 0} reason={convertible.length ? undefined : `No purchase of ${cur} ${offer.minAmount} or more in the current cycle`}>Instalment plan</Btn>}
                        {open && <Btn variant="danger" onClick={() => toggle('close')} disabled={isPositive(p.totalOwed)} reason={isPositive(p.totalOwed) ? 'Repay everything owed first' : undefined}>Close card</Btn>}
                    </div>
                    {panel === 'purchase' && <SpendPanel cardId={id} currency={cur} kind="PURCHASE" available={p.available} onDone={done} onClose={close} />}
                    {panel === 'cash' && <SpendPanel cardId={id} currency={cur} kind="CASH_ADVANCE" available={p.cashAvailable} onDone={done} onClose={close} />}
                    {panel === 'pay' && <CardPaymentPanel cardId={id} currency={cur} position={p} onDone={done} onClose={close} />}
                    {panel === 'statement' && <CardStatementPanel cardId={id} currency={cur} periodStart={statedTo ?? d.facility.availabilityFrom ?? ''} businessDate={p.businessDate} onDone={done} onClose={close} />}
                    {panel === 'plan' && offer && <PlanPanel cardId={id} currency={cur} purchases={convertible} offer={offer} onDone={done} onClose={close} />}
                    {panel === 'close' && <CloseCardPanel cardId={id} onDone={done} onClose={close} />}
                </div>
            </Card>

            <Card title="Statements" subtitle="Purchase interest is computed every cycle and waived when the previous statement was paid in full by its due date." bodyClass="p-0">
                {d.statements.length === 0 ? <Empty>No statements yet.</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>#</th><th className={th}>Period</th><th className={th}>Due</th>
                                <th className={thR}>Statement balance</th><th className={thR}>Minimum</th>
                                <th className={thR}>Purchase interest</th><th className={thR}>Waived</th><th className={thR}>Cash interest</th>
                                <th className={thR}>Plan billed</th><th className={th}>Grace</th>
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

            <Card title="Instalment plans" bodyClass="p-0">
                {d.plans.length === 0 ? <Empty>No purchase has been converted into instalments.</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>Status</th><th className={thR}>Principal</th><th className={th}>Term</th>
                                <th className={thR}>Instalment</th><th className={th}>Billed</th><th className={thR}>Remaining</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {d.plans.map((x) => (
                                <tr key={x.id}>
                                    <td className={td}><StatusBadge status={x.status} /></td>
                                    <td className={tdR}><MoneyCell value={x.principal} /></td>
                                    <td className={td}>{x.months} months at {fmtRate(x.annualRate)}</td>
                                    <td className={tdR}><MoneyCell value={x.instalmentAmount} /></td>
                                    <td className={td}>{x.billedCount} of {x.months}</td>
                                    <td className={tdR}><MoneyCell value={x.principalRemaining} strong /></td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Card>

            <Card title="Transactions" subtitle="Each row moves the card's balances; the balances are always the sum of these rows." bodyClass="p-0">
                {d.transactions.length === 0 ? <Empty>No transactions yet.</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>Date</th><th className={th}>Type</th><th className={th}>Merchant / detail</th>
                                <th className={thR}>Amount</th><th className={thR}>Fee</th><th className={thR}>Purchases</th><th className={thR}>Cash</th><th className={thR}>Plans</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {d.transactions.map((t) => (
                                <tr key={t.id}>
                                    <td className={`${td} whitespace-nowrap`}>{t.transactionDate}</td>
                                    <td className={td}>{TXN_LABEL[t.type] ?? t.type}</td>
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

            <Card title="Terms">
                <KV
                    cols={4}
                    items={[
                        ['Purchase rate', fmtRate(d.terms.purchaseAnnualRate)],
                        ['Cash-advance rate', `${fmtRate(d.terms.cashAdvanceAnnualRate)} from the advance date`],
                        ['Cash-advance fee', `${d.terms.cashAdvanceFeeRate ? fmtRate(d.terms.cashAdvanceFeeRate) : '—'} (min ${cur} ${d.terms.cashAdvanceFeeMinimum ?? '0'})`],
                        ['Cash-advance share of limit', fmtRate(d.terms.cashAdvanceLimitShare)],
                        ['Minimum payment', `charges + plan instalment + ${fmtRate(d.terms.minimumPaymentRate)} of principal (floor ${cur} ${d.terms.minimumPaymentFloor})`],
                        ['Payment due', `${d.terms.paymentDueDays} days after the statement`],
                        ['Line availability ends', d.facility.availabilityTo ?? '—'],
                        ['Instalment plans', offer ? `${offer.allowedMonths.join(' / ')} months at ${fmtRate(offer.annualRate)}, from ${cur} ${offer.minAmount}` : 'Not offered'],
                    ]}
                />
            </Card>
        </LendingShell>
    );
}
