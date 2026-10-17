"use client";

import Link from 'next/link';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, Spinner, Table, td, tdR, th, thR } from '../ui';
import { useApi } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { fmtDateTime, subDecimal } from '../format';
import { TASK_LABEL, type RecoveryDeskView } from './types';

/**
 * The recovery desk: repossessions in progress, pawns past their deadline,
 * claims and premiums owed by or to insurers, pending debt sales, surpluses
 * still owed to borrowers, and every recovery decision waiting for a second
 * user. Decisions are taken on the loan screen.
 */
export function RecoveryDesk() {
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
            title="Recovery"
            subtitle={d ? `Business date ${d.businessDate}` : 'Repossession, pawn, credit insurance and debt sale'}
            actions={<Btn variant="ghost" onClick={desk.reload}>Refresh</Btn>}
        >
            {desk.error && <ErrorBox error={desk.error} />}
            {!d ? (!desk.error && <Spinner />) : (
                <>
                    <Card title="Awaiting a second user" subtitle="Open the loan to approve or reject." bodyClass="p-0">
                        {d.pendingTasks.length === 0 ? <Empty>Nothing awaiting approval.</Empty> : (
                            <Table>
                                {head(['Loan'], ['Decision'], ['Amount', true], ['Proposed by'], ['Proposed'])}
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {d.pendingTasks.map((t) => (
                                        <tr key={t.id}>
                                            <td className={td}>{loanLink(t.loan)}</td>
                                            <td className={td}>{TASK_LABEL[t.action]}</td>
                                            <td className={tdR}>{t.amount ? <MoneyCell value={t.amount} currency={t.currency ?? undefined} /> : '—'}</td>
                                            <td className={td}><span className="font-mono text-[11px]">{t.makerId.slice(0, 8)}</span></td>
                                            <td className={`${td} whitespace-nowrap`}>{fmtDateTime(t.createdAt)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Card>

                    <Card title="Repossessions in progress" bodyClass="p-0">
                        {d.repossessions.length === 0 ? <Empty>None.</Empty> : (
                            <Table>
                                {head(['Loan'], ['Status'], ['Held at'], ['Seized'], ['Valuation', true], ['DPD', true])}
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

                    <Card title="Pawned items in custody or forfeited" bodyClass="p-0">
                        {d.pawnItems.length === 0 ? <Empty>None.</Empty> : (
                            <Table>
                                {head(['Loan'], ['Item'], ['Custody'], ['Redeem by'], ['Status'], ['Value', true])}
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {d.pawnItems.map((i) => (
                                        <tr key={i.id}>
                                            <td className={td}>{loanLink(i.loan)}</td>
                                            <td className={td}>{i.description}</td>
                                            <td className={td}>{i.custodyLocation}</td>
                                            <td className={td}>{i.redemptionDeadline}{i.pastDeadline && i.status === 'IN_CUSTODY' && <div className="text-[11px] font-semibold text-red-600">past deadline</div>}</td>
                                            <td className={td}><StatusBadge status={i.status} /></td>
                                            <td className={tdR}><MoneyCell value={i.appraisedValue} currency={i.loan.currency} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Card>

                    <Card title="Insurers" subtitle="Claims under consideration or not yet paid by the insurer, and premiums still to remit." bodyClass="p-0">
                        {d.claims.length + d.premiums.length === 0 ? <Empty>Nothing outstanding.</Empty> : (
                            <Table>
                                {head(['Loan'], ['What'], ['Status'], ['Outstanding', true])}
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {d.claims.map((c) => (
                                        <tr key={c.id}>
                                            <td className={td}>{loanLink(c.loan)}</td>
                                            <td className={td}>{c.eventType.toLowerCase()} claim · {c.evidenceReference}</td>
                                            <td className={td}><StatusBadge status={c.status} /></td>
                                            <td className={tdR}><MoneyCell value={c.status === 'PENDING' ? c.amountClaimed : subDecimal(c.amountClaimed, c.received)} currency={c.loan.currency} /></td>
                                        </tr>
                                    ))}
                                    {d.premiums.map((p) => (
                                        <tr key={p.id}>
                                            <td className={td}>{loanLink(p.loan)}</td>
                                            <td className={td}>premium to remit · {p.insurer} {p.policyNumber}</td>
                                            <td className={td}><StatusBadge status={p.status} /></td>
                                            <td className={tdR}><MoneyCell value={subDecimal(p.premium, p.premiumRemitted)} currency={p.currency} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Card>

                    <Card title="Debt sales awaiting approval" bodyClass="p-0">
                        {d.debtSales.length === 0 ? <Empty>None.</Empty> : (
                            <Table>
                                {head(['Loan'], ['Buyer'], ['Date'], ['Price', true])}
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

                    <Card title="Surplus owed to borrowers and estates" bodyClass="p-0">
                        {d.refunds.length === 0 ? <Empty>None.</Empty> : (
                            <Table>
                                {head(['Loan'], ['From'], ['Payee'], ['Amount', true])}
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
