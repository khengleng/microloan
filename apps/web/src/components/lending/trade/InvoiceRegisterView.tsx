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
import { ACK_COPY, type AcknowledgementType, type InvoiceDetail, type InvoiceQuote, type InvoiceRegister, type ReceivablesKind, type TradeInvoice } from './types';

type Tr = ReturnType<typeof useTranslations>;

/** The words a receivables kind uses for its parties and money, translated. */
function useKindCopy() {
    const tk = useTranslations('LendingTrade.kind');
    return (kind: ReceivablesKind) => ({
        name: tk(`${kind}.name`), register: tk(`${kind}.register`),
        counterparty: tk(`${kind}.counterparty`), counterpartyLower: tk(`${kind}.counterpartyLower`),
        item: tk(`${kind}.item`), itemLower: tk(`${kind}.itemLower`),
        funding: tk(`${kind}.funding`), fundingLower: tk(`${kind}.fundingLower`),
        holder: tk(`${kind}.holder`), holderLower: tk(`${kind}.holderLower`),
    });
}

/** What recording an acknowledgement is called, translated. */
function useAckCopy() {
    const ta = useTranslations('LendingTrade.ack');
    return (type: AcknowledgementType) => ({
        action: ta(`${type}.action`), actionLower: ta(`${type}.actionLower`),
        done: ta(`${type}.done`), doneLower: ta(`${type}.doneLower`),
        methods: ACK_COPY[type].methods.map((m) => ({ value: m.value, label: ta(`${type}.methods.${m.value}`) })),
    });
}

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
    const t = useTranslations('LendingTrade.register');
    const kindCopy = useKindCopy();
    const ack = useAckCopy();
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

    if (reg.loading && !reg.data) return <LendingShell title={t('loadingTitle')}><Spinner /></LendingShell>;
    if (reg.error && !reg.data)
        return <LendingShell title={t('loadingTitle')} back={{ href: '/lending/trade', label: t('back') }}><ErrorBox error={reg.error} /></LendingShell>;
    const data = reg.data!;
    const ccy = data.facility.currency;
    const kind: ReceivablesKind = data.kind ?? 'INVOICE_FINANCE';
    const copy = kindCopy(kind);
    const terms = data.terms;
    const discounted = !!terms?.discount;
    const activeSuppliers = data.suppliers.filter((s) => s.status === 'ACTIVE');
    const canClose = data.facility.status !== 'CLOSED' && data.invoices.every((i) => !OPEN.includes(i.status)) && Number(data.summary.reserveOwedToBorrower) === 0;

    const register = async () => {
        const body = clean({ ...form, debtorName: kind === 'SUPPLY_CHAIN' ? '' : form.debtorName.trim() });
        const res = await run('register', () => api.post(`/lending/facilities/${facilityId}/invoices`, body));
        if (res) {
            setForm(EMPTY_FORM);
            done(terms?.acknowledgement?.required ? t('registeredAck', { item: copy.item, action: ack(terms.acknowledgement.type).actionLower }) : t('registered', { item: copy.item }));
        }
    };
    const step = async (inv: TradeInvoice, path: string, label: string, question: string) => {
        if (!(await confirm({ title: label, message: question, confirmLabel: label }))) return;
        const res = await run(`${path}-${inv.id}`, () => api.post(`/lending/invoices/${inv.id}/${path}`));
        if (res) done(t('stepDone', { number: inv.invoiceNumber, step: label.toLowerCase() }));
    };
    const closeProgramme = async () => {
        if (!(await confirm({ title: t('closeProgramme'), message: t('closeConfirm', { reference: data.facility.reference }), confirmLabel: t('closeProgramme') }))) return;
        const res = await run('close', () => api.post(`/lending/facilities/${facilityId}/receivables/close`));
        if (res) done(t('closed', { reference: data.facility.reference }));
    };
    const submitPanel = async () => {
        if (!panel) return;
        const inv = panel.invoice;
        if (panel.kind === 'reject') {
            const res = await run('reject', () => api.post(`/lending/invoices/${inv.id}/reject`, { reason: text.trim() }));
            if (res) done(t('rejected', { number: inv.invoiceNumber }));
        } else if (panel.kind === 'acknowledge') {
            const body = clean({ method, reference: text.trim(), guarantorName: inv.receivable?.acknowledgementType === 'AVAL' ? guarantor.trim() : '' });
            const res = await run('acknowledge', () => api.post(`/lending/invoices/${inv.id}/acknowledge`, body));
            if (res) done(t('ackDone', { number: inv.invoiceNumber, done: ack(inv.receivable!.acknowledgementType).doneLower }));
        } else if (panel.kind === 'release') {
            const body = { externalReference: text.trim() };
            const res = await run('release', () => api.post<{ paidOut: string }>(`/lending/invoices/${inv.id}/advance/release`, body, idem(releaseKey.keyFor({ id: inv.id, ...body }))));
            if (res) { releaseKey.reset(); done(t('released', { funding: copy.funding, number: inv.invoiceNumber })); }
        } else if (panel.kind === 'collect') {
            const body = { source, amount: amount.trim(), ...(text.trim() ? { externalReference: text.trim() } : {}) };
            const res = await run('collect', () => api.post(`/lending/invoices/${inv.id}/collections`, body, idem(collectKey.keyFor({ id: inv.id, ...body }))));
            if (res) { collectKey.reset(); done(t('paymentApplied', { currency: ccy, amount: body.amount, number: inv.invoiceNumber })); }
        } else if (panel.kind === 'writeOff') {
            const res = await run('writeOff', () => api.post(`/lending/invoices/${inv.id}/write-offs`, { reason: text.trim() }));
            if (res) done(t('writeOffProposed', { number: inv.invoiceNumber }));
        }
    };

    const sourceOptions = [
        { value: 'DEBTOR', label: kind === 'SUPPLY_CHAIN' ? t('buyerAtMaturity') : copy.counterparty },
        ...(kind !== 'SUPPLY_CHAIN' && terms?.recourse !== 'NONE' ? [{ value: 'BORROWER', label: t('holderRecourse', { holder: copy.holder }) }] : []),
    ];

    return (
        <LendingShell
            title={`${copy.register} · ${data.facility.reference}`}
            subtitle={t(`subtitle.${kind}`)}
            back={{ href: '/lending/trade', label: t('back') }}
            actions={
                <div className="flex items-center gap-3">
                    {canClose && <Btn size="sm" onClick={closeProgramme} busy={busy === 'close'}>{t('closeProgramme')}</Btn>}
                    <Link href={href(`/lending/facilities/${facilityId}`)} className="text-[13px] font-semibold text-[#635BFF] hover:underline">{t('facilityLink')}</Link>
                </div>
            }
        >
            {msg && <Notice tone="success">{msg}</Notice>}
            <Card title={copy.name} actions={<StatusBadge status={data.facility.status} />}>
                <KV
                    cols={4}
                    items={[
                        [t('limit'), <Money key="l" value={data.facility.limitAmount} currency={ccy} />],
                        [discounted ? t('faceOutstanding') : t('advancedOutstanding'), <Money key="o" value={data.position.outstanding} currency={ccy} />],
                        [t('available'), <Money key="a" value={data.position.available} currency={ccy} />],
                        [t('daysPastDue'), data.facility.daysPastDue],
                        ...termItems(t, data, ccy),
                    ]}
                />
                {data.summary.inRecourse > 0 && (
                    <div className="mt-3"><Notice tone="warn" title={t('recourse')}>{t(terms?.recourse === 'LIMITED' ? 'recourseNoticeCap' : 'recourseNotice', { count: data.summary.inRecourse, item: copy.itemLower, holder: copy.holderLower })}</Notice></div>
                )}
                {data.summary.defaulted > 0 && (
                    <div className="mt-3"><Notice tone="danger" title={t('defaultedTitle')}>{t('defaultedNotice', { count: data.summary.defaulted, item: copy.itemLower, counterparty: copy.counterpartyLower })}</Notice></div>
                )}
            </Card>

            {kind === 'SUPPLY_CHAIN' && <SuppliersCard data={data} onDone={done} />}

            <Card title={kind === 'FORFAITING' ? t('registerInstrument') : t('registerInvoice')} subtitle={terms?.acknowledgement?.required ? t('makerNoteAck', { action: ack(terms.acknowledgement.type).actionLower }) : t('makerNote')}>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {kind === 'SUPPLY_CHAIN' ? (
                        <Field label={t('supplier')} hint={activeSuppliers.length ? t('supplierHint') : t('supplierHintNone')}>
                            <SelectInput value={form.supplierId} onChange={(v) => setForm({ ...form, supplierId: v })} options={activeSuppliers.map((s) => ({ value: s.id, label: s.name }))} placeholder={t('selectSupplier')} />
                        </Field>
                    ) : (
                        <Field label={kind === 'FORFAITING' ? t('obligor') : t('debtor')}><TextInput value={form.debtorName} onChange={(v) => setForm({ ...form, debtorName: v })} maxLength={160} /></Field>
                    )}
                    {kind === 'FORFAITING' && (
                        <>
                            <Field label={t('instrument')}><SelectInput value={form.instrumentType} onChange={(v) => setForm({ ...form, instrumentType: v })} options={(terms?.instrumentTypes ?? []).map((it) => ({ value: it, label: it.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()) }))} placeholder={t('select')} /></Field>
                            <Field label={t('avalisingBank')} hint={t('avalisingBankHint')}><TextInput value={form.guarantorName} onChange={(v) => setForm({ ...form, guarantorName: v })} maxLength={160} /></Field>
                        </>
                    )}
                    <Field label={kind === 'FORFAITING' ? t('instrumentNumber') : t('invoiceNumber')}><TextInput value={form.invoiceNumber} onChange={(v) => setForm({ ...form, invoiceNumber: v })} maxLength={60} /></Field>
                    {kind !== 'SUPPLY_CHAIN' && kind !== 'FORFAITING' && <Field label={t('debtorReference')} hint={t('optional')}><TextInput value={form.debtorReference} onChange={(v) => setForm({ ...form, debtorReference: v })} maxLength={80} /></Field>}
                    <Field label={discounted ? t('faceValueCcy', { currency: ccy }) : t('amountCcy', { currency: ccy })}><TextInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} inputMode="decimal" /></Field>
                    <Field label={t('issueDate')}><TextInput type="date" value={form.issueDate} onChange={(v) => setForm({ ...form, issueDate: v })} /></Field>
                    <Field label={discounted ? t('maturityDate') : t('dueDate')}><TextInput type="date" value={form.dueDate} onChange={(v) => setForm({ ...form, dueDate: v })} /></Field>
                </div>
                <div className="mt-3 flex items-center gap-3">
                    <Btn variant="primary" onClick={register} busy={busy === 'register'}>{t('register')}</Btn>
                    {!panel && <ErrorBox error={error} onDismiss={clearError} />}
                </div>
            </Card>

            {panel && panel.kind !== 'detail' && (
                <ActionPanel
                    title={{
                        reject: t('reject'),
                        acknowledge: panel.invoice.receivable ? ack(panel.invoice.receivable.acknowledgementType).action : t('acknowledge'),
                        release: t('releaseTitle', { funding: copy.fundingLower }),
                        collect: t('recordPayment'),
                        writeOff: t('proposeWriteOffTitle'),
                    }[panel.kind] + ` · ${panel.invoice.invoiceNumber}`}
                    onClose={() => setPanel(null)}
                >
                    {panel.kind === 'reject' && <Field label={t('reason')}><TextArea value={text} onChange={setText} rows={2} maxLength={500} /></Field>}
                    {panel.kind === 'acknowledge' && panel.invoice.receivable && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <Field label={t('how')}><SelectInput value={method} onChange={setMethod} options={ack(panel.invoice.receivable.acknowledgementType).methods} /></Field>
                            <Field label={t('reference')} hint={t('referenceHint')}><TextInput value={text} onChange={setText} maxLength={120} /></Field>
                            {panel.invoice.receivable.acknowledgementType === 'AVAL' && <Field label={t('avalisingBank')}><TextInput value={guarantor} onChange={setGuarantor} maxLength={160} /></Field>}
                        </div>
                    )}
                    {panel.kind === 'release' && (
                        <>
                            <ReleasePreview invoiceId={panel.invoice.id} currency={ccy} payee={kind === 'SUPPLY_CHAIN' ? panel.invoice.debtorName : t('theHolder', { holder: copy.holderLower })} />
                            <Field label={t('externalReference')} hint={t('payoutReferenceHint')}><TextInput value={text} onChange={setText} maxLength={120} className="max-w-sm" /></Field>
                        </>
                    )}
                    {panel.kind === 'collect' && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <Field label={t('paidBy')} hint={source === 'BORROWER' ? (terms?.recourse === 'LIMITED' ? t('recourseUpToCap') : t('recourseNotExceed')) : discounted ? t('faceOwedAtMaturity') : t('surplusHeld', { holder: copy.holderLower })}>
                                <SelectInput value={source} onChange={(v) => setSource(v as 'DEBTOR' | 'BORROWER')} options={sourceOptions} />
                            </Field>
                            <Field label={t('amountCcy', { currency: ccy })}><TextInput value={amount} onChange={setAmount} inputMode="decimal" /></Field>
                            <Field label={t('externalReference')} hint={t('optional')}><TextInput value={text} onChange={setText} maxLength={120} /></Field>
                        </div>
                    )}
                    {panel.kind === 'writeOff' && (
                        <>
                            <p className="text-[12px]">{t('writeOffText', { number: panel.invoice.invoiceNumber })}</p>
                            <Field label={t('reason')}><TextArea value={text} onChange={setText} rows={2} maxLength={500} /></Field>
                        </>
                    )}
                    <ErrorBox error={error} onDismiss={clearError} />
                    <Btn variant={panel.kind === 'reject' || panel.kind === 'writeOff' ? 'danger' : 'primary'} onClick={submitPanel} busy={busy === panel.kind}>
                        {{ reject: t('reject'), acknowledge: t('record'), release: t('releaseFunds'), collect: t('applyPayment'), writeOff: t('proposeWriteOff') }[panel.kind]}
                    </Btn>
                </ActionPanel>
            )}
            {panel?.kind === 'detail' && <InvoiceDetailPanel invoiceId={panel.invoice.id} currency={ccy} kind={kind} onClose={() => setPanel(null)} onDone={done} />}

            <Card title={kind === 'FORFAITING' ? t('instruments') : t('invoices')} subtitle={[t('registeredCount', { count: data.summary.invoices }), discounted ? t('discountToEarn', { amount: data.summary.unearnedDiscount }) : t('feesOutstanding', { amount: data.summary.feesOutstanding }), ...(Number(data.summary.writtenOff) > 0 ? [t('writtenOffAmount', { amount: data.summary.writtenOff })] : [])].join(' · ')} bodyClass="p-0">
                {data.invoices.length === 0 ? <Empty>{t('nothingRegistered')}</Empty> : (
                    <Table>
                        <thead>
                            <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                                <th className={th}>{copy.item}</th>
                                <th className={th}>{copy.counterparty}</th>
                                <th className={th}>{t('colStatus')}</th>
                                <th className={thR}>{discounted ? t('colFace') : t('colAmount')}</th>
                                <th className={th}>{discounted ? t('colMaturity') : t('colDue')}</th>
                                <th className={thR}>{copy.funding}</th>
                                <th className={thR}>{t('colOwed')}</th>
                                <th className={thR}>{discounted ? t('colDiscount') : t('colFeeOwed')}</th>
                                {!discounted && <th className={thR}>{t('colReserveOwed')}</th>}
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
                                            {rec && <div className="text-[11px] text-[#697386]">{rec.acknowledgedAt ? `✓ ${ack(rec.acknowledgementType).done}` : t('notYet', { done: ack(rec.acknowledgementType).done })}</div>}
                                        </td>
                                        <td className={td}><StatusBadge status={inv.status} />{inv.recourseDate && <div className="text-[11px] text-[#697386]">{t(rec?.recourse === 'NONE' ? 'defaultAfterDate' : 'recourseAfterDate', { date: inv.recourseDate })}</div>}</td>
                                        <td className={tdR}><MoneyCell value={inv.amount} currency={ccy} /></td>
                                        <td className={`${td} whitespace-nowrap`}>{inv.dueDate}</td>
                                        <td className={tdR}><MoneyCell value={rec && Number(rec.purchasePrice) > 0 ? rec.purchasePrice : inv.advanceAmount} currency={ccy} muted /></td>
                                        <td className={tdR}><MoneyCell value={inv.advanceOutstanding} currency={ccy} highlightNonZero /></td>
                                        <td className={tdR}>{discounted ? <MoneyCell value={rec?.discountAmount} currency={ccy} muted /> : <MoneyCell value={inv.feeOwed} currency={ccy} highlightNonZero />}</td>
                                        {!discounted && <td className={tdR}><MoneyCell value={inv.reserveOwed} currency={ccy} highlightNonZero /></td>}
                                        <td className={`${td} whitespace-nowrap`}>
                                            <div className="flex flex-wrap justify-end gap-1.5">
                                                {needsAck && <Btn size="sm" onClick={() => open({ kind: 'acknowledge', invoice: inv })}>{ack(rec!.acknowledgementType).action}…</Btn>}
                                                {inv.status === 'SUBMITTED' && <Btn size="sm" variant="primary" busy={busy === `approve-${inv.id}`} onClick={() => step(inv, 'approve', t('approve'), t('approveQuestion', { number: inv.invoiceNumber, debtor: inv.debtorName }))}>{t('approve')}</Btn>}
                                                {inv.status === 'APPROVED' && <Btn size="sm" variant="primary" disabled={!!needsAck && !!terms?.acknowledgement?.required} reason={needsAck ? t('firstDo', { action: ack(rec!.acknowledgementType).action }) : undefined} busy={busy === `advance-${inv.id}`} onClick={() => step(inv, 'advance', t('requestFunding', { funding: copy.fundingLower }), t('requestQuestion', { funding: copy.fundingLower, number: inv.invoiceNumber }))}>{t('requestFunding', { funding: copy.fundingLower })}</Btn>}
                                                {inv.status === 'ADVANCE_REQUESTED' && <Btn size="sm" variant="primary" busy={busy === `advance/approve-${inv.id}`} onClick={() => step(inv, 'advance/approve', t('approveFunding'), t('approveFundingQuestion', { currency: ccy, amount: inv.advanceAmount }))}>{t('approveFunding')}</Btn>}
                                                {inv.status === 'ADVANCE_APPROVED' && <Btn size="sm" variant="primary" onClick={() => open({ kind: 'release', invoice: inv })}>{t('releaseEllipsis')}</Btn>}
                                                {['SUBMITTED', 'APPROVED', 'ADVANCE_REQUESTED'].includes(inv.status) && <Btn size="sm" variant="danger" onClick={() => open({ kind: 'reject', invoice: inv })}>{t('reject')}</Btn>}
                                                {['FUNDED', 'RECOURSE', 'DEFAULTED', 'SETTLED'].includes(inv.status) && <Btn size="sm" onClick={() => open({ kind: 'collect', invoice: inv })}>{t('paymentEllipsis')}</Btn>}
                                                {rec && ['RECOURSE', 'DEFAULTED'].includes(inv.status) && <Btn size="sm" variant="danger" onClick={() => open({ kind: 'writeOff', invoice: inv })}>{t('writeOffEllipsis')}</Btn>}
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
                <Card title={kind === 'SUPPLY_CHAIN' ? t('bySupplier') : t('byCounterparty', { counterparty: copy.counterpartyLower })} subtitle={terms?.maxDebtorConcentration ? t('concentration', { pct: Number(terms.maxDebtorConcentration) * 100 }) : t('outstandingPerCounterparty')} bodyClass="p-0">
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{copy.counterparty}</th><th className={thR}>{t('colOpen')}</th><th className={thR}>{t('colFaceUnpaid')}</th><th className={thR}>{t('colOwedToLender')}</th><th className={thR}>{t('colShareOfLimit')}</th><th className={thR}>{t('colInDefault')}</th></tr></thead>
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

function termItems(tr: Tr, data: InvoiceRegister, ccy: string): [React.ReactNode, React.ReactNode][] {
    const t = data.terms;
    if (!t) return [];
    const recourse = { FULL: tr('recourseFull'), LIMITED: tr('recourseLimited', { pct: Number(t.limitedRecourseRate ?? 0) * 100 }), NONE: tr('recourseNone') }[t.recourse];
    if (t.discount)
        return [
            [tr('discountRate'), <span key="d">{tr.rich(t.discount.graceDays ? 'discountRateValueGrace' : 'discountRateValue', { rate: () => <Rate value={t.discount!.rate} />, method: t.discount.method.toLowerCase(), basis: t.discount.dayCountBasis, grace: t.discount.graceDays ?? 0 })}</span>],
            [tr('recourse'), t.kind === 'SUPPLY_CHAIN' ? tr('buyerOwesAll') : recourse],
            [t.kind === 'SUPPLY_CHAIN' ? tr('buyerGrace') : tr('collectionGrace'), tr('daysAfterMaturity', { days: t.recourseGraceDays })],
            [tr('discountToEarnLabel'), <Money key="u" value={data.summary.unearnedDiscount} currency={ccy} />],
        ];
    return [
        [tr('advanceRate'), <Rate key="r" value={t.advanceRate} />],
        [tr('fee'), <span key="f">{tr.rich(Number(t.serviceFeeRate) > 0 ? 'feeValueService' : 'feeValue', { rate: () => <Rate value={t.feeRatePerPeriod} />, days: t.feePeriodDays, basis: t.feeBasis.replace('_', ' ').toLowerCase(), service: () => <Rate value={t.serviceFeeRate} /> })}</span>],
        [tr('recourse'), tr('recourseAfterDays', { recourse, days: t.recourseGraceDays })],
        [tr('owedToHolder'), <Money key="res" value={data.summary.reserveOwedToBorrower} currency={ccy} />],
    ];
}

/** What releasing the funding would put on the facility and pay out today. */
function ReleasePreview({ invoiceId, currency, payee }: { invoiceId: string; currency: string; payee: string }) {
    const t = useTranslations('LendingTrade.register');
    const q = useApi<InvoiceQuote>(`/lending/invoices/${invoiceId}/quote`);
    if (!q.data) return q.error ? <ErrorBox error={q.error} /> : <Spinner />;
    const d = q.data;
    const fee = Number(d.serviceFee ?? 0) > 0;
    const disc = Number(d.discount ?? 0) > 0;
    return (
        <p className="text-[12px]">
            {t.rich(fee && disc ? 'releasePreviewFeeDiscount' : fee ? 'releasePreviewFee' : disc ? 'releasePreviewDiscount' : 'releasePreview', {
                advance: () => <Money value={d.advance} currency={currency} />,
                paid: () => <strong><Money value={d.paidOutIfFundedToday ?? d.advance} currency={currency} /></strong>,
                fee: () => <Money value={d.serviceFee} currency={currency} />,
                discount: () => <Money value={d.discount} currency={currency} />,
                days: d.discountDays ?? 0,
                payee,
            })}
        </p>
    );
}

function SuppliersCard({ data, onDone }: { data: InvoiceRegister; onDone: (m: string) => void }) {
    const t = useTranslations('LendingTrade.suppliers');
    const confirm = useConfirm();
    const { busy, error, run, clearError } = useAction();
    const [f, setF] = useState({ name: '', bankName: '', accountNumber: '', sublimit: '' });
    const [rejecting, setRejecting] = useState<string | null>(null);
    const [reason, setReason] = useState('');
    const ccy = data.facility.currency;
    const add = async () => {
        const res = await run('add', () => api.post(`/lending/facilities/${data.facility.id}/suppliers`, clean(f)));
        if (res) { setF({ name: '', bankName: '', accountNumber: '', sublimit: '' }); onDone(t('onboarded', { name: f.name })); }
    };
    const approve = async (id: string, name: string) => {
        if (!(await confirm({ title: t('approveTitle'), message: t('approveMessage', { name }), confirmLabel: t('approve') }))) return;
        const res = await run(`approve-${id}`, () => api.post(`/lending/suppliers/${id}/approve`));
        if (res) onDone(t('approved', { name }));
    };
    const reject = async () => {
        if (!rejecting) return;
        const res = await run('reject', () => api.post(`/lending/suppliers/${rejecting}/reject`, { reason: reason.trim() }));
        if (res) { setRejecting(null); setReason(''); onDone(t('rejected')); }
    };
    return (
        <Card title={t('title')} subtitle={t('subtitle')} bodyClass="p-0">
            {data.suppliers.length > 0 && (
                <Table>
                    <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>{t('colSupplier')}</th><th className={th}>{t('colBankAccount')}</th><th className={thR}>{t('colSublimit')}</th><th className={th}>{t('colStatus')}</th><th className={th}></th></tr></thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {data.suppliers.map((s) => (
                            <tr key={s.id}>
                                <td className={td}>{s.name}<div className="text-[11px] text-[#697386]">{s.reference}</div></td>
                                <td className={td}>{[s.bankName, s.accountNumber].filter(Boolean).join(' · ') || '—'}</td>
                                <td className={tdR}>{s.sublimit ? <MoneyCell value={s.sublimit} currency={ccy} /> : '—'}</td>
                                <td className={td}><StatusBadge status={s.status} />{s.statusReason && <div className="text-[11px] text-[#697386]">{s.statusReason}</div>}</td>
                                <td className={`${td} whitespace-nowrap`}>
                                    <div className="flex justify-end gap-1.5">
                                        {s.status === 'PENDING' && <Btn size="sm" variant="primary" busy={busy === `approve-${s.id}`} onClick={() => approve(s.id, s.name)}>{t('approve')}</Btn>}
                                        {['PENDING', 'ACTIVE'].includes(s.status) && <Btn size="sm" variant="danger" onClick={() => { setRejecting(s.id); setReason(''); clearError(); }}>{s.status === 'ACTIVE' ? t('suspendEllipsis') : t('rejectEllipsis')}</Btn>}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
            <div className="p-4 space-y-3">
                {rejecting && (
                    <ActionPanel title={t('rejectTitle')} onClose={() => setRejecting(null)}>
                        <Field label={t('reason')}><TextArea value={reason} onChange={setReason} rows={2} maxLength={500} /></Field>
                        <Btn variant="danger" onClick={reject} busy={busy === 'reject'}>{t('confirm')}</Btn>
                    </ActionPanel>
                )}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <Field label={t('name')}><TextInput value={f.name} onChange={(v) => setF({ ...f, name: v })} maxLength={160} /></Field>
                    <Field label={t('bank')} hint={t('optional')}><TextInput value={f.bankName} onChange={(v) => setF({ ...f, bankName: v })} maxLength={160} /></Field>
                    <Field label={t('accountNumber')} hint={t('optional')}><TextInput value={f.accountNumber} onChange={(v) => setF({ ...f, accountNumber: v })} maxLength={60} /></Field>
                    <Field label={t('sublimit', { currency: ccy })} hint={t('sublimitHint')}><TextInput value={f.sublimit} onChange={(v) => setF({ ...f, sublimit: v })} inputMode="decimal" /></Field>
                </div>
                <div className="flex items-center gap-3">
                    <Btn onClick={add} busy={busy === 'add'}>{t('onboard')}</Btn>
                    <ErrorBox error={error} onDismiss={clearError} />
                </div>
            </div>
        </Card>
    );
}

/** One receivable: what it owes today, its collections, payouts and write-offs. */
function InvoiceDetailPanel({ invoiceId, currency, kind, onClose, onDone }: { invoiceId: string; currency: string; kind: ReceivablesKind; onClose: () => void; onDone: (m: string) => void }) {
    const t = useTranslations('LendingTrade.detail');
    const kindCopy = useKindCopy();
    const ack = useAckCopy();
    const view = useApi<InvoiceDetail>(`/lending/invoices/${invoiceId}`);
    const { busy, error, run, clearError } = useAction();
    const payKey = useIdempotencyKey();
    const woKey = useIdempotencyKey();
    const [ref, setRef] = useState('');
    if (!view.data) return <ActionPanel title={t('title')} onClose={onClose}>{view.error ? <ErrorBox error={view.error} /> : <Spinner />}</ActionPanel>;
    const { invoice: inv, quote, collections, reservePayouts, writeOffs } = view.data;
    const rec = inv.receivable;
    const copy = kindCopy(kind);
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
        if (res) { payKey.reset(); onDone(approve ? t('paidTo', { currency, amount: pending.amount, holder: copy.holderLower }) : t('payoutRejected')); }
    };
    const decideWriteOff = async (approve: boolean) => {
        if (!pendingWo) return;
        const body = { approve };
        const res = await run('wo', () => api.post(`/lending/invoices/${invoiceId}/write-offs/${pendingWo.id}/decision`, body, idem(woKey.keyFor({ id: pendingWo.id, ...body }))));
        if (res) { woKey.reset(); onDone(approve ? t('writtenOff', { number: inv.invoiceNumber, currency, amount: pendingWo.amount }) : t('writeOffRejected')); }
    };

    return (
        <ActionPanel title={`${copy.item} ${inv.invoiceNumber} · ${inv.debtorName}`} onClose={onClose}>
            <KV
                cols={4}
                items={[
                    [t('status'), <StatusBadge key="s" status={inv.status} />],
                    [t('fundedOn'), inv.advanceDate ?? '—'],
                    [rec?.discountAmount && Number(rec.discountAmount) > 0 ? t('discountEarned') : t('feeToDate'), rec && Number(rec.discountAmount) > 0 ? <Money key="de" value={rec.discountEarned} currency={currency} /> : <Money key="f" value={quote.feeToDate} currency={currency} />],
                    [t('owedToday'), <Money key="o" value={quote.owed} currency={currency} />],
                    [rec?.recourse === 'NONE' ? t('defaultAfter') : t('recourseAfter'), quote.recourseDate ?? '—'],
                    [t('fromParty', { party: copy.counterpartyLower }), <Money key="d" value={inv.collectedFromDebtor} currency={currency} />],
                    [t('fromParty', { party: copy.holderLower }), <Money key="b" value={inv.collectedFromBorrower} currency={currency} />],
                    ...(rec
                        ? ([
                            [t('recourse'), rec.recourse === 'LIMITED' ? <span key="rc">{t.rich('limitedTo', { cap: () => <Money value={rec.recourseCap} currency={currency} /> })}</span> : t(`recourseKind.${rec.recourse}`)],
                            [rec.acknowledgementType === 'AVAL' ? t('aval') : ack(rec.acknowledgementType).done, rec.acknowledgedAt ? `${rec.acknowledgementReference ?? ''}${rec.guarantorName ? ` · ${rec.guarantorName}` : ''}` : t('notRecorded')],
                            [t('paidOutAtPurchase'), <Money key="pp" value={rec.purchasePrice} currency={currency} />],
                            [t('writtenOffLabel'), <Money key="wo" value={rec.writtenOff} currency={currency} />],
                        ] as [React.ReactNode, React.ReactNode][])
                        : [[t('reserveOwed'), <Money key="r" value={inv.reserveOwed} currency={currency} />] as [React.ReactNode, React.ReactNode]]),
                ]}
            />
            {quote.holderOwes != null && (
                <p className="text-[12px] text-[#697386]">{t.rich('afterDefault', { holder: copy.holderLower, owes: () => <Money value={quote.holderOwes} currency={currency} />, bears: () => <Money value={quote.lenderBears} currency={currency} /> })}</p>
            )}
            {!rec && quote.surplusIfDebtorPaysInFull && Number(quote.owed) > 0 && (
                <p className="text-[12px] text-[#697386]">{t.rich('surplusIfPaid', { amount: () => <Money value={quote.surplusIfDebtorPaysInFull} currency={currency} /> })}</p>
            )}
            {collections.length > 0 && (
                <Table>
                    <thead><tr><th className={th}>{t('colDate')}</th><th className={th}>{t('colPaidBy')}</th><th className={thR}>{t('colAmount')}</th><th className={thR}>{t('colFee')}</th><th className={thR}>{copy.funding}</th><th className={thR}>{t('colToHolder', { holder: copy.holderLower })}</th></tr></thead>
                    <tbody>
                        {collections.map((c) => (
                            <tr key={c.id}><td className={td}>{c.valueDate}</td><td className={td}>{c.source === 'DEBTOR' ? copy.counterpartyLower : copy.holderLower}</td><td className={tdR}>{c.amount}</td><td className={tdR}>{c.toFee}</td><td className={tdR}>{c.toAdvance}</td><td className={tdR}>{c.toReserve}</td></tr>
                        ))}
                    </tbody>
                </Table>
            )}
            {Number(inv.reserveOwed) > 0 && !pending && (
                <div className="flex flex-wrap items-end gap-2">
                    <Field label={t('payoutReference')} hint={t('optional')}><TextInput value={ref} onChange={setRef} maxLength={120} className="w-56" /></Field>
                    <Btn variant="primary" onClick={propose} busy={busy === 'propose'}>{t('proposePayout', { amount: inv.reserveOwed })}</Btn>
                </div>
            )}
            {pending && (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px]">{t.rich('payoutAwaiting', { amount: () => <Money value={pending.amount} currency={currency} /> })}</span>
                    <Btn size="sm" variant="primary" onClick={() => decide(true)} busy={busy === 'decide'}>{t('approveAndPay')}</Btn>
                    <Btn size="sm" variant="danger" onClick={() => decide(false)}>{t('reject')}</Btn>
                </div>
            )}
            {pendingWo && (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px]">{t.rich(pendingWo.payload?.reason ? 'writeOffAwaitingReason' : 'writeOffAwaiting', { amount: () => <Money value={pendingWo.amount} currency={currency} />, reason: String(pendingWo.payload?.reason ?? '') })}</span>
                    <Btn size="sm" variant="danger" onClick={() => decideWriteOff(true)} busy={busy === 'wo'}>{t('approveWriteOff')}</Btn>
                    <Btn size="sm" onClick={() => decideWriteOff(false)}>{t('reject')}</Btn>
                </div>
            )}
            <ErrorBox error={error} onDismiss={clearError} />
        </ActionPanel>
    );
}
