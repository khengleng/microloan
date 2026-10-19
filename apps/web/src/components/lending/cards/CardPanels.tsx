"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ActionPanel, Btn, ErrorBox, Field, SelectInput, TextInput } from '../ui';
import { clean, idem, useAction, useIdempotencyKey } from '../useAsync';
import type { CardDetail, CardTransaction } from './types';

const MONEY_RE = /^\d+(\.\d{1,4})?$/;

type DoneProps = { cardId: string; currency: string; onDone: (msg: string) => void; onClose: () => void };

const positive = (v: string) => MONEY_RE.test(v) && /[1-9]/.test(v);

/** A purchase at a merchant, or a cash advance (UC-40: fee now, interest from today). */
export function SpendPanel({ cardId, currency, kind, available, onDone, onClose }: DoneProps & {
    kind: 'PURCHASE' | 'CASH_ADVANCE'; available: string;
}) {
    const tc = useTranslations('LendingCards');
    const [amount, setAmount] = useState('');
    const [party, setParty] = useState('');
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const purchase = kind === 'PURCHASE';

    const post = async () => {
        const a = amount.trim();
        if (!positive(a)) { setProblem(tc('panels.errAmount')); return; }
        if (party.trim().length < 2) { setProblem(purchase ? tc('panels.errMerchant') : tc('panels.errAtmReference')); return; }
        setProblem('');
        const body = purchase ? { amount: a, merchantName: party.trim() } : { amount: a, externalReference: party.trim() };
        const k = key.keyFor(body);
        const res = await run('spend', () => api.post<{ fee: string }>(`/lending/cards/${cardId}/${purchase ? 'purchases' : 'cash-advances'}`, body, idem(k)));
        if (res) {
            key.reset();
            onDone(purchase ? tc('panels.purchasePosted', { amount: `${currency} ${a}` }) : tc('panels.cashPosted', { amount: `${currency} ${a}`, fee: `${currency} ${res.data.fee}` }));
        }
    };

    return (
        <ActionPanel title={purchase ? tc('panels.purchaseTitle') : tc('panels.cashTitle')} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={tc('panels.amount', { currency })} hint={tc('panels.available', { amount: `${currency} ${available}` })} error={problem || undefined}>
                    <TextInput value={amount} onChange={setAmount} inputMode="decimal" />
                </Field>
                <Field label={purchase ? tc('panels.merchant') : tc('panels.atmReference')}>
                    <TextInput value={party} onChange={setParty} maxLength={120} />
                </Field>
            </div>
            <p className="text-[11px] text-[#697386]">
                {purchase
                    ? tc('panels.purchaseNote')
                    : tc('panels.cashNote')}
            </p>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={post} busy={busy === 'spend'}>{purchase ? tc('panels.postPurchase') : tc('panels.postCash')}</Btn>
        </ActionPanel>
    );
}

/** A card payment: charges, then cash advances, purchases, and finally plan principal. */
export function CardPaymentPanel({ cardId, currency, position, onDone, onClose }: DoneProps & { position: CardDetail['position'] }) {
    const tc = useTranslations('LendingCards');
    const last = position.lastStatement;
    const [amount, setAmount] = useState(last && /[1-9]/.test(last.toPayInFull) ? last.toPayInFull : '');
    const [externalReference, setExternalReference] = useState('');
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();

    const post = async () => {
        const a = amount.trim();
        if (!positive(a)) { setProblem(tc('panels.errAmount')); return; }
        setProblem('');
        const body = clean({ amount: a, externalReference: externalReference.trim() });
        const k = key.keyFor(body);
        const res = await run('pay', () => api.post(`/lending/cards/${cardId}/payments`, body, idem(k)));
        if (res) { key.reset(); onDone(tc('panels.paymentPosted', { amount: `${currency} ${a}` })); }
    };

    return (
        <ActionPanel title={tc('panels.paymentTitle')} onClose={onClose}>
            <div className="flex flex-wrap gap-2">
                {last && <Btn size="sm" onClick={() => setAmount(last.minimumPayment)}>{tc('panels.quickMinimum', { amount: `${currency} ${last.minimumPayment}` })}</Btn>}
                {last && <Btn size="sm" onClick={() => setAmount(last.toPayInFull)}>{tc('panels.quickStatement', { amount: `${currency} ${last.toPayInFull}` })}</Btn>}
                <Btn size="sm" onClick={() => setAmount(position.totalOwed)}>{tc('panels.quickEverything', { amount: `${currency} ${position.totalOwed}` })}</Btn>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={tc('panels.amount', { currency })} error={problem || undefined}>
                    <TextInput value={amount} onChange={setAmount} inputMode="decimal" />
                </Field>
                <Field label={tc('panels.externalReference')} hint={tc('panels.optional')}>
                    <TextInput value={externalReference} onChange={setExternalReference} maxLength={120} />
                </Field>
            </div>
            <p className="text-[11px] text-[#697386]">{last?.dueDate ? tc('panels.paymentNote', { dueDate: last.dueDate }) : tc('panels.paymentNoteNoDate')}</p>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={post} busy={busy === 'pay'}>{tc('panels.postPayment')}</Btn>
        </ActionPanel>
    );
}

/** Close a statement cycle: grace decision, interest, plan billing, minimum payment. */
export function CardStatementPanel({ cardId, currency, periodStart, businessDate, onDone, onClose }: DoneProps & { periodStart: string; businessDate: string }) {
    const tc = useTranslations('LendingCards');
    const confirm = useConfirm();
    const [periodEnd, setPeriodEnd] = useState(businessDate);
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();

    const generate = async () => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) { setProblem(tc('panels.errStatementDate')); return; }
        if (periodEnd <= periodStart) { setProblem(tc('panels.errCycleClose', { periodStart })); return; }
        setProblem('');
        const ok = await confirm({
            title: tc('panels.statementTitle'),
            message: tc('panels.statementConfirm', { periodStart, periodEnd }),
            confirmLabel: tc('panels.generate'),
        });
        if (!ok) return;
        const body = { periodEnd };
        const k = key.keyFor(body);
        const res = await run('statement', () => api.post<{ statement: { minimumPayment: string; dueDate: string; graceApplied: boolean } }>(`/lending/cards/${cardId}/statements`, body, idem(k)));
        if (res) {
            key.reset();
            const s = res.data.statement;
            onDone(tc(s.graceApplied ? 'panels.statementDoneGrace' : 'panels.statementDone', { minimum: `${currency} ${s.minimumPayment}`, dueDate: s.dueDate }));
        }
    };

    return (
        <ActionPanel title={tc('panels.statementTitle')} onClose={onClose}>
            <Field label={tc('panels.statementDate')} hint={tc('panels.cycleStarts', { periodStart })} error={problem || undefined}>
                <TextInput type="date" value={periodEnd} onChange={setPeriodEnd} />
            </Field>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={generate} busy={busy === 'statement'}>{tc('panels.statementTitle')}</Btn>
        </ActionPanel>
    );
}

/** UC-44: convert a purchase of the current cycle into fixed monthly instalments. */
export function PlanPanel({ cardId, currency, purchases, offer, onDone, onClose }: DoneProps & {
    purchases: CardTransaction[]; offer: NonNullable<CardDetail['instalmentPlanTerms']>;
}) {
    const tc = useTranslations('LendingCards');
    const [txn, setTxn] = useState(purchases[0]?.id ?? '');
    const [months, setMonths] = useState(String(offer.allowedMonths[0]));
    const { busy, error, run, clearError } = useAction();

    const convert = async () => {
        const res = await run('plan', () => api.post<{ plan: { instalmentAmount: string; months: number } }>(`/lending/cards/${cardId}/transactions/${txn}/instalment-plan`, { months: Number(months) }));
        if (res) onDone(tc('panels.converted', { months: res.data.plan.months, amount: `${currency} ${res.data.plan.instalmentAmount}` }));
    };

    return (
        <ActionPanel title={tc('panels.planTitle')} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={tc('panels.purchase')} hint={tc('panels.purchaseHint', { amount: `${currency} ${offer.minAmount}` })}>
                    <SelectInput value={txn} onChange={setTxn} options={purchases.map((p) => ({ value: p.id, label: `${p.transactionDate} · ${p.merchantName} · ${currency} ${p.amount}` }))} placeholder={tc('panels.choosePurchase')} />
                </Field>
                <Field label={tc('panels.term')} hint={tc('panels.planRate', { rate: `${Number(offer.annualRate) * 100}%` })}>
                    <SelectInput value={months} onChange={setMonths} options={offer.allowedMonths.map((m) => ({ value: String(m), label: tc('panels.months', { count: m }) }))} />
                </Field>
            </div>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={convert} busy={busy === 'plan'} disabled={!txn}>{tc('panels.convert')}</Btn>
        </ActionPanel>
    );
}

/** Close a card that owes nothing. */
export function CloseCardPanel({ cardId, onDone, onClose }: Omit<DoneProps, 'currency'>) {
    const tc = useTranslations('LendingCards');
    const [reason, setReason] = useState('');
    const { busy, error, run, clearError } = useAction();
    const closeCard = async () => {
        const res = await run('close', () => api.post(`/lending/cards/${cardId}/close`, { reason: reason.trim() }));
        if (res) onDone(tc('panels.cardClosed'));
    };
    return (
        <ActionPanel title={tc('panels.closeTitle')} onClose={onClose}>
            <Field label={tc('panels.reason')}>
                <TextInput value={reason} onChange={setReason} maxLength={500} />
            </Field>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="danger" onClick={closeCard} busy={busy === 'close'} disabled={reason.trim().length < 2}>{tc('actions.closeCard')}</Btn>
        </ActionPanel>
    );
}
