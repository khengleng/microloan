"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useLendingHref } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, Field, Notice, SelectInput, Spinner, Table, TextInput, td, tdR, th, thR } from '../ui';
import { qs, useApi } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { CHANNEL_LABEL } from './types';
import type { EmployerSummary, ReconBreak, ReconTotals, ReconciliationView } from './types';

export function TotalsTable({ totals }: { totals: ReconTotals[] }) {
    const t = useTranslations('LendingChannels.recon');
    return (
        <Table>
            <thead>
                <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                    <th className={th}>{t('colCurrency')}</th><th className={thR}>{t('colLines')}</th><th className={thR}>{t('colFileTotal')}</th><th className={thR}>{t('colPosted')}</th>
                    <th className={thR}>{t('colReversed')}</th><th className={thR}>{t('colMatched')}</th><th className={thR}>{t('colRefunded')}</th>
                    <th className={thR}>{t('colStillSuspense')}</th><th className={thR}>{t('colDifference')}</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F2F5]">
                {totals.map((tot) => (
                    <tr key={tot.currency}>
                        <td className={`${td} font-bold`}>{tot.currency}</td>
                        <td className={tdR}>{tot.lines}{tot.duplicates > 0 && <span className="text-[11px] text-[#697386]"> {t('dups', { count: tot.duplicates })}</span>}</td>
                        <td className={tdR}><MoneyCell value={tot.fileTotal} strong /></td>
                        <td className={tdR}><MoneyCell value={tot.posted} /></td>
                        <td className={tdR}><MoneyCell value={tot.reversed} highlightNonZero /></td>
                        <td className={tdR}><MoneyCell value={tot.suspenseMatched} /></td>
                        <td className={tdR}><MoneyCell value={tot.suspenseRefunded} /></td>
                        <td className={tdR}><MoneyCell value={tot.suspenseOpen} highlightNonZero /></td>
                        <td className={tdR}><MoneyCell value={tot.difference} highlightNonZero strong /></td>
                    </tr>
                ))}
            </tbody>
        </Table>
    );
}

export function BreaksTable({ breaks }: { breaks: ReconBreak[] }) {
    const t = useTranslations('LendingChannels.recon');
    if (breaks.length === 0) return <div className="p-4"><Notice tone="success" title={t('noBreaks')}>{t('noBreaksBody')}</Notice></div>;
    return (
        <Table>
            <thead>
                <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                    <th className={th}>{t('colBreak')}</th><th className={th}>{t('colLine')}</th><th className={th}>{t('colChannelTxn')}</th><th className={thR}>{t('colAmount')}</th><th className={th}>{t('colWhatToDo')}</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F2F5]">
                {breaks.map((b) => (
                    <tr key={b.lineId}>
                        <td className={td}><StatusBadge status={b.kind === 'UNMATCHED_IN_SUSPENSE' ? 'OPEN' : 'FAILED'} /> <span className="ml-1">{t(`break.${b.kind}`)}</span></td>
                        <td className={td}>{b.lineNo}</td>
                        <td className={`${td} font-mono text-[11px]`}>{b.channelTxnId}</td>
                        <td className={tdR}><MoneyCell value={b.amount} currency={b.currency} /></td>
                        <td className={`${td} text-[12px]`}>{b.detail}</td>
                    </tr>
                ))}
            </tbody>
        </Table>
    );
}

/** Daily reconciliation per channel (UC-18, UC-19). */
export function ReconciliationPanel({ defaultDate }: { defaultDate: string }) {
    const t = useTranslations('LendingChannels.recon');
    const tch = useTranslations('LendingChannels.channel');
    const href = useLendingHref();
    const [date, setDate] = useState(defaultDate);
    const [channel, setChannel] = useState('');
    const rec = useApi<ReconciliationView>(`/lending/payment-channels/reconciliation${qs({ date, channel })}`);
    return (
        <div className="space-y-4">
            <Card>
                <div className="flex flex-wrap items-end gap-3">
                    <Field label={t('valueDate')}><TextInput type="date" value={date} onChange={setDate} /></Field>
                    <Field label={t('channel')}>
                        <SelectInput value={channel} onChange={setChannel} placeholder={t('allChannels')} options={Object.keys(CHANNEL_LABEL).map((value) => ({ value, label: tch(value) }))} />
                    </Field>
                    <Btn variant="ghost" onClick={rec.reload}>{t('refresh')}</Btn>
                </div>
            </Card>
            {rec.error && <ErrorBox error={rec.error} />}
            {rec.loading && !rec.data ? <Spinner /> : rec.data && rec.data.channels.length === 0 ? (
                <Card><Empty>{t('noLines', { date: rec.data.date })}</Empty></Card>
            ) : rec.data?.channels.map((c) => (
                <Card
                    key={c.channel}
                    title={`${CHANNEL_LABEL[c.channel] ? tch(c.channel) : c.channel} — ${rec.data!.date}`}
                    subtitle={<>{t('files')} {c.files.map((x, i) => <span key={x.id}>{i > 0 && ', '}<Link href={href(`/lending/payment-channels?file=${x.id}`)} className="text-[#635BFF] hover:underline">{x.fileName}</Link></span>)}</>}
                    actions={<StatusBadge status={c.breaks.length ? 'OPEN' : 'BALANCED'} />}
                    bodyClass="p-0"
                >
                    <TotalsTable totals={c.totals} />
                    <div className="border-t border-[#E3E8EE]"><BreaksTable breaks={c.breaks} /></div>
                </Card>
            ))}
        </div>
    );
}

/** Per employer and payroll period (UC-19). */
export function PayrollSummaryPanel() {
    const t = useTranslations('LendingChannels.recon');
    const [employer, setEmployer] = useState('');
    const rows = useApi<EmployerSummary[]>(`/lending/payment-channels/payroll-summary${qs({ employer: employer.trim() })}`);
    return (
        <div className="space-y-4">
            <Card>
                <div className="flex flex-wrap items-end gap-3">
                    <Field label={t('employer')} hint={t('employerHint')}><TextInput value={employer} onChange={setEmployer} maxLength={80} /></Field>
                    <Btn variant="ghost" onClick={rows.reload}>{t('refresh')}</Btn>
                </div>
            </Card>
            {rows.error && <ErrorBox error={rows.error} />}
            {rows.loading && !rows.data ? <Spinner /> : rows.data?.length === 0 ? <Card><Empty>{t('noPayroll')}</Empty></Card> : rows.data?.map((r) => (
                <Card key={`${r.employer}-${r.period}`} title={`${r.employer} — ${r.period}`}
                    subtitle={t('payrollSubtitle', { employees: r.employees, files: r.files.length, names: r.files.map((x) => x.fileName).join(', ') })}
                    actions={<StatusBadge status={r.breaks.length ? 'OPEN' : 'BALANCED'} />} bodyClass="p-0">
                    <TotalsTable totals={r.totals} />
                    {r.breaks.length > 0 && <div className="border-t border-[#E3E8EE]"><BreaksTable breaks={r.breaks} /></div>}
                </Card>
            ))}
        </div>
    );
}
