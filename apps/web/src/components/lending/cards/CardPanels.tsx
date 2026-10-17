"use client";

import { useState } from 'react';
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
    const [amount, setAmount] = useState('');
    const [party, setParty] = useState('');
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const purchase = kind === 'PURCHASE';

    const post = async () => {
        const a = amount.trim();
        if (!positive(a)) { setProblem('Enter a positive decimal amount (up to 4 decimals).'); return; }
        if (party.trim().length < 2) { setProblem(purchase ? 'Name the merchant.' : 'Record the ATM or teller reference.'); return; }
        setProblem('');
        const body = purchase ? { amount: a, merchantName: party.trim() } : { amount: a, externalReference: party.trim() };
        const k = key.keyFor(body);
        const res = await run('spend', () => api.post<{ fee: string }>(`/lending/cards/${cardId}/${purchase ? 'purchases' : 'cash-advances'}`, body, idem(k)));
        if (res) {
            key.reset();
            onDone(purchase ? `Purchase of ${currency} ${a} posted` : `Cash advance of ${currency} ${a} posted — fee ${currency} ${res.data.fee}`);
        }
    };

    return (
        <ActionPanel title={purchase ? 'Post a purchase' : 'Post a cash advance'} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={`Amount (${currency})`} hint={`Available: ${currency} ${available}`} error={problem || undefined}>
                    <TextInput value={amount} onChange={setAmount} inputMode="decimal" />
                </Field>
                <Field label={purchase ? 'Merchant' : 'ATM / teller reference'}>
                    <TextInput value={party} onChange={setParty} maxLength={120} />
                </Field>
            </div>
            <p className="text-[11px] text-[#697386]">
                {purchase
                    ? 'Purchases enjoy the grace period: no interest while each statement is paid in full by its due date.'
                    : 'A cash advance is charged a fee now and interest at the cash-advance rate from today — there is no grace period.'}
            </p>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={post} busy={busy === 'spend'}>{purchase ? 'Post purchase' : 'Post cash advance'}</Btn>
        </ActionPanel>
    );
}

/** A card payment: charges, then cash advances, purchases, and finally plan principal. */
export function CardPaymentPanel({ cardId, currency, position, onDone, onClose }: DoneProps & { position: CardDetail['position'] }) {
    const last = position.lastStatement;
    const [amount, setAmount] = useState(last && /[1-9]/.test(last.toPayInFull) ? last.toPayInFull : '');
    const [externalReference, setExternalReference] = useState('');
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();

    const post = async () => {
        const a = amount.trim();
        if (!positive(a)) { setProblem('Enter a positive decimal amount (up to 4 decimals).'); return; }
        setProblem('');
        const body = clean({ amount: a, externalReference: externalReference.trim() });
        const k = key.keyFor(body);
        const res = await run('pay', () => api.post(`/lending/cards/${cardId}/payments`, body, idem(k)));
        if (res) { key.reset(); onDone(`Payment of ${currency} ${a} posted`); }
    };

    return (
        <ActionPanel title="Post a payment" onClose={onClose}>
            <div className="flex flex-wrap gap-2">
                {last && <Btn size="sm" onClick={() => setAmount(last.minimumPayment)}>Minimum {currency} {last.minimumPayment}</Btn>}
                {last && <Btn size="sm" onClick={() => setAmount(last.toPayInFull)}>Statement balance {currency} {last.toPayInFull}</Btn>}
                <Btn size="sm" onClick={() => setAmount(position.totalOwed)}>Everything owed {currency} {position.totalOwed}</Btn>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={`Amount (${currency})`} error={problem || undefined}>
                    <TextInput value={amount} onChange={setAmount} inputMode="decimal" />
                </Field>
                <Field label="External reference" hint="Optional">
                    <TextInput value={externalReference} onChange={setExternalReference} maxLength={120} />
                </Field>
            </div>
            <p className="text-[11px] text-[#697386]">Paying the statement balance by {last?.dueDate ?? 'the due date'} keeps the purchase grace period for the next cycle. Applied to fees, interest, cash advances, purchases, then (as a prepayment) instalment-plan principal.</p>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={post} busy={busy === 'pay'}>Post payment</Btn>
        </ActionPanel>
    );
}

/** Close a statement cycle: grace decision, interest, plan billing, minimum payment. */
export function CardStatementPanel({ cardId, currency, periodStart, businessDate, onDone, onClose }: DoneProps & { periodStart: string; businessDate: string }) {
    const confirm = useConfirm();
    const [periodEnd, setPeriodEnd] = useState(businessDate);
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();

    const generate = async () => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) { setProblem('Choose the statement date.'); return; }
        if (periodEnd <= periodStart) { setProblem(`The cycle starts on ${periodStart}; it must close after that.`); return; }
        setProblem('');
        const ok = await confirm({
            title: 'Generate statement',
            message: `Close the cycle ${periodStart} → ${periodEnd}? Interest is posted to the card, plan instalments are billed and a minimum payment falls due.`,
            confirmLabel: 'Generate',
        });
        if (!ok) return;
        const body = { periodEnd };
        const k = key.keyFor(body);
        const res = await run('statement', () => api.post<{ statement: { minimumPayment: string; dueDate: string; graceApplied: boolean } }>(`/lending/cards/${cardId}/statements`, body, idem(k)));
        if (res) {
            key.reset();
            const s = res.data.statement;
            onDone(`Statement generated — minimum ${currency} ${s.minimumPayment} due ${s.dueDate}${s.graceApplied ? '; purchase interest waived (grace period)' : ''}`);
        }
    };

    return (
        <ActionPanel title="Generate statement" onClose={onClose}>
            <Field label="Statement date" hint={`The cycle starts on ${periodStart}.`} error={problem || undefined}>
                <TextInput type="date" value={periodEnd} onChange={setPeriodEnd} />
            </Field>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={generate} busy={busy === 'statement'}>Generate statement</Btn>
        </ActionPanel>
    );
}

/** UC-44: convert a purchase of the current cycle into fixed monthly instalments. */
export function PlanPanel({ cardId, currency, purchases, offer, onDone, onClose }: DoneProps & {
    purchases: CardTransaction[]; offer: NonNullable<CardDetail['instalmentPlanTerms']>;
}) {
    const [txn, setTxn] = useState(purchases[0]?.id ?? '');
    const [months, setMonths] = useState(String(offer.allowedMonths[0]));
    const { busy, error, run, clearError } = useAction();

    const convert = async () => {
        const res = await run('plan', () => api.post<{ plan: { instalmentAmount: string; months: number } }>(`/lending/cards/${cardId}/transactions/${txn}/instalment-plan`, { months: Number(months) }));
        if (res) onDone(`Converted into ${res.data.plan.months} instalments of ${currency} ${res.data.plan.instalmentAmount}`);
    };

    return (
        <ActionPanel title="Convert a purchase into instalments" onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Purchase" hint={`Purchases of ${currency} ${offer.minAmount} or more, from the current cycle`}>
                    <SelectInput value={txn} onChange={setTxn} options={purchases.map((p) => ({ value: p.id, label: `${p.transactionDate} · ${p.merchantName} · ${currency} ${p.amount}` }))} placeholder="Choose a purchase" />
                </Field>
                <Field label="Term" hint={`Plan rate ${Number(offer.annualRate) * 100}% a year on the reducing balance`}>
                    <SelectInput value={months} onChange={setMonths} options={offer.allowedMonths.map((m) => ({ value: String(m), label: `${m} months` }))} />
                </Field>
            </div>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={convert} busy={busy === 'plan'} disabled={!txn}>Convert</Btn>
        </ActionPanel>
    );
}

/** Close a card that owes nothing. */
export function CloseCardPanel({ cardId, onDone, onClose }: Omit<DoneProps, 'currency'>) {
    const [reason, setReason] = useState('');
    const { busy, error, run, clearError } = useAction();
    const closeCard = async () => {
        const res = await run('close', () => api.post(`/lending/cards/${cardId}/close`, { reason: reason.trim() }));
        if (res) onDone('Card closed');
    };
    return (
        <ActionPanel title="Close the card" onClose={onClose}>
            <Field label="Reason">
                <TextInput value={reason} onChange={setReason} maxLength={500} />
            </Field>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="danger" onClick={closeCard} busy={busy === 'close'} disabled={reason.trim().length < 2}>Close card</Btn>
        </ActionPanel>
    );
}
