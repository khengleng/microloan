"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { ActionPanel, Btn, ErrorBox, Field, Notice, SelectInput, TextArea, TextInput } from '../ui';
import { clean, idem, useAction, useIdempotencyKey } from '../useAsync';
import { Money } from '../MoneyCell';
import type { InsurancePolicy, ProceedsResult, Repossession } from './types';

const MONEY_RE = /^\d+(\.\d{1,4})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const positive = (v: string) => MONEY_RE.test(v.trim()) && /[1-9]/.test(v);

type Done = (msg: string) => void;

/* ── UC-65 Repossession ──────────────────────────────────────────────────── */

export function RepossessionForm({ loanId, pledges, businessDate, onDone, onClose }: {
    loanId: string; pledges: { collateralId: string; type: string; description: string }[]; businessDate: string; onDone: Done; onClose: () => void;
}) {
    const [collateralId, setCollateralId] = useState(pledges[0]?.collateralId ?? '');
    const [location, setLocation] = useState('');
    const [seizedOn, setSeizedOn] = useState(businessDate);
    const [reason, setReason] = useState('');
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const submit = async () => {
        if (!collateralId) { setProblem('Choose the pledged asset.'); return; }
        if (location.trim().length < 2 || reason.trim().length < 3 || !DATE_RE.test(seizedOn)) { setProblem('Give the location, the seizure date and the reason.'); return; }
        setProblem('');
        const res = await run('propose', () => api.post(`/lending/loans/${loanId}/repossessions`, { collateralId, location: location.trim(), seizedOn, reason: reason.trim() }));
        if (res) onDone('Seizure proposed — a different user must approve it');
    };
    return (
        <ActionPanel title="Repossess collateral" onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Asset">
                    <SelectInput value={collateralId} onChange={setCollateralId} options={pledges.map((p) => ({ value: p.collateralId, label: `${p.type} — ${p.description}` }))} />
                </Field>
                <Field label="Held at (location)"><TextInput value={location} onChange={setLocation} maxLength={200} /></Field>
                <Field label="Seized on"><TextInput type="date" value={seizedOn} onChange={setSeizedOn} max={businessDate} /></Field>
                <Field label="Reason" className="sm:col-span-3" error={problem || undefined}><TextArea value={reason} onChange={setReason} rows={2} maxLength={500} /></Field>
            </div>
            <Btn variant="danger" onClick={submit} busy={busy === 'propose'}>Propose seizure</Btn>
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}

export function RepossessionValuationForm({ loanId, repo, currency, businessDate, onDone, onClose }: {
    loanId: string; repo: Repossession; currency: string; businessDate: string; onDone: Done; onClose: () => void;
}) {
    const [value, setValue] = useState('');
    const [valuer, setValuer] = useState('');
    const [date, setDate] = useState(businessDate);
    const { busy, error, run, clearError } = useAction();
    const submit = async () => {
        if (!positive(value) || valuer.trim().length < 2) return;
        const res = await run('value', () => api.post(`/lending/loans/${loanId}/repossessions/${repo.id}/valuation`, { marketValue: value.trim(), valuer: valuer.trim(), valuationDate: date }));
        if (res) onDone('Repossession valuation recorded');
    };
    return (
        <ActionPanel title="Repossession valuation" onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label={`Market value (${currency})`}><TextInput value={value} onChange={setValue} inputMode="decimal" /></Field>
                <Field label="Valuer"><TextInput value={valuer} onChange={setValuer} maxLength={120} /></Field>
                <Field label="Valued on"><TextInput type="date" value={date} onChange={setDate} max={businessDate} /></Field>
            </div>
            <Btn variant="primary" onClick={submit} busy={busy === 'value'} disabled={!positive(value) || valuer.trim().length < 2}>Record valuation</Btn>
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}

/** Sale of a repossessed asset or auction of a forfeited pawn: proceeds pay costs, then the loan. */
export function SaleForm({ title, endpoint, currency, owed, businessDate, onDone, onClose }: {
    title: string; endpoint: string; currency: string; owed: string; businessDate: string; onDone: Done; onClose: () => void;
}) {
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
        if (!positive(price)) { setProblem('Enter the sale price.'); return; }
        if (costs && !MONEY_RE.test(costs.trim())) { setProblem('Costs must be a decimal amount.'); return; }
        if (buyer.trim().length < 2) { setProblem('Name the buyer.'); return; }
        setProblem('');
        const body = clean({ salePrice: price.trim(), costs: costs.trim(), buyer: buyer.trim(), saleDate: date, externalReference: ref.trim() });
        const res = await run('sell', () => api.post<{ proceeds: ProceedsResult }>(endpoint, body, idem(key.keyFor(body))));
        if (res) {
            key.reset();
            setResult(res.data.proceeds);
            onDone(res.data.proceeds.settlesLoan ? 'Sold — the loan is paid off' : 'Sold — a deficiency is still owed');
        }
    };
    return (
        <ActionPanel title={title} onClose={onClose}>
            <p className="text-[12px] text-[#697386]">The loan owes <b><Money value={owed} currency={currency} /></b>. Proceeds pay the costs first, then the loan in the product&apos;s order; a surplus is held for the borrower and paid out by a second user; a shortfall stays owed.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label={`Sale price (${currency})`}><TextInput value={price} onChange={setPrice} inputMode="decimal" /></Field>
                <Field label={`Costs paid from proceeds (${currency})`} hint="Seizure, storage, auction fees"><TextInput value={costs} onChange={setCosts} inputMode="decimal" /></Field>
                <Field label="Buyer"><TextInput value={buyer} onChange={setBuyer} maxLength={120} /></Field>
                <Field label="Sale date"><TextInput type="date" value={date} onChange={setDate} max={businessDate} /></Field>
                <Field label="Reference" className="sm:col-span-2" error={problem || undefined}><TextInput value={ref} onChange={setRef} maxLength={120} /></Field>
            </div>
            <Btn variant="primary" onClick={submit} busy={busy === 'sell'}>Record sale and apply proceeds</Btn>
            {result && <Notice tone={result.settlesLoan ? 'success' : 'warn'}>{result.explanation.join(' ')}</Notice>}
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}

/* ── UC-66 / LT-09 Pawn and gold ─────────────────────────────────────────── */

export function PawnForm({ loanId, currency, businessDate, onDone, onClose }: {
    loanId: string; currency: string; businessDate: string; onDone: Done; onClose: () => void;
}) {
    const [f, setF] = useState({ description: '', itemType: 'GOLD', weightGrams: '', karat: '18', purity: '', pricePerGram: '', custodyLocation: '', sealNumber: '', receivedOn: businessDate, redemptionDeadline: '' });
    const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const submit = async () => {
        if (f.description.trim().length < 2 || f.custodyLocation.trim().length < 2) { setProblem('Describe the item and where it is kept.'); return; }
        if (!/^\d+(\.\d{1,4})?$/.test(f.weightGrams) || !positive(f.pricePerGram)) { setProblem('Give the weight in grams and the price per gram of pure metal.'); return; }
        if (!DATE_RE.test(f.redemptionDeadline)) { setProblem('Set the redemption deadline.'); return; }
        setProblem('');
        const body = clean({
            description: f.description.trim(), itemType: f.itemType, weightGrams: f.weightGrams.trim(),
            karat: f.purity ? undefined : Number(f.karat), purity: f.purity.trim(), pricePerGram: f.pricePerGram.trim(),
            custodyLocation: f.custodyLocation.trim(), sealNumber: f.sealNumber.trim(), receivedOn: f.receivedOn, redemptionDeadline: f.redemptionDeadline,
        });
        const res = await run('custody', () => api.post<{ valuation: { value: string; explanation: string } }>(`/lending/loans/${loanId}/pawn-items`, body));
        if (res) onDone(`Item in custody — valued ${currency} ${res.data.valuation.value}`);
    };
    return (
        <ActionPanel title="Take an item into custody" onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <Field label="Item" className="sm:col-span-2"><TextInput value={f.description} onChange={set('description')} maxLength={300} placeholder="e.g. 22k gold bracelet" /></Field>
                <Field label="Type"><SelectInput value={f.itemType} onChange={set('itemType')} options={['GOLD', 'JEWELLERY', 'OTHER']} /></Field>
                <Field label="Weight (g)"><TextInput value={f.weightGrams} onChange={set('weightGrams')} inputMode="decimal" /></Field>
                <Field label="Karat"><SelectInput value={f.karat} onChange={set('karat')} options={['24', '22', '21', '18', '14', '10', '9']} disabled={!!f.purity} /></Field>
                <Field label="…or purity (fineness)" hint="e.g. 0.9999"><TextInput value={f.purity} onChange={set('purity')} inputMode="decimal" /></Field>
                <Field label={`Price per gram, pure (${currency})`}><TextInput value={f.pricePerGram} onChange={set('pricePerGram')} inputMode="decimal" /></Field>
                <Field label="Seal number"><TextInput value={f.sealNumber} onChange={set('sealNumber')} maxLength={60} /></Field>
                <Field label="Custody location" className="sm:col-span-2"><TextInput value={f.custodyLocation} onChange={set('custodyLocation')} maxLength={200} placeholder="Vault, box" /></Field>
                <Field label="Received on"><TextInput type="date" value={f.receivedOn} onChange={set('receivedOn')} max={businessDate} /></Field>
                <Field label="Redemption deadline" error={problem || undefined}><TextInput type="date" value={f.redemptionDeadline} onChange={set('redemptionDeadline')} /></Field>
            </div>
            <Btn variant="primary" onClick={submit} busy={busy === 'custody'}>Record custody and value</Btn>
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
    const [f, setF] = useState({ insurer: '', policyNumber: '', coverType: 'DEATH_AND_DISABILITY', premiumTreatment: 'FINANCED', premium: '', startDate: businessDate, externalReference: '' });
    const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const submit = async () => {
        if (f.insurer.trim().length < 2 || f.policyNumber.trim().length < 2) { setProblem('Name the insurer and the policy number.'); return; }
        if (f.premiumTreatment === 'PAID' && !positive(f.premium)) { setProblem('Give the premium the borrower paid.'); return; }
        if (f.premium && !MONEY_RE.test(f.premium.trim())) { setProblem('The premium must be a decimal amount.'); return; }
        setProblem('');
        const body = clean({ ...f, insurer: f.insurer.trim(), policyNumber: f.policyNumber.trim(), premium: f.premium.trim(), externalReference: f.externalReference.trim() });
        const res = await run('policy', () => api.post(`/lending/loans/${loanId}/insurance-policies`, body, idem(key.keyFor(body))));
        if (res) { key.reset(); onDone('Insurance policy recorded'); }
    };
    return (
        <ActionPanel title="Record credit insurance" onClose={onClose}>
            <p className="text-[12px] text-[#697386]">A <b>financed</b> premium was added to the principal at disbursement and credited to the insurer payable (a product fee with payee INSURER). A <b>paid</b> premium is received now in cash. Either way it is the insurer&apos;s money, not fee income.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Insurer"><TextInput value={f.insurer} onChange={set('insurer')} maxLength={120} /></Field>
                <Field label="Policy number"><TextInput value={f.policyNumber} onChange={set('policyNumber')} maxLength={60} /></Field>
                <Field label="Cover"><SelectInput value={f.coverType} onChange={set('coverType')} options={[{ value: 'DEATH_AND_DISABILITY', label: 'Death and disability' }, { value: 'DEATH', label: 'Death' }, { value: 'DISABILITY', label: 'Disability' }]} /></Field>
                <Field label="Premium"><SelectInput value={f.premiumTreatment} onChange={set('premiumTreatment')} options={[{ value: 'FINANCED', label: 'Financed in the loan' }, { value: 'PAID', label: 'Paid by the borrower now' }]} /></Field>
                <Field label={`Premium (${currency})`} hint={f.premiumTreatment === 'FINANCED' ? 'Blank: the financed amount' : undefined}><TextInput value={f.premium} onChange={set('premium')} inputMode="decimal" /></Field>
                <Field label="Cover starts"><TextInput type="date" value={f.startDate} onChange={set('startDate')} /></Field>
                {f.premiumTreatment === 'PAID' && <Field label="Receipt reference" className="sm:col-span-3"><TextInput value={f.externalReference} onChange={set('externalReference')} maxLength={120} /></Field>}
            </div>
            {problem && <p className="text-[12px] text-red-600">{problem}</p>}
            <Btn variant="primary" onClick={submit} busy={busy === 'policy'}>Record policy</Btn>
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}

export function RemittanceForm({ loanId, policy, onDone, onClose }: { loanId: string; policy: InsurancePolicy; onDone: Done; onClose: () => void }) {
    const [amount, setAmount] = useState(policy.premiumToRemit);
    const [reference, setReference] = useState('');
    const { busy, error, run, clearError } = useAction();
    const submit = async () => {
        if (!positive(amount) || reference.trim().length < 2) return;
        const res = await run('remit', () => api.post(`/lending/loans/${loanId}/insurance-policies/${policy.id}/remittances`, { amount: amount.trim(), reference: reference.trim() }));
        if (res) onDone('Remittance proposed — a different user approves the payment');
    };
    return (
        <ActionPanel title={`Remit premium to ${policy.insurer}`} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={`Amount (${policy.currency})`} hint={`Held for the insurer: ${policy.premiumToRemit}`}><TextInput value={amount} onChange={setAmount} inputMode="decimal" /></Field>
                <Field label="Bordereau / payment reference"><TextInput value={reference} onChange={setReference} maxLength={120} /></Field>
            </div>
            <Btn variant="primary" onClick={submit} busy={busy === 'remit'} disabled={!positive(amount) || reference.trim().length < 2}>Propose remittance</Btn>
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}

export function ClaimForm({ loanId, policy, businessDate, onDone, onClose }: { loanId: string; policy: InsurancePolicy; businessDate: string; onDone: Done; onClose: () => void }) {
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
        if (res) onDone('Claim filed — a different user approves it, which settles the loan');
    };
    return (
        <ActionPanel title={`Claim on ${policy.insurer} ${policy.policyNumber}`} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Event"><SelectInput value={eventType} onChange={setEventType} options={types} /></Field>
                <Field label="Event date"><TextInput type="date" value={eventDate} onChange={setEventDate} max={businessDate} /></Field>
                <Field label="Evidence reference" hint="Certificate / medical report number"><TextInput value={evidence} onChange={setEvidence} maxLength={200} /></Field>
                <Field label={`Amount claimed (${policy.currency})`} hint="Blank: the balance on the settlement day"><TextInput value={amount} onChange={setAmount} inputMode="decimal" /></Field>
                <Field label="Note" className="sm:col-span-2"><TextInput value={note} onChange={setNote} maxLength={500} /></Field>
            </div>
            <Btn variant="primary" onClick={submit} busy={busy === 'claim'} disabled={evidence.trim().length < 2}>File claim</Btn>
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}

export function ClaimReceiptForm({ loanId, claimId, due, currency, onDone, onClose }: { loanId: string; claimId: string; due: string; currency: string; onDone: Done; onClose: () => void }) {
    const [amount, setAmount] = useState(due);
    const [reference, setReference] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const submit = async () => {
        if (!positive(amount) || reference.trim().length < 2) return;
        const body = { amount: amount.trim(), externalReference: reference.trim() };
        const res = await run('receipt', () => api.post(`/lending/loans/${loanId}/insurance-claims/${claimId}/receipts`, body, idem(key.keyFor({ claimId, ...body }))));
        if (res) { key.reset(); onDone('Insurer payment received'); }
    };
    return (
        <ActionPanel title="Insurer payment received" onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={`Amount (${currency})`} hint={`Still owed by the insurer: ${due}`}><TextInput value={amount} onChange={setAmount} inputMode="decimal" /></Field>
                <Field label="Bank reference"><TextInput value={reference} onChange={setReference} maxLength={120} /></Field>
            </div>
            <Btn variant="primary" onClick={submit} busy={busy === 'receipt'} disabled={!positive(amount) || reference.trim().length < 2}>Record receipt</Btn>
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}

/* ── UC-71 Debt sale ─────────────────────────────────────────────────────── */

export function DebtSaleForm({ loanId, currency, businessDate, onDone, onClose }: { loanId: string; currency: string; businessDate: string; onDone: Done; onClose: () => void }) {
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
        if (res) { setPreview(res.data.preview); onDone('Debt sale proposed — a different user approves it'); }
    };
    return (
        <ActionPanel title="Sell the loan to a collection agency" onClose={onClose}>
            <p className="text-[12px] text-[#697386]">On approval the loan leaves the book (status SOLD) and is no longer serviced. The difference between the price and the loan&apos;s carrying amount, net of its loss allowance, is booked as a gain or loss.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Buyer"><TextInput value={buyer} onChange={setBuyer} maxLength={120} /></Field>
                <Field label={`Price (${currency})`}><TextInput value={price} onChange={setPrice} inputMode="decimal" /></Field>
                <Field label="Sale date"><TextInput type="date" value={date} onChange={setDate} max={businessDate} /></Field>
                <Field label="Reason" className="sm:col-span-2"><TextInput value={reason} onChange={setReason} maxLength={500} /></Field>
                <Field label="Contract reference"><TextInput value={ref} onChange={setRef} maxLength={120} /></Field>
            </div>
            <Btn variant="danger" onClick={submit} busy={busy === 'sale'} disabled={!ok}>Propose sale</Btn>
            {preview && <Notice tone="info">{preview.explanation}</Notice>}
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}
