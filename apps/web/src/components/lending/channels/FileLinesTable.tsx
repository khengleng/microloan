"use client";

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useLendingHref } from '../LendingShell';
import { Table, td, tdR, th, thR } from '../ui';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import type { ChannelFileLine } from './types';

/** The lines of an imported file and what became of each. */
export function FileLinesTable({ lines }: { lines: ChannelFileLine[] }) {
    const t = useTranslations('LendingChannels.lines');
    const href = useLendingHref();
    return (
        <Table>
            <thead>
                <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                    <th className={th}>{t('colLine')}</th>
                    <th className={th}>{t('colChannelTxn')}</th>
                    <th className={th}>{t('colPayerRef')}</th>
                    <th className={th}>{t('colValueDate')}</th>
                    <th className={thR}>{t('colAmount')}</th>
                    <th className={th}>{t('colOutcome')}</th>
                    <th className={th}>{t('colAppliedTo')}</th>
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
                                {[l.reference, l.employeeRef && t('employee', { ref: l.employeeRef }), l.nationalIdHint && t('nationalId', { hint: l.nationalIdHint }), l.loanRef && t('loan', { ref: l.loanRef })].filter(Boolean).join(' · ')}
                            </p>
                        </td>
                        <td className={td}>{l.valueDate}</td>
                        <td className={tdR}><MoneyCell value={l.amount} currency={l.currency} /></td>
                        <td className={td}>
                            <StatusBadge status={l.reversed ? 'REVERSED' : l.outcome} />
                            {l.conflicting && <span className="ml-1 text-[11px] font-semibold text-red-700">{t('differs')}</span>}
                            {l.reason && <p className="text-[11px] text-[#697386] mt-0.5 max-w-xs">{l.reason}</p>}
                        </td>
                        <td className={td}>
                            {l.loanAccountId && <Link href={href(`/lending/loans/${l.loanAccountId}`)} className="text-[#635BFF] font-semibold hover:underline">{l.loanReference ?? t('loanFallback')}</Link>}
                            {l.suspense && (
                                <span>
                                    <Link href={href('/lending/suspense')} className="text-[#635BFF] font-semibold hover:underline">{l.suspense.reference}</Link>
                                    <span className="ml-1"><StatusBadge status={l.suspense.status} /></span>
                                    {l.suspense.status === 'OPEN' && <p className="text-[11px] text-[#697386]">{t('stillHeld', { amount: l.suspense.remaining })}</p>}
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
