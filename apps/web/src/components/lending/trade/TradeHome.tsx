"use client";

import { useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { BorrowerPicker } from '../groups/borrowers';
import { LendingShell, useLendingHref } from '../LendingShell';
import { Btn, Card, Empty, ErrorBox, Field, Notice, SelectInput, Spinner, Table, Tabs, TextInput, td, tdR, th, thR } from '../ui';
import { clean, qs, useAction, useApi } from '../useAsync';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import type { Paged, Product } from '../types';
import type { FacilitySummary } from '../facilities/types';
import { LC_STATUSES, type LetterOfCredit } from './types';

type Tab = 'lc' | 'invoices';

/**
 * Trade finance: letters of credit (LT-19, UC-53) and invoice-finance
 * registers (LT-18, UC-67).
 */
export function TradeHome() {
    const [tab, setTab] = useState<Tab>('lc');
    return (
        <LendingShell title="Trade finance" subtitle="Letters of credit for importers and advances against invoices.">
            <Tabs<Tab> tabs={[{ value: 'lc', label: 'Letters of credit' }, { value: 'invoices', label: 'Invoice finance' }]} value={tab} onChange={setTab} />
            {tab === 'lc' ? <LettersOfCredit /> : <InvoiceFacilities />}
        </LendingShell>
    );
}

function LettersOfCredit() {
    const href = useLendingHref();
    const [status, setStatus] = useState('');
    const [showNew, setShowNew] = useState(false);
    const list = useApi<Paged<LetterOfCredit>>(`/lending/letters-of-credit${qs({ status })}`);
    return (
        <>
            {showNew && <NewLetterOfCredit onDone={() => { setShowNew(false); list.reload(); }} onClose={() => setShowNew(false)} />}
            <Card
                title="Letters of credit"
                subtitle="Issued credits are off-balance-sheet commitments; a payment under one becomes the importer's loan."
                bodyClass="p-0"
                actions={
                    <>
                        <SelectInput value={status} onChange={setStatus} options={LC_STATUSES} placeholder="All statuses" className="w-44" />
                        <Btn variant="primary" onClick={() => setShowNew(true)}>New letter of credit</Btn>
                    </>
                }
            >
                {list.error && <div className="p-4"><ErrorBox error={list.error} /></div>}
                {list.loading && !list.data ? <Spinner /> : (list.data?.data.length ?? 0) === 0 ? <Empty>No letters of credit.</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>Reference</th><th className={th}>Beneficiary</th><th className={th}>Status</th>
                                <th className={thR}>Amount</th><th className={thR}>Drawn</th><th className={thR}>Undrawn</th><th className={thR}>Fee</th><th className={th}>Expiry</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {list.data!.data.map((lc) => (
                                <tr key={lc.id}>
                                    <td className={td}><Link className="font-semibold text-[#635BFF] hover:underline" href={href(`/lending/trade/letters-of-credit/${lc.id}`)}>{lc.reference}</Link></td>
                                    <td className={td}>{lc.beneficiaryName}</td>
                                    <td className={td}><StatusBadge status={lc.status} /></td>
                                    <td className={tdR}><MoneyCell value={lc.amount} currency={lc.currency} strong /></td>
                                    <td className={tdR}><MoneyCell value={lc.drawnAmount} currency={lc.currency} /></td>
                                    <td className={tdR}><MoneyCell value={lc.undrawn} currency={lc.currency} /></td>
                                    <td className={tdR}><MoneyCell value={lc.feeAmount} currency={lc.currency} muted /></td>
                                    <td className={`${td} whitespace-nowrap`}>{lc.expiryDate}</td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Card>
        </>
    );
}

function NewLetterOfCredit({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
    const products = useApi<Product[]>('/lending/products');
    const lcProducts = (products.data ?? []).filter((p) => p.templateCode === 'LETTER_OF_CREDIT' && p.activeVersion);
    const { busy, error, run, clearError } = useAction();
    const [f, setF] = useState({ borrowerId: '', productId: '', amount: '', beneficiaryName: '', beneficiaryBank: '', beneficiaryAccount: '', expiryDate: '', numberOfInstalments: '6' });
    const submit = async () => {
        const body = clean({ ...f, numberOfInstalments: Number(f.numberOfInstalments) });
        const res = await run('request', () => api.post('/lending/letters-of-credit', body));
        if (res) onDone();
    };
    return (
        <Card title="Request a letter of credit" subtitle="Maker: a credit approver issues it within their authority. The fee is charged at issue." actions={<Btn variant="ghost" onClick={onClose}>Close</Btn>}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="Importer (borrower)"><BorrowerPicker value={f.borrowerId} onChange={(v) => setF({ ...f, borrowerId: v })} /></Field>
                <Field label="Letter-of-credit product" hint="Its configuration names the loan a paid credit converts into">
                    <SelectInput value={f.productId} onChange={(v) => setF({ ...f, productId: v })} options={lcProducts.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} placeholder={products.loading ? 'Loading…' : 'Select a product'} />
                </Field>
                <Field label="Amount"><TextInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} inputMode="decimal" /></Field>
                <Field label="Beneficiary (exporter)"><TextInput value={f.beneficiaryName} onChange={(v) => setF({ ...f, beneficiaryName: v })} maxLength={160} /></Field>
                <Field label="Beneficiary bank" hint="Optional"><TextInput value={f.beneficiaryBank} onChange={(v) => setF({ ...f, beneficiaryBank: v })} maxLength={160} /></Field>
                <Field label="Beneficiary account" hint="Optional"><TextInput value={f.beneficiaryAccount} onChange={(v) => setF({ ...f, beneficiaryAccount: v })} maxLength={60} /></Field>
                <Field label="Expiry date"><TextInput type="date" value={f.expiryDate} onChange={(v) => setF({ ...f, expiryDate: v })} /></Field>
                <Field label="Instalments if converted to a loan"><TextInput value={f.numberOfInstalments} onChange={(v) => setF({ ...f, numberOfInstalments: v })} inputMode="numeric" /></Field>
            </div>
            <div className="mt-3 flex items-center gap-3">
                <Btn variant="primary" onClick={submit} busy={busy === 'request'}>Request</Btn>
                <ErrorBox error={error} onDismiss={clearError} />
            </div>
        </Card>
    );
}

/** Revolving facilities; the register opens for those under an invoice-finance product. */
function InvoiceFacilities() {
    const href = useLendingHref();
    const list = useApi<Paged<FacilitySummary>>(`/lending/facilities${qs({ type: 'REVOLVING' })}`);
    return (
        <Card title="Invoice-finance facilities" subtitle="Open a facility's invoice register. Facilities under other revolving products refuse invoices." bodyClass="p-0">
            <div className="p-4"><Notice>An invoice-finance facility is booked like any facility (an application under an invoice-backed product). It is drawn only by advances against approved invoices.</Notice></div>
            {list.error && <div className="p-4"><ErrorBox error={list.error} /></div>}
            {list.loading && !list.data ? <Spinner /> : (list.data?.data.length ?? 0) === 0 ? <Empty>No revolving facilities.</Empty> : (
                <Table>
                    <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Facility</th><th className={th}>Status</th><th className={thR}>Limit</th><th className={th}></th></tr></thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {list.data!.data.map((x) => (
                            <tr key={x.id}>
                                <td className={td}>{x.reference}</td>
                                <td className={td}><StatusBadge status={x.status} /></td>
                                <td className={tdR}><MoneyCell value={x.limitAmount} currency={x.currency} /></td>
                                <td className={td}><Link className="text-[12px] font-semibold text-[#635BFF] hover:underline" href={href(`/lending/trade/invoices/${x.id}`)}>Invoice register →</Link></td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
        </Card>
    );
}
