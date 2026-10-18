"use client";

import { useTranslations } from 'next-intl';
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
    const t = useTranslations('LendingChannels.fx');
    const ready = /^\d+(\.\d{1,4})?$/.test(amount.trim()) && /[1-9]/.test(amount);
    const q = useApi<FxQuote>(ready ? `/lending/loans/${loanId}/fx-quote${qs({ amount: amount.trim(), currency, valueDate })}` : null);
    if (!ready) return <p className="text-[12px] text-[#697386]">{t('enterAmount', { currency })}</p>;
    if (q.loading && !q.data) return <Spinner label={t('fetching')} />;
    if (q.error)
        return (
            <Notice tone="warn" title={q.error.code === 'FX_RATE_MISSING' ? t('noRate') : t('cannotConvert')}>
                {q.error.message}
            </Notice>
        );
    if (!q.data) return null;
    const c = q.data.conversion;
    const gain = !c.gainLoss.startsWith('-');
    return (
        <Notice tone="info" title={t.rich('credits', { amount: () => <Money value={c.converted} currency={loanCurrency} /> })}>
            <p>
                {t('rateLine', { amount: c.amount, from: c.from, to: c.to, bankRate: c.bankRate, midRate: c.midRate, spread: c.spreadBps, date: q.data.rate.rateDate })}
            </p>
            <p className="mt-0.5">
                {t.rich(gain ? 'midGain' : 'midLoss', { mid: () => <Money value={c.midValue} currency={c.to} />, diff: () => <Money value={c.gainLoss.replace(/^-/, '')} currency={c.to} /> })}
            </p>
        </Notice>
    );
}
