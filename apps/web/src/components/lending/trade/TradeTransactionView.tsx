"use client";

import { useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
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

    if (view.loading && !view.data) return <LendingShell title="Trade loan"><Spinner /></LendingShell>;
    if (view.error && !view.data)
        return <LendingShell title="Trade loan" back={{ href: '/lending/trade', label: 'Trade finance' }}><ErrorBox error={view.error} /></LendingShell>;
    const d = view.data!;
    const ccy = d.loan.currency;
    const t = d.transaction;
    const importing = d.terms.direction === 'IMPORT';
    const proceedsOver = d.loan.payoff && proceeds.amount && Number(proceeds.amount) > Number(d.loan.payoff);
    const canTakeProceeds = t?.status === 'FINANCED' && d.loan.status === 'ACTIVE';
    const editableDocs = !!t && !['SETTLED', 'CANCELLED'].includes(t.status) && ['BOOKED', 'ACTIVE'].includes(d.loan.status);

    const record = async () => {
        const res = await run('record', () => api.post(`/lending/loans/${loanId}/trade`, clean(trade)));
        if (res) done('Trade recorded — receive its documents, then a checker verifies them');
    };
    const verify = async (doc: TradeDocument) => {
        if (!(await confirm({ title: 'Verify document', message: `Verify ${doc.label} (${doc.reference})? You confirm it is complete and consistent with the trade.`, confirmLabel: 'Verify' }))) return;
        const res = await run(`verify-${doc.id}`, () => api.post(`/lending/trade-documents/${doc.id}/verify`));
        if (res) done(`${doc.label} verified`);
    };
    const submitPanel = async () => {
        if (!panel || !t) return;
        if (panel.kind === 'receive') {
            const res = await run('receive', () => api.post(`/lending/trade-transactions/${t.id}/documents`, { code: panel.code, reference: text.trim() }));
            if (res) done(`${panel.label} received — awaiting verification by another officer`);
        } else {
            const res = await run('reject', () => api.post(`/lending/trade-documents/${panel.doc.id}/reject`, { reason: text.trim() }));
            if (res) done(`${panel.doc.label} rejected — it can be presented again`);
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
            done(r.settled ? `Loan settled from the proceeds${Number(r.remitted ?? 0) > 0 ? `; ${ccy} ${r.remitted} passed to the customer` : ''}` : `${ccy} ${r.applied ?? body.amount} applied to the loan`);
        }
    };

    return (
        <LendingShell
            title={`${importing ? 'Import loan' : 'Export working capital'} · ${d.loan.reference}`}
            subtitle="One trade per loan: paid out against verified documents, repaid from the trade’s proceeds."
            back={{ href: '/lending/trade', label: 'Trade finance' }}
            actions={<Link href={href(`/lending/loans/${loanId}`)} className="text-[13px] font-semibold text-[#635BFF] hover:underline">Loan →</Link>}
        >
            {msg && <Notice tone="success">{msg}</Notice>}
            <Card title="Loan" actions={<StatusBadge status={d.loan.status} />}>
                <KV
                    cols={4}
                    items={[
                        ['Amount', <Money key="a" value={d.loan.bookedPrincipal} currency={ccy} />],
                        ['Principal outstanding', <Money key="p" value={d.loan.principalOutstanding} currency={ccy} />],
                        ['Matures', d.loan.maturityDate ?? '—'],
                        ['Payoff today', d.loan.payoff ? <Money key="po" value={d.loan.payoff} currency={ccy} /> : '—'],
                        ['Financing ratio', <span key="r">up to <Rate value={d.terms.maxFinancingRatio} /> of the trade</span>],
                        ['Trade cycle', `at most ${d.terms.maxTradeCycleDays} days`],
                        ['Repaid by', `the expected proceeds + ${d.terms.proceedsGraceDays} days`],
                        ['Business date', d.businessDate],
                    ]}
                />
            </Card>

            {!t ? (
                d.loan.status === 'BOOKED' ? (
                    <Card title="Record the trade" subtitle={`Maker. The loan (${d.loan.bookedPrincipal} ${ccy}) must fit the trade: within the financing ratio and maturing by the expected proceeds plus grace.`}>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <Field label={importing ? 'Supplier (exporter)' : 'Buyer (importer)'}><TextInput value={trade.counterpartyName} onChange={(v) => setTrade({ ...trade, counterpartyName: v })} maxLength={160} /></Field>
                            <Field label="Country" hint="Two-letter code, optional"><TextInput value={trade.counterpartyCountry} onChange={(v) => setTrade({ ...trade, counterpartyCountry: v })} maxLength={2} /></Field>
                            <Field label={`Transaction value (${ccy})`}><TextInput value={trade.transactionValue} onChange={(v) => setTrade({ ...trade, transactionValue: v })} inputMode="decimal" /></Field>
                            <Field label="Goods" className="md:col-span-3"><TextArea value={trade.goodsDescription} onChange={(v) => setTrade({ ...trade, goodsDescription: v })} rows={2} maxLength={500} /></Field>
                            <Field label={importing ? 'Shipment date' : 'Contract / order date'}><TextInput type="date" value={trade.cycleStartDate} onChange={(v) => setTrade({ ...trade, cycleStartDate: v })} /></Field>
                            <Field label={importing ? 'Expected sale proceeds' : 'Expected export proceeds'}><TextInput type="date" value={trade.expectedProceedsDate} onChange={(v) => setTrade({ ...trade, expectedProceedsDate: v })} /></Field>
                        </div>
                        <div className="mt-3 flex items-center gap-3">
                            <Btn variant="primary" onClick={record} busy={busy === 'record'}>Record trade</Btn>
                            <ErrorBox error={error} onDismiss={clearError} />
                        </div>
                    </Card>
                ) : (
                    <Card title="Trade"><Empty>No trade was recorded for this loan.</Empty></Card>
                )
            ) : (
                <>
                    <Card title={`Trade ${t.reference}`} actions={<StatusBadge status={t.status} />}>
                        <KV
                            cols={4}
                            items={[
                                [importing ? 'Supplier' : 'Buyer', `${t.counterpartyName}${t.counterpartyCountry ? ` (${t.counterpartyCountry})` : ''}`],
                                ['Goods', t.goodsDescription],
                                ['Value', <Money key="v" value={t.transactionValue} currency={ccy} />],
                                [importing ? 'Shipped' : 'Contract', t.cycleStartDate],
                                ['Proceeds expected', t.expectedProceedsDate],
                                ['Proceeds received', <Money key="pr" value={t.proceedsReceived} currency={ccy} />],
                                ['Applied to the loan', <Money key="pa" value={t.proceedsApplied} currency={ccy} />],
                                ['Passed to the customer', <Money key="pm" value={t.proceedsRemitted} currency={ccy} />],
                            ]}
                        />
                        {d.checks && d.loan.status === 'BOOKED' && (
                            <div className="mt-3 space-y-2">
                                {d.checks.documents.complete && d.checks.cycle.ok ? (
                                    <Notice tone="success" title="Ready to pay out">Every required document is verified and the loan fits the trade. Prepare the disbursement from the loan.</Notice>
                                ) : (
                                    <Notice tone="warn" title="Not yet payable">
                                        {[
                                            ...d.checks.documents.missing.map((c) => `${d.terms.documentLabels[c] ?? c}: not received`),
                                            ...d.checks.documents.unverified.map((c) => `${d.terms.documentLabels[c] ?? c}: awaiting verification`),
                                            ...d.checks.cycle.issues.map((i) => i.message),
                                        ].join(' · ')}
                                    </Notice>
                                )}
                            </div>
                        )}
                    </Card>

                    <Card title="Documents" subtitle="Received by one officer, verified by another. Required documents gate the payout." bodyClass="p-0">
                        {d.documents.length === 0 ? <Empty>No documents.</Empty> : (
                            <Table>
                                <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Document</th><th className={th}>Reference</th><th className={th}>Status</th><th className={th}></th></tr></thead>
                                <tbody className="divide-y divide-[#F0F2F5]">
                                    {d.documents.map((doc) => (
                                        <tr key={doc.id}>
                                            <td className={td}>{doc.label}{!doc.required && <div className="text-[11px] text-[#697386]">On file (not required)</div>}</td>
                                            <td className={td}>{doc.reference ?? '—'}</td>
                                            <td className={td}><StatusBadge status={doc.status} />{doc.rejectionReason && doc.status === 'REJECTED' && <div className="text-[11px] text-red-700">{doc.rejectionReason}</div>}</td>
                                            <td className={`${td} whitespace-nowrap`}>
                                                {editableDocs && (
                                                    <div className="flex justify-end gap-1.5">
                                                        {['PENDING', 'REJECTED'].includes(doc.status) && <Btn size="sm" onClick={() => { setPanel({ kind: 'receive', code: doc.code, label: doc.label }); setText(''); clearError(); }}>Receive…</Btn>}
                                                        {doc.status === 'RECEIVED' && <Btn size="sm" variant="primary" busy={busy === `verify-${doc.id}`} onClick={() => verify(doc)}>Verify</Btn>}
                                                        {doc.status === 'RECEIVED' && <Btn size="sm" variant="danger" onClick={() => { setPanel({ kind: 'reject', doc }); setText(''); clearError(); }}>Reject…</Btn>}
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
                                <Field label="Add another document">
                                    <SelectInput value={extra} onChange={setExtra} options={TRADE_DOCUMENT_CODES.filter((c) => !d.documents.some((x) => x.code === c.value))} placeholder="Select" className="w-72" />
                                </Field>
                                <Btn size="sm" disabled={!extra} onClick={() => { const c = TRADE_DOCUMENT_CODES.find((x) => x.value === extra)!; setPanel({ kind: 'receive', code: c.value, label: c.label }); setText(''); setExtra(''); clearError(); }}>Receive…</Btn>
                            </div>
                        )}
                    </Card>

                    {panel && (
                        <ActionPanel title={panel.kind === 'receive' ? `Receive · ${panel.label}` : `Reject · ${panel.doc.label}`} onClose={() => setPanel(null)}>
                            {panel.kind === 'receive' ? (
                                <Field label="Document number or reference"><TextInput value={text} onChange={setText} maxLength={120} className="max-w-sm" /></Field>
                            ) : (
                                <Field label="Why it is rejected"><TextArea value={text} onChange={setText} rows={2} maxLength={500} /></Field>
                            )}
                            <ErrorBox error={error} onDismiss={clearError} />
                            <Btn variant={panel.kind === 'reject' ? 'danger' : 'primary'} onClick={submitPanel} busy={busy === panel.kind}>{panel.kind === 'receive' ? 'Record receipt' : 'Reject'}</Btn>
                        </ActionPanel>
                    )}

                    {(canTakeProceeds || d.proceeds.length > 0) && (
                        <Card title="Proceeds" subtitle="The trade’s proceeds repay the loan: at or above the payoff they settle it, and the rest goes to the customer." bodyClass="p-0">
                            {d.proceeds.length > 0 && (
                                <Table>
                                    <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Date</th><th className={th}>Payer</th><th className={thR}>Received</th><th className={thR}>Applied</th><th className={thR}>To customer</th><th className={th}>References</th><th className={th}></th></tr></thead>
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
                                        <Field label={`Amount (${ccy})`} hint={d.loan.payoff ? `Payoff today ${d.loan.payoff}` : undefined}><TextInput value={proceeds.amount} onChange={(v) => setProceeds({ ...proceeds, amount: v })} inputMode="decimal" /></Field>
                                        <Field label="Paid by"><TextInput value={proceeds.payerName} onChange={(v) => setProceeds({ ...proceeds, payerName: v })} maxLength={160} placeholder={importing ? 'The importer’s buyer' : t.counterpartyName} /></Field>
                                        <Field label="Receipt reference" hint="Optional"><TextInput value={proceeds.externalReference} onChange={(v) => setProceeds({ ...proceeds, externalReference: v })} maxLength={120} /></Field>
                                        {proceedsOver && <Field label="Credit to customer — reference" hint="Required: where the rest was credited"><TextInput value={proceeds.remitReference} onChange={(v) => setProceeds({ ...proceeds, remitReference: v })} maxLength={120} /></Field>}
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <Btn variant="primary" onClick={postProceeds} busy={busy === 'proceeds'}>Apply proceeds</Btn>
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
