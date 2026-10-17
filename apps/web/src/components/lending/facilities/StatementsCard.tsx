"use client";

import type { ReactNode } from 'react';
import { Card, Empty, Table, td, tdR, th, thR } from '../ui';
import { fmtDateTime } from '../format';
import { MoneyCell } from '../MoneyCell';
import type { FacilityStatementRow } from './types';

/** Period statements, newest first (the API returns the latest 24). */
export function StatementsCard({ statements, currency, actions }: { statements: FacilityStatementRow[]; currency: string; actions?: ReactNode }) {
    return (
        <Card title="Statements" subtitle="Append-only: a correction is a later statement, never an edit. Period end is exclusive." actions={actions} bodyClass="p-0">
            {statements.length === 0 ? <Empty>No statements generated yet.</Empty> : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>#</th>
                            <th className={th}>Period</th>
                            <th className={thR}>Opening</th>
                            <th className={thR}>Drawdowns</th>
                            <th className={thR}>Repayments</th>
                            <th className={thR}>Interest</th>
                            <th className={thR}>Over-limit int.</th>
                            <th className={thR}>Commitment fee</th>
                            <th className={thR}>Closing</th>
                            <th className={thR}>Charges</th>
                            <th className={th}>Minimum due</th>
                            <th className={th}>Generated</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {statements.map((s) => (
                            <tr key={s.id}>
                                <td className={td}>{s.sequence}</td>
                                <td className={`${td} whitespace-nowrap`}>{s.periodStart} → {s.periodEnd}</td>
                                <td className={tdR}><MoneyCell value={s.openingBalance} currency={currency} /></td>
                                <td className={tdR}><MoneyCell value={s.drawdowns} /></td>
                                <td className={tdR}><MoneyCell value={s.repayments} /></td>
                                <td className={tdR}><MoneyCell value={s.interest} /></td>
                                <td className={tdR}><MoneyCell value={s.overlimitInterest} highlightNonZero /></td>
                                <td className={tdR}><MoneyCell value={s.commitmentFee} /></td>
                                <td className={tdR}><MoneyCell value={s.closingBalance} strong /></td>
                                <td className={tdR}><MoneyCell value={s.chargesRaised} strong /></td>
                                <td className={`${td} whitespace-nowrap`}>
                                    {s.minimumPayment ? <><MoneyCell value={s.minimumPayment} /> <span className="text-[11px] text-[#697386]">by {s.minimumPaymentDue ?? '—'}</span></> : '—'}
                                </td>
                                <td className={`${td} whitespace-nowrap`}>
                                    <span className="text-[12px]">{fmtDateTime(s.createdAt)}</span>
                                    <div className="font-mono text-[10px] text-[#8792A2]">{s.engineVersion}</div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
        </Card>
    );
}
