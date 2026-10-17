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
import { ACK_COPY, KIND_COPY, type InvoiceDetail, type InvoiceQuote, type InvoiceRegister, type ReceivablesKind, type TradeInvoice } from './types';

type Panel =
    | { kind: 'reject'; invoice: TradeInvoice }
    | { kind: 'acknowledge'; invoice: TradeInvoice }
    | { kind: 'release'; invoice: TradeInvoice }
    | { kind: 'collect'; invoice: TradeInvoice }
    | { kind: 'writeOff'; invoice: TradeInvoice }
    | { kind: 'detail'; invoice: TradeInvoice };

const OPEN = ['SUBMITTED', 'APPROVED', 'ADVANCE_REQUESTED', 'ADVANCE_APPROVED', 'FUNDED', 'RECOURSE', 'DEFAULTED'];
const EMPTY_FORM = { debtorName: '', debtorReference: '', invoiceNumber: '', amount: '', issueDate: '', dueDate: '', supplierId: '', instrumentType: '', guarantorName: '' };

/**
 * A receivables programme's register: invoice finance (LT-18), factoring,
 * supply-chain finance and forfaiting. Register receivables, record what
 * must precede a purchase (notice to the debtor, the buyer's approval, the
 * aval), approve them as eligible, fund them under maker-checker, post the
 * obligor's or the holder's payments, write off what the lender bears, pay
 * out what is owed to the borrower, and close the programme.
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
    const [form, setForm] = useState(EMPTY_FORM);
    const [text, setText] = useState('');
    const [method, setMethod] = useState('');
    const [guarantor, setGuarantor] = useState('');
    const [source, setSource] = useState<'DEBTOR' | 'BORROWER'>('DEBTOR');
    const [amount, setAmount] = useState('');

    const done = (m: string) => { setMsg(m); setPanel(null); setText(''); setAmount(''); setGuarantor(''); reg.reload(); };
    const open = (p: Panel) => {
        setPanel(p); setText(''); setAmount(''); setGuarantor(p.invoice.receivable?.guarantorName ?? ''); clearError();
        setSource(p.invoice.status === 'RECOURSE' && p.invoice.kind !== 'SUPPLY_CHAIN' ? 'BORROWER' : 'DEBTOR');
        setMethod(p.invoice.receivable ? ACK_COPY[p.invoice.receivable.acknowledgementType].methods[0].value : '');
    };

    if (reg.loading && !reg.data) return <LendingShell title="Receivables register"><Spinner /></LendingShell>;
    if (reg.error && !reg.data)
        return <LendingShell title="Receivables register" back={{ href: '/lending/trade', label: 'Trade finance' }}><ErrorBox error={reg.error} /></LendingShell>;
    const data = reg.data!;
    const ccy = data.facility.currency;
    const kind: ReceivablesKind = data.kind ?? 'INVOICE_FINANCE';
    const copy = KIND_COPY[kind];
    const terms = data.terms;
    const discounted = !!terms?.discount;
    const activeSuppliers = data.suppliers.filter((s) => s.status === 'ACTIVE');
    const canClose = data.facility.status !== 'CLOSED' && data.invoices.every((i) => !OPEN.includes(i.status)) && Number(data.summary.reserveOwedToBorrower) === 0;

    const register = async () => {
        const body = clean({ ...form, debtorName: kind === 'SUPPLY_CHAIN' ? '' : form.debtorName.trim() });
        const res = await run('register', () => api.post(`/lending/facilities/${facilityId}/invoices`, body));
        if (res) {
            setForm(EMPTY_FORM);
            done(`${copy.item} registered — ${terms?.acknowledgement?.required ? `${ACK_COPY[terms.acknowledgement.type].action.toLowerCase()}, then ` : ''}awaiting approval as eligible`);
        }
    };
    const step = async (inv: TradeInvoice, path: string, label: string, question: string) => {
        if (!(await confirm({ title: label, message: question, confirmLabel: label }))) return;
        const res = await run(`${path}-${inv.id}`, () => api.post(`/lending/invoices/${inv.id}/${path}`));
        if (res) done(`${inv.invoiceNumber}: ${label.toLowerCase()} done`);
    };
    const closeProgramme = async () => {
        if (!(await confirm({ title: 'Close programme', message: `Close ${data.facility.reference}? Nothing is open on it; the facility and its account close.`, confirmLabel: 'Close programme' }))) return;
        const res = await run('close', () => api.post(`/lending/facilities/${facilityId}/receivables/close`));
        if (res) done(`${data.facility.reference} closed`);
    };
    const submitPanel = async () => {
        if (!panel) return;
        const inv = panel.invoice;
        if (panel.kind === 'reject') {
            const res = await run('reject', () => api.post(`/lending/invoices/${inv.id}/reject`, { reason: text.trim() }));
            if (res) done(`${inv.invoiceNumber} rejected`);
        } else if (panel.kind === 'acknowledge') {
            const body = clean({ method, reference: text.trim(), guarantorName: inv.receivable?.acknowledgementType === 'AVAL' ? guarantor.trim() : '' });
            const res = await run('acknowledge', () => api.post(`/lending/invoices/${inv.id}/acknowledge`, body));
            if (res) done(`${inv.invoiceNumber}: ${ACK_COPY[inv.receivable!.acknowledgementType].done.toLowerCase()}`);
        } else if (panel.kind === 'release') {
            const body = { externalReference: text.trim() };
            const res = await run('release', () => api.post<{ paidOut: string }>(`/lending/invoices/${inv.id}/advance/release`, body, idem(releaseKey.keyFor({ id: inv.id, ...body }))));
            if (res) { releaseKey.reset(); done(`${copy.funding} of ${inv.invoiceNumber} paid`); }
        } else if (panel.kind === 'collect') {
            const body = { source, amount: amount.trim(), ...(text.trim() ? { externalReference: text.trim() } : {}) };
            const res = await run('collect', () => api.post(`/lending/invoices/${inv.id}/collections`, body, idem(collectKey.keyFor({ id: inv.id, ...body }))));
            if (res) { collectKey.reset(); done(`Payment of ${ccy} ${body.amount} applied to ${inv.invoiceNumber}`); }
        } else if (panel.kind === 'writeOff') {
            const res = await run('writeOff', () => api.post(`/lending/invoices/${inv.id}/write-offs`, { reason: text.trim() }));
            if (res) done(`Write-off of ${inv.invoiceNumber} proposed — a write-off checker decides`);
        }
    };

    const sourceOptions = [
        { value: 'DEBTOR', label: kind === 'SUPPLY_CHAIN' ? 'Buyer (at maturity)' : copy.counterparty },
        ...(kind !== 'SUPPLY_CHAIN' && terms?.recourse !== 'NONE' ? [{ value: 'BORROWER', label: `${copy.holder} (recourse)` }] : []),
    ];

    return (
        <LendingShell
            title={`${copy.register} · ${data.facility.reference}`}
            subtitle={{
                INVOICE_FINANCE: 'Advances against approved invoices; the debtor’s payment repays the advance and fee, and the balance goes to the borrower (TV-20).',
                FACTORING: 'Invoices bought from the seller: the debtor is notified and pays the factor; the fee and advance are repaid first and the balance goes to the seller.',
                SUPPLY_CHAIN: 'The buyer’s programme: invoices it has approved are paid to its suppliers early at a discount; the buyer pays the face at maturity.',
                FORFAITING: 'Avalised bills and notes bought without recourse at a discount; the obligor pays the face at maturity.',
            }[kind]}
            back={{ href: '/lending/trade', label: 'Trade finance' }}
            actions={
                <div className="flex items-center gap-3">
                    {canClose && <Btn size="sm" onClick={closeProgramme} busy={busy === 'close'}>Close programme</Btn>}
                    <Link href={href(`/lending/facilities/${facilityId}`)} className="text-[13px] font-semibold text-[#635BFF] hover:underline">Facility →</Link>
                </div>
            }
        >
            {msg && <Notice tone="success">{msg}</Notice>}
            <Card title={copy.name} actions={<StatusBadge status={data.facility.status} />}>
                <KV
                    cols={4}
                    items={[
                        ['Limit', <Money key="l" value={data.facility.limitAmount} currency={ccy} />],
                        [discounted ? 'Face outstanding' : 'Advanced, outstanding', <Money key="o" value={data.position.outstanding} currency={ccy} />],
                        ['Available', <Money key="a" value={data.position.available} currency={ccy} />],
                        ['Days past due', data.facility.daysPastDue],
                        ...termItems(data, ccy),
                    ]}
                />
                {data.summary.inRecourse > 0 && (
                    <div className="mt-3"><Notice tone="warn" title="Recourse">{data.summary.inRecourse} {copy.item.toLowerCase()}(s) unpaid past due date + grace: the {copy.holder.toLowerCase()} owes them{terms?.recourse === 'LIMITED' ? ' up to the recourse cap' : ''}, aged as arrears.</Notice></div>
                )}
                {data.summary.defaulted > 0 && (
                    <div className="mt-3"><Notice tone="danger" title="Defaulted without recourse">{data.summary.defaulted} {copy.item.toLowerCase()}(s) unpaid by the {copy.counterparty.toLowerCase()}: the lender bears the loss. Collect what you can, then propose a write-off.</Notice></div>
                )}
            </Card>

            {kind === 'SUPPLY_CHAIN' && <SuppliersCard data={data} onDone={done} />}

            <Card title={`Register ${kind === 'FORFAITING' ? 'an instrument' : 'an invoice'}`} subtitle={`Maker: a different officer approves it as eligible${terms?.acknowledgement?.required ? `; ${ACK_COPY[terms.acknowledgement.type].action.toLowerCase()} before funding` : ''}.`}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {kind === 'SUPPLY_CHAIN' ? (
                        <Field label="Supplier" hint={activeSuppliers.length ? 'Approved suppliers on this programme' : 'Onboard and approve a supplier first'}>
                            <SelectInput value={form.supplierId} onChange={(v) => setForm({ ...form, supplierId: v })} options={activeSuppliers.map((s) => ({ value: s.id, label: s.name }))} placeholder="Select a supplier" />
                        </Field>
                    ) : (
                        <Field label={kind === 'FORFAITING' ? 'Obligor (drawee / maker)' : 'Debtor (the seller’s customer)'}><TextInput value={form.debtorName} onChange={(v) => setForm({ ...form, debtorName: v })} maxLength={160} /></Field>
                    )}
                    {kind === 'FORFAITING' && (
                        <>
                            <Field label="Instrument"><SelectInput value={form.instrumentType} onChange={(v) => setForm({ ...form, instrumentType: v })} options={(terms?.instrumentTypes ?? []).map((t) => ({ value: t, label: t.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()) }))} placeholder="Select" /></Field>
                            <Field label="Avalising bank" hint="Can also be recorded with the aval"><TextInput value={form.guarantorName} onChange={(v) => setForm({ ...form, guarantorName: v })} maxLength={160} /></Field>
                        </>
                    )}
                    <Field label={`${kind === 'FORFAITING' ? 'Instrument' : 'Invoice'} number`}><TextInput value={form.invoiceNumber} onChange={(v) => setForm({ ...form, invoiceNumber: v })} maxLength={60} /></Field>
                    {kind !== 'SUPPLY_CHAIN' && kind !== 'FORFAITING' && <Field label="Debtor reference" hint="Optional"><TextInput value={form.debtorReference} onChange={(v) => setForm({ ...form, debtorReference: v })} maxLength={80} /></Field>}
                    <Field label={`${discounted ? 'Face value' : 'Amount'} (${ccy})`}><TextInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} inputMode="decimal" /></Field>
                    <Field label="Issue date"><TextInput type="date" value={form.issueDate} onChange={(v) => setForm({ ...form, issueDate: v })} /></Field>
                    <Field label={discounted ? 'Maturity date' : 'Due date'}><TextInput type="date" value={form.dueDate} onChange={(v) => setForm({ ...form, dueDate: v })} /></Field>
                </div>
                <div className="mt-3 flex items-center gap-3">
                    <Btn variant="primary" onClick={register} busy={busy === 'register'}>Register</Btn>
                    {!panel && <ErrorBox error={error} onDismiss={clearError} />}
                </div>
            </Card>

            {panel && panel.kind !== 'detail' && (
                <ActionPanel
                    title={{
                        reject: 'Reject',
                        acknowledge: panel.invoice.receivable ? ACK_COPY[panel.invoice.receivable.acknowledgementType].action : 'Acknowledge',
                        release: `Release the ${copy.funding.toLowerCase()}`,
                        collect: 'Record a payment',
                        writeOff: 'Propose a write-off',
                    }[panel.kind] + ` · ${panel.invoice.invoiceNumber}`}
                    onClose={() => setPanel(null)}
                >
                    {panel.kind === 'reject' && <Field label="Reason"><TextArea value={text} onChange={setText} rows={2} maxLength={500} /></Field>}
                    {panel.kind === 'acknowledge' && panel.invoice.receivable && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <Field label="How"><SelectInput value={method} onChange={setMethod} options={ACK_COPY[panel.invoice.receivable.acknowledgementType].methods} /></Field>
                            <Field label="Reference" hint="Letter, email, approval or guarantee number"><TextInput value={text} onChange={setText} maxLength={120} /></Field>
                            {panel.invoice.receivable.acknowledgementType === 'AVAL' && <Field label="Avalising bank"><TextInput value={guarantor} onChange={setGuarantor} maxLength={160} /></Field>}
                        </div>
                    )}
                    {panel.kind === 'release' && (
                        <>
                            <ReleasePreview invoiceId={panel.invoice.id} currency={ccy} payee={kind === 'SUPPLY_CHAIN' ? panel.invoice.debtorName : `the ${copy.holder.toLowerCase()}`} />
                            <Field label="External reference" hint="Bank transfer reference of the payout"><TextInput value={text} onChange={setText} maxLength={120} className="max-w-sm" /></Field>
                        </>
                    )}
                    {panel.kind === 'collect' && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <Field label="Paid by" hint={source === 'BORROWER' ? (terms?.recourse === 'LIMITED' ? 'Recourse: up to the cap' : 'Recourse: may not exceed what is owed') : discounted ? 'The face is owed at maturity' : `Any surplus is held for the ${copy.holder.toLowerCase()}`}>
                                <SelectInput value={source} onChange={(v) => setSource(v as 'DEBTOR' | 'BORROWER')} options={sourceOptions} />
                            </Field>
                            <Field label={`Amount (${ccy})`}><TextInput value={amount} onChange={setAmount} inputMode="decimal" /></Field>
                            <Field label="External reference" hint="Optional"><TextInput value={text} onChange={setText} maxLength={120} /></Field>
                        </div>
                    )}
                    {panel.kind === 'writeOff' && (
                        <>
                            <p className="text-[12px]">Takes everything still owed on {panel.invoice.invoiceNumber} off the books as the lender’s loss. A write-off checker with authority approves it.</p>
                            <Field label="Reason"><TextArea value={text} onChange={setText} rows={2} maxLength={500} /></Field>
                        </>
                    )}
                    <ErrorBox error={error} onDismiss={clearError} />
                    <Btn variant={panel.kind === 'reject' || panel.kind === 'writeOff' ? 'danger' : 'primary'} onClick={submitPanel} busy={busy === panel.kind}>
                        {{ reject: 'Reject', acknowledge: 'Record', release: 'Release funds', collect: 'Apply payment', writeOff: 'Propose write-off' }[panel.kind]}
                    </Btn>
                </ActionPanel>
            )}
            {panel?.kind === 'detail' && <InvoiceDetailPanel invoiceId={panel.invoice.id} currency={ccy} kind={kind} onClose={() => setPanel(null)} onDone={done} />}

            <Card title={kind === 'FORFAITING' ? 'Instruments' : 'Invoices'} subtitle={`${data.summary.invoices} registered${discounted ? ` · discount still to earn ${data.summary.unearnedDiscount}` : ` · fees outstanding ${data.summary.feesOutstanding}`}${Number(data.summary.writtenOff) > 0 ? ` · written off ${data.summary.writtenOff}` : ''}`} bodyClass="p-0">
                {data.invoices.length === 0 ? <Empty>Nothing registered yet.</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>{copy.item}</th>
                                <th className={th}>{copy.counterparty}</th>
                                <th className={th}>Status</th>
                                <th className={thR}>{discounted ? 'Face' : 'Amount'}</th>
                                <th className={th}>{discounted ? 'Maturity' : 'Due'}</th>
                                <th className={thR}>{copy.funding}</th>
                                <th className={thR}>Owed</th>
                                <th className={thR}>{discounted ? 'Discount' : 'Fee owed'}</th>
                                {!discounted && <th className={thR}>Reserve owed</th>}
                                <th className={th}></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {data.invoices.map((inv) => {
                                const rec = inv.receivable;
                                const needsAck = rec && !rec.acknowledgedAt && ['SUBMITTED', 'APPROVED'].includes(inv.status);
                                return (
                                    <tr key={inv.id} className={inv.status === 'RECOURSE' ? 'bg-amber-50' : inv.status === 'DEFAULTED' ? 'bg-red-50' : ''}>
                                        <td className={td}>
                                            <button type="button" className="font-semibold text-[#635BFF] hover:underline" onClick={() => open({ kind: 'detail', invoice: inv })}>{inv.invoiceNumber}</button>
                                            <div className="text-[11px] text-[#697386]">{inv.reference}{rec?.instrumentType ? ` · ${rec.instrumentType.replace(/_/g, ' ').toLowerCase()}` : ''}</div>
                                        </td>
                                        <td className={td}>
                                            {inv.debtorName}
                                            {rec && <div className="text-[11px] text-[#697386]">{rec.acknowledgedAt ? `✓ ${ACK_COPY[rec.acknowledgementType].done}` : `${ACK_COPY[rec.acknowledgementType].done}: not yet`}</div>}
                                        </td>
                                        <td className={td}><StatusBadge status={inv.status} />{inv.recourseDate && <div className="text-[11px] text-[#697386]">{rec?.recourse === 'NONE' ? 'default' : 'recourse'} after {inv.recourseDate}</div>}</td>
                                        <td className={tdR}><MoneyCell value={inv.amount} currency={ccy} /></td>
                                        <td className={`${td} whitespace-nowrap`}>{inv.dueDate}</td>
                                        <td className={tdR}><MoneyCell value={rec && Number(rec.purchasePrice) > 0 ? rec.purchasePrice : inv.advanceAmount} currency={ccy} muted /></td>
                                        <td className={tdR}><MoneyCell value={inv.advanceOutstanding} currency={ccy} highlightNonZero /></td>
                                        <td className={tdR}>{discounted ? <MoneyCell value={rec?.discountAmount} currency={ccy} muted /> : <MoneyCell value={inv.feeOwed} currency={ccy} highlightNonZero />}</td>
                                        {!discounted && <td className={tdR}><MoneyCell value={inv.reserveOwed} currency={ccy} highlightNonZero /></td>}
                                        <td className={`${td} whitespace-nowrap`}>
                                            <div className="flex flex-wrap justify-end gap-1.5">
                                                {needsAck && <Btn size="sm" onClick={() => open({ kind: 'acknowledge', invoice: inv })}>{ACK_COPY[rec!.acknowledgementType].action}…</Btn>}
                                                {inv.status === 'SUBMITTED' && <Btn size="sm" variant="primary" busy={busy === `approve-${inv.id}`} onClick={() => step(inv, 'approve', 'Approve', `Approve ${inv.invoiceNumber} (${inv.debtorName}) as eligible?`)}>Approve</Btn>}
                                                {inv.status === 'APPROVED' && <Btn size="sm" variant="primary" disabled={!!needsAck && !!terms?.acknowledgement?.required} reason={needsAck ? `${ACK_COPY[rec!.acknowledgementType].action} first` : undefined} busy={busy === `advance-${inv.id}`} onClick={() => step(inv, 'advance', `Request ${copy.funding.toLowerCase()}`, `Request the ${copy.funding.toLowerCase()} of ${inv.invoiceNumber}? The price is fixed when the money is released.`)}>Request {copy.funding.toLowerCase()}</Btn>}
                                                {inv.status === 'ADVANCE_REQUESTED' && <Btn size="sm" variant="primary" busy={busy === `advance/approve-${inv.id}`} onClick={() => step(inv, 'advance/approve', 'Approve funding', `Approve funding ${ccy} ${inv.advanceAmount} against the limit? It is re-checked at release.`)}>Approve funding</Btn>}
                                                {inv.status === 'ADVANCE_APPROVED' && <Btn size="sm" variant="primary" onClick={() => open({ kind: 'release', invoice: inv })}>Release…</Btn>}
                                                {['SUBMITTED', 'APPROVED', 'ADVANCE_REQUESTED'].includes(inv.status) && <Btn size="sm" variant="danger" onClick={() => open({ kind: 'reject', invoice: inv })}>Reject</Btn>}
                                                {['FUNDED', 'RECOURSE', 'DEFAULTED', 'SETTLED'].includes(inv.status) && <Btn size="sm" onClick={() => open({ kind: 'collect', invoice: inv })}>Payment…</Btn>}
                                                {rec && ['RECOURSE', 'DEFAULTED'].includes(inv.status) && <Btn size="sm" variant="danger" onClick={() => open({ kind: 'writeOff', invoice: inv })}>Write off…</Btn>}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </Table>
                )}
            </Card>

            {data.debtors.length > 0 && (
                <Card title={kind === 'SUPPLY_CHAIN' ? 'By supplier' : `By ${copy.counterparty.toLowerCase()}`} subtitle={terms?.maxDebtorConcentration ? `Concentration limit: ${Number(terms.maxDebtorConcentration) * 100}% of the limit per debtor` : 'What is outstanding on each counterparty'} bodyClass="p-0">
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{copy.counterparty}</th><th className={thR}>Open</th><th className={thR}>Face unpaid</th><th className={thR}>Owed to lender</th><th className={thR}>Share of limit</th><th className={thR}>In default</th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {data.debtors.map((d) => (
                                <tr key={d.name}>
                                    <td className={td}>{d.name}</td>
                                    <td className={tdR}>{d.invoices}</td>
                                    <td className={tdR}><MoneyCell value={d.faceOutstanding} currency={ccy} /></td>
                                    <td className={tdR}><MoneyCell value={d.advanceOutstanding} currency={ccy} /></td>
                                    <td className={tdR}><Rate value={d.shareOfLimit} /></td>
                                    <td className={tdR}>{d.inDefault || '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                </Card>
            )}
        </LendingShell>
    );
}

function termItems(data: InvoiceRegister, ccy: string): [React.ReactNode, React.ReactNode][] {
    const t = data.terms;
    if (!t) return [];
    const recourse = { FULL: 'Full', LIMITED: `Limited to ${Number(t.limitedRecourseRate ?? 0) * 100}% of each invoice`, NONE: 'None — the lender bears default' }[t.recourse];
    if (t.discount)
        return [
            ['Discount rate', <span key="d"><Rate value={t.discount.rate} /> a year ({t.discount.method.toLowerCase()}, {t.discount.dayCountBasis}-day year{t.discount.graceDays ? `, +${t.discount.graceDays} days grace` : ''})</span>],
            ['Recourse', t.kind === 'SUPPLY_CHAIN' ? 'The buyer owes every approved invoice' : recourse],
            [t.kind === 'SUPPLY_CHAIN' ? 'Buyer grace' : 'Collection grace', `${t.recourseGraceDays} days after maturity`],
            ['Discount still to earn', <Money key="u" value={data.summary.unearnedDiscount} currency={ccy} />],
        ];
    return [
        ['Advance rate', <Rate key="r" value={t.advanceRate} />],
        ['Fee', <span key="f"><Rate value={t.feeRatePerPeriod} /> per {t.feePeriodDays} days ({t.feeBasis.replace('_', ' ').toLowerCase()}){Number(t.serviceFeeRate) > 0 ? <> + <Rate value={t.serviceFeeRate} /> service fee</> : null}</span>],
        ['Recourse', `${recourse} · after ${t.recourseGraceDays} days past due`],
        ['Owed to the holder (reserve)', <Money key="res" value={data.summary.reserveOwedToBorrower} currency={ccy} />],
    ];
}

/** What releasing the funding would put on the facility and pay out today. */
function ReleasePreview({ invoiceId, currency, payee }: { invoiceId: string; currency: string; payee: string }) {
    const q = useApi<InvoiceQuote>(`/lending/invoices/${invoiceId}/quote`);
    if (!q.data) return q.error ? <ErrorBox error={q.error} /> : <Spinner />;
    const d = q.data;
    return (
        <p className="text-[12px]">
            Puts <Money value={d.advance} currency={currency} /> on the facility and pays <strong><Money value={d.paidOutIfFundedToday ?? d.advance} currency={currency} /></strong> to {payee}
            {Number(d.serviceFee ?? 0) > 0 && <> after a service fee of <Money value={d.serviceFee} currency={currency} /></>}
            {Number(d.discount ?? 0) > 0 && <> after a discount of <Money value={d.discount} currency={currency} /> for {d.discountDays} days</>}.
        </p>
    );
}

function SuppliersCard({ data, onDone }: { data: InvoiceRegister; onDone: (m: string) => void }) {
    const confirm = useConfirm();
    const { busy, error, run, clearError } = useAction();
    const [f, setF] = useState({ name: '', bankName: '', accountNumber: '', sublimit: '' });
    const [rejecting, setRejecting] = useState<string | null>(null);
    const [reason, setReason] = useState('');
    const ccy = data.facility.currency;
    const add = async () => {
        const res = await run('add', () => api.post(`/lending/facilities/${data.facility.id}/suppliers`, clean(f)));
        if (res) { setF({ name: '', bankName: '', accountNumber: '', sublimit: '' }); onDone(`${f.name} onboarded — awaiting approval by another officer`); }
    };
    const approve = async (id: string, name: string) => {
        if (!(await confirm({ title: 'Approve supplier', message: `Approve ${name} on this programme? Its buyer-approved invoices can then be paid early.`, confirmLabel: 'Approve' }))) return;
        const res = await run(`approve-${id}`, () => api.post(`/lending/suppliers/${id}/approve`));
        if (res) onDone(`${name} approved`);
    };
    const reject = async () => {
        if (!rejecting) return;
        const res = await run('reject', () => api.post(`/lending/suppliers/${rejecting}/reject`, { reason: reason.trim() }));
        if (res) { setRejecting(null); setReason(''); onDone('Supplier rejected or suspended'); }
    };
    return (
        <Card title="Suppliers" subtitle="Onboarded by one officer, approved by another. Only approved suppliers’ invoices are paid." bodyClass="p-0">
            {data.suppliers.length > 0 && (
                <Table>
                    <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>Supplier</th><th className={th}>Bank account</th><th className={thR}>Sublimit</th><th className={th}>Status</th><th className={th}></th></tr></thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {data.suppliers.map((s) => (
                            <tr key={s.id}>
                                <td className={td}>{s.name}<div className="text-[11px] text-[#697386]">{s.reference}</div></td>
                                <td className={td}>{[s.bankName, s.accountNumber].filter(Boolean).join(' · ') || '—'}</td>
                                <td className={tdR}>{s.sublimit ? <MoneyCell value={s.sublimit} currency={ccy} /> : '—'}</td>
                                <td className={td}><StatusBadge status={s.status} />{s.statusReason && <div className="text-[11px] text-[#697386]">{s.statusReason}</div>}</td>
                                <td className={`${td} whitespace-nowrap`}>
                                    <div className="flex justify-end gap-1.5">
                                        {s.status === 'PENDING' && <Btn size="sm" variant="primary" busy={busy === `approve-${s.id}`} onClick={() => approve(s.id, s.name)}>Approve</Btn>}
                                        {['PENDING', 'ACTIVE'].includes(s.status) && <Btn size="sm" variant="danger" onClick={() => { setRejecting(s.id); setReason(''); clearError(); }}>{s.status === 'ACTIVE' ? 'Suspend…' : 'Reject…'}</Btn>}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
            <div className="p-4 space-y-3">
                {rejecting && (
                    <ActionPanel title="Reject or suspend supplier" onClose={() => setRejecting(null)}>
                        <Field label="Reason"><TextArea value={reason} onChange={setReason} rows={2} maxLength={500} /></Field>
                        <Btn variant="danger" onClick={reject} busy={busy === 'reject'}>Confirm</Btn>
                    </ActionPanel>
                )}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <Field label="Supplier name"><TextInput value={f.name} onChange={(v) => setF({ ...f, name: v })} maxLength={160} /></Field>
                    <Field label="Bank" hint="Optional"><TextInput value={f.bankName} onChange={(v) => setF({ ...f, bankName: v })} maxLength={160} /></Field>
                    <Field label="Account number" hint="Optional"><TextInput value={f.accountNumber} onChange={(v) => setF({ ...f, accountNumber: v })} maxLength={60} /></Field>
                    <Field label={`Sublimit (${ccy})`} hint="Optional cap on what is outstanding"><TextInput value={f.sublimit} onChange={(v) => setF({ ...f, sublimit: v })} inputMode="decimal" /></Field>
                </div>
                <div className="flex items-center gap-3">
                    <Btn onClick={add} busy={busy === 'add'}>Onboard supplier</Btn>
                    <ErrorBox error={error} onDismiss={clearError} />
                </div>
            </div>
        </Card>
    );
}

/** One receivable: what it owes today, its collections, payouts and write-offs. */
function InvoiceDetailPanel({ invoiceId, currency, kind, onClose, onDone }: { invoiceId: string; currency: string; kind: ReceivablesKind; onClose: () => void; onDone: (m: string) => void }) {
    const view = useApi<InvoiceDetail>(`/lending/invoices/${invoiceId}`);
    const { busy, error, run, clearError } = useAction();
    const payKey = useIdempotencyKey();
    const woKey = useIdempotencyKey();
    const [ref, setRef] = useState('');
    if (!view.data) return <ActionPanel title="Receivable" onClose={onClose}>{view.error ? <ErrorBox error={view.error} /> : <Spinner />}</ActionPanel>;
    const { invoice: inv, quote, collections, reservePayouts, writeOffs } = view.data;
    const rec = inv.receivable;
    const copy = KIND_COPY[kind];
    const pending = reservePayouts.find((t) => t.status === 'PENDING');
    const pendingWo = writeOffs?.find((t) => t.status === 'PENDING');

    const propose = async () => {
        const res = await run('propose', () => api.post(`/lending/invoices/${invoiceId}/reserve-payouts`, ref.trim() ? { externalReference: ref.trim() } : {}));
        if (res) { view.reload(); setRef(''); }
    };
    const decide = async (approve: boolean) => {
        if (!pending) return;
        const body = { approve };
        const res = await run('decide', () => api.post(`/lending/invoices/${invoiceId}/reserve-payouts/${pending.id}/decision`, body, idem(payKey.keyFor({ id: pending.id, ...body }))));
        if (res) { payKey.reset(); onDone(approve ? `Paid ${currency} ${pending.amount} to the ${copy.holder.toLowerCase()}` : 'Payout rejected'); }
    };
    const decideWriteOff = async (approve: boolean) => {
        if (!pendingWo) return;
        const body = { approve };
        const res = await run('wo', () => api.post(`/lending/invoices/${invoiceId}/write-offs/${pendingWo.id}/decision`, body, idem(woKey.keyFor({ id: pendingWo.id, ...body }))));
        if (res) { woKey.reset(); onDone(approve ? `${inv.invoiceNumber} written off (${currency} ${pendingWo.amount})` : 'Write-off rejected'); }
    };

    return (
        <ActionPanel title={`${copy.item} ${inv.invoiceNumber} · ${inv.debtorName}`} onClose={onClose}>
            <KV
                cols={4}
                items={[
                    ['Status', <StatusBadge key="s" status={inv.status} />],
                    ['Funded on', inv.advanceDate ?? '—'],
                    [rec?.discountAmount && Number(rec.discountAmount) > 0 ? 'Discount earned' : 'Fee to date', rec && Number(rec.discountAmount) > 0 ? <Money key="de" value={rec.discountEarned} currency={currency} /> : <Money key="f" value={quote.feeToDate} currency={currency} />],
                    ['Owed today', <Money key="o" value={quote.owed} currency={currency} />],
                    [rec?.recourse === 'NONE' ? 'Default after' : 'Recourse after', quote.recourseDate ?? '—'],
                    [`From ${copy.counterparty.toLowerCase()}`, <Money key="d" value={inv.collectedFromDebtor} currency={currency} />],
                    [`From ${copy.holder.toLowerCase()}`, <Money key="b" value={inv.collectedFromBorrower} currency={currency} />],
                    ...(rec
                        ? ([
                            ['Recourse', rec.recourse === 'LIMITED' ? <span key="rc">Limited to <Money value={rec.recourseCap} currency={currency} /></span> : rec.recourse.toLowerCase()],
                            [rec.acknowledgementType === 'AVAL' ? 'Aval' : ACK_COPY[rec.acknowledgementType].done, rec.acknowledgedAt ? `${rec.acknowledgementReference ?? ''}${rec.guarantorName ? ` · ${rec.guarantorName}` : ''}` : 'Not recorded'],
                            ['Paid out at purchase', <Money key="pp" value={rec.purchasePrice} currency={currency} />],
                            ['Written off', <Money key="wo" value={rec.writtenOff} currency={currency} />],
                        ] as [React.ReactNode, React.ReactNode][])
                        : [['Reserve owed to borrower', <Money key="r" value={inv.reserveOwed} currency={currency} />] as [React.ReactNode, React.ReactNode]]),
                ]}
            />
            {quote.holderOwes != null && (
                <p className="text-[12px] text-[#697386]">After default the {copy.holder.toLowerCase()} answers for <Money value={quote.holderOwes} currency={currency} />; the lender bears <Money value={quote.lenderBears} currency={currency} />.</p>
            )}
            {!rec && quote.surplusIfDebtorPaysInFull && Number(quote.owed) > 0 && (
                <p className="text-[12px] text-[#697386]">If the debtor paid the rest of the invoice today, <Money value={quote.surplusIfDebtorPaysInFull} currency={currency} /> would go to the borrower.</p>
            )}
            {collections.length > 0 && (
                <Table>
                    <thead><tr><th className={th}>Date</th><th className={th}>Paid by</th><th className={thR}>Amount</th><th className={thR}>Fee</th><th className={thR}>{copy.funding}</th><th className={thR}>To {copy.holder.toLowerCase()}</th></tr></thead>
                    <tbody>
                        {collections.map((c) => (
                            <tr key={c.id}><td className={td}>{c.valueDate}</td><td className={td}>{c.source === 'DEBTOR' ? copy.counterparty.toLowerCase() : copy.holder.toLowerCase()}</td><td className={tdR}>{c.amount}</td><td className={tdR}>{c.toFee}</td><td className={tdR}>{c.toAdvance}</td><td className={tdR}>{c.toReserve}</td></tr>
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
            {pendingWo && (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px]">Write-off of <Money value={pendingWo.amount} currency={currency} /> proposed{pendingWo.payload?.reason ? ` (${pendingWo.payload.reason})` : ''}, awaiting a write-off checker.</span>
                    <Btn size="sm" variant="danger" onClick={() => decideWriteOff(true)} busy={busy === 'wo'}>Approve write-off</Btn>
                    <Btn size="sm" onClick={() => decideWriteOff(false)}>Reject</Btn>
                </div>
            )}
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}
