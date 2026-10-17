"use client";

import Link from 'next/link';
import { useLendingHref } from '../LendingShell';
import { Table, td, tdR, th, thR } from '../ui';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import type { ChannelFileLine } from './types';

/** The lines of an imported file and what became of each. */
export function FileLinesTable({ lines }: { lines: ChannelFileLine[] }) {
    const href = useLendingHref();
    return (
        <Table>
            <thead>
                <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                    <th className={th}>Line</th>
                    <th className={th}>Channel txn</th>
                    <th className={th}>Payer / ref</th>
                    <th className={th}>Value date</th>
                    <th className={thR}>Amount</th>
                    <th className={th}>Outcome</th>
                    <th className={th}>Applied to</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F2F5]">
                {lines.map((l) => (
                    <tr key={l.id} className={l.outcome === 'SUSPENSE' && l.suspense?.status === 'OPEN' ? 'bg-amber-50/40' : l.reversed || l.conflicting ? 'bg-red-50/40' : ''}>
                        <td className={td}>{l.lineNo}</td>
                        <td className={`${td} font-mono text-[11px]`}>{l.channelTxnId}</td>
                        <td className={td}>
                            {l.payerName ?? '—'}
                            <p className="text-[11px] text-[#697386]">
                                {[l.reference, l.employeeRef && `employee ${l.employeeRef}`, l.nationalIdHint && `ID …${l.nationalIdHint}`, l.loanRef && `loan ${l.loanRef}`].filter(Boolean).join(' · ')}
                            </p>
                        </td>
                        <td className={td}>{l.valueDate}</td>
                        <td className={tdR}><MoneyCell value={l.amount} currency={l.currency} /></td>
                        <td className={td}>
                            <StatusBadge status={l.reversed ? 'REVERSED' : l.outcome} />
                            {l.conflicting && <span className="ml-1 text-[11px] font-semibold text-red-700">differs from original</span>}
                            {l.reason && <p className="text-[11px] text-[#697386] mt-0.5 max-w-xs">{l.reason}</p>}
                        </td>
                        <td className={td}>
                            {l.loanAccountId && <Link href={href(`/lending/loans/${l.loanAccountId}`)} className="text-[#635BFF] font-semibold hover:underline">{l.loanReference ?? 'Loan'}</Link>}
                            {l.suspense && (
                                <span>
                                    <Link href={href('/lending/suspense')} className="text-[#635BFF] font-semibold hover:underline">{l.suspense.reference}</Link>
                                    <span className="ml-1"><StatusBadge status={l.suspense.status} /></span>
                                    {l.suspense.status === 'OPEN' && <p className="text-[11px] text-[#697386]">still held: {l.suspense.remaining}</p>}
                                </span>
                            )}
                            {!l.loanAccountId && !l.suspense && '—'}
                        </td>
                    </tr>
                ))}
            </tbody>
        </Table>
    );
}
