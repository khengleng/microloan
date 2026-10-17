"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { Btn, Card, Empty, ErrorBox, Spinner, Table, TextInput, td, tdR, th, thR } from '../ui';
import { idem, useAction, useApi, useIdempotencyKey } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { addDecimal, compareDecimal, fmtMoney, fmtRate, isPositive, subDecimal } from '../format';
import { useBorrowerNames } from './borrowers';
import type { GroupRepaymentBody, LoanGroupMembers } from './types';

const MONEY_RE = /^\d+(\.\d{1,4})?$/;

/**
 * Per-member position on a group loan, past contributions, and a form to post
 * one repayment split by member (POST /lending/loans/:id/repayments with
 * `contributions`, which must sum to `amount`).
 */
export function GroupContributionsPanel({ loanId, onDone, currency }: {
    loanId: string; onDone?: (msg: string) => void; currency?: string;
}) {
    const pos = useApi<LoanGroupMembers>(`/lending/loans/${loanId}/group-members`);
    const [amounts, setAmounts] = useState<Record<string, string>>({});
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();

    const d = pos.data;
    const nameOf = useBorrowerNames([
        ...(d?.members.map((m) => m.borrowerId) ?? []),
        ...(d?.contributions.map((c) => c.borrowerId) ?? []),
    ]);

    if (!d) {
        return (
            <Card title="Group members">
                {pos.error ? <ErrorBox error={pos.error} /> : <Spinner />}
            </Card>
        );
    }
    if (!d.group) {
        return (
            <Card title="Group members">
                <Empty>This is not a group loan.</Empty>
            </Card>
        );
    }

    const lines = d.members.map((m) => ({ borrowerId: m.borrowerId, amount: (amounts[m.borrowerId] ?? '').trim() }));
    const filled = lines.filter((l) => l.amount !== '');
    const validLines = filled.every((l) => MONEY_RE.test(l.amount));
    const total = validLines ? addDecimal(...filled.map((l) => l.amount)) : null;

    const fillShare = (borrowerId: string, value: string) => setAmounts((a) => ({ ...a, [borrowerId]: value }));

    const post = async () => {
        if (!validLines) { setProblem('Each amount must be a decimal with up to 4 places.'); return; }
        const contributions = filled.filter((l) => isPositive(l.amount));
        if (!contributions.length || !total || !isPositive(total)) { setProblem('Enter at least one member contribution.'); return; }
        setProblem('');
        const body: GroupRepaymentBody = { amount: total, contributions };
        const k = key.keyFor(body);
        const res = await run('repay', () => api.post(`/lending/loans/${loanId}/repayments`, body, idem(k)));
        if (res) {
            key.reset();
            setAmounts({});
            pos.reload();
            onDone?.(`Group repayment of ${fmtMoney(total)} posted`);
        }
    };

    // Contributions grouped by the repayment event they were recorded against.
    const byEvent = new Map<string, { borrowerId: string; amount: string }[]>();
    for (const c of d.contributions) {
        const list = byEvent.get(c.financialEventId) ?? [];
        list.push(c);
        byEvent.set(c.financialEventId, list);
    }

    return (
        <Card
            title="Group members"
            subtitle={<>Liability <StatusBadge status={d.liability} className="ml-1" /> · principal outstanding <MoneyCell value={d.outstanding} currency={currency} /></>}
            bodyClass="p-0"
            actions={<Btn variant="ghost" size="sm" onClick={pos.reload}>Refresh</Btn>}
        >
            <Table>
                <thead>
                    <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                        <th className={th}>Member</th>
                        <th className={thR}>Share</th>
                        <th className={thR}>Fraction</th>
                        <th className={thR}>Liable for</th>
                        <th className={thR}>Exposure today</th>
                        <th className={thR}>Contributed</th>
                        <th className={thR}>This payment</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-[#F0F2F5]">
                    {d.members.map((m) => {
                        const v = amounts[m.borrowerId] ?? '';
                        const bad = v.trim() !== '' && !MONEY_RE.test(v.trim());
                        const remaining = subDecimal(m.shareAmount, m.contributed);
                        return (
                            <tr key={m.borrowerId} className="hover:bg-[#F7FAFC]">
                                <td className={td}>
                                    <span className="font-semibold text-[#1A1F36]">{nameOf(m.borrowerId)}</span>
                                    {m.role === 'LEADER' && <span className="ml-1.5 text-[11px] font-semibold text-amber-700">Leader</span>}
                                </td>
                                <td className={tdR}><MoneyCell value={m.shareAmount} /></td>
                                <td className={tdR}>{fmtRate(m.shareFraction)}</td>
                                <td className={tdR}><MoneyCell value={m.liableFor} /></td>
                                <td className={tdR}><MoneyCell value={m.exposureToday} strong /></td>
                                <td className={tdR}><MoneyCell value={m.contributed} /></td>
                                <td className={`${tdR} w-44`}>
                                    <TextInput
                                        value={v}
                                        onChange={(x) => fillShare(m.borrowerId, x)}
                                        inputMode="decimal"
                                        placeholder="0.00"
                                        className={`text-right ${bad ? 'border-red-300' : ''}`}
                                    />
                                    {isPositive(remaining) && (
                                        <button type="button" onClick={() => fillShare(m.borrowerId, remaining)} className="mt-0.5 text-[11px] text-[#635BFF] hover:underline">
                                            Rest of share: {fmtMoney(remaining)}
                                        </button>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
                <tfoot>
                    <tr className="border-t border-[#E3E8EE] bg-[#F7FAFC]">
                        <td className={`${td} font-bold`} colSpan={6}>Repayment amount (sum of contributions)</td>
                        <td className={tdR}><MoneyCell value={total ?? '0'} currency={currency} strong /></td>
                    </tr>
                </tfoot>
            </Table>

            <div className="p-4 space-y-3 border-t border-[#E3E8EE]">
                {problem && <p className="text-[12px] text-red-600">{problem}</p>}
                <p className="text-[11px] text-[#697386]">
                    Posts one repayment for the total; the split records who paid. Retrying the same split reuses its idempotency key, so a network retry never posts twice.
                </p>
                <ErrorBox error={error} onDismiss={clearError} />
                <div className="flex items-center gap-2">
                    <Btn
                        variant="primary"
                        onClick={post}
                        busy={busy === 'repay'}
                        disabled={!total || compareDecimal(total, '0') <= 0}
                        reason={!total ? 'Fix the highlighted amounts' : undefined}
                    >
                        Post group repayment{total && isPositive(total) ? ` of ${fmtMoney(total)}` : ''}
                    </Btn>
                    {filled.length > 0 && <Btn variant="ghost" onClick={() => { setAmounts({}); setProblem(''); }}>Clear</Btn>}
                </div>
            </div>

            <div className="border-t border-[#E3E8EE]">
                <p className="px-5 pt-3.5 text-[13px] font-bold text-[#1A1F36]">Past contributions</p>
                {byEvent.size === 0 ? <Empty>No contributions recorded yet.</Empty> : (
                    <Table className="mt-2">
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>Repayment event</th>
                                <th className={th}>Member</th>
                                <th className={thR}>Amount</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {[...byEvent.entries()].map(([eventId, list]) =>
                                list.map((c, i) => (
                                    <tr key={`${eventId}-${c.borrowerId}-${i}`}>
                                        <td className={`${td} font-mono text-[11px] text-[#697386]`} title={eventId}>{i === 0 ? `${eventId.slice(0, 8)}…` : ''}</td>
                                        <td className={td}>{nameOf(c.borrowerId)}</td>
                                        <td className={tdR}><MoneyCell value={c.amount} /></td>
                                    </tr>
                                )),
                            )}
                        </tbody>
                    </Table>
                )}
            </div>
        </Card>
    );
}
