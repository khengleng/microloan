"use client";

import { useState } from 'react';
import { useTranslations } from 'next-intl';
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
    const t = useTranslations('LendingServicing.murabaha');
    const cur = detail.account.currency;
    const booked = detail.account.status === 'BOOKED';
    const res = useApi<MurabahaView>(`/lending/loans/${loanId}/murabaha`);
    const [registering, setRegistering] = useState(false);
    const v = res.data;
    const done = (msg: string) => { setRegistering(false); res.reload(); onDone(msg); };
    return (
        <Card title={t('title')} subtitle={t('subtitle')}>
            {res.error && <ErrorBox error={res.error} />}
            {!v ? <Spinner /> : (
                <div className="space-y-4">
                    {v.terms && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <Figure label={t('costOfAsset')} value={v.terms.cost} currency={cur} note={v.asset ? t('paidTo', { supplier: v.asset.supplierName }) : t('paidToSupplier')} />
                            <Figure label={t('profitFixed')} value={v.terms.profit} currency={cur} note={t('markUpNote', { rate: fmtRate(v.terms.markUp), financed: v.terms.financed })} />
                            <Figure label={t('salePrice')} value={v.terms.salePrice} currency={cur} note={t('instalmentsNote', { count: v.terms.instalments, hasDown: Number(v.terms.downPayment) > 0 ? 'yes' : 'no', downPayment: v.terms.downPayment })} strong />
                        </div>
                    )}
                    {v.terms && <p className="text-[12px] text-[#697386]">{v.terms.explanation}</p>}
                    {v.asset ? (
                        <KV
                            cols={4}
                            items={[
                                [t('kv.asset'), `${v.asset.description}${v.asset.serialNumber ? ` · ${v.asset.serialNumber}` : ''}`],
                                [t('kv.type'), v.asset.assetType],
                                [t('kv.supplier'), v.asset.supplierName],
                                [t('kv.contract'), <StatusBadge key="s" status={v.asset.status} />],
                                [t('kv.soldOn'), v.asset.soldOn ?? t('kv.soldOnPending')],
                                [t('kv.earlySettlement'), v.ibra.share === null ? t('kv.noRebate') : t('kv.ibraShare', { share: fmtRate(v.ibra.share) })],
                                [t('kv.profitRecognised'), <MoneyCell key="r" value={v.profitRecognised} currency={cur} />],
                                [t('kv.deferredProfitLedger'), <MoneyCell key="d" value={v.deferredProfit} currency={cur} />],
                            ]}
                        />
                    ) : booked ? (
                        registering
                            ? <RegisterPanel loanId={loanId} currency={cur} types={v.assetTypes} cost={v.terms?.cost ?? ''} onDone={done} onClose={() => setRegistering(false)} />
                            : (
                                <Notice tone="warn" title={t('registerNoticeTitle')}>
                                    {t('registerNoticeBody')}
                                    <div className="mt-2"><Btn variant="primary" onClick={() => setRegistering(true)}>{t('registerTheAsset')}</Btn></div>
                                </Notice>
                            )
                    ) : null}
                    <p className="text-[12px] text-[#697386]">{v.ibra.explanation}{Number(v.ibraGranted) > 0 && <> {t.rich('waivedOnSettlement', { currency: cur, amount: v.ibraGranted, b: (c) => <b>{c}</b> })}</>}</p>
                    {v.recognition.length > 0 && (
                        <Disclosure summary={t('recognitionSummary')}>
                            <p className="text-[12px] text-[#697386] mb-2">
                                {t('recognitionBody', { unearned: v.accounts.unearnedProfit, deferred: v.accounts.deferredProfit, income: v.accounts.profitIncome, lateCharges: v.accounts.lateChargesTo })}
                            </p>
                            <Table>
                                <thead>
                                    <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                        <th className={th}>#</th><th className={th}>{t('columns.due')}</th><th className={thR}>{t('columns.profit')}</th><th className={thR}>{t('columns.recognisedToDate')}</th><th className={thR}>{t('columns.stillDeferred')}</th>
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
    const t = useTranslations('LendingServicing.murabaha.register');
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
        if (r) onDone(t('toast'));
    };
    return (
        <ActionPanel title={t('title')} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={t('assetType')}><SelectInput value={assetType} onChange={setAssetType} options={types} /></Field>
                <Field label={t('description')}><TextInput value={description} onChange={setDescription} maxLength={200} /></Field>
                <Field label={t('serial')} hint={t('optional')}><TextInput value={serialNumber} onChange={setSerialNumber} maxLength={80} /></Field>
                <Field label={t('supplier')}><TextInput value={supplierName} onChange={setSupplierName} maxLength={120} /></Field>
                <Field label={t('cost', { currency })} hint={expected ? t('costHint', { currency, expected }) : undefined}>
                    <TextInput value={cost} onChange={setCost} inputMode="decimal" />
                </Field>
            </div>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={register} busy={busy === 'register'} disabled={!valid}>{t('submit')}</Btn>
        </ActionPanel>
    );
}
