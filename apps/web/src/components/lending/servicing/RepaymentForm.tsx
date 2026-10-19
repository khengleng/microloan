"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { ActionPanel, Btn, ErrorBox, Field, SelectInput, TextInput } from '../ui';
import { clean, idem, useAction, useIdempotencyKey } from '../useAsync';
import { FxQuotePreview, PAYMENT_CURRENCIES } from '../channels/FxQuotePreview';
import { useTranslations } from 'next-intl';

const MONEY_RE = /^\d+(\.\d{1,4})?$/;
const RELATIONSHIPS = ['GUARANTOR', 'FAMILY', 'EMPLOYER', 'GROUP_MEMBER', 'OTHER'];

const PAYMENT_CHANNELS = ['BRANCH_CASH', 'AGENT', 'BANK_TRANSFER', 'MOBILE', 'QR', 'WALLET', 'PAYROLL', 'OTHER'];

export function RepaymentForm({ loanId, currency, can, onDone, onClose }: {
    loanId: string; currency: string; can: (code: string) => { allowed: boolean; reason?: string }; onDone: (msg: string) => void; onClose: () => void;
}) {
    const tl = useTranslations('LendingServicing.repayment');
    const [amount, setAmount] = useState('');
    const [valueDate, setValueDate] = useState('');
    const [externalReference, setExternalReference] = useState('');
    // How the money came in; cash counts towards the cash transaction report (AML).
    const [channel, setChannel] = useState('');
    const [strategy, setStrategy] = useState('');
    const [excess, setExcess] = useState('');
    const [payerName, setPayerName] = useState('');
    const [payerRelationship, setPayerRelationship] = useState('');
    const [problem, setProblem] = useState('');
    // UC-21: paid in another currency, converted at the bank's rate.
    const [payCurrency, setPayCurrency] = useState(currency);
    const fx = payCurrency !== currency;
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const allowed = can('loan.repayment.post');

    const post = async () => {
        if (!MONEY_RE.test(amount.trim()) || !/[1-9]/.test(amount)) { setProblem(tl('enterAmount')); return; }
        setProblem('');
        const payer = payerName.trim() ? { name: payerName.trim(), relationship: payerRelationship || 'OTHER' } : undefined;
        const body = clean({ amount: amount.trim(), currency: fx ? payCurrency : undefined, valueDate, externalReference: externalReference.trim(), channel, prepaymentStrategy: strategy, applyExcessAs: excess, payer });
        const k = key.keyFor(body);
        const res = await run('repay', () => api.post(`/lending/loans/${loanId}/${fx ? 'fx-repayments' : 'repayments'}`, body, idem(k)));
        if (res) {
            key.reset();
            setAmount('');
            setExternalReference('');
            onDone(fx ? tl('doneFx', { currency: payCurrency }) : tl('done'));
        }
    };

    return (
        <ActionPanel title={tl('title')} onClose={onClose}>
            <div data-tour="repay-amount-fields" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <Field label={tl('amount', { currency: payCurrency })} error={problem || undefined}>
                    <div className="flex gap-1">
                        <TextInput value={amount} onChange={setAmount} inputMode="decimal" />
                        <SelectInput
                            value={payCurrency}
                            onChange={setPayCurrency}
                            options={[currency, ...PAYMENT_CURRENCIES.filter((c) => c !== currency)]}
                            className="!w-24"
                            aria-label={tl('currencyPaid')}
                        />
                    </div>
                </Field>
                <Field label={tl('valueDate')} hint={tl('valueDateHint')}>
                    <TextInput type="date" value={valueDate} onChange={setValueDate} />
                </Field>
                <Field label={tl('externalReference')} hint={tl('optional')}>
                    <TextInput value={externalReference} onChange={setExternalReference} maxLength={120} />
                </Field>
                <Field label={tl('channel')} hint={tl('channelHint')}>
                    <SelectInput value={channel} onChange={setChannel} placeholder={tl('channelUnknown')} options={PAYMENT_CHANNELS.map((c) => ({ value: c, label: tl(`channels.${c}`) }))} />
                </Field>
                <Field label={tl('excess')} hint={tl('excessHint')}>
                    <SelectInput
                        value={excess}
                        onChange={setExcess}
                        placeholder={tl('productDefault')}
                        options={[{ value: 'ADVANCE', label: tl('excessOptions.ADVANCE') }, { value: 'PREPAY', label: tl('excessOptions.PREPAY') }]}
                    />
                </Field>
                <Field label={tl('strategy')} hint={tl('strategyHint')}>
                    <SelectInput
                        value={strategy}
                        onChange={setStrategy}
                        placeholder={tl('productDefault')}
                        options={[{ value: 'RECAST', label: tl('strategyOptions.RECAST') }, { value: 'SHORTEN', label: tl('strategyOptions.SHORTEN') }]}
                    />
                </Field>
            </div>
            <div data-tour="repay-payer-fields" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <Field label={tl('payerName')} hint={tl('payerNameHint')}>
                    <TextInput value={payerName} onChange={setPayerName} maxLength={120} />
                </Field>
                <Field label={tl('payerRelationship')}>
                    <SelectInput
                        value={payerRelationship}
                        onChange={setPayerRelationship}
                        placeholder="—"
                        options={RELATIONSHIPS.map((r) => ({ value: r, label: tl(`relationships.${r}`) }))}
                    />
                </Field>
            </div>
            {fx && <FxQuotePreview loanId={loanId} amount={amount} currency={payCurrency} valueDate={valueDate} loanCurrency={currency} />}
            <p className="text-[11px] text-[#697386]">{tl('idempotencyNote')}</p>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn data-tour="repay-post-button" variant="primary" onClick={post} busy={busy === 'repay'} disabled={!allowed.allowed} reason={allowed.reason}>{tl('post')}</Btn>
        </ActionPanel>
    );
}
