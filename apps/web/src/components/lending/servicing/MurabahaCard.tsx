"use client";

import { useState } from 'react';
import api from '@/lib/api';
import { ActionPanel, Btn, Card, Disclosure, ErrorBox, Field, KV, Notice, SelectInput, Spinner, Table, TextInput, td, tdR, th, thR } from '../ui';
import { clean, useAction, useApi } from '../useAsync';
import { fmtRate } from '../format';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import type { LoanDetail } from '../types';

const MONEY_RE = /^\d+(\.\d{1,4})?$/;

interface MurabahaView {
    status: string;
    currency: string;
    assetTypes: string[];
    asset: {
        id: string; assetType: string; description: string; serialNumber: string; supplierName: string; cost: string; downPayment: string;
        profit: string | null; salePrice: string | null; ibraShare: string | null; deferredProfitBalance: string; ibraGranted: string;
        status: string; soldOn: string | null;
    } | null;
    terms: { cost: string; downPayment: string; financed: string; profit: string; salePrice: string; deferredPrice: string; instalments: number; markUp: string; explanation: string } | null;
    ibra: { share: string | null; explanation: string };
    recognition: { number: number; dueDate: string; profit: string; cumulativeRecognised: string; deferredRemaining: string }[];
    profitRecognised: string;
    deferredProfit: string;
    deferredProfitToday: string | null;
    ibraGranted: string;
    accounts: Record<string, string>;
}

type Props = { loanId: string; detail: LoanDetail; onDone: (msg: string) => void };

/** Murabaha contract: what the customer buys, at what cost, profit and price, and how the profit is earned (D-067). */
export function MurabahaCard({ loanId, detail, onDone }: Props) {
    const cur = detail.account.currency;
    const booked = detail.account.status === 'BOOKED';
    const res = useApi<MurabahaView>(`/lending/loans/${loanId}/murabaha`);
    const [registering, setRegistering] = useState(false);
    const v = res.data;
    const done = (msg: string) => { setRegistering(false); res.reload(); onDone(msg); };
    return (
        <Card title="Murabaha contract" subtitle="A sale, not a loan: the financier buys the asset from its supplier and sells it to the customer at cost plus a disclosed, fixed profit. No interest is charged.">
            {res.error && <ErrorBox error={res.error} />}
            {!v ? <Spinner /> : (
                <div className="space-y-4">
                    {v.terms && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <Figure label="Cost of the asset" value={v.terms.cost} currency={cur} note={v.asset ? `Paid to ${v.asset.supplierName}` : 'Paid to the supplier at disbursement'} />
                            <Figure label="Profit (fixed)" value={v.terms.profit} currency={cur} note={`Mark-up ${fmtRate(v.terms.markUp)} on ${v.terms.financed} financed`} />
                            <Figure label="Sale price" value={v.terms.salePrice} currency={cur} note={`${v.terms.instalments} instalments${Number(v.terms.downPayment) > 0 ? ` after ${v.terms.downPayment} paid up front` : ''}`} strong />
                        </div>
                    )}
                    {v.terms && <p className="text-[12px] text-[#697386]">{v.terms.explanation}</p>}
                    {v.asset ? (
                        <KV
                            cols={4}
                            items={[
                                ['Asset', `${v.asset.description}${v.asset.serialNumber ? ` · ${v.asset.serialNumber}` : ''}`],
                                ['Type', v.asset.assetType],
                                ['Supplier', v.asset.supplierName],
                                ['Contract', <StatusBadge key="s" status={v.asset.status} />],
                                ['Sold on', v.asset.soldOn ?? 'On payment of the supplier'],
                                ['Early settlement', v.ibra.share === null ? 'No rebate (full price)' : `Ibra’ ${fmtRate(v.ibra.share)} of unearned profit`],
                                ['Profit recognised', <MoneyCell key="r" value={v.profitRecognised} currency={cur} />],
                                ['Deferred profit (ledger)', <MoneyCell key="d" value={v.deferredProfit} currency={cur} />],
                            ]}
                        />
                    ) : booked ? (
                        registering
                            ? <RegisterPanel loanId={loanId} currency={cur} types={v.assetTypes} cost={v.terms?.cost ?? ''} onDone={done} onClose={() => setRegistering(false)} />
                            : (
                                <Notice tone="warn" title="Register the asset before the payout">
                                    The financier must own the asset before it sells it. Record the asset and its supplier; at disbursement pay the supplier (payee type SUPPLIER, DEALER or SELLER) — never the customer.
                                    <div className="mt-2"><Btn variant="primary" onClick={() => setRegistering(true)}>Register the asset</Btn></div>
                                </Notice>
                            )
                    ) : null}
                    <p className="text-[12px] text-[#697386]">{v.ibra.explanation}{Number(v.ibraGranted) > 0 && <> Waived on settlement: <b>{cur} {v.ibraGranted}</b>.</>}</p>
                    {v.recognition.length > 0 && (
                        <Disclosure summary="How the profit is recognised">
                            <p className="text-[12px] text-[#697386] mb-2">
                                Each instalment&apos;s profit is earned over its own period. Until then it is deferred: carried as unearned profit ({v.accounts.unearnedProfit}) against deferred profit ({v.accounts.deferredProfit}), and released into profit income ({v.accounts.profitIncome}) as it is earned. Late charges go to charity ({v.accounts.lateChargesTo}).
                            </p>
                            <Table>
                                <thead>
                                    <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                        <th className={th}>#</th><th className={th}>Due</th><th className={thR}>Profit</th><th className={thR}>Recognised to date</th><th className={thR}>Still deferred</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {v.recognition.map((r) => (
                                        <tr key={r.number}>
                                            <td className={td}>{r.number}</td><td className={td}>{r.dueDate}</td>
                                            <td className={tdR}><MoneyCell value={r.profit} /></td>
                                            <td className={tdR}><MoneyCell value={r.cumulativeRecognised} /></td>
                                            <td className={tdR}><MoneyCell value={r.deferredRemaining} /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        </Disclosure>
                    )}
                </div>
            )}
        </Card>
    );
}

function Figure({ label, value, currency, note, strong }: { label: string; value: string; currency: string; note?: string; strong?: boolean }) {
    return (
        <div className={`rounded-md border p-3 ${strong ? 'border-[#C9D7FF] bg-[#F8F9FF]' : 'border-[#E3E8EE] bg-white'}`}>
            <p className="text-[11px] font-bold uppercase tracking-wide text-[#8792A2]">{label}</p>
            <p className="text-xl font-bold text-[#1A1F36] tabular-nums mt-0.5">{currency} {value}</p>
            {note && <p className="text-[11px] text-[#697386] mt-0.5">{note}</p>}
        </div>
    );
}

function RegisterPanel({ loanId, currency, types, cost: expected, onDone, onClose }: { loanId: string; currency: string; types: string[]; cost: string; onDone: (m: string) => void; onClose: () => void }) {
    const [assetType, setAssetType] = useState(types[0] ?? '');
    const [description, setDescription] = useState('');
    const [serialNumber, setSerialNumber] = useState('');
    const [supplierName, setSupplierName] = useState('');
    const [cost, setCost] = useState(expected);
    const { busy, error, run, clearError } = useAction();
    const valid = MONEY_RE.test(cost.trim()) && description.trim().length >= 2 && supplierName.trim().length >= 2 && !!assetType;
    const register = async () => {
        const body = clean({ assetType, description: description.trim(), serialNumber: serialNumber.trim(), supplierName: supplierName.trim(), cost: cost.trim() });
        const r = await run('register', () => api.post(`/lending/loans/${loanId}/murabaha`, body));
        if (r) onDone('Murabaha asset registered');
    };
    return (
        <ActionPanel title="Register the asset being sold" onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Asset type"><SelectInput value={assetType} onChange={setAssetType} options={types} /></Field>
                <Field label="Description"><TextInput value={description} onChange={setDescription} maxLength={200} /></Field>
                <Field label="Serial / VIN" hint="Optional"><TextInput value={serialNumber} onChange={setSerialNumber} maxLength={80} /></Field>
                <Field label="Supplier"><TextInput value={supplierName} onChange={setSupplierName} maxLength={120} /></Field>
                <Field label={`Cost (${currency})`} hint={expected ? `Must equal what is financed plus any down payment: ${currency} ${expected}` : undefined}>
                    <TextInput value={cost} onChange={setCost} inputMode="decimal" />
                </Field>
            </div>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={register} busy={busy === 'register'} disabled={!valid}>Register asset</Btn>
        </ActionPanel>
    );
}
