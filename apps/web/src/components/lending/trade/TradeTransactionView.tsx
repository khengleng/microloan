"use client";

import { useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { useTranslations } from 'next-intl';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { LendingShell, useLendingHref } from '../LendingShell';
import { ActionPanel, Btn, Card, Empty, ErrorBox, Field, KV, Notice, SelectInput, Spinner, Table, TextArea, TextInput, td, tdR, th, thR } from '../ui';
import { clean, idem, useAction, useApi, useIdempotencyKey } from '../useAsync';
import { Money, MoneyCell, Rate } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import { TRADE_DOCUMENT_CODES, type TradeDocument, type TradeLoanView } from './types';

type Panel = { kind: 'receive'; code: string; label: string } | { kind: 'reject'; doc: TradeDocument };

/**
 * An import loan or export working-capital loan and the one trade it
 * finances: record the trade, receive (maker) and verify (checker) its
 * documents — the loan is paid out only once every required one is
 * verified — and post the proceeds that repay it.
 */
export function TradeTransactionView({ loanId }: { loanId: string }) {
    const tt = useTranslations('LendingTrade.loan');
    const tdoc = useTranslations('LendingTrade.doc');
    const href = useLendingHref();
    const confirm = useConfirm();
    const view = useApi<TradeLoanView>(`/lending/loans/${loanId}/trade`);
    const { busy, error, run, clearError } = useAction();
    const proceedsKey = useIdempotencyKey();
    const [msg, setMsg] = useState('');
    const [panel, setPanel] = useState<Panel | null>(null);
    const [text, setText] = useState('');
    const [extra, setExtra] = useState('');
    const [trade, setTrade] = useState({ counterpartyName: '', counterpartyCountry: '', goodsDescription: '', transactionValue: '', cycleStartDate: '', expectedProceedsDate: '' });
    const [proceeds, setProceeds] = useState({ amount: '', payerName: '', externalReference: '', remitReference: '' });

    const done = (m: string) => { setMsg(m); setPanel(null); setText(''); clearError(); view.reload(); };

    if (view.loading && !view.data) return <LendingShell title={tt('title')}><Spinner /></LendingShell>;
    if (view.error && !view.data)
        return <LendingShell title={tt('title')} back={{ href: '/lending/trade', label: 'Trade finance' }}><ErrorBox error={view.error} /></LendingShell>;
    const d = view.data!;
    const ccy = d.loan.currency;
    const t = d.transaction;
    const importing = d.terms.direction === 'IMPORT';
    const proceedsOver = d.loan.payoff && proceeds.amount && Number(proceeds.amount) > Number(d.loan.payoff);
    const canTakeProceeds = t?.status === 'FINANCED' && d.loan.status === 'ACTIVE';
    const editableDocs = !!t && !['SETTLED', 'CANCELLED'].includes(t.status) && ['BOOKED', 'ACTIVE'].includes(d.loan.status);

    const record = async () => {
        const res = await run('record', () => api.post(`/lending/loans/${loanId}/trade`, clean(trade)));
        if (res) done(tt('recorded'));
    };
    const verify = async (doc: TradeDocument) => {
        if (!(await confirm({ title: tt('verifyTitle'), message: tt('verifyMessage', { label: doc.label, reference: doc.reference ?? '—' }), confirmLabel: tt('verify') }))) return;
        const res = await run(`verify-${doc.id}`, () => api.post(`/lending/trade-documents/${doc.id}/verify`));
        if (res) done(tt('verified', { label: doc.label }));
    };
    const submitPanel = async () => {
        if (!panel || !t) return;
        if (panel.kind === 'receive') {
            const res = await run('receive', () => api.post(`/lending/trade-transactions/${t.id}/documents`, { code: panel.code, reference: text.trim() }));
            if (res) done(tt('received', { label: panel.label }));
        } else {
            const res = await run('reject', () => api.post(`/lending/trade-documents/${panel.doc.id}/reject`, { reason: text.trim() }));
            if (res) done(tt('rejected', { label: panel.doc.label }));
        }
    };
    const postProceeds = async () => {
        if (!t) return;
        const body = clean(proceeds);
        const res = await run('proceeds', () => api.post<{ settled: boolean; applied: string; remitted: string }>(`/lending/trade-transactions/${t.id}/proceeds`, body, idem(proceedsKey.keyFor({ id: t.id, ...body }))));
        if (res) {
            proceedsKey.reset();
            setProceeds({ amount: '', payerName: '', externalReference: '', remitReference: '' });
            const r = res as { settled?: boolean; applied?: string; remitted?: string };
            done(r.settled ? (Number(r.remitted ?? 0) > 0 ? tt('settledRemitted', { currency: ccy, amount: r.remitted ?? '' }) : tt('settled')) : tt('applied', { currency: ccy, amount: r.applied ?? body.amount ?? '' }));
        }
    };

    return (
        <LendingShell
            title={`${importing ? tt('importLoan') : tt('exportLoan')} · ${d.loan.reference}`}
            subtitle={tt('subtitle')}
            back={{ href: '/lending/trade', label: 'Trade finance' }}
            actions={<Link href={href(`/lending/loans/${loanId}`)} className="text-[13px] font-semibold text-[#635BFF] hover:underline">{tt('loanLink')}</Link>}
        >
            {msg && <Notice tone="success">{msg}</Notice>}
            <Card title={tt('loan')} actions={<StatusBadge status={d.loan.status} />}>
                <KV
                    cols={4}
                    items={[
                        [tt('amount'), <Money key="a" value={d.loan.bookedPrincipal} currency={ccy} />],
                        [tt('principalOutstanding'), <Money key="p" value={d.loan.principalOutstanding} currency={ccy} />],
                        [tt('matures'), d.loan.maturityDate ?? '—'],
                        [tt('payoffToday'), d.loan.payoff ? <Money key="po" value={d.loan.payoff} currency={ccy} /> : '—'],
                        [tt('financingRatio'), <span key="r">{tt.rich('financingRatioValue', { rate: () => <Rate value={d.terms.maxFinancingRatio} /> })}</span>],
                        [tt('tradeCycle'), tt('tradeCycleValue', { days: d.terms.maxTradeCycleDays })],
                        [tt('repaidBy'), tt('repaidByValue', { days: d.terms.proceedsGraceDays })],
                        [tt('businessDate'), d.businessDate],
                    ]}
                />
            </Card>

            {!t ? (
                d.loan.status === 'BOOKED' ? (
                    <Card title={tt('recordTitle')} subtitle={tt('recordSubtitle', { amount: d.loan.bookedPrincipal, currency: ccy })}>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <Field label={importing ? tt('supplierExporter') : tt('buyerImporter')}><TextInput value={trade.counterpartyName} onChange={(v) => setTrade({ ...trade, counterpartyName: v })} maxLength={160} /></Field>
                            <Field label={tt('country')} hint={tt('countryHint')}><TextInput value={trade.counterpartyCountry} onChange={(v) => setTrade({ ...trade, counterpartyCountry: v })} maxLength={2} /></Field>
                            <Field label={tt('transactionValue', { currency: ccy })}><TextInput value={trade.transactionValue} onChange={(v) => setTrade({ ...trade, transactionValue: v })} inputMode="decimal" /></Field>
                            <Field label={tt('goods')} className="md:col-span-3"><TextArea value={trade.goodsDescription} onChange={(v) => setTrade({ ...trade, goodsDescription: v })} rows={2} maxLength={500} /></Field>
                            <Field label={importing ? tt('shipmentDate') : tt('contractDate')}><TextInput type="date" value={trade.cycleStartDate} onChange={(v) => setTrade({ ...trade, cycleStartDate: v })} /></Field>
                            <Field label={importing ? tt('expectedSale') : tt('expectedExport')}><TextInput type="date" value={trade.expectedProceedsDate} onChange={(v) => setTrade({ ...trade, expectedProceedsDate: v })} /></Field>
                        </div>
                        <div className="mt-3 flex items-center gap-3">
                            <Btn variant="primary" onClick={record} busy={busy === 'record'}>{tt('recordTrade')}</Btn>
                            <ErrorBox error={error} onDismiss={clearError} />
                        </div>
                    </Card>
                ) : (
                    <Card title={tt('trade')}><Empty>{tt('noTrade')}</Empty></Card>
                )
            ) : (
                <>
                    <Card title={tt('tradeRef', { reference: t.reference })} actions={<StatusBadge status={t.status} />}>
                        <KV
                            cols={4}
                            items={[
                                [importing ? tt('supplier') : tt('buyer'), `${t.counterpartyName}${t.counterpartyCountry ? ` (${t.counterpartyCountry})` : ''}`],
                                [tt('goods'), t.goodsDescription],
                                [tt('value'), <Money key="v" value={t.transactionValue} currency={ccy} />],
                                [importing ? tt('shipped') : tt('contract'), t.cycleStartDate],
                                [tt('proceedsExpected'), t.expectedProceedsDate],
                                [tt('proceedsReceived'), <Money key="pr" value={t.proceedsReceived} currency={ccy} />],
                                [tt('appliedToLoan'), <Money key="pa" value={t.proceedsApplied} currency={ccy} />],
                                [tt('passedToCustomer'), <Money key="pm" value={t.proceedsRemitted} currency={ccy} />],
                            ]}
                        />
                        {d.checks && d.loan.status === 'BOOKED' && (
                            <div className="mt-3 space-y-2">
                                {d.checks.documents.complete && d.checks.cycle.ok ? (
                                    <Notice tone="success" title={tt('readyTitle')}>{tt('readyBody')}</Notice>
                                ) : (
                                    <Notice tone="warn" title={tt('notPayable')}>
                                        {[
                                            ...d.checks.documents.missing.map((c) => tt('notReceived', { label: d.terms.documentLabels[c] ?? c })),
                                            ...d.checks.documents.unverified.map((c) => tt('awaitingVerification', { label: d.terms.documentLabels[c] ?? c })),
                                            ...d.checks.cycle.issues.map((i) => i.message),
                                        ].join(' · ')}
                                    </Notice>
                                )}
                            </div>
                        )}
                    </Card>

                    <Card title={tt('documents')} subtitle={tt('documentsSubtitle')} bodyClass="p-0">
                        {d.documents.length === 0 ? <Empty>{tt('noDocuments')}</Empty> : (
                            <Table>
                                <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{tt('colDocument')}</th><th className={th}>{tt('colReference')}</th><th className={th}>{tt('colStatus')}</th><th className={th}></th></tr></thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {d.documents.map((doc) => (
                                        <tr key={doc.id}>
                                            <td className={td}>{doc.label}{!doc.required && <div className="text-[11px] text-[#697386]">{tt('onFile')}</div>}</td>
                                            <td className={td}>{doc.reference ?? '—'}</td>
                                            <td className={td}><StatusBadge status={doc.status} />{doc.rejectionReason && doc.status === 'REJECTED' && <div className="text-[11px] text-red-700">{doc.rejectionReason}</div>}</td>
                                            <td className={`${td} whitespace-nowrap`}>
                                                {editableDocs && (
                                                    <div className="flex justify-end gap-1.5">
                                                        {['PENDING', 'REJECTED'].includes(doc.status) && <Btn size="sm" onClick={() => { setPanel({ kind: 'receive', code: doc.code, label: doc.label }); setText(''); clearError(); }}>{tt('receiveEllipsis')}</Btn>}
                                                        {doc.status === 'RECEIVED' && <Btn size="sm" variant="primary" busy={busy === `verify-${doc.id}`} onClick={() => verify(doc)}>{tt('verify')}</Btn>}
                                                        {doc.status === 'RECEIVED' && <Btn size="sm" variant="danger" onClick={() => { setPanel({ kind: 'reject', doc }); setText(''); clearError(); }}>{tt('rejectEllipsis')}</Btn>}
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                        {editableDocs && (
                            <div className="p-4 flex flex-wrap items-end gap-2">
                                <Field label={tt('addDocument')}>
                                    <SelectInput value={extra} onChange={setExtra} options={TRADE_DOCUMENT_CODES.filter((c) => !d.documents.some((x) => x.code === c.value)).map((c) => ({ value: c.value, label: tdoc(c.value) }))} placeholder={tt('select')} className="w-72" />
                                </Field>
                                <Btn size="sm" disabled={!extra} onClick={() => { const c = TRADE_DOCUMENT_CODES.find((x) => x.value === extra)!; setPanel({ kind: 'receive', code: c.value, label: tdoc(c.value) }); setText(''); setExtra(''); clearError(); }}>{tt('receiveEllipsis')}</Btn>
                            </div>
                        )}
                    </Card>

                    {panel && (
                        <ActionPanel title={panel.kind === 'receive' ? tt('receiveTitle', { label: panel.label }) : tt('rejectTitle', { label: panel.doc.label })} onClose={() => setPanel(null)}>
                            {panel.kind === 'receive' ? (
                                <Field label={tt('documentNumber')}><TextInput value={text} onChange={setText} maxLength={120} className="max-w-sm" /></Field>
                            ) : (
                                <Field label={tt('whyRejected')}><TextArea value={text} onChange={setText} rows={2} maxLength={500} /></Field>
                            )}
                            <ErrorBox error={error} onDismiss={clearError} />
                            <Btn variant={panel.kind === 'reject' ? 'danger' : 'primary'} onClick={submitPanel} busy={busy === panel.kind}>{panel.kind === 'receive' ? tt('recordReceipt') : tt('reject')}</Btn>
                        </ActionPanel>
                    )}

                    {(canTakeProceeds || d.proceeds.length > 0) && (
                        <Card title={tt('proceeds')} subtitle={tt('proceedsSubtitle')} bodyClass="p-0">
                            {d.proceeds.length > 0 && (
                                <Table>
                                    <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{tt('colDate')}</th><th className={th}>{tt('colPayer')}</th><th className={thR}>{tt('colReceived')}</th><th className={thR}>{tt('colApplied')}</th><th className={thR}>{tt('colToCustomer')}</th><th className={th}>{tt('colReferences')}</th><th className={th}></th></tr></thead>
                                    <tbody className="divide-y divide-[#F0F2F5]">
                                        {d.proceeds.map((p) => (
                                            <tr key={p.id}>
                                                <td className={td}>{p.valueDate}</td>
                                                <td className={td}>{p.payerName}</td>
                                                <td className={tdR}><MoneyCell value={p.amount} currency={ccy} /></td>
                                                <td className={tdR}><MoneyCell value={p.applied} currency={ccy} /></td>
                                                <td className={tdR}><MoneyCell value={p.remitted} currency={ccy} highlightNonZero /></td>
                                                <td className={td}>{[p.externalReference, p.remitReference].filter(Boolean).join(' · ') || '—'}</td>
                                                <td className={td}>{p.settled && <StatusBadge status="SETTLED" />}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            )}
                            {canTakeProceeds && (
                                <div className="p-4 space-y-3">
                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                        <Field label={tt('amountCcy', { currency: ccy })} hint={d.loan.payoff ? tt('payoffHint', { amount: d.loan.payoff }) : undefined}><TextInput value={proceeds.amount} onChange={(v) => setProceeds({ ...proceeds, amount: v })} inputMode="decimal" /></Field>
                                        <Field label={tt('paidBy')}><TextInput value={proceeds.payerName} onChange={(v) => setProceeds({ ...proceeds, payerName: v })} maxLength={160} placeholder={importing ? tt('importersBuyer') : t.counterpartyName} /></Field>
                                        <Field label={tt('receiptReference')} hint={tt('optional')}><TextInput value={proceeds.externalReference} onChange={(v) => setProceeds({ ...proceeds, externalReference: v })} maxLength={120} /></Field>
                                        {proceedsOver && <Field label={tt('creditReference')} hint={tt('creditReferenceHint')}><TextInput value={proceeds.remitReference} onChange={(v) => setProceeds({ ...proceeds, remitReference: v })} maxLength={120} /></Field>}
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <Btn variant="primary" onClick={postProceeds} busy={busy === 'proceeds'}>{tt('applyProceeds')}</Btn>
                                        {!panel && <ErrorBox error={error} onDismiss={clearError} />}
                                    </div>
                                </div>
                            )}
                        </Card>
                    )}
                </>
            )}
        </LendingShell>
    );
}
