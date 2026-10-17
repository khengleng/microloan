"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ActionPanel, Btn, ErrorBox, Field, Notice, Table, TextArea, TextInput, td, tdR, th, thR } from '../ui';
import { idem, qs, useAction, useIdempotencyKey } from '../useAsync';
import { MoneyCell } from '../MoneyCell';

interface ComponentAmount { component: string; amount: string }
interface NegotiatedQuote {
    position: Record<string, string>;
    settlement: {
        agreedAmount: string; fullAmount: string; concession: string; concessionRate: string;
        allocations: ComponentAmount[]; forgiven: ComponentAmount[]; forgivesPrincipal: boolean; explanation: string[];
    };
    businessDate: string;
}

const MONEY_RE = /^\d+(\.\d{1,4})?$/;

/**
 * Close a loan for less than it owes (UC-64). The concession is shown by
 * component before anything is posted; forgiving principal needs its own,
 * higher authority, which the server checks.
 */
export function NegotiatedSettlementPanel({ loanId, currency, can, onDone, onClose }: {
    loanId: string; currency: string; can: (code: string) => { allowed: boolean; reason?: string }; onDone: (msg: string) => void; onClose: () => void;
}) {
    const confirm = useConfirm();
    const [agreed, setAgreed] = useState('');
    const [reason, setReason] = useState('');
    const [quote, setQuote] = useState<NegotiatedQuote | null>(null);
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const allowed = can('loan.settlement.negotiate');

    const getQuote = async () => {
        if (!MONEY_RE.test(agreed.trim())) { setProblem('Enter the agreed amount.'); return; }
        setProblem('');
        const res = await run('quote', () => api.get<NegotiatedQuote>(`/lending/loans/${loanId}/negotiated-settlement-quote${qs({ agreedAmount: agreed.trim() })}`));
        if (res) setQuote(res.data);
    };

    const settle = async () => {
        if (!quote) return;
        if (reason.trim().length < 3) { setProblem('Record why the loan is settled for less than it owes.'); return; }
        const ok = await confirm({
            title: 'Settle for less than owed',
            message: `Accept ${currency} ${quote.settlement.agreedAmount} against ${quote.settlement.fullAmount} owed and close the loan? The ${quote.settlement.concession} concession is posted as an expense.`,
            confirmLabel: 'Settle',
            variant: 'warning',
        });
        if (!ok) return;
        const body = { agreedAmount: quote.settlement.agreedAmount, reason: reason.trim() };
        const res = await run('settle', () => api.post(`/lending/loans/${loanId}/negotiated-settlement`, body, idem(key.keyFor(body))));
        if (res) {
            key.reset();
            onDone('Negotiated settlement posted');
        }
    };

    const s = quote?.settlement;
    return (
        <ActionPanel title="Negotiated settlement" onClose={onClose}>
            <div className="flex flex-wrap items-end gap-2">
                <Field label={`Agreed amount (${currency})`} error={problem || undefined}>
                    <TextInput value={agreed} onChange={(v) => { setAgreed(v); setQuote(null); }} inputMode="decimal" className="w-44" />
                </Field>
                <Btn onClick={getQuote} busy={busy === 'quote'}>Price it</Btn>
            </div>
            {s && (
                <div className="space-y-3">
                    {s.forgivesPrincipal && <Notice tone="warn" title="Forgives principal">This needs the principal-forgiveness authority, not just a charge waiver.</Notice>}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Table>
                            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Paid from the agreed amount</th><th className={thR}>Amount</th></tr></thead>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                {s.allocations.map((a) => <tr key={a.component}><td className={td}>{a.component}</td><td className={tdR}><MoneyCell value={a.amount} /></td></tr>)}
                            </tbody>
                        </Table>
                        <Table>
                            <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Forgiven</th><th className={thR}>Amount</th></tr></thead>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                {s.forgiven.map((a) => <tr key={a.component}><td className={td}>{a.component}</td><td className={tdR}><MoneyCell value={a.amount} /></td></tr>)}
                                <tr className="bg-[#F7FAFC]"><td className={`${td} font-bold`}>Concession ({(Number(s.concessionRate) * 100).toFixed(2)}%)</td><td className={tdR}><MoneyCell value={s.concession} currency={currency} strong /></td></tr>
                            </tbody>
                        </Table>
                    </div>
                    <ul className="text-[12px] text-[#697386] list-disc pl-4">{s.explanation.map((e, i) => <li key={i}>{e}</li>)}</ul>
                    <Field label="Reason (recorded with the settlement)">
                        <TextArea value={reason} onChange={setReason} rows={2} maxLength={500} />
                    </Field>
                    <Btn variant="primary" onClick={settle} busy={busy === 'settle'} disabled={!allowed.allowed} reason={allowed.reason}>Settle for {currency} {s.agreedAmount}</Btn>
                </div>
            )}
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}
