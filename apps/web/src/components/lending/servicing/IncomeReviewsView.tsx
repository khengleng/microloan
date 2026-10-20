"use client";

import Link from 'next/link';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Card, Empty, ErrorBox, Spinner, Table, td, tdR, th, thR } from '../ui';
import { useApi } from '../useAsync';
import { fmtDateTime } from '../format';
import { MoneyCell } from '../MoneyCell';
import type { IncomeAssessment } from './IncomeContingentCard';
import { useTranslations } from 'next-intl';

interface Reviews {
    businessDate: string;
    due: { loanId: string; reference: string; currency: string; currentPayment: string; nextReviewDate: string; daysOverdue: number }[];
    pending: (IncomeAssessment & { loanId: string; reference: string; currency: string })[];
}

/** Lending › Income assessments: annual reassessments due, and assessments waiting for a checker. */
export function IncomeReviewsView() {
    const tl = useTranslations('LendingServicing.incomeReviews');
    const tw = useTranslations('Workspace.nav');
    const tp = useTranslations('LendingPages');
    const href = useLendingHref();
    const res = useApi<Reviews>('/lending/income-contingent/reviews');
    const r = res.data;
    return (
        <LendingShell
            title={tw('incomeAssessments')}
            subtitle={tp('incomeAssessments')}
        >
            {res.error && <ErrorBox error={res.error} />}
            {!r ? <Spinner /> : (
                <>
                    <Card title={tl('pendingTitle')} subtitle={tl('pendingSubtitle')} bodyClass="p-0">
                        {r.pending.length === 0 ? <div className="p-5"><Empty>{tl('pendingEmpty')}</Empty></div> : (
                            <Table>
                                <thead>
                                    <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                        <th className={th}>{tl('columns.loan')}</th><th className={th}>{tl('columns.reason')}</th><th className={thR}>{tl('columns.declaredIncome')}</th><th className={thR}>{tl('columns.newInstalment')}</th><th className={th}>{tl('columns.evidence')}</th><th className={th}>{tl('columns.recorded')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {r.pending.map((a) => (
                                        <tr key={a.id}>
                                            <td className={td}><Link href={href(`/lending/loans/${a.loanId}`)} className="font-semibold text-[#635BFF] hover:underline">{a.reference}</Link></td>
                                            <td className={td}>{a.reason.replace(/_/g, ' ').toLowerCase()}</td>
                                            <td className={tdR}><MoneyCell value={a.declaredAnnualIncome} currency={a.currency} /></td>
                                            <td className={tdR}><MoneyCell value={a.periodicPayment} currency={a.currency} strong /></td>
                                            <td className={td}>{a.evidenceType.replace(/_/g, ' ').toLowerCase()}<div className="text-[11px] text-[#697386]">{a.evidenceReference}</div></td>
                                            <td className={td}>{fmtDateTime(a.createdAt)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </Card>
                    <Card title={tl('dueTitle')} subtitle={tl('dueSubtitle', { date: r.businessDate })} bodyClass="p-0">
                        {r.due.length === 0 ? <div className="p-5"><Empty>{tl('dueEmpty')}</Empty></div> : (
                            <Table>
                                <thead>
                                    <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                        <th className={th}>{tl('columns.loan')}</th><th className={thR}>{tl('columns.currentInstalment')}</th><th className={th}>{tl('columns.reviewDue')}</th><th className={thR}>{tl('columns.daysOverdue')}</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {r.due.map((x) => (
                                        <tr key={x.loanId}>
                                            <td className={td}><Link href={href(`/lending/loans/${x.loanId}`)} className="font-semibold text-[#635BFF] hover:underline">{x.reference}</Link></td>
                                            <td className={tdR}><MoneyCell value={x.currentPayment} currency={x.currency} /></td>
                                            <td className={td}>{x.nextReviewDate}</td>
                                            <td className={tdR}>{x.daysOverdue}</td>
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
