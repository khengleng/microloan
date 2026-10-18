"use client";

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import api from '@/lib/api';
import { useLendingHref } from '../LendingShell';
import { ActionPanel, Btn, Card, Empty, ErrorBox, Field, KV, Notice, Spinner, Table, TextInput, td, tdR, th, thR } from '../ui';
import { clean, idem, useAction, useApi, useIdempotencyKey } from '../useAsync';
import { fmtRate, isPositive } from '../format';
import { MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import type { LoanDetail } from '../types';
import { MurabahaCard } from './MurabahaCard';
import { IncomeContingentCard } from './IncomeContingentCard';
import { InstitutionalLoanCard } from '../institutional/CounterpartyViews';

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

/** Card, BNPL, lease, documentary-trade, Murabaha, income-contingent or institutional behaviour of a loan. */
export function PurchaseLinkedCard({ loanId, detail, onDone }: Props) {
    const href = useLendingHref();
    const t = useTranslations('LendingServicing.purchaseLinked');
    const s = detail.specialised;
    if (!s) return null;
    if (s.kind === 'CARD')
        return (
            <Notice title={t('card.title')}>
                {t('card.body')}{' '}
                {s.cardId && <Link href={href(`/lending/cards/${s.cardId}`)} className="font-semibold text-[#635BFF] hover:underline">{t('card.open')}</Link>}
            </Notice>
        );
    if (s.kind === 'TRADE')
        return (
            <Notice title={s.direction === 'IMPORT' ? t('trade.importTitle') : t('trade.exportTitle')}>
                {t('trade.body')}{' '}
                <Link href={href(`/lending/trade/transactions/${loanId}`)} className="font-semibold text-[#635BFF] hover:underline">{t('trade.open')}</Link>
            </Notice>
        );
    if (s.kind === 'BNPL') return <BnplCard loanId={loanId} detail={detail} onDone={onDone} />;
    if (s.kind === 'PROJECT_FINANCE') return null;
    if (s.kind === 'MURABAHA') return <MurabahaCard loanId={loanId} detail={detail} onDone={onDone} />;
    if (s.kind === 'INCOME_CONTINGENT') return detail.account.status === 'BOOKED' ? null : <IncomeContingentCard loanId={loanId} detail={detail} onDone={onDone} />;
    if (s.kind === 'INSTITUTIONAL') return <InstitutionalLoanCard detail={detail} />;
    return <LeaseCard loanId={loanId} detail={detail} onDone={onDone} />;
}

function BnplCard({ loanId, detail, onDone }: Props) {
    const t = useTranslations('LendingServicing.purchaseLinked');
    const cur = detail.account.currency;
    const booked = detail.account.status === 'BOOKED';
    const res = useApi<BnplPlanView>(booked ? null : `/lending/loans/${loanId}/bnpl`);
    const [refunding, setRefunding] = useState(false);
    const done = (msg: string) => { setRefunding(false); res.reload(); onDone(msg); };
    if (booked)
        return (
            <Card title={t('bnpl.title')}>
                <p className="text-[13px] text-[#3C4257]">{t.rich('bnpl.bookedBody', { b: (c) => <b>{c}</b> })}</p>
            </Card>
        );
    const p = res.data;
    return (
        <Card title={t('bnpl.title')} subtitle={t('bnpl.subtitle')}>
            {res.error && <ErrorBox error={res.error} />}
            {!p ? <Spinner /> : (
                <div className="space-y-4">
                    <KV
                        cols={4}
                        items={[
                            [t('bnpl.merchant'), `${p.merchantName}${p.merchantReference ? ` · ${p.merchantReference}` : ''}`],
                            [t('bnpl.purchaseFinanced'), <MoneyCell key="g" value={p.purchaseAmount} currency={cur} />],
                            [t('bnpl.merchantDiscount'), <span key="d"><MoneyCell value={p.merchantDiscount} currency={cur} /> ({fmtRate(p.merchantDiscountRate)})</span>],
                            [t('bnpl.paidToMerchant'), <MoneyCell key="n" value={p.merchantNet} currency={cur} />],
                            [t('bnpl.refundedSoFar'), <MoneyCell key="r" value={p.refundedAmount} currency={cur} />],
                            [t('bnpl.stillRefundable'), <MoneyCell key="l" value={p.refundable} currency={cur} />],
                        ]}
                    />
                    {isPositive(p.refundable) && !refunding && <Btn onClick={() => setRefunding(true)}>{t('bnpl.recordRefund')}</Btn>}
                    {refunding && <RefundPanel loanId={loanId} currency={cur} refundable={p.refundable} onDone={done} onClose={() => setRefunding(false)} />}
                    {p.refunds.length === 0 ? <Empty>{t('bnpl.noRefunds')}</Empty> : (
                        <Table>
                            <thead>
                                <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                    <th className={th}>{t('bnpl.columns.reference')}</th><th className={thR}>{t('bnpl.columns.refund')}</th><th className={thR}>{t('bnpl.columns.offInstalments')}</th>
                                    <th className={thR}>{t('bnpl.columns.toCustomer')}</th><th className={thR}>{t('bnpl.columns.discountReversed')}</th><th className={thR}>{t('bnpl.columns.merchantOwes')}</th><th className={th}>{t('bnpl.columns.clawback')}</th>
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
    const t = useTranslations('LendingServicing.purchaseLinked');
    const [amount, setAmount] = useState('');
    const [merchantReference, setMerchantReference] = useState('');
    const [reason, setReason] = useState('');
    const [externalReference, setExternalReference] = useState('');
    const [problem, setProblem] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const post = async () => {
        const a = amount.trim();
        if (!MONEY_RE.test(a) || !/[1-9]/.test(a)) { setProblem(t('refund.positiveAmount')); return; }
        setProblem('');
        const body = clean({ amount: a, merchantReference: merchantReference.trim(), reason: reason.trim(), externalReference: externalReference.trim() });
        const k = key.keyFor(body);
        const res = await run('refund', () => api.post(`/lending/loans/${loanId}/bnpl/refunds`, body, idem(k)));
        if (res) { key.reset(); onDone(t('refund.recorded', { currency, amount: a })); }
    };
    return (
        <ActionPanel title={t('refund.title')} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={t('refund.amount', { currency })} hint={t('refund.amountHint', { currency, amount: refundable })} error={problem || undefined}><TextInput value={amount} onChange={setAmount} inputMode="decimal" /></Field>
                <Field label={t('refund.merchantReference')}><TextInput value={merchantReference} onChange={setMerchantReference} maxLength={120} /></Field>
                <Field label={t('refund.reason')}><TextInput value={reason} onChange={setReason} maxLength={500} /></Field>
                <Field label={t('refund.customerPayoutReference')} hint={t('refund.customerPayoutHint')}><TextInput value={externalReference} onChange={setExternalReference} maxLength={120} /></Field>
            </div>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={post} busy={busy === 'refund'}>{t('refund.submit')}</Btn>
        </ActionPanel>
    );
}

function CollectButton({ loanId, refundId, onDone }: { loanId: string; refundId: string; onDone: (m: string) => void }) {
    const t = useTranslations('LendingServicing.purchaseLinked');
    const [ref, setRef] = useState('');
    const { busy, error, run } = useAction();
    const key = useIdempotencyKey();
    const collect = async () => {
        const body = { externalReference: ref.trim() };
        const k = key.keyFor(body);
        const res = await run('collect', () => api.post(`/lending/loans/${loanId}/bnpl/refunds/${refundId}/collect`, body, idem(k)));
        if (res) { key.reset(); onDone(t('collect.collected')); }
    };
    return (
        <div className="flex items-center gap-1.5">
            <TextInput value={ref} onChange={setRef} placeholder={t('collect.placeholder')} className="w-32" />
            <Btn size="sm" onClick={collect} busy={busy === 'collect'} disabled={ref.trim().length < 2} reason={error?.message}>{t('collect.button')}</Btn>
        </div>
    );
}

function LeaseCard({ loanId, detail, onDone }: Props) {
    const cur = detail.account.currency;
    const t = useTranslations('LendingServicing.purchaseLinked');
    const status = detail.account.status;
    const res = useApi<LeaseView>(`/lending/loans/${loanId}/lease`);
    const [panel, setPanel] = useState<'register' | 'return' | null>(null);
    const { busy, error, run, clearError } = useAction();
    const done = (msg: string) => { setPanel(null); res.reload(); onDone(msg); };
    const v = res.data;
    const a = v?.asset;
    const transfer = async () => {
        const r = await run('title', () => api.post(`/lending/loans/${loanId}/lease/transfer-title`, {}));
        if (r) done(t('lease.titleTransferred'));
    };
    return (
        <Card title={v?.structure === 'IJARAH' ? t('lease.ijarahTitle') : t('lease.title')} subtitle={t('lease.subtitle')}>
            {res.error && <ErrorBox error={res.error} />}
            {!v ? <Spinner /> : (
                <div className="space-y-3">
                    {!a ? (
                        status === 'BOOKED'
                            ? (panel === 'register' ? <RegisterAssetPanel loanId={loanId} currency={cur} types={v.lease.assetTypes} onDone={done} onClose={() => setPanel(null)} /> : <Btn variant="primary" onClick={() => setPanel('register')}>{t('lease.register')}</Btn>)
                            : <Empty>{t('lease.noAsset')}</Empty>
                    ) : (
                        <KV
                            cols={4}
                            items={[
                                [t('lease.asset'), `${a.description}${a.serialNumber ? ` · ${a.serialNumber}` : ''}`],
                                [t('lease.type'), a.assetType],
                                [t('lease.supplier'), a.supplierName],
                                [t('lease.cost'), <MoneyCell key="c" value={a.cost} currency={cur} />],
                                [t('lease.residual'), <MoneyCell key="r" value={a.residualValue} currency={cur} />],
                                [t('lease.ownership'), <StatusBadge key="o" status={a.ownership} />],
                                [t('lease.leaseEnd'), a.endOption ? (a.endOption === 'PURCHASE' ? t('lease.boughtOn', { date: a.endDate ?? '—' }) : t('lease.returnedOn', { date: a.endDate ?? '—' })) : '—'],
                                [t('lease.returnCondition'), a.returnCondition || '—'],
                            ]}
                        />
                    )}
                    {a && a.ownership === 'LESSOR' && status === 'BOOKED' && <p className="text-[12px] text-[#697386]">{t('lease.paySupplier')}</p>}
                    {a && a.ownership === 'LESSOR' && status === 'ACTIVE' && v.lease.allowReturn && (
                        <div className="space-y-2">
                            {v.returnCheck && !v.returnCheck.ok && <p className="text-[12px] text-[#697386]">{t('lease.returnPossible', { issues: v.returnCheck.issues.join(' ') })}</p>}
                            {panel === 'return'
                                ? <ReturnPanel loanId={loanId} residual={a.residualValue} currency={cur} onDone={done} onClose={() => setPanel(null)} />
                                : <Btn onClick={() => setPanel('return')} disabled={!v.returnCheck?.ok}>{t('lease.returnAsset')}</Btn>}
                        </div>
                    )}
                    {a && a.ownership === 'LESSOR' && status === 'CLOSED' && (
                        <div className="space-y-2">
                            <p className="text-[12px] text-[#697386]">{t('lease.optionReady')}</p>
                            <ErrorBox error={error} onDismiss={clearError} />
                            <Btn variant="primary" onClick={transfer} busy={busy === 'title'}>{t('lease.transferTitle')}</Btn>
                        </div>
                    )}
                </div>
            )}
        </Card>
    );
}

function RegisterAssetPanel({ loanId, currency, types, onDone, onClose }: { loanId: string; currency: string; types: string[]; onDone: (m: string) => void; onClose: () => void }) {
    const t = useTranslations('LendingServicing.purchaseLinked');
    const [assetType, setAssetType] = useState(types[0] ?? '');
    const [description, setDescription] = useState('');
    const [serialNumber, setSerialNumber] = useState('');
    const [supplierName, setSupplierName] = useState('');
    const [cost, setCost] = useState('');
    const { busy, error, run, clearError } = useAction();
    const register = async () => {
        const body = clean({ assetType, description: description.trim(), serialNumber: serialNumber.trim(), supplierName: supplierName.trim(), cost: cost.trim() });
        const res = await run('register', () => api.post(`/lending/loans/${loanId}/lease`, body));
        if (res) onDone(t('register.registered'));
    };
    return (
        <ActionPanel title={t('register.title')} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={t('register.assetType')} hint={types.join(', ')}><TextInput value={assetType} onChange={setAssetType} /></Field>
                <Field label={t('register.description')}><TextInput value={description} onChange={setDescription} maxLength={200} /></Field>
                <Field label={t('register.serial')} hint={t('register.optional')}><TextInput value={serialNumber} onChange={setSerialNumber} maxLength={80} /></Field>
                <Field label={t('register.supplier')}><TextInput value={supplierName} onChange={setSupplierName} maxLength={120} /></Field>
                <Field label={t('register.cost', { currency })}><TextInput value={cost} onChange={setCost} inputMode="decimal" /></Field>
            </div>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={register} busy={busy === 'register'}>{t('register.submit')}</Btn>
        </ActionPanel>
    );
}

function ReturnPanel({ loanId, residual, currency, onDone, onClose }: { loanId: string; residual: string; currency: string; onDone: (m: string) => void; onClose: () => void }) {
    const t = useTranslations('LendingServicing.purchaseLinked');
    const [condition, setCondition] = useState('');
    const [externalReference, setExternalReference] = useState('');
    const { busy, error, run, clearError } = useAction();
    const key = useIdempotencyKey();
    const post = async () => {
        const body = { condition: condition.trim(), externalReference: externalReference.trim() };
        const k = key.keyFor(body);
        const res = await run('return', () => api.post(`/lending/loans/${loanId}/lease/return`, body, idem(k)));
        if (res) { key.reset(); onDone(t('returnPanel.returned')); }
    };
    return (
        <ActionPanel title={t('returnPanel.title', { currency, residual })} onClose={onClose}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={t('returnPanel.condition')}><TextInput value={condition} onChange={setCondition} maxLength={500} /></Field>
                <Field label={t('returnPanel.reference')}><TextInput value={externalReference} onChange={setExternalReference} maxLength={120} /></Field>
            </div>
            <ErrorBox error={error} onDismiss={clearError} />
            <Btn variant="primary" onClick={post} busy={busy === 'return'} disabled={condition.trim().length < 2 || externalReference.trim().length < 2}>{t('returnPanel.submit')}</Btn>
        </ActionPanel>
    );
}
