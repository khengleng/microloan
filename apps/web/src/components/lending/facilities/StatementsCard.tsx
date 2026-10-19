"use client";

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Card, Empty, Table, td, tdR, th, thR } from '../ui';
import { fmtDateTime } from '../format';
import { MoneyCell } from '../MoneyCell';
import type { FacilityStatementRow } from './types';

/** Period statements, newest first (the API returns the latest 24). */
export function StatementsCard({ statements, currency, actions }: { statements: FacilityStatementRow[]; currency: string; actions?: ReactNode }) {
    const t = useTranslations('LendingFacilities.statements');
    return (
        <Card title={t('title')} subtitle={t('subtitle')} actions={actions} bodyClass="p-0">
            {statements.length === 0 ? <Empty>{t('empty')}</Empty> : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>#</th>
                            <th className={th}>{t('columns.period')}</th>
                            <th className={thR}>{t('columns.opening')}</th>
                            <th className={thR}>{t('columns.drawdowns')}</th>
                            <th className={thR}>{t('columns.repayments')}</th>
                            <th className={thR}>{t('columns.interest')}</th>
                            <th className={thR}>{t('columns.overlimitInterest')}</th>
                            <th className={thR}>{t('columns.commitmentFee')}</th>
                            <th className={thR}>{t('columns.closing')}</th>
                            <th className={thR}>{t('columns.charges')}</th>
                            <th className={th}>{t('columns.minimumDue')}</th>
                            <th className={th}>{t('columns.generated')}</th>
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
                                    {s.minimumPayment ? <><MoneyCell value={s.minimumPayment} /> <span className="text-[11px] text-[#697386]">{t('dueBy', { date: s.minimumPaymentDue ?? '—' })}</span></> : '—'}
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
