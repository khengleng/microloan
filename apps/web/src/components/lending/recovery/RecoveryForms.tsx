"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { useTranslations } from 'next-intl';
import { ActionPanel, Btn, ErrorBox, Field, Notice, SelectInput, TextArea, TextInput } from '../ui';
import { clean, idem, useAction, useIdempotencyKey } from '../useAsync';
import { Money } from '../MoneyCell';
import type { InsurancePolicy, ProceedsResult, Repossession } from './types';

const MONEY_RE = /^\d+(\.\d{1,4})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const positive = (v: string) => MONEY_RE.test(v.trim()) && /[1-9]/.test(v);
const ITEM_TYPES = ['GOLD', 'JEWELLERY', 'OTHER'];

type Done = (msg: string) => void;

/* ── UC-65 Repossession ──────────────────────────────────────────────────── */

export function RepossessionForm({ loanId, pledges, businessDate, onDone, onClose }: {
    loanId: string; pledges: { collateralId: string; type: string; description: string }[]; businessDate: string; onDone: Done; onClose: () => void;
}) {
    const t = useTranslations('LendingRecovery.forms');
    const [collateralId, setCollateralId] = useState(pledges[0]?.collateralId ?? '');
    const [location, setLocation] = useState('');
    const [seizedOn, setSeizedOn] = useState(businessDate);
    const [reason, setReason] = useState('');
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const submit = async () => {
        if (!collateralId) { setProblem(t('chooseAsset')); return; }
        if (location.trim().length < 2 || reason.trim().length < 3 || !DATE_RE.test(seizedOn)) { setProblem(t('seizureMissing')); return; }
        setProblem('');
        const res = await run('propose', () => api.post(`/lending/loans/${loanId}/repossessions`, { collateralId, location: location.trim(), seizedOn, reason: reason.trim() }));
        if (res) onDone(t('seizureProposed'));
    };
    return (
        <ActionPanel title={t('repossessTitle')} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label={t('asset')}>
                    <SelectInput value={collateralId} onChange={setCollateralId} options={pledges.map((p) => ({ value: p.collateralId, label: `${p.type} — ${p.description}` }))} />
                </Field>
                <Field label={t('heldAt')}><TextInput value={location} onChange={setLocation} maxLength={200} /></Field>
                <Field label={t('seizedOn')}><TextInput type="date" value={seizedOn} onChange={setSeizedOn} max={businessDate} /></Field>
                <Field label={t('reason')} className="sm:col-span-3" error={problem || undefined}><TextArea value={reason} onChange={setReason} rows={2} maxLength={500} /></Field>
            </div>
            <Btn variant="danger" onClick={submit} busy={busy === 'propose'}>{t('proposeSeizure')}</Btn>
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}

export function RepossessionValuationForm({ loanId, repo, currency, businessDate, onDone, onClose }: {
    loanId: string; repo: Repossession; currency: string; businessDate: string; onDone: Done; onClose: () => void;
}) {
    const t = useTranslations('LendingRecovery.forms');
    const [value, setValue] = useState('');
    const [valuer, setValuer] = useState('');
    const [date, setDate] = useState(businessDate);
    const { busy, error, run, clearError } = useAction();
    const submit = async () => {
        if (!positive(value) || valuer.trim().length < 2) return;
        const res = await run('value', () => api.post(`/lending/loans/${loanId}/repossessions/${repo.id}/valuation`, { marketValue: value.trim(), valuer: valuer.trim(), valuationDate: date }));
        if (res) onDone(t('valuationRecorded'));
    };
    return (
        <ActionPanel title={t('valuationTitle')} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label={t('marketValue', { currency })}><TextInput value={value} onChange={setValue} inputMode="decimal" /></Field>
                <Field label={t('valuer')}><TextInput value={valuer} onChange={setValuer} maxLength={120} /></Field>
                <Field label={t('valuedOn')}><TextInput type="date" value={date} onChange={setDate} max={businessDate} /></Field>
            </div>
            <Btn variant="primary" onClick={submit} busy={busy === 'value'} disabled={!positive(value) || valuer.trim().length < 2}>{t('recordValuation')}</Btn>
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}

/** Sale of a repossessed asset or auction of a forfeited pawn: proceeds pay costs, then the loan. */
export function SaleForm({ title, endpoint, currency, owed, businessDate, onDone, onClose }: {
    title: string; endpoint: string; currency: string; owed: string; businessDate: string; onDone: Done; onClose: () => void;
}) {
    const t = useTranslations('LendingRecovery.forms');
    const [price, setPrice] = useState('');
    const [costs, setCosts] = useState('');
    const [buyer, setBuyer] = useState('');
    const [date, setDate] = useState(businessDate);
    const [ref, setRef] = useState('');
    const [problem, setProblem] = useState('');
    const [result, setResult] = useState<ProceedsResult | null>(null);
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const submit = async () => {
        if (!positive(price)) { setProblem(t('enterSalePrice')); return; }
        if (costs && !MONEY_RE.test(costs.trim())) { setProblem(t('costsDecimal')); return; }
        if (buyer.trim().length < 2) { setProblem(t('nameBuyer')); return; }
        setProblem('');
        const body = clean({ salePrice: price.trim(), costs: costs.trim(), buyer: buyer.trim(), saleDate: date, externalReference: ref.trim() });
        const res = await run('sell', () => api.post<{ proceeds: ProceedsResult }>(endpoint, body, idem(key.keyFor(body))));
        if (res) {
            key.reset();
            setResult(res.data.proceeds);
            onDone(res.data.proceeds.settlesLoan ? t('soldPaidOff') : t('soldDeficiency'));
        }
    };
    return (
        <ActionPanel title={title} onClose={onClose}>
            <p className="text-[12px] text-[#697386]">{t.rich('saleIntro', { owed: () => <b><Money value={owed} currency={currency} /></b> })}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label={t('salePrice', { currency })}><TextInput value={price} onChange={setPrice} inputMode="decimal" /></Field>
                <Field label={t('costs', { currency })} hint={t('costsHint')}><TextInput value={costs} onChange={setCosts} inputMode="decimal" /></Field>
                <Field label={t('buyer')}><TextInput value={buyer} onChange={setBuyer} maxLength={120} /></Field>
                <Field label={t('saleDate')}><TextInput type="date" value={date} onChange={setDate} max={businessDate} /></Field>
                <Field label={t('reference')} className="sm:col-span-2" error={problem || undefined}><TextInput value={ref} onChange={setRef} maxLength={120} /></Field>
            </div>
            <Btn variant="primary" onClick={submit} busy={busy === 'sell'}>{t('recordSale')}</Btn>
            {result && <Notice tone={result.settlesLoan ? 'success' : 'warn'}>{result.explanation.join(' ')}</Notice>}
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}

/* ── UC-66 / LT-09 Pawn and gold ─────────────────────────────────────────── */

export function PawnForm({ loanId, currency, businessDate, onDone, onClose }: {
    loanId: string; currency: string; businessDate: string; onDone: Done; onClose: () => void;
}) {
    const t = useTranslations('LendingRecovery.forms');
    const [f, setF] = useState({ description: '', itemType: 'GOLD', weightGrams: '', karat: '18', purity: '', pricePerGram: '', custodyLocation: '', sealNumber: '', receivedOn: businessDate, redemptionDeadline: '' });
    const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const submit = async () => {
        if (f.description.trim().length < 2 || f.custodyLocation.trim().length < 2) { setProblem(t('describeItem')); return; }
        if (!/^\d+(\.\d{1,4})?$/.test(f.weightGrams) || !positive(f.pricePerGram)) { setProblem(t('weightPrice')); return; }
        if (!DATE_RE.test(f.redemptionDeadline)) { setProblem(t('setDeadline')); return; }
        setProblem('');
        const body = clean({
            description: f.description.trim(), itemType: f.itemType, weightGrams: f.weightGrams.trim(),
            karat: f.purity ? undefined : Number(f.karat), purity: f.purity.trim(), pricePerGram: f.pricePerGram.trim(),
            custodyLocation: f.custodyLocation.trim(), sealNumber: f.sealNumber.trim(), receivedOn: f.receivedOn, redemptionDeadline: f.redemptionDeadline,
        });
        const res = await run('custody', () => api.post<{ valuation: { value: string; explanation: string } }>(`/lending/loans/${loanId}/pawn-items`, body));
        if (res) onDone(t('inCustody', { currency, value: res.data.valuation.value }));
    };
    return (
        <ActionPanel title={t('custodyTitle')} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <Field label={t('item')} className="sm:col-span-2"><TextInput value={f.description} onChange={set('description')} maxLength={300} placeholder={t('itemPlaceholder')} /></Field>
                <Field label={t('type')}><SelectInput value={f.itemType} onChange={set('itemType')} options={ITEM_TYPES.map((v) => ({ value: v, label: t(`itemType.${v}`) }))} /></Field>
                <Field label={t('weight')}><TextInput value={f.weightGrams} onChange={set('weightGrams')} inputMode="decimal" /></Field>
                <Field label={t('karat')}><SelectInput value={f.karat} onChange={set('karat')} options={['24', '22', '21', '18', '14', '10', '9']} disabled={!!f.purity} /></Field>
                <Field label={t('purity')} hint={t('purityHint')}><TextInput value={f.purity} onChange={set('purity')} inputMode="decimal" /></Field>
                <Field label={t('pricePerGram', { currency })}><TextInput value={f.pricePerGram} onChange={set('pricePerGram')} inputMode="decimal" /></Field>
                <Field label={t('sealNumber')}><TextInput value={f.sealNumber} onChange={set('sealNumber')} maxLength={60} /></Field>
                <Field label={t('custodyLocation')} className="sm:col-span-2"><TextInput value={f.custodyLocation} onChange={set('custodyLocation')} maxLength={200} placeholder={t('custodyPlaceholder')} /></Field>
                <Field label={t('receivedOn')}><TextInput type="date" value={f.receivedOn} onChange={set('receivedOn')} max={businessDate} /></Field>
                <Field label={t('redemptionDeadline')} error={problem || undefined}><TextInput type="date" value={f.redemptionDeadline} onChange={set('redemptionDeadline')} /></Field>
            </div>
            <Btn variant="primary" onClick={submit} busy={busy === 'custody'}>{t('recordCustody')}</Btn>
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}

/** A one-field action (forfeiture reason, return reference). */
export function OneFieldForm({ title, label, endpoint, field, multiline, button, done, onDone, onClose }: {
    title: string; label: string; endpoint: string; field: string; multiline?: boolean; button: string; done: string; onDone: Done; onClose: () => void;
}) {
    const [value, setValue] = useState('');
    const { busy, error, run, clearError } = useAction();
    const submit = async () => {
        if (value.trim().length < 3) return;
        const res = await run('go', () => api.post(endpoint, { [field]: value.trim() }));
        if (res) onDone(done);
    };
    return (
        <ActionPanel title={title} onClose={onClose}>
            <Field label={label}>{multiline ? <TextArea value={value} onChange={setValue} rows={2} maxLength={500} /> : <TextInput value={value} onChange={setValue} maxLength={120} />}</Field>
            <Btn variant="primary" onClick={submit} busy={busy === 'go'} disabled={value.trim().length < 3}>{button}</Btn>
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}

/* ── UC-68 / UC-06 Credit insurance ──────────────────────────────────────── */

export function PolicyForm({ loanId, currency, businessDate, onDone, onClose }: {
    loanId: string; currency: string; businessDate: string; onDone: Done; onClose: () => void;
}) {
    const t = useTranslations('LendingRecovery.forms');
    const [f, setF] = useState({ insurer: '', policyNumber: '', coverType: 'DEATH_AND_DISABILITY', premiumTreatment: 'FINANCED', premium: '', startDate: businessDate, externalReference: '' });
    const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const submit = async () => {
        if (f.insurer.trim().length < 2 || f.policyNumber.trim().length < 2) { setProblem(t('nameInsurer')); return; }
        if (f.premiumTreatment === 'PAID' && !positive(f.premium)) { setProblem(t('givePremium')); return; }
        if (f.premium && !MONEY_RE.test(f.premium.trim())) { setProblem(t('premiumDecimal')); return; }
        setProblem('');
        const body = clean({ ...f, insurer: f.insurer.trim(), policyNumber: f.policyNumber.trim(), premium: f.premium.trim(), externalReference: f.externalReference.trim() });
        const res = await run('policy', () => api.post(`/lending/loans/${loanId}/insurance-policies`, body, idem(key.keyFor(body))));
        if (res) { key.reset(); onDone(t('policyRecorded')); }
    };
    return (
        <ActionPanel title={t('policyTitle')} onClose={onClose}>
            <p className="text-[12px] text-[#697386]">{t.rich('policyIntro', { b: (chunks) => <b>{chunks}</b> })}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label={t('insurer')}><TextInput value={f.insurer} onChange={set('insurer')} maxLength={120} /></Field>
                <Field label={t('policyNumber')}><TextInput value={f.policyNumber} onChange={set('policyNumber')} maxLength={60} /></Field>
                <Field label={t('cover')}><SelectInput value={f.coverType} onChange={set('coverType')} options={[{ value: 'DEATH_AND_DISABILITY', label: t('coverType.DEATH_AND_DISABILITY') }, { value: 'DEATH', label: t('coverType.DEATH') }, { value: 'DISABILITY', label: t('coverType.DISABILITY') }]} /></Field>
                <Field label={t('premiumLabel')}><SelectInput value={f.premiumTreatment} onChange={set('premiumTreatment')} options={[{ value: 'FINANCED', label: t('premiumFinanced') }, { value: 'PAID', label: t('premiumPaid') }]} /></Field>
                <Field label={t('premiumAmount', { currency })} hint={f.premiumTreatment === 'FINANCED' ? t('premiumBlank') : undefined}><TextInput value={f.premium} onChange={set('premium')} inputMode="decimal" /></Field>
                <Field label={t('coverStarts')}><TextInput type="date" value={f.startDate} onChange={set('startDate')} /></Field>
                {f.premiumTreatment === 'PAID' && <Field label={t('receiptReference')} className="sm:col-span-3"><TextInput value={f.externalReference} onChange={set('externalReference')} maxLength={120} /></Field>}
            </div>
            {problem && <p className="text-[12px] text-red-600">{problem}</p>}
            <Btn variant="primary" onClick={submit} busy={busy === 'policy'}>{t('recordPolicy')}</Btn>
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}

export function RemittanceForm({ loanId, policy, onDone, onClose }: { loanId: string; policy: InsurancePolicy; onDone: Done; onClose: () => void }) {
    const t = useTranslations('LendingRecovery.forms');
    const [amount, setAmount] = useState(policy.premiumToRemit);
    const [reference, setReference] = useState('');
    const { busy, error, run, clearError } = useAction();
    const submit = async () => {
        if (!positive(amount) || reference.trim().length < 2) return;
        const res = await run('remit', () => api.post(`/lending/loans/${loanId}/insurance-policies/${policy.id}/remittances`, { amount: amount.trim(), reference: reference.trim() }));
        if (res) onDone(t('remittanceProposed'));
    };
    return (
        <ActionPanel title={t('remitTitle', { insurer: policy.insurer })} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={t('amount', { currency: policy.currency })} hint={t('heldForInsurer', { amount: policy.premiumToRemit })}><TextInput value={amount} onChange={setAmount} inputMode="decimal" /></Field>
                <Field label={t('bordereau')}><TextInput value={reference} onChange={setReference} maxLength={120} /></Field>
            </div>
            <Btn variant="primary" onClick={submit} busy={busy === 'remit'} disabled={!positive(amount) || reference.trim().length < 2}>{t('proposeRemittance')}</Btn>
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}

export function ClaimForm({ loanId, policy, businessDate, onDone, onClose }: { loanId: string; policy: InsurancePolicy; businessDate: string; onDone: Done; onClose: () => void }) {
    const t = useTranslations('LendingRecovery.forms');
    const types = policy.coverType === 'DEATH_AND_DISABILITY' ? ['DEATH', 'DISABILITY'] : [policy.coverType];
    const [eventType, setEventType] = useState(types[0]);
    const [eventDate, setEventDate] = useState(businessDate);
    const [evidence, setEvidence] = useState('');
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');
    const { busy, error, run, clearError } = useAction();
    const submit = async () => {
        if (evidence.trim().length < 2) return;
        if (amount && !positive(amount)) return;
        const res = await run('claim', () => api.post(`/lending/loans/${loanId}/insurance-policies/${policy.id}/claims`, clean({ eventType, eventDate, evidenceReference: evidence.trim(), amountClaimed: amount.trim(), note: note.trim() })));
        if (res) onDone(t('claimFiled'));
    };
    return (
        <ActionPanel title={t('claimTitle', { insurer: policy.insurer, policy: policy.policyNumber })} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label={t('event')}><SelectInput value={eventType} onChange={setEventType} options={types.map((v) => ({ value: v, label: t(`coverType.${v}`) }))} /></Field>
                <Field label={t('eventDate')}><TextInput type="date" value={eventDate} onChange={setEventDate} max={businessDate} /></Field>
                <Field label={t('evidence')} hint={t('evidenceHint')}><TextInput value={evidence} onChange={setEvidence} maxLength={200} /></Field>
                <Field label={t('amountClaimed', { currency: policy.currency })} hint={t('amountClaimedHint')}><TextInput value={amount} onChange={setAmount} inputMode="decimal" /></Field>
                <Field label={t('note')} className="sm:col-span-2"><TextInput value={note} onChange={setNote} maxLength={500} /></Field>
            </div>
            <Btn variant="primary" onClick={submit} busy={busy === 'claim'} disabled={evidence.trim().length < 2}>{t('fileClaim')}</Btn>
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}

export function ClaimReceiptForm({ loanId, claimId, due, currency, onDone, onClose }: { loanId: string; claimId: string; due: string; currency: string; onDone: Done; onClose: () => void }) {
    const t = useTranslations('LendingRecovery.forms');
    const [amount, setAmount] = useState(due);
    const [reference, setReference] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const submit = async () => {
        if (!positive(amount) || reference.trim().length < 2) return;
        const body = { amount: amount.trim(), externalReference: reference.trim() };
        const res = await run('receipt', () => api.post(`/lending/loans/${loanId}/insurance-claims/${claimId}/receipts`, body, idem(key.keyFor({ claimId, ...body }))));
        if (res) { key.reset(); onDone(t('insurerPaymentReceived')); }
    };
    return (
        <ActionPanel title={t('insurerPaymentReceived')} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={t('amount', { currency })} hint={t('stillOwed', { amount: due })}><TextInput value={amount} onChange={setAmount} inputMode="decimal" /></Field>
                <Field label={t('bankReference')}><TextInput value={reference} onChange={setReference} maxLength={120} /></Field>
            </div>
            <Btn variant="primary" onClick={submit} busy={busy === 'receipt'} disabled={!positive(amount) || reference.trim().length < 2}>{t('recordReceipt')}</Btn>
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}

/* ── UC-71 Debt sale ─────────────────────────────────────────────────────── */

export function DebtSaleForm({ loanId, currency, businessDate, onDone, onClose }: { loanId: string; currency: string; businessDate: string; onDone: Done; onClose: () => void }) {
    const t = useTranslations('LendingRecovery.forms');
    const [buyer, setBuyer] = useState('');
    const [price, setPrice] = useState('');
    const [date, setDate] = useState(businessDate);
    const [reason, setReason] = useState('');
    const [ref, setRef] = useState('');
    const [preview, setPreview] = useState<{ explanation: string } | null>(null);
    const { busy, error, run, clearError } = useAction();
    const ok = buyer.trim().length >= 2 && positive(price) && reason.trim().length >= 3;
    const submit = async () => {
        if (!ok) return;
        const res = await run('sale', () => api.post<{ preview: { explanation: string } }>(`/lending/loans/${loanId}/debt-sales`, clean({ buyer: buyer.trim(), price: price.trim(), saleDate: date, reason: reason.trim(), externalReference: ref.trim() })));
        if (res) { setPreview(res.data.preview); onDone(t('debtSaleProposed')); }
    };
    return (
        <ActionPanel title={t('debtSaleTitle')} onClose={onClose}>
            <p className="text-[12px] text-[#697386]">{t('debtSaleIntro')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label={t('buyer')}><TextInput value={buyer} onChange={setBuyer} maxLength={120} /></Field>
                <Field label={t('price', { currency })}><TextInput value={price} onChange={setPrice} inputMode="decimal" /></Field>
                <Field label={t('saleDate')}><TextInput type="date" value={date} onChange={setDate} max={businessDate} /></Field>
                <Field label={t('reason')} className="sm:col-span-2"><TextInput value={reason} onChange={setReason} maxLength={500} /></Field>
                <Field label={t('contractReference')}><TextInput value={ref} onChange={setRef} maxLength={120} /></Field>
            </div>
            <Btn variant="danger" onClick={submit} busy={busy === 'sale'} disabled={!ok}>{t('proposeSale')}</Btn>
            {preview && <Notice tone="info">{preview.explanation}</Notice>}
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}
