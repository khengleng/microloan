"use client";

import { useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { LendingShell, useLendingHref } from '../LendingShell';
import { ActionPanel, Btn, Card, Empty, ErrorBox, Field, KV, Notice, SelectInput, Spinner, Table, TextArea, TextInput, td, tdR, th, thR } from '../ui';
import { idem, useAction, useApi, useIdempotencyKey } from '../useAsync';
import { Money, MoneyCell, Rate } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import type { InvoiceDetail, InvoiceRegister, TradeInvoice } from './types';

type Panel =
    | { kind: 'reject'; invoice: TradeInvoice }
    | { kind: 'release'; invoice: TradeInvoice }
    | { kind: 'collect'; invoice: TradeInvoice }
    | { kind: 'detail'; invoice: TradeInvoice };

/**
 * An invoice-finance facility's register (LT-18): register invoices, approve
 * them as eligible, advance against them under maker-checker, post debtor or
 * recourse (UC-67) payments, and pay the borrower's balance out.
 */
export function InvoiceRegisterView({ facilityId }: { facilityId: string }) {
    const href = useLendingHref();
    const confirm = useConfirm();
    const reg = useApi<InvoiceRegister>(`/lending/facilities/${facilityId}/invoices`);
    const { busy, error, run, clearError } = useAction();
    const releaseKey = useIdempotencyKey();
    const collectKey = useIdempotencyKey();
    const [panel, setPanel] = useState<Panel | null>(null);
    const [msg, setMsg] = useState('');
    const [form, setForm] = useState({ debtorName: '', debtorReference: '', invoiceNumber: '', amount: '', issueDate: '', dueDate: '' });
    const [text, setText] = useState('');
    const [source, setSource] = useState<'DEBTOR' | 'BORROWER'>('DEBTOR');
    const [amount, setAmount] = useState('');

    const done = (m: string) => { setMsg(m); setPanel(null); setText(''); setAmount(''); reg.reload(); };
    const open = (p: Panel) => { setPanel(p); setText(''); setAmount(''); clearError(); setSource(p.invoice.status === 'RECOURSE' ? 'BORROWER' : 'DEBTOR'); };

    if (reg.loading && !reg.data) return <LendingShell title="Invoice register"><Spinner /></LendingShell>;
    if (reg.error && !reg.data)
        return <LendingShell title="Invoice register" back={{ href: '/lending/trade', label: 'Trade finance' }}><ErrorBox error={reg.error} /></LendingShell>;
    const data = reg.data!;
    const ccy = data.facility.currency;

    const register = async () => {
        const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== ''));
        const res = await run('register', () => api.post(`/lending/facilities/${facilityId}/invoices`, body));
        if (res) {
            setForm({ debtorName: '', debtorReference: '', invoiceNumber: '', amount: '', issueDate: '', dueDate: '' });
            done('Invoice registered — awaiting approval as eligible');
        }
    };
    const step = async (inv: TradeInvoice, path: string, label: string, question: string) => {
        if (!(await confirm({ title: label, message: question, confirmLabel: label }))) return;
        const res = await run(`${path}-${inv.id}`, () => api.post(`/lending/invoices/${inv.id}/${path}`));
        if (res) done(`${inv.invoiceNumber}: ${label.toLowerCase()} done`);
    };
    const submitPanel = async () => {
        if (!panel) return;
        const inv = panel.invoice;
        if (panel.kind === 'reject') {
            const res = await run('reject', () => api.post(`/lending/invoices/${inv.id}/reject`, { reason: text.trim() }));
            if (res) done(`${inv.invoiceNumber} rejected`);
        } else if (panel.kind === 'release') {
            const body = { externalReference: text.trim() };
            const res = await run('release', () => api.post(`/lending/invoices/${inv.id}/advance/release`, body, idem(releaseKey.keyFor({ id: inv.id, ...body }))));
            if (res) { releaseKey.reset(); done(`Advance of ${ccy} ${inv.advanceAmount} paid on ${inv.invoiceNumber}`); }
        } else if (panel.kind === 'collect') {
            const body = { source, amount: amount.trim(), ...(text.trim() ? { externalReference: text.trim() } : {}) };
            const res = await run('collect', () => api.post(`/lending/invoices/${inv.id}/collections`, body, idem(collectKey.keyFor({ id: inv.id, ...body }))));
            if (res) { collectKey.reset(); done(`Payment of ${ccy} ${body.amount} applied to ${inv.invoiceNumber}`); }
        }
    };

    return (
        <LendingShell
            title={`Invoice register · ${data.facility.reference}`}
            subtitle="Advances against approved invoices; the debtor's payment repays the advance and fee, and the balance goes to the borrower (TV-20)."
            back={{ href: '/lending/trade', label: 'Trade finance' }}
            actions={<Link href={href(`/lending/facilities/${facilityId}`)} className="text-[13px] font-semibold text-[#635BFF] hover:underline">Facility →</Link>}
        >
            {msg && <Notice tone="success">{msg}</Notice>}
            <Card title="Facility">
                <KV
                    cols={4}
                    items={[
                        ['Limit', <Money key="l" value={data.facility.limitAmount} currency={ccy} />],
                        ['Advanced, outstanding', <Money key="o" value={data.position.outstanding} currency={ccy} />],
                        ['Available', <Money key="a" value={data.position.available} currency={ccy} />],
                        ['Days past due', data.facility.daysPastDue],
                        ['Advance rate', <Rate key="r" value={data.terms?.advanceRate} />],
                        ['Fee', data.terms ? <span key="f"><Rate value={data.terms.feeRatePerPeriod} /> per {data.terms.feePeriodDays} days ({data.terms.feeBasis.replace('_', ' ').toLowerCase()})</span> : '—'],
                        ['Recourse grace', data.terms ? `${data.terms.recourseGraceDays} days after due` : '—'],
                        ['Owed to borrowers (reserve)', <Money key="res" value={data.summary.reserveOwedToBorrower} currency={ccy} />],
                    ]}
                />
                {data.summary.inRecourse > 0 && (
                    <div className="mt-3"><Notice tone="warn" title="Recourse">{data.summary.inRecourse} invoice(s) unpaid past due date + grace: the borrower owes the advance and fee, aged as arrears (UC-67).</Notice></div>
                )}
            </Card>

            <Card title="Register an invoice" subtitle="Maker: a different officer approves it as eligible.">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Field label="Debtor (the borrower's customer)"><TextInput value={form.debtorName} onChange={(v) => setForm({ ...form, debtorName: v })} maxLength={160} /></Field>
                    <Field label="Debtor reference" hint="Optional"><TextInput value={form.debtorReference} onChange={(v) => setForm({ ...form, debtorReference: v })} maxLength={80} /></Field>
                    <Field label="Invoice number"><TextInput value={form.invoiceNumber} onChange={(v) => setForm({ ...form, invoiceNumber: v })} maxLength={60} /></Field>
                    <Field label={`Amount (${ccy})`}><TextInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} inputMode="decimal" /></Field>
                    <Field label="Issue date"><TextInput type="date" value={form.issueDate} onChange={(v) => setForm({ ...form, issueDate: v })} /></Field>
                    <Field label="Due date"><TextInput type="date" value={form.dueDate} onChange={(v) => setForm({ ...form, dueDate: v })} /></Field>
                </div>
                <div className="mt-3 flex items-center gap-3">
                    <Btn variant="primary" onClick={register} busy={busy === 'register'}>Register invoice</Btn>
                    {!panel && <ErrorBox error={error} onDismiss={clearError} />}
                </div>
            </Card>

            {panel && panel.kind !== 'detail' && (
                <ActionPanel
                    title={{ reject: 'Reject invoice', release: 'Release the advance', collect: 'Record a payment' }[panel.kind] + ` · ${panel.invoice.invoiceNumber}`}
                    onClose={() => setPanel(null)}
                >
                    {panel.kind === 'reject' && <Field label="Reason"><TextArea value={text} onChange={setText} rows={2} maxLength={500} /></Field>}
                    {panel.kind === 'release' && (
                        <>
                            <p className="text-[12px]">Pays <Money value={panel.invoice.advanceAmount} currency={ccy} /> to the borrower as a disbursement on the facility.</p>
                            <Field label="External reference" hint="Bank transfer reference of the payout"><TextInput value={text} onChange={setText} maxLength={120} className="max-w-sm" /></Field>
                        </>
                    )}
                    {panel.kind === 'collect' && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <Field label="Paid by" hint={source === 'BORROWER' ? 'Recourse: may not exceed what is owed' : 'Any surplus is held for the borrower'}>
                                <SelectInput value={source} onChange={(v) => setSource(v as 'DEBTOR' | 'BORROWER')} options={[{ value: 'DEBTOR', label: 'Debtor' }, { value: 'BORROWER', label: 'Borrower (recourse)' }]} />
                            </Field>
                            <Field label={`Amount (${ccy})`}><TextInput value={amount} onChange={setAmount} inputMode="decimal" /></Field>
                            <Field label="External reference" hint="Optional"><TextInput value={text} onChange={setText} maxLength={120} /></Field>
                        </div>
                    )}
                    <ErrorBox error={error} onDismiss={clearError} />
                    <Btn variant={panel.kind === 'reject' ? 'danger' : 'primary'} onClick={submitPanel} busy={busy === panel.kind}>
                        {{ reject: 'Reject', release: 'Release funds', collect: 'Apply payment' }[panel.kind]}
                    </Btn>
                </ActionPanel>
            )}
            {panel?.kind === 'detail' && <InvoiceDetailPanel invoiceId={panel.invoice.id} currency={ccy} onClose={() => setPanel(null)} onDone={done} />}

            <Card title="Invoices" subtitle={`${data.summary.invoices} registered · fees outstanding ${data.summary.feesOutstanding}`} bodyClass="p-0">
                {data.invoices.length === 0 ? <Empty>No invoices registered yet.</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>Invoice</th>
                                <th className={th}>Debtor</th>
                                <th className={th}>Status</th>
                                <th className={thR}>Amount</th>
                                <th className={th}>Due</th>
                                <th className={thR}>Advance</th>
                                <th className={thR}>Advance owed</th>
                                <th className={thR}>Fee owed</th>
                                <th className={thR}>Reserve owed</th>
                                <th className={th}></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {data.invoices.map((inv) => (
                                <tr key={inv.id} className={inv.status === 'RECOURSE' ? 'bg-amber-50' : ''}>
                                    <td className={td}><button type="button" className="font-semibold text-[#635BFF] hover:underline" onClick={() => open({ kind: 'detail', invoice: inv })}>{inv.invoiceNumber}</button><div className="text-[11px] text-[#697386]">{inv.reference}</div></td>
                                    <td className={td}>{inv.debtorName}</td>
                                    <td className={td}><StatusBadge status={inv.status} />{inv.recourseDate && <div className="text-[11px] text-[#697386]">recourse after {inv.recourseDate}</div>}</td>
                                    <td className={tdR}><MoneyCell value={inv.amount} currency={ccy} /></td>
                                    <td className={`${td} whitespace-nowrap`}>{inv.dueDate}</td>
                                    <td className={tdR}><MoneyCell value={inv.advanceAmount} currency={ccy} muted /></td>
                                    <td className={tdR}><MoneyCell value={inv.advanceOutstanding} currency={ccy} highlightNonZero /></td>
                                    <td className={tdR}><MoneyCell value={inv.feeOwed} currency={ccy} highlightNonZero /></td>
                                    <td className={tdR}><MoneyCell value={inv.reserveOwed} currency={ccy} highlightNonZero /></td>
                                    <td className={`${td} whitespace-nowrap`}>
                                        <div className="flex flex-wrap justify-end gap-1.5">
                                            {inv.status === 'SUBMITTED' && <Btn size="sm" variant="primary" busy={busy === `approve-${inv.id}`} onClick={() => step(inv, 'approve', 'Approve invoice', `Approve ${inv.invoiceNumber} from ${inv.debtorName} as eligible for an advance?`)}>Approve</Btn>}
                                            {inv.status === 'APPROVED' && <Btn size="sm" variant="primary" busy={busy === `advance-${inv.id}`} onClick={() => step(inv, 'advance', 'Request advance', `Request an advance of ${inv.advanceRate} × ${inv.amount} ${ccy}?`)}>Request advance</Btn>}
                                            {inv.status === 'ADVANCE_REQUESTED' && <Btn size="sm" variant="primary" busy={busy === `advance/approve-${inv.id}`} onClick={() => step(inv, 'advance/approve', 'Approve advance', `Approve the advance of ${ccy} ${inv.advanceAmount}? The limit is re-checked now and at release.`)}>Approve advance</Btn>}
                                            {inv.status === 'ADVANCE_APPROVED' && <Btn size="sm" variant="primary" onClick={() => open({ kind: 'release', invoice: inv })}>Release…</Btn>}
                                            {['SUBMITTED', 'APPROVED', 'ADVANCE_REQUESTED'].includes(inv.status) && <Btn size="sm" variant="danger" onClick={() => open({ kind: 'reject', invoice: inv })}>Reject</Btn>}
                                            {['FUNDED', 'RECOURSE', 'SETTLED'].includes(inv.status) && <Btn size="sm" onClick={() => open({ kind: 'collect', invoice: inv })}>Payment…</Btn>}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </Card>
        </LendingShell>
    );
}

/** One invoice: what it owes today, its collections and the borrower's balance payout. */
function InvoiceDetailPanel({ invoiceId, currency, onClose, onDone }: { invoiceId: string; currency: string; onClose: () => void; onDone: (m: string) => void }) {
    const view = useApi<InvoiceDetail>(`/lending/invoices/${invoiceId}`);
    const { busy, error, run, clearError } = useAction();
    const payKey = useIdempotencyKey();
    const [ref, setRef] = useState('');
    if (!view.data) return <ActionPanel title="Invoice" onClose={onClose}>{view.error ? <ErrorBox error={view.error} /> : <Spinner />}</ActionPanel>;
    const { invoice: inv, quote, collections, reservePayouts } = view.data;
    const pending = reservePayouts.find((t) => t.status === 'PENDING');

    const propose = async () => {
        const res = await run('propose', () => api.post(`/lending/invoices/${invoiceId}/reserve-payouts`, ref.trim() ? { externalReference: ref.trim() } : {}));
        if (res) { view.reload(); setRef(''); }
    };
    const decide = async (approve: boolean) => {
        if (!pending) return;
        const body = { approve };
        const res = await run('decide', () => api.post(`/lending/invoices/${invoiceId}/reserve-payouts/${pending.id}/decision`, body, idem(payKey.keyFor({ id: pending.id, ...body }))));
        if (res) { payKey.reset(); onDone(approve ? `Paid ${currency} ${pending.amount} to the borrower` : 'Payout rejected'); }
    };

    return (
        <ActionPanel title={`Invoice ${inv.invoiceNumber} · ${inv.debtorName}`} onClose={onClose}>
            <KV
                cols={4}
                items={[
                    ['Status', <StatusBadge key="s" status={inv.status} />],
                    ['Advanced on', inv.advanceDate ?? '—'],
                    ['Fee to date', <Money key="f" value={quote.feeToDate} currency={currency} />],
                    ['Owed today', <Money key="o" value={quote.owed} currency={currency} />],
                    ['Recourse after', quote.recourseDate ?? '—'],
                    ['From debtor', <Money key="d" value={inv.collectedFromDebtor} currency={currency} />],
                    ['From borrower', <Money key="b" value={inv.collectedFromBorrower} currency={currency} />],
                    ['Reserve owed to borrower', <Money key="r" value={inv.reserveOwed} currency={currency} />],
                ]}
            />
            {quote.surplusIfDebtorPaysInFull && Number(quote.owed) > 0 && (
                <p className="text-[12px] text-[#697386]">If the debtor paid the rest of the invoice today, <Money value={quote.surplusIfDebtorPaysInFull} currency={currency} /> would go to the borrower.</p>
            )}
            {collections.length > 0 && (
                <Table>
                    <thead><tr><th className={th}>Date</th><th className={th}>Paid by</th><th className={thR}>Amount</th><th className={thR}>Fee</th><th className={thR}>Advance</th><th className={thR}>To borrower</th></tr></thead>
                    <tbody>
                        {collections.map((c) => (
                            <tr key={c.id}><td className={td}>{c.valueDate}</td><td className={td}>{c.source.toLowerCase()}</td><td className={tdR}>{c.amount}</td><td className={tdR}>{c.toFee}</td><td className={tdR}>{c.toAdvance}</td><td className={tdR}>{c.toReserve}</td></tr>
                        ))}
                    </tbody>
                </Table>
            )}
            {Number(inv.reserveOwed) > 0 && !pending && (
                <div className="flex flex-wrap items-end gap-2">
                    <Field label="Payout reference" hint="Optional"><TextInput value={ref} onChange={setRef} maxLength={120} className="w-56" /></Field>
                    <Btn variant="primary" onClick={propose} busy={busy === 'propose'}>Propose payout of {inv.reserveOwed}</Btn>
                </div>
            )}
            {pending && (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px]">Payout of <Money value={pending.amount} currency={currency} /> awaiting a checker.</span>
                    <Btn size="sm" variant="primary" onClick={() => decide(true)} busy={busy === 'decide'}>Approve and pay</Btn>
                    <Btn size="sm" variant="danger" onClick={() => decide(false)}>Reject</Btn>
                </div>
            )}
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}
