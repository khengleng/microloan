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
import { KIND_COPY, LC_STATUSES, type LetterOfCredit, type ReceivablesProgramme, type TradeLoanList } from './types';

type Tab = 'lc' | 'receivables' | 'loans';

/**
 * Trade finance: letters of credit (LT-19, UC-53); receivables programmes —
 * invoice finance (LT-18, UC-67), factoring, supply-chain finance and
 * forfaiting; and import / export loans against trade documents.
 */
export function TradeHome() {
    const [tab, setTab] = useState<Tab>('lc');
    return (
        <LendingShell title="Trade finance" subtitle="Letters of credit, receivables programmes and import / export loans.">
            <Tabs<Tab>
                tabs={[
                    { value: 'lc', label: 'Letters of credit' },
                    { value: 'receivables', label: 'Receivables' },
                    { value: 'loans', label: 'Import & export loans' },
                ]}
                value={tab}
                onChange={setTab}
            />
            {tab === 'lc' ? <LettersOfCredit /> : tab === 'receivables' ? <ReceivablesProgrammes /> : <TradeLoans />}
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

/** Receivables programmes: invoice finance, factoring, supply-chain finance and forfaiting. */
function ReceivablesProgrammes() {
    const href = useLendingHref();
    const [kind, setKind] = useState('');
    const list = useApi<Paged<ReceivablesProgramme>>('/lending/trade/receivables');
    const rows = (list.data?.data ?? []).filter((x) => !kind || x.kind === kind);
    return (
        <Card
            title="Receivables programmes"
            subtitle="Each is a revolving limit drawn only by the receivables it finances or buys."
            bodyClass="p-0"
            actions={<SelectInput value={kind} onChange={setKind} options={Object.entries(KIND_COPY).map(([value, c]) => ({ value, label: c.name }))} placeholder="All kinds" className="w-48" />}
        >
            <div className="p-4"><Notice>A programme is booked like any facility: an application under an invoice-finance, factoring, supply-chain-finance or forfaiting product. For supply-chain finance the borrower is the anchor buyer.</Notice></div>
            {list.error && <div className="p-4"><ErrorBox error={list.error} /></div>}
            {list.loading && !list.data ? <Spinner /> : rows.length === 0 ? <Empty>No receivables programmes.</Empty> : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>Programme</th><th className={th}>Kind</th><th className={th}>Holder</th><th className={th}>Status</th>
                            <th className={thR}>Limit</th><th className={thR}>Outstanding</th><th className={thR}>Open</th><th className={thR}>Awaiting</th><th className={thR}>In default</th><th className={th}></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {rows.map((x) => (
                            <tr key={x.id} className={x.inDefault ? 'bg-amber-50' : ''}>
                                <td className={td}>{x.reference}</td>
                                <td className={td}>{KIND_COPY[x.kind].name}</td>
                                <td className={td}>{x.borrowerName ?? '—'}</td>
                                <td className={td}><StatusBadge status={x.status} />{x.daysPastDue > 0 && <div className="text-[11px] text-amber-700">{x.daysPastDue} days past due</div>}</td>
                                <td className={tdR}><MoneyCell value={x.limitAmount} currency={x.currency} /></td>
                                <td className={tdR}><MoneyCell value={x.outstanding} currency={x.currency} /></td>
                                <td className={tdR}>{x.live}</td>
                                <td className={tdR}>{x.pending || '—'}</td>
                                <td className={tdR}>{x.inDefault || '—'}</td>
                                <td className={td}><Link className="text-[12px] font-semibold text-[#635BFF] hover:underline" href={href(`/lending/trade/invoices/${x.id}`)}>{KIND_COPY[x.kind].register} →</Link></td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
        </Card>
    );
}

/** Import loans and export working capital: their trade, documents and proceeds. */
function TradeLoans() {
    const href = useLendingHref();
    const list = useApi<TradeLoanList>('/lending/trade/transactions');
    const d = list.data;
    return (
        <>
            {list.error && <ErrorBox error={list.error} />}
            {d && d.awaitingTrade.length > 0 && (
                <Card title="Booked, awaiting the trade" subtitle="Record the trade and its documents; the loan cannot be paid out before every required document is verified." bodyClass="p-0">
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Loan</th><th className={thR}>Amount</th><th className={th}></th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {d.awaitingTrade.map((a) => (
                                <tr key={a.loanAccountId}>
                                    <td className={td}>{a.reference}</td>
                                    <td className={tdR}><MoneyCell value={a.bookedPrincipal} currency={a.currency} /></td>
                                    <td className={td}><Link className="text-[12px] font-semibold text-[#635BFF] hover:underline" href={href(`/lending/trade/transactions/${a.loanAccountId}`)}>Record the trade →</Link></td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </Card>
            )}
            <Card title="Import & export loans" subtitle="Each finances one trade: paid out against verified documents, repaid from the proceeds." bodyClass="p-0">
                {list.loading && !d ? <Spinner /> : (d?.data.length ?? 0) === 0 ? <Empty>No trade transactions recorded.</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>Trade</th><th className={th}>Direction</th><th className={th}>Counterparty</th><th className={thR}>Value</th>
                                <th className={th}>Documents</th><th className={th}>Proceeds expected</th><th className={th}>Status</th><th className={thR}>Loan outstanding</th><th className={th}></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {d!.data.map((t) => (
                                <tr key={t.id}>
                                    <td className={td}>{t.reference}<div className="text-[11px] text-[#697386]">{t.loan.reference}</div></td>
                                    <td className={td}>{t.direction === 'IMPORT' ? 'Import' : 'Export'}</td>
                                    <td className={td}>{t.counterpartyName}{t.counterpartyCountry ? ` (${t.counterpartyCountry})` : ''}</td>
                                    <td className={tdR}><MoneyCell value={t.transactionValue} currency={t.currency} /></td>
                                    <td className={td}>{t.documentsVerified} of {t.documents} verified</td>
                                    <td className={`${td} whitespace-nowrap`}>{t.expectedProceedsDate}</td>
                                    <td className={td}><StatusBadge status={t.status} /></td>
                                    <td className={tdR}><MoneyCell value={t.loan.principalOutstanding} currency={t.currency} /></td>
                                    <td className={td}><Link className="text-[12px] font-semibold text-[#635BFF] hover:underline" href={href(`/lending/trade/transactions/${t.loanAccountId}`)}>Open →</Link></td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Card>
        </>
    );
}
