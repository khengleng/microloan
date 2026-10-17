"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useLendingHref } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, Field, Notice, SelectInput, Spinner, Table, TextInput, td, tdR, th, thR } from '../ui';
import { qs, useApi } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { CHANNEL_LABEL } from './types';
import type { EmployerSummary, ReconBreak, ReconTotals, ReconciliationView } from './types';

const BREAK_LABEL: Record<ReconBreak['kind'], string> = {
    UNMATCHED_IN_SUSPENSE: 'Unmatched in suspense',
    REVERSED: 'Posted, then reversed',
    CONFLICTING_DUPLICATE: 'Repeated id, different payment',
};

export function TotalsTable({ totals }: { totals: ReconTotals[] }) {
    return (
        <Table>
            <thead>
                <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                    <th className={th}>Currency</th><th className={thR}>Lines</th><th className={thR}>File total</th><th className={thR}>Posted</th>
                    <th className={thR}>Reversed</th><th className={thR}>Matched from suspense</th><th className={thR}>Refunded</th>
                    <th className={thR}>Still in suspense</th><th className={thR}>Difference</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F2F5]">
                {totals.map((t) => (
                    <tr key={t.currency}>
                        <td className={`${td} font-bold`}>{t.currency}</td>
                        <td className={tdR}>{t.lines}{t.duplicates > 0 && <span className="text-[11px] text-[#697386]"> ({t.duplicates} dup.)</span>}</td>
                        <td className={tdR}><MoneyCell value={t.fileTotal} strong /></td>
                        <td className={tdR}><MoneyCell value={t.posted} /></td>
                        <td className={tdR}><MoneyCell value={t.reversed} highlightNonZero /></td>
                        <td className={tdR}><MoneyCell value={t.suspenseMatched} /></td>
                        <td className={tdR}><MoneyCell value={t.suspenseRefunded} /></td>
                        <td className={tdR}><MoneyCell value={t.suspenseOpen} highlightNonZero /></td>
                        <td className={tdR}><MoneyCell value={t.difference} highlightNonZero strong /></td>
                    </tr>
                ))}
            </tbody>
        </Table>
    );
}

export function BreaksTable({ breaks }: { breaks: ReconBreak[] }) {
    if (breaks.length === 0) return <div className="p-4"><Notice tone="success" title="No breaks">Every amount the files reported is on a loan or was matched or refunded out of suspense.</Notice></div>;
    return (
        <Table>
            <thead>
                <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                    <th className={th}>Break</th><th className={th}>Line</th><th className={th}>Channel txn</th><th className={thR}>Amount</th><th className={th}>What to do</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-[#F0F2F5]">
                {breaks.map((b) => (
                    <tr key={b.lineId}>
                        <td className={td}><StatusBadge status={b.kind === 'UNMATCHED_IN_SUSPENSE' ? 'OPEN' : 'FAILED'} /> <span className="ml-1">{BREAK_LABEL[b.kind]}</span></td>
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
    const href = useLendingHref();
    const [date, setDate] = useState(defaultDate);
    const [channel, setChannel] = useState('');
    const rec = useApi<ReconciliationView>(`/lending/payment-channels/reconciliation${qs({ date, channel })}`);
    return (
        <div className="space-y-4">
            <Card>
                <div className="flex flex-wrap items-end gap-3">
                    <Field label="Value date"><TextInput type="date" value={date} onChange={setDate} /></Field>
                    <Field label="Channel">
                        <SelectInput value={channel} onChange={setChannel} placeholder="All channels" options={Object.entries(CHANNEL_LABEL).map(([value, label]) => ({ value, label }))} />
                    </Field>
                    <Btn variant="ghost" onClick={rec.reload}>Refresh</Btn>
                </div>
            </Card>
            {rec.error && <ErrorBox error={rec.error} />}
            {rec.loading && !rec.data ? <Spinner /> : rec.data && rec.data.channels.length === 0 ? (
                <Card><Empty>No file lines are valued on {rec.data.date}.</Empty></Card>
            ) : rec.data?.channels.map((c) => (
                <Card
                    key={c.channel}
                    title={`${CHANNEL_LABEL[c.channel] ?? c.channel} — ${rec.data!.date}`}
                    subtitle={<>Files: {c.files.map((x, i) => <span key={x.id}>{i > 0 && ', '}<Link href={href(`/lending/payment-channels?file=${x.id}`)} className="text-[#635BFF] hover:underline">{x.fileName}</Link></span>)}</>}
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
    const [employer, setEmployer] = useState('');
    const rows = useApi<EmployerSummary[]>(`/lending/payment-channels/payroll-summary${qs({ employer: employer.trim() })}`);
    return (
        <div className="space-y-4">
            <Card>
                <div className="flex flex-wrap items-end gap-3">
                    <Field label="Employer" hint="Exact name; blank for all"><TextInput value={employer} onChange={setEmployer} maxLength={80} /></Field>
                    <Btn variant="ghost" onClick={rows.reload}>Refresh</Btn>
                </div>
            </Card>
            {rows.error && <ErrorBox error={rows.error} />}
            {rows.loading && !rows.data ? <Spinner /> : rows.data?.length === 0 ? <Card><Empty>No payroll files imported.</Empty></Card> : rows.data?.map((r) => (
                <Card key={`${r.employer}-${r.period}`} title={`${r.employer} — ${r.period}`}
                    subtitle={`${r.employees} employee(s) · ${r.files.length} file(s): ${r.files.map((x) => x.fileName).join(', ')}`}
                    actions={<StatusBadge status={r.breaks.length ? 'OPEN' : 'BALANCED'} />} bodyClass="p-0">
                    <TotalsTable totals={r.totals} />
                    {r.breaks.length > 0 && <div className="border-t border-[#E3E8EE]"><BreaksTable breaks={r.breaks} /></div>}
                </Card>
            ))}
        </div>
    );
}
