"use client";

import Link from 'next/link';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, Spinner, Table, td, tdR, th, thR } from '../ui';
import { useApi } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { fmtDateTime, subDecimal } from '../format';
import { useTranslations } from 'next-intl';
import { Person } from '../People';
import type { RecoveryDeskView } from './types';

/**
 * The recovery desk: repossessions in progress, pawns past their deadline,
 * claims and premiums owed by or to insurers, pending debt sales, surpluses
 * still owed to borrowers, and every recovery decision waiting for a second
 * user. Decisions are taken on the loan screen.
 */
export function RecoveryDesk() {
    const t = useTranslations('LendingRecovery.desk');
    const tt = useTranslations('LendingRecovery.task');
    const tw = useTranslations('Workspace.nav');
    const href = useLendingHref();
    const desk = useApi<RecoveryDeskView>('/lending/recovery');
    const d = desk.data;
    const loanLink = (l?: { id: string; reference: string }) =>
        l ? <Link href={href(`/lending/loans/${l.id}`)} className="font-mono text-[12px] text-[#635BFF] hover:underline">{l.reference}</Link> : '—';
    const head = (...cols: [string, boolean?][]) => (
        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">{cols.map(([c, right]) => <th key={c} className={right ? thR : th}>{c}</th>)}</tr></thead>
    );

    return (
        <LendingShell
            title={tw('recovery')}
            subtitle={d ? t('businessDate', { date: d.businessDate }) : t('subtitle')}
            actions={<Btn variant="ghost" onClick={desk.reload}>{t('refresh')}</Btn>}
        >
            {desk.error && <ErrorBox error={desk.error} />}
            {!d ? (!desk.error && <Spinner />) : (
                <>
                    <Card title={t('awaitingTitle')} subtitle={t('awaitingSubtitle')} bodyClass="p-0">
                        {d.pendingTasks.length === 0 ? <Empty>{t('nothingAwaiting')}</Empty> : (
                            <Table>
                                {head([t('colLoan')], [t('colDecision')], [t('colAmount'), true], [t('colProposedBy')], [t('colProposed')])}
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {d.pendingTasks.map((task) => (
                                        <tr key={task.id}>
                                            <td className={td}>{loanLink(task.loan)}</td>
                                            <td className={td}>{tt(task.action)}</td>
                                            <td className={tdR}>{task.amount ? <MoneyCell value={task.amount} currency={task.currency ?? undefined} /> : '—'}</td>
                                            <td className={td}><Person id={task.makerId} className="text-[12px]" /></td>
                                            <td className={`${td} whitespace-nowrap`}>{fmtDateTime(task.createdAt)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Card>

                    <Card title={t('repossessionsTitle')} bodyClass="p-0">
                        {d.repossessions.length === 0 ? <Empty>{t('none')}</Empty> : (
                            <Table>
                                {head([t('colLoan')], [t('colStatus')], [t('colHeldAt')], [t('colSeized')], [t('colValuation'), true], [t('colDpd'), true])}
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {d.repossessions.map((r) => (
                                        <tr key={r.id}>
                                            <td className={td}>{loanLink(r.loan)}</td>
                                            <td className={td}><StatusBadge status={r.status} /></td>
                                            <td className={td}>{r.location}</td>
                                            <td className={td}>{r.seizedOn}</td>
                                            <td className={tdR}><MoneyCell value={r.valuationAmount} currency={r.loan.currency} /></td>
                                            <td className={tdR}>{r.loan.daysPastDue}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Card>

                    <Card title={t('pawnTitle')} bodyClass="p-0">
                        {d.pawnItems.length === 0 ? <Empty>{t('none')}</Empty> : (
                            <Table>
                                {head([t('colLoan')], [t('colItem')], [t('colCustody')], [t('colRedeemBy')], [t('colStatus')], [t('colValue'), true])}
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {d.pawnItems.map((i) => (
                                        <tr key={i.id}>
                                            <td className={td}>{loanLink(i.loan)}</td>
                                            <td className={td}>{i.description}</td>
                                            <td className={td}>{i.custodyLocation}</td>
                                            <td className={td}>{i.redemptionDeadline}{i.pastDeadline && i.status === 'IN_CUSTODY' && <div className="text-[11px] font-semibold text-red-600">{t('pastDeadline')}</div>}</td>
                                            <td className={td}><StatusBadge status={i.status} /></td>
                                            <td className={tdR}><MoneyCell value={i.appraisedValue} currency={i.loan.currency} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Card>

                    <Card title={t('insurersTitle')} subtitle={t('insurersSubtitle')} bodyClass="p-0">
                        {d.claims.length + d.premiums.length === 0 ? <Empty>{t('nothingOutstanding')}</Empty> : (
                            <Table>
                                {head([t('colLoan')], [t('colWhat')], [t('colStatus')], [t('colOutstanding'), true])}
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {d.claims.map((c) => (
                                        <tr key={c.id}>
                                            <td className={td}>{loanLink(c.loan)}</td>
                                            <td className={td}>{t('claimLine', { event: c.eventType.toLowerCase(), evidence: c.evidenceReference })}</td>
                                            <td className={td}><StatusBadge status={c.status} /></td>
                                            <td className={tdR}><MoneyCell value={c.status === 'PENDING' ? c.amountClaimed : subDecimal(c.amountClaimed, c.received)} currency={c.loan.currency} /></td>
                                        </tr>
                                    ))}
                                    {d.premiums.map((p) => (
                                        <tr key={p.id}>
                                            <td className={td}>{loanLink(p.loan)}</td>
                                            <td className={td}>{t('premiumLine', { insurer: p.insurer, policy: p.policyNumber })}</td>
                                            <td className={td}><StatusBadge status={p.status} /></td>
                                            <td className={tdR}><MoneyCell value={subDecimal(p.premium, p.premiumRemitted)} currency={p.currency} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Card>

                    <Card title={t('debtSalesTitle')} bodyClass="p-0">
                        {d.debtSales.length === 0 ? <Empty>{t('none')}</Empty> : (
                            <Table>
                                {head([t('colLoan')], [t('colBuyer')], [t('colDate')], [t('colPrice'), true])}
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {d.debtSales.map((s) => (
                                        <tr key={s.id}>
                                            <td className={td}>{loanLink(s.loan)}</td>
                                            <td className={td}>{s.buyer}</td>
                                            <td className={td}>{s.saleDate}</td>
                                            <td className={tdR}><MoneyCell value={s.price} currency={s.loan.currency} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Card>

                    <Card title={t('refundsTitle')} bodyClass="p-0">
                        {d.refunds.length === 0 ? <Empty>{t('none')}</Empty> : (
                            <Table>
                                {head([t('colLoan')], [t('colFrom')], [t('colPayee')], [t('colAmount'), true])}
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {d.refunds.map((r) => (
                                        <tr key={r.id}>
                                            <td className={td}>{loanLink(r.loan)}</td>
                                            <td className={td}>{r.source.replace(/_/g, ' ').toLowerCase()}</td>
                                            <td className={td}>{r.payee}</td>
                                            <td className={tdR}><MoneyCell value={r.amount} currency={r.currency} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Card>
                </>
            )}
        </LendingShell>
    );
}
