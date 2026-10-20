"use client";

import { useState } from 'react';
import { Loader2, Wallet } from 'lucide-react';
import api from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useTranslations } from 'next-intl';

interface PayoffQuote {
    outstandingPrincipal: number;
    accruedInterestDue: number;
    outstandingPenalty: number;
    futureInterestWaived: number;
    payoffAmount: number;
}

/**
 * Early settlement of a legacy loan (UC-31): the quote, and settling at it.
 * Settling closes the loan and waives interest not yet due; an ordinary
 * repayment of the same amount would not close it.
 */
/** `readOnly`: the original module is frozen (D-097) — the quote is shown, settling is not offered. */
export function EarlySettlementPanel({ loanId, onSettled, readOnly = false }: { loanId: string; onSettled: () => void; readOnly?: boolean }) {
    const { showToast } = useToast();
    const confirm = useConfirm();
    const t = useTranslations('LoanDetails.settlement');
    const [quote, setQuote] = useState<PayoffQuote | null>(null);
    const [busy, setBusy] = useState(false);
    const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const getQuote = async () => {
        setBusy(true);
        try {
            setQuote((await api.get<PayoffQuote>(`/loans/${loanId}/payoff-quote`)).data);
        } finally {
            setBusy(false);
        }
    };

    const settle = async () => {
        if (!quote) return;
        const ok = await confirm({
            title: t('confirmTitle'),
            message: t('confirmMessage', { amount: money(quote.payoffAmount), waived: money(quote.futureInterestWaived) }),
            confirmLabel: t('confirmLabel'),
            variant: 'warning',
        });
        if (!ok) return;
        setBusy(true);
        try {
            await api.post('/repayments/settlements', {
                loanId,
                amount: quote.payoffAmount,
                idempotencyKey: `settle-${loanId}-${quote.payoffAmount}`,
            });
            showToast(t('settled'), 'success');
            setQuote(null);
            onSettled();
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="bg-white border border-border rounded-md">
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
                <h3 className="text-sm font-bold text-foreground flex items-center gap-2"><Wallet size={15} className="text-primary" /> {t('title')}</h3>
                <button onClick={getQuote} disabled={busy} className="text-xs font-semibold text-primary hover:underline disabled:opacity-50">
                    {busy && !quote ? <Loader2 size={12} className="animate-spin inline" /> : t('getQuote')}
                </button>
            </div>
            {quote && (
                <div className="p-4 space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">{t('principal')}</span><span>{money(quote.outstandingPrincipal)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">{t('interestDue')}</span><span>{money(quote.accruedInterestDue)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">{t('penalties')}</span><span>{money(quote.outstandingPenalty)}</span></div>
                    <div className="flex justify-between text-emerald-700"><span>{t('futureInterestWaived')}</span><span>−{money(quote.futureInterestWaived)}</span></div>
                    <div className="flex justify-between border-t border-border pt-2 font-bold"><span>{t('payoffToday')}</span><span>{money(quote.payoffAmount)}</span></div>
                    {!readOnly && (
                    <button onClick={settle} disabled={busy} className="w-full mt-2 bg-primary text-white text-sm font-semibold rounded py-2 disabled:opacity-50">
                        {busy ? <Loader2 size={14} className="animate-spin inline" /> : t('settleButton', { amount: money(quote.payoffAmount) })}
                    </button>
                    )}
                </div>
            )}
        </div>
    );
}
