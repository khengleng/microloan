"use client";

import Link from 'next/link';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Card, Empty, ErrorBox, Spinner, Table, td, tdR, th, thR } from '../ui';
import { useApi } from '../useAsync';
import { fmtDateTime } from '../format';
import { MoneyCell } from '../MoneyCell';
import type { IncomeAssessment } from './IncomeContingentCard';

interface Reviews {
    businessDate: string;
    due: { loanId: string; reference: string; currency: string; currentPayment: string; nextReviewDate: string; daysOverdue: number }[];
    pending: (IncomeAssessment & { loanId: string; reference: string; currency: string })[];
}

/** Lending › Income assessments: annual reassessments due, and assessments waiting for a checker. */
export function IncomeReviewsView() {
    const href = useLendingHref();
    const res = useApi<Reviews>('/lending/income-contingent/reviews');
    const r = res.data;
    return (
        <LendingShell
            title="Income assessments"
            subtitle="Income-contingent loans: the instalment follows the borrower's assessed income. Reassess every year (or on a change of circumstances) with evidence; a second person approves, and the schedule is rebuilt from the next period."
        >
            {res.error && <ErrorBox error={res.error} />}
            {!r ? <Spinner /> : (
                <>
                    <Card title="Waiting for approval" subtitle="Open the loan to check the evidence and approve or reject. You cannot approve an assessment you recorded." bodyClass="p-0">
                        {r.pending.length === 0 ? <div className="p-5"><Empty>Nothing waiting.</Empty></div> : (
                            <Table>
                                <thead>
                                    <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                        <th className={th}>Loan</th><th className={th}>Reason</th><th className={thR}>Declared income</th><th className={thR}>New instalment</th><th className={th}>Evidence</th><th className={th}>Recorded</th>
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
                    <Card title="Annual reassessment due" subtitle={`As of ${r.businessDate}. Until reassessed, the last assessed instalment continues.`} bodyClass="p-0">
                        {r.due.length === 0 ? <div className="p-5"><Empty>No reassessments due.</Empty></div> : (
                            <Table>
                                <thead>
                                    <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                        <th className={th}>Loan</th><th className={thR}>Current instalment</th><th className={th}>Review was due</th><th className={thR}>Days overdue</th>
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
