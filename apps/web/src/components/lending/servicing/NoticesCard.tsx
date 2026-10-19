"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useLendingHref } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, Field, SelectInput, Spinner, Table, TextInput, td, tdR, th, thR } from '../ui';
import { qs, useApi } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { useTranslations } from 'next-intl';

interface Notice {
    loanAccountId: string; reference: string; borrower: string; phone: string | null; instalment: number;
    dueDate: string; amount: string; currency: string; daysPastDue: number; text: string;
}

/** Reminders before a due date and notices after it (OPS-7), with the message for each borrower. */
export function NoticesCard() {
    const tl = useTranslations('LendingServicing.notices');
    const href = useLendingHref();
    const [kind, setKind] = useState('DUE_SOON');
    const [days, setDays] = useState('7');
    const [open, setOpen] = useState<string | null>(null);
    const r = useApi<{ businessDate: string; notices: Notice[] }>(`/lending/ops/notices${qs({ kind, days })}`);
    const copy = (n: Notice) => { void navigator.clipboard?.writeText(n.text); setOpen(`${n.loanAccountId}:${n.instalment}`); };
    return (
        <Card
            title={tl('title')}
            subtitle={r.data ? tl('subtitleAsOf', { date: r.data.businessDate, count: r.data.notices.length }) : tl('subtitle')}
            actions={<Btn variant="ghost" onClick={r.reload}>{tl('refresh')}</Btn>}
            bodyClass="p-0"
        >
            <div data-tour="coll-notices" className="flex flex-wrap items-end gap-2 p-4 border-b border-[#E3E8EE]">
                <Field label={tl('notice')}>
                    <SelectInput value={kind} onChange={setKind} options={[{ value: 'DUE_SOON', label: tl('kinds.DUE_SOON') }, { value: 'OVERDUE', label: tl('kinds.OVERDUE') }]} />
                </Field>
                {kind === 'DUE_SOON' && <Field label={tl('withinDays')}><TextInput value={days} onChange={setDays} inputMode="numeric" className="w-20" /></Field>}
            </div>
            {r.error && <div className="p-4"><ErrorBox error={r.error} /></div>}
            {r.loading && !r.data ? <Spinner /> : !r.data?.notices.length ? (!r.error && <Empty>{tl('empty')}</Empty>) : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>{tl('columns.loan')}</th><th className={th}>{tl('columns.borrower')}</th><th className={th}>{tl('columns.phone')}</th>
                            <th className={thR}>{tl('columns.instalment')}</th><th className={th}>{tl('columns.due')}</th><th className={thR}>{tl('columns.amount')}</th><th className={th}>{tl('columns.message')}</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {r.data.notices.map((n) => {
                            const k = `${n.loanAccountId}:${n.instalment}`;
                            return (
                                <tr key={k}>
                                    <td className={td}><Link href={href(`/lending/loans/${n.loanAccountId}`)} className="font-mono text-[12px] font-semibold text-[#635BFF] hover:underline">{n.reference}</Link></td>
                                    <td className={td}>{n.borrower}</td>
                                    <td className={td}>{n.phone ?? '—'}</td>
                                    <td className={tdR}>{n.instalment}</td>
                                    <td className={td}>{n.dueDate}</td>
                                    <td className={tdR}><MoneyCell value={n.amount} currency={n.currency} /></td>
                                    <td className={`${td} max-w-md`}>
                                        <p className="text-[12px] text-[#3C4257]">{n.text}</p>
                                        <Btn size="sm" variant="ghost" onClick={() => copy(n)}>{open === k ? tl('copied') : tl('copy')}</Btn>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </Table>
            )}
        </Card>
    );
}
