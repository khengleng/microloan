"use client";

import { useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { useLendingHref } from '../LendingShell';
import { ActionPanel, Btn, Card, Empty, ErrorBox, Field, KV, Notice, Spinner, Table, TextInput, td, tdR, th, thR } from '../ui';
import { clean, idem, useAction, useApi, useIdempotencyKey } from '../useAsync';
import { fmtRate, isPositive } from '../format';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import type { LoanDetail } from '../types';

const MONEY_RE = /^\d+(\.\d{1,4})?$/;

interface BnplRefundRow {
    id: string; amount: string; merchantReference: string; reason: string; appliedToPrincipal: string; customerRefund: string;
    discountReversed: string; merchantClawback: string; reductions: { number: number; principal: string }[]; status: string; createdAt: string;
}
interface BnplPlanView {
    merchantName: string; merchantReference: string; purchaseAmount: string; merchantDiscountRate: string; merchantDiscount: string;
    merchantNet: string; refundedAmount: string; discountReversed: string; refundable: string; refunds: BnplRefundRow[];
}
interface LeaseView {
    lease: { assetTypes: string[]; allowReturn: boolean };
    structure: string;
    residualValue: string;
    asset: {
        id: string; assetType: string; description: string; serialNumber: string; supplierName: string; cost: string; residualValue: string;
        ownership: string; endOption: string | null; endDate: string | null; returnCondition: string;
    } | null;
    returnCheck: { ok: boolean; issues: string[] } | null;
}

type Props = { loanId: string; detail: LoanDetail; onDone: (msg: string) => void };

/** Card, BNPL or lease behaviour of a loan (LT-07, LT-11, LT-15). */
export function PurchaseLinkedCard({ loanId, detail, onDone }: Props) {
    const href = useLendingHref();
    const s = detail.specialised;
    if (!s) return null;
    if (s.kind === 'CARD')
        return (
            <Notice title="Credit card">
                This account carries a credit card&apos;s balance. Purchases, cash advances, statements and payments are handled on the card.{' '}
                {s.cardId && <Link href={href(`/lending/cards/${s.cardId}`)} className="font-semibold text-[#635BFF] hover:underline">Open the card →</Link>}
            </Notice>
        );
    if (s.kind === 'BNPL') return <BnplCard loanId={loanId} detail={detail} onDone={onDone} />;
    return <LeaseCard loanId={loanId} detail={detail} onDone={onDone} />;
}

function BnplCard({ loanId, detail, onDone }: Props) {
    const cur = detail.account.currency;
    const booked = detail.account.status === 'BOOKED';
    const res = useApi<BnplPlanView>(booked ? null : `/lending/loans/${loanId}/bnpl`);
    const [refunding, setRefunding] = useState(false);
    const done = (msg: string) => { setRefunding(false); res.reload(); onDone(msg); };
    if (booked)
        return (
            <Card title="Buy now, pay later">
                <p className="text-[13px] text-[#3C4257]">At disbursement, name the merchant as the single <b>MERCHANT</b> payee for the full purchase price. The merchant is paid net of the product&apos;s merchant discount; the discount is the lender&apos;s income.</p>
            </Card>
        );
    const p = res.data;
    return (
        <Card title="Buy now, pay later" subtitle="Merchant settlement and refunds (UC-52). A refund reduces the remaining instalments, latest first.">
            {res.error && <ErrorBox error={res.error} />}
            {!p ? <Spinner /> : (
                <div className="space-y-4">
                    <KV
                        cols={4}
                        items={[
                            ['Merchant', `${p.merchantName}${p.merchantReference ? ` · ${p.merchantReference}` : ''}`],
                            ['Purchase financed', <MoneyCell key="g" value={p.purchaseAmount} currency={cur} />],
                            ['Merchant discount', <span key="d"><MoneyCell value={p.merchantDiscount} currency={cur} /> ({fmtRate(p.merchantDiscountRate)})</span>],
                            ['Paid to merchant', <MoneyCell key="n" value={p.merchantNet} currency={cur} />],
                            ['Refunded so far', <MoneyCell key="r" value={p.refundedAmount} currency={cur} />],
                            ['Still refundable', <MoneyCell key="l" value={p.refundable} currency={cur} />],
                        ]}
                    />
                    {isPositive(p.refundable) && !refunding && <Btn onClick={() => setRefunding(true)}>Record merchant refund</Btn>}
                    {refunding && <RefundPanel loanId={loanId} currency={cur} refundable={p.refundable} onDone={done} onClose={() => setRefunding(false)} />}
                    {p.refunds.length === 0 ? <Empty>No refunds.</Empty> : (
                        <Table>
                            <thead>
                                <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                    <th className={th}>Reference</th><th className={thR}>Refund</th><th className={thR}>Off instalments</th>
                                    <th className={thR}>To customer</th><th className={thR}>Discount reversed</th><th className={thR}>Merchant owes</th><th className={th}>Clawback</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#F0F2F5]">
                                {p.refunds.map((r) => (
                                    <tr key={r.id}>
                                        <td className={td}>{r.merchantReference}<div className="text-[11px] text-[#697386]">{r.reason}</div></td>
                                        <td className={tdR}><MoneyCell value={r.amount} strong /></td>
                                        <td className={tdR}><MoneyCell value={r.appliedToPrincipal} /><div className="text-[11px] text-[#697386]">{r.reductions.map((x) => `#${x.number} −${x.principal}`).join(', ')}</div></td>
                                        <td className={tdR}><MoneyCell value={r.customerRefund} /></td>
                                        <td className={tdR}><MoneyCell value={r.discountReversed} /></td>
                                        <td className={tdR}><MoneyCell value={r.merchantClawback} /></td>
                                        <td className={td}>{r.status === 'CLAWBACK_DUE' ? <CollectButton loanId={loanId} refundId={r.id} onDone={done} /> : <StatusBadge status={r.status} />}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    )}
                </div>
            )}
        </Card>
    );
}

function RefundPanel({ loanId, currency, refundable, onDone, onClose }: { loanId: string; currency: string; refundable: string; onDone: (m: string) => void; onClose: () => void }) {
    const [amount, setAmount] = useState('');
    const [merchantReference, setMerchantReference] = useState('');
    const [reason, setReason] = useState('');
    const [externalReference, setExternalReference] = useState('');
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const post = async () => {
        const a = amount.trim();
        if (!MONEY_RE.test(a) || !/[1-9]/.test(a)) { setProblem('Enter a positive decimal amount.'); return; }
        setProblem('');
        const body = clean({ amount: a, merchantReference: merchantReference.trim(), reason: reason.trim(), externalReference: externalReference.trim() });
        const k = key.keyFor(body);
        const res = await run('refund', () => api.post(`/lending/loans/${loanId}/bnpl/refunds`, body, idem(k)));
        if (res) { key.reset(); onDone(`Merchant refund of ${currency} ${a} recorded`); }
    };
    return (
        <ActionPanel title="Record a merchant refund" onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={`Refund amount (${currency})`} hint={`Up to ${currency} ${refundable}`} error={problem || undefined}><TextInput value={amount} onChange={setAmount} inputMode="decimal" /></Field>
                <Field label="Merchant refund reference"><TextInput value={merchantReference} onChange={setMerchantReference} maxLength={120} /></Field>
                <Field label="Reason"><TextInput value={reason} onChange={setReason} maxLength={500} /></Field>
                <Field label="Customer payout reference" hint="Needed when part of the refund goes back to the customer (already paid)"><TextInput value={externalReference} onChange={setExternalReference} maxLength={120} /></Field>
            </div>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={post} busy={busy === 'refund'}>Record refund</Btn>
        </ActionPanel>
    );
}

function CollectButton({ loanId, refundId, onDone }: { loanId: string; refundId: string; onDone: (m: string) => void }) {
    const [ref, setRef] = useState('');
    const { busy, error, run } = useAction();
    const key = useIdempotencyKey();
    const collect = async () => {
        const body = { externalReference: ref.trim() };
        const k = key.keyFor(body);
        const res = await run('collect', () => api.post(`/lending/loans/${loanId}/bnpl/refunds/${refundId}/collect`, body, idem(k)));
        if (res) { key.reset(); onDone('Merchant clawback collected'); }
    };
    return (
        <div className="flex items-center gap-1.5">
            <TextInput value={ref} onChange={setRef} placeholder="Settlement ref" className="w-32" />
            <Btn size="sm" onClick={collect} busy={busy === 'collect'} disabled={ref.trim().length < 2} reason={error?.message}>Collect</Btn>
        </div>
    );
}

function LeaseCard({ loanId, detail, onDone }: Props) {
    const cur = detail.account.currency;
    const status = detail.account.status;
    const res = useApi<LeaseView>(`/lending/loans/${loanId}/lease`);
    const [panel, setPanel] = useState<'register' | 'return' | null>(null);
    const { busy, error, run, clearError } = useAction();
    const done = (msg: string) => { setPanel(null); res.reload(); onDone(msg); };
    const v = res.data;
    const a = v?.asset;
    const transfer = async () => {
        const r = await run('title', () => api.post(`/lending/loans/${loanId}/lease/transfer-title`, {}));
        if (r) done('Purchase option exercised — title transferred to the lessee');
    };
    return (
        <Card title={v?.structure === 'IJARAH' ? 'Ijarah lease' : 'Lease'} subtitle="The lender owns the asset; rentals are rental income. At the end the lessee buys it for the residual or returns it.">
            {res.error && <ErrorBox error={res.error} />}
            {!v ? <Spinner /> : (
                <div className="space-y-3">
                    {!a ? (
                        status === 'BOOKED'
                            ? (panel === 'register' ? <RegisterAssetPanel loanId={loanId} currency={cur} types={v.lease.assetTypes} onDone={done} onClose={() => setPanel(null)} /> : <Btn variant="primary" onClick={() => setPanel('register')}>Register the leased asset</Btn>)
                            : <Empty>No leased asset is registered.</Empty>
                    ) : (
                        <KV
                            cols={4}
                            items={[
                                ['Asset', `${a.description}${a.serialNumber ? ` · ${a.serialNumber}` : ''}`],
                                ['Type', a.assetType],
                                ['Supplier', a.supplierName],
                                ['Cost', <MoneyCell key="c" value={a.cost} currency={cur} />],
                                ['Residual (purchase option)', <MoneyCell key="r" value={a.residualValue} currency={cur} />],
                                ['Ownership', <StatusBadge key="o" status={a.ownership} />],
                                ['Lease end', a.endOption ? `${a.endOption === 'PURCHASE' ? 'Bought' : 'Returned'} on ${a.endDate}` : '—'],
                                ['Return condition', a.returnCondition || '—'],
                            ]}
                        />
                    )}
                    {a && a.ownership === 'LESSOR' && status === 'BOOKED' && <p className="text-[12px] text-[#697386]">Pay the supplier at disbursement (payee type SUPPLIER, DEALER or SELLER) — never the lessee.</p>}
                    {a && a.ownership === 'LESSOR' && status === 'ACTIVE' && v.lease.allowReturn && (
                        <div className="space-y-2">
                            {v.returnCheck && !v.returnCheck.ok && <p className="text-[12px] text-[#697386]">Return possible once only the residual is left: {v.returnCheck.issues.join(' ')}</p>}
                            {panel === 'return'
                                ? <ReturnPanel loanId={loanId} residual={a.residualValue} currency={cur} onDone={done} onClose={() => setPanel(null)} />
                                : <Btn onClick={() => setPanel('return')} disabled={!v.returnCheck?.ok}>Return the asset</Btn>}
                        </div>
                    )}
                    {a && a.ownership === 'LESSOR' && status === 'CLOSED' && (
                        <div className="space-y-2">
                            <p className="text-[12px] text-[#697386]">Every rental and the residual are paid: the purchase option can be exercised.</p>
                            <ErrorBox error={error} onDismiss={clearError} />
                            <Btn variant="primary" onClick={transfer} busy={busy === 'title'}>Transfer title to the lessee</Btn>
                        </div>
                    )}
                </div>
            )}
        </Card>
    );
}

function RegisterAssetPanel({ loanId, currency, types, onDone, onClose }: { loanId: string; currency: string; types: string[]; onDone: (m: string) => void; onClose: () => void }) {
    const [assetType, setAssetType] = useState(types[0] ?? '');
    const [description, setDescription] = useState('');
    const [serialNumber, setSerialNumber] = useState('');
    const [supplierName, setSupplierName] = useState('');
    const [cost, setCost] = useState('');
    const { busy, error, run, clearError } = useAction();
    const register = async () => {
        const body = clean({ assetType, description: description.trim(), serialNumber: serialNumber.trim(), supplierName: supplierName.trim(), cost: cost.trim() });
        const res = await run('register', () => api.post(`/lending/loans/${loanId}/lease`, body));
        if (res) onDone('Leased asset registered');
    };
    return (
        <ActionPanel title="Register the leased asset" onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Asset type" hint={types.join(', ')}><TextInput value={assetType} onChange={setAssetType} /></Field>
                <Field label="Description"><TextInput value={description} onChange={setDescription} maxLength={200} /></Field>
                <Field label="Serial / VIN" hint="Optional"><TextInput value={serialNumber} onChange={setSerialNumber} maxLength={80} /></Field>
                <Field label="Supplier"><TextInput value={supplierName} onChange={setSupplierName} maxLength={120} /></Field>
                <Field label={`Cost (${currency})`}><TextInput value={cost} onChange={setCost} inputMode="decimal" /></Field>
            </div>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={register} busy={busy === 'register'}>Register asset</Btn>
        </ActionPanel>
    );
}

function ReturnPanel({ loanId, residual, currency, onDone, onClose }: { loanId: string; residual: string; currency: string; onDone: (m: string) => void; onClose: () => void }) {
    const [condition, setCondition] = useState('');
    const [externalReference, setExternalReference] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const post = async () => {
        const body = { condition: condition.trim(), externalReference: externalReference.trim() };
        const k = key.keyFor(body);
        const res = await run('return', () => api.post(`/lending/loans/${loanId}/lease/return`, body, idem(k)));
        if (res) { key.reset(); onDone('Asset returned — the residual is settled by the asset and the lease is closed'); }
    };
    return (
        <ActionPanel title={`Return the asset instead of paying the ${currency} ${residual} residual`} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Condition on return"><TextInput value={condition} onChange={setCondition} maxLength={500} /></Field>
                <Field label="Return / yard reference"><TextInput value={externalReference} onChange={setExternalReference} maxLength={120} /></Field>
            </div>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={post} busy={busy === 'return'} disabled={condition.trim().length < 2 || externalReference.trim().length < 2}>Record return</Btn>
        </ActionPanel>
    );
}
