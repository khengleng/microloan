"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ActionPanel, Btn, ErrorBox, Field, Table, TextInput, td, tdR } from '../ui';
import { idem, qs, useAction, useIdempotencyKey } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import type { SettlementQuote } from '../types';
import { useTranslations } from 'next-intl';
import { useBusinessDate } from '../useBusinessDate';

export function SettlementPanel({ loanId, can, onDone, onClose }: {
    loanId: string; can: (code: string) => { allowed: boolean; reason?: string }; onDone: (msg: string) => void; onClose: () => void;
}) {
    const confirm = useConfirm();
    const [asOf, setAsOf] = useState('');
    const [quote, setQuote] = useState<SettlementQuote | null>(null);
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const allowed = can('loan.repayment.post');
    const t = useTranslations('Servicing.settlement');
    const businessDate = useBusinessDate();
    // The settlement is posted on the quote's own date, so what is paid is what was quoted.
    // A quote dated after the business date is for information only: the API refuses future value dates.
    const futureQuote = !!quote && quote.asOf > businessDate;

    const getQuote = async () => {
        const res = await run('quote', () => api.get<SettlementQuote>(`/lending/loans/${loanId}/settlement-quote${qs({ asOf })}`));
        if (res) setQuote(res.data);
    };

    const settle = async () => {
        if (!quote) return;
        const ok = await confirm({
            title: 'Settle loan',
            message: t('confirm', { currency: quote.currency, amount: quote.payable, date: quote.asOf }),
            confirmLabel: 'Settle',
            variant: 'warning',
        });
        if (!ok) return;
        const body = { amount: quote.payable, ...(quote.asOf !== businessDate ? { valueDate: quote.asOf } : {}) };
        const k = key.keyFor({ ...body, asOf: quote.asOf });
        const res = await run('settle', () => api.post(`/lending/loans/${loanId}/settlement`, body, idem(k)));
        if (res) {
            key.reset();
            setQuote(null);
            onDone('Loan settled');
        }
    };

    const rows: [string, string][] = quote ? [
        ['Principal', quote.principal],
        ['Interest', quote.interest],
        ['Fees', quote.fees],
        ['Penalties', quote.penalties],
        ['Settlement fee', quote.settlementFee],
        ...(quote.advanceApplied && Number(quote.advanceApplied) > 0 ? [['Less: held on advance', `-${quote.advanceApplied}`] as [string, string]] : []),
        ['Total', quote.total],
        ['Rounding difference', quote.roundingDifference],
    ] : [];

    return (
        <ActionPanel title="Early settlement" onClose={onClose}>
            <div data-tour="payoff-settlement-quote" className="flex flex-wrap items-end gap-2">
                <Field label="Quote as of" hint={t('asOfHint', { date: businessDate })}>
                    <TextInput type="date" value={asOf} onChange={(v) => { setAsOf(v); setQuote(null); }} className="w-44" />
                </Field>
                <Btn onClick={getQuote} busy={busy === 'quote'}>Get quote</Btn>
            </div>
            {quote && (
                <div className="space-y-2">
                    <p className="text-[12px] text-[#697386]">Quote as of <b>{quote.asOf}</b></p>
                    {quote.interestRebate && (
                        <p className="text-[12px] text-[#3C4257]"><b>Interest rebate ({quote.interestRebate.method.replace(/_/g, ' ').toLowerCase()}):</b> {quote.interestRebate.explanation}</p>
                    )}
                    {quote.murabaha && (
                        <p className="text-[12px] text-[#3C4257]"><b>Murabaha profit (ibra&apos;):</b> {quote.murabaha.explanation}</p>
                    )}
                    {quote.settlementFeeExplanation && <p className="text-[12px] text-[#3C4257]"><b>Settlement fee:</b> {quote.settlementFeeExplanation}</p>}
                    <Table className="max-w-md">
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {rows.map(([k, v]) => (
                                <tr key={k}><td className={td}>{k}</td><td className={tdR}><MoneyCell value={v} /></td></tr>
                            ))}
                            <tr className="bg-[#F7FAFC]"><td className={`${td} font-bold`}>Payable</td><td className={tdR}><MoneyCell value={quote.payable} currency={quote.currency} strong /></td></tr>
                        </tbody>
                    </Table>
                    {futureQuote ? (
                        <p className="text-[12px] text-amber-800">{t('futureQuote', { asOf: quote.asOf, date: businessDate })}</p>
                    ) : (
                        <>
                            {quote.asOf !== businessDate && <p className="text-[12px] text-[#697386]">{t('backdated', { asOf: quote.asOf, date: businessDate })}</p>}
                            <Btn variant="primary" onClick={settle} busy={busy === 'settle'} disabled={!allowed.allowed} reason={allowed.reason}>{t('settleOn', { currency: quote.currency, amount: quote.payable, date: quote.asOf })}</Btn>
                        </>
                    )}
                </div>
            )}
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}
