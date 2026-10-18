"use client";

import { useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { useTranslations } from 'next-intl';
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
    const t = useTranslations('LendingTrade.home');
    const [tab, setTab] = useState<Tab>('lc');
    return (
        <LendingShell title={t('title')} subtitle={t('subtitle')}>
            <Tabs<Tab>
                tabs={[
                    { value: 'lc', label: t('tabLc') },
                    { value: 'receivables', label: t('tabReceivables') },
                    { value: 'loans', label: t('tabLoans') },
                ]}
                value={tab}
                onChange={setTab}
            />
            {tab === 'lc' ? <LettersOfCredit /> : tab === 'receivables' ? <ReceivablesProgrammes /> : <TradeLoans />}
        </LendingShell>
    );
}

function LettersOfCredit() {
    const t = useTranslations('LendingTrade.home');
    const ts = useTranslations('Status');
    const href = useLendingHref();
    const [status, setStatus] = useState('');
    const [showNew, setShowNew] = useState(false);
    const list = useApi<Paged<LetterOfCredit>>(`/lending/letters-of-credit${qs({ status })}`);
    return (
        <>
            {showNew && <NewLetterOfCredit onDone={() => { setShowNew(false); list.reload(); }} onClose={() => setShowNew(false)} />}
            <Card
                title={t('lcTitle')}
                subtitle={t('lcSubtitle')}
                bodyClass="p-0"
                actions={
                    <>
                        <SelectInput value={status} onChange={setStatus} options={LC_STATUSES.map((s) => ({ value: s, label: ts.has(s) ? ts(s) : s }))} placeholder={t('allStatuses')} className="w-44" />
                        <Btn variant="primary" onClick={() => setShowNew(true)}>{t('newLc')}</Btn>
                    </>
                }
            >
                {list.error && <div className="p-4"><ErrorBox error={list.error} /></div>}
                {list.loading && !list.data ? <Spinner /> : (list.data?.data.length ?? 0) === 0 ? <Empty>{t('noLc')}</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>{t('colReference')}</th><th className={th}>{t('colBeneficiary')}</th><th className={th}>{t('colStatus')}</th>
                                <th className={thR}>{t('colAmount')}</th><th className={thR}>{t('colDrawn')}</th><th className={thR}>{t('colUndrawn')}</th><th className={thR}>{t('colFee')}</th><th className={th}>{t('colExpiry')}</th>
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
    const t = useTranslations('LendingTrade.newLc');
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
        <Card title={t('title')} subtitle={t('subtitle')} actions={<Btn variant="ghost" onClick={onClose}>{t('close')}</Btn>}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label={t('importer')}><BorrowerPicker value={f.borrowerId} onChange={(v) => setF({ ...f, borrowerId: v })} /></Field>
                <Field label={t('product')} hint={t('productHint')}>
                    <SelectInput value={f.productId} onChange={(v) => setF({ ...f, productId: v })} options={lcProducts.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` }))} placeholder={products.loading ? t('loading') : t('selectProduct')} />
                </Field>
                <Field label={t('amount')}><TextInput value={f.amount} onChange={(v) => setF({ ...f, amount: v })} inputMode="decimal" /></Field>
                <Field label={t('beneficiary')}><TextInput value={f.beneficiaryName} onChange={(v) => setF({ ...f, beneficiaryName: v })} maxLength={160} /></Field>
                <Field label={t('beneficiaryBank')} hint={t('optional')}><TextInput value={f.beneficiaryBank} onChange={(v) => setF({ ...f, beneficiaryBank: v })} maxLength={160} /></Field>
                <Field label={t('beneficiaryAccount')} hint={t('optional')}><TextInput value={f.beneficiaryAccount} onChange={(v) => setF({ ...f, beneficiaryAccount: v })} maxLength={60} /></Field>
                <Field label={t('expiryDate')}><TextInput type="date" value={f.expiryDate} onChange={(v) => setF({ ...f, expiryDate: v })} /></Field>
                <Field label={t('instalments')}><TextInput value={f.numberOfInstalments} onChange={(v) => setF({ ...f, numberOfInstalments: v })} inputMode="numeric" /></Field>
            </div>
            <div className="mt-3 flex items-center gap-3">
                <Btn variant="primary" onClick={submit} busy={busy === 'request'}>{t('request')}</Btn>
                <ErrorBox error={error} onDismiss={clearError} />
            </div>
        </Card>
    );
}

/** Receivables programmes: invoice finance, factoring, supply-chain finance and forfaiting. */
function ReceivablesProgrammes() {
    const t = useTranslations('LendingTrade.home');
    const tk = useTranslations('LendingTrade.kind');
    const href = useLendingHref();
    const [kind, setKind] = useState('');
    const list = useApi<Paged<ReceivablesProgramme>>('/lending/trade/receivables');
    const rows = (list.data?.data ?? []).filter((x) => !kind || x.kind === kind);
    return (
        <Card
            title={t('receivablesTitle')}
            subtitle={t('receivablesSubtitle')}
            bodyClass="p-0"
            actions={<SelectInput value={kind} onChange={setKind} options={Object.keys(KIND_COPY).map((value) => ({ value, label: tk(`${value}.name`) }))} placeholder={t('allKinds')} className="w-48" />}
        >
            <div className="p-4"><Notice>{t('programmeNote')}</Notice></div>
            {list.error && <div className="p-4"><ErrorBox error={list.error} /></div>}
            {list.loading && !list.data ? <Spinner /> : rows.length === 0 ? <Empty>{t('noProgrammes')}</Empty> : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>{t('colProgramme')}</th><th className={th}>{t('colKind')}</th><th className={th}>{t('colHolder')}</th><th className={th}>{t('colStatus')}</th>
                            <th className={thR}>{t('colLimit')}</th><th className={thR}>{t('colOutstanding')}</th><th className={thR}>{t('colOpen')}</th><th className={thR}>{t('colAwaiting')}</th><th className={thR}>{t('colInDefault')}</th><th className={th}></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {rows.map((x) => (
                            <tr key={x.id} className={x.inDefault ? 'bg-amber-50' : ''}>
                                <td className={td}>{x.reference}</td>
                                <td className={td}>{tk(`${x.kind}.name`)}</td>
                                <td className={td}>{x.borrowerName ?? '—'}</td>
                                <td className={td}><StatusBadge status={x.status} />{x.daysPastDue > 0 && <div className="text-[11px] text-amber-700">{t('daysPastDue', { days: x.daysPastDue })}</div>}</td>
                                <td className={tdR}><MoneyCell value={x.limitAmount} currency={x.currency} /></td>
                                <td className={tdR}><MoneyCell value={x.outstanding} currency={x.currency} /></td>
                                <td className={tdR}>{x.live}</td>
                                <td className={tdR}>{x.pending || '—'}</td>
                                <td className={tdR}>{x.inDefault || '—'}</td>
                                <td className={td}><Link className="text-[12px] font-semibold text-[#635BFF] hover:underline" href={href(`/lending/trade/invoices/${x.id}`)}>{tk(`${x.kind}.register`)} →</Link></td>
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
    const tr = useTranslations('LendingTrade.home');
    const href = useLendingHref();
    const list = useApi<TradeLoanList>('/lending/trade/transactions');
    const d = list.data;
    return (
        <>
            {list.error && <ErrorBox error={list.error} />}
            {d && d.awaitingTrade.length > 0 && (
                <Card title={tr('awaitingTitle')} subtitle={tr('awaitingSubtitle')} bodyClass="p-0">
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{tr('colLoan')}</th><th className={thR}>{tr('colAmount')}</th><th className={th}></th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {d.awaitingTrade.map((a) => (
                                <tr key={a.loanAccountId}>
                                    <td className={td}>{a.reference}</td>
                                    <td className={tdR}><MoneyCell value={a.bookedPrincipal} currency={a.currency} /></td>
                                    <td className={td}><Link className="text-[12px] font-semibold text-[#635BFF] hover:underline" href={href(`/lending/trade/transactions/${a.loanAccountId}`)}>{tr('recordTrade')}</Link></td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </Card>
            )}
            <Card title={tr('loansTitle')} subtitle={tr('loansSubtitle')} bodyClass="p-0">
                {list.loading && !d ? <Spinner /> : (d?.data.length ?? 0) === 0 ? <Empty>{tr('noTrades')}</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>{tr('colTrade')}</th><th className={th}>{tr('colDirection')}</th><th className={th}>{tr('colCounterparty')}</th><th className={thR}>{tr('colValue')}</th>
                                <th className={th}>{tr('colDocuments')}</th><th className={th}>{tr('colProceedsExpected')}</th><th className={th}>{tr('colStatus')}</th><th className={thR}>{tr('colLoanOutstanding')}</th><th className={th}></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {d!.data.map((t) => (
                                <tr key={t.id}>
                                    <td className={td}>{t.reference}<div className="text-[11px] text-[#697386]">{t.loan.reference}</div></td>
                                    <td className={td}>{t.direction === 'IMPORT' ? tr('import') : tr('export')}</td>
                                    <td className={td}>{t.counterpartyName}{t.counterpartyCountry ? ` (${t.counterpartyCountry})` : ''}</td>
                                    <td className={tdR}><MoneyCell value={t.transactionValue} currency={t.currency} /></td>
                                    <td className={td}>{tr('docsVerified', { verified: t.documentsVerified, total: t.documents })}</td>
                                    <td className={`${td} whitespace-nowrap`}>{t.expectedProceedsDate}</td>
                                    <td className={td}><StatusBadge status={t.status} /></td>
                                    <td className={tdR}><MoneyCell value={t.loan.principalOutstanding} currency={t.currency} /></td>
                                    <td className={td}><Link className="text-[12px] font-semibold text-[#635BFF] hover:underline" href={href(`/lending/trade/transactions/${t.loanAccountId}`)}>{tr('open')}</Link></td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Card>
        </>
    );
}
