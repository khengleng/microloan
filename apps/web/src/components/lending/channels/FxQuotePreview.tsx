"use client";

import { Notice, Spinner } from '../ui';
import { qs, useApi } from '../useAsync';
import { Money } from '../MoneyCell';
import type { FxQuote } from './types';

/** Currencies a borrower may pay in; the loan currency is always offered first. */
export const PAYMENT_CURRENCIES = ['USD', 'KHR', 'THB'];

/**
 * What a payment in another currency would credit to the loan (UC-21): the
 * bank's rate (mid less spread), the converted amount and the FX gain or
 * loss. The server converts again when posting; this is a preview.
 */
export function FxQuotePreview({ loanId, amount, currency, valueDate, loanCurrency }: {
    loanId: string; amount: string; currency: string; valueDate: string; loanCurrency: string;
}) {
    const ready = /^\d+(\.\d{1,4})?$/.test(amount.trim()) && /[1-9]/.test(amount);
    const q = useApi<FxQuote>(ready ? `/lending/loans/${loanId}/fx-quote${qs({ amount: amount.trim(), currency, valueDate })}` : null);
    if (!ready) return <p className="text-[12px] text-[#697386]">Enter the amount paid in {currency} to see the conversion.</p>;
    if (q.loading && !q.data) return <Spinner label="Fetching the bank rate…" />;
    if (q.error)
        return (
            <Notice tone="warn" title={q.error.code === 'FX_RATE_MISSING' ? 'No rate for this date' : 'Cannot convert'}>
                {q.error.message}
            </Notice>
        );
    if (!q.data) return null;
    const c = q.data.conversion;
    const gain = !c.gainLoss.startsWith('-');
    return (
        <Notice tone="info" title={<>Credits <Money value={c.converted} currency={loanCurrency} /> to the loan</>}>
            <p>
                {c.amount} {c.from} at the bank rate {c.bankRate} {c.to}/{c.from} (mid {c.midRate}, less {c.spreadBps} bp), rate of {q.data.rate.rateDate}.
            </p>
            <p className="mt-0.5">
                Valued at mid: <Money value={c.midValue} currency={c.to} /> · FX {gain ? 'gain' : 'loss'} <Money value={c.gainLoss.replace(/^-/, '')} currency={c.to} />
            </p>
        </Notice>
    );
}
