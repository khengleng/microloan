"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useLendingHref } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, Field, SelectInput, Spinner, Table, TextInput, td, tdR, th, thR } from '../ui';
import { qs, useApi } from '../useAsync';
import { MoneyCell } from '../MoneyCell';

interface Notice {
    loanAccountId: string; reference: string; borrower: string; phone: string | null; instalment: number;
    dueDate: string; amount: string; currency: string; daysPastDue: number; text: string;
}

/** Reminders before a due date and notices after it (OPS-7), with the message for each borrower. */
export function NoticesCard() {
    const href = useLendingHref();
    const [kind, setKind] = useState('DUE_SOON');
    const [days, setDays] = useState('7');
    const [open, setOpen] = useState<string | null>(null);
    const r = useApi<{ businessDate: string; notices: Notice[] }>(`/lending/ops/notices${qs({ kind, days })}`);
    const copy = (n: Notice) => { void navigator.clipboard?.writeText(n.text); setOpen(`${n.loanAccountId}:${n.instalment}`); };
    return (
        <Card
            title="Borrower notices"
            subtitle={r.data ? `As of ${r.data.businessDate} — ${r.data.notices.length} notice${r.data.notices.length === 1 ? '' : 's'}` : 'Reminders before a due date and notices once it has passed'}
            actions={<Btn variant="ghost" onClick={r.reload}>Refresh</Btn>}
            bodyClass="p-0"
        >
            <div className="flex flex-wrap items-end gap-2 p-4 border-b border-[#E3E8EE]">
                <Field label="Notice">
                    <SelectInput value={kind} onChange={setKind} options={[{ value: 'DUE_SOON', label: 'Falling due (reminder)' }, { value: 'OVERDUE', label: 'Overdue' }]} />
                </Field>
                {kind === 'DUE_SOON' && <Field label="Within (days)"><TextInput value={days} onChange={setDays} inputMode="numeric" className="w-20" /></Field>}
            </div>
            {r.error && <div className="p-4"><ErrorBox error={r.error} /></div>}
            {r.loading && !r.data ? <Spinner /> : !r.data?.notices.length ? (!r.error && <Empty>No notices to send.</Empty>) : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>Loan</th><th className={th}>Borrower</th><th className={th}>Phone</th>
                            <th className={thR}>Instalment</th><th className={th}>Due</th><th className={thR}>Amount</th><th className={th}>Message</th>
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
                                        <Btn size="sm" variant="ghost" onClick={() => copy(n)}>{open === k ? 'Copied' : 'Copy message'}</Btn>
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
