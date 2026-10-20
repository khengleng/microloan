"use client";

import { useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { useTranslations } from 'next-intl';
import { useWorkspace } from '@/lib/workspace';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { LendingShell, useLendingHref } from '../LendingShell';
import { ActionPanel, Btn, Card, Empty, ErrorBox, Field, KV, Notice, SelectInput, Spinner, Table, TextArea, TextInput, td, tdR, th, thR } from '../ui';
import { idem, useAction, useApi, useIdempotencyKey } from '../useAsync';
import { Money, MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import type { LcDetail, LcDrawing } from './types';

type Panel = { kind: 'reject' } | { kind: 'close' } | { kind: 'drawing' } | { kind: 'rejectDrawing'; drawing: LcDrawing } | { kind: 'pay'; drawing: LcDrawing };

/**
 * One letter of credit (LT-19): issue or reject it, record presentations,
 * and pay them — each payment converting into the importer's loan (UC-53).
 */
export function LetterOfCreditView({ id }: { id: string }) {
    const t = useTranslations('LendingTrade.lc');
    const tn = useTranslations('Workspace.nav');
    const href = useLendingHref();
    const confirm = useConfirm();
    const { can, access } = useWorkspace();
    const me = access?.principal.id;
    const view = useApi<LcDetail>(`/lending/letters-of-credit/${id}`);
    const { busy, error, run, clearError } = useAction();
    const issueKey = useIdempotencyKey();
    const payKey = useIdempotencyKey();
    const closeKey = useIdempotencyKey();
    const [panel, setPanel] = useState<Panel | null>(null);
    const [text, setText] = useState('');
    const [amount, setAmount] = useState('');
    const [action, setAction] = useState<'CANCEL' | 'EXPIRE'>('CANCEL');
    const [msg, setMsg] = useState('');

    if (!view.data) return <LendingShell title={t('title')} back={{ href: '/lending/trade', label: tn('trade') }}>{view.error ? <ErrorBox error={view.error} /> : <Spinner />}</LendingShell>;
    const { letterOfCredit: lc, drawings, undrawn } = view.data;
    const ccy = lc.currency;
    const open = (p: Panel) => { setPanel(p); setText(''); setAmount(''); clearError(); };
    const done = (m: string) => { setMsg(m); setPanel(null); view.reload(); };
    const live = ['ISSUED', 'PARTIALLY_DRAWN'].includes(lc.status);
    // The API's rules (policy/actions.ts): issuing and refusing are the checker's, never the requester's.
    const canIssue = can('trade.lc.issue') && lc.requestedBy !== me;
    const canPresent = can('trade.lc.request');
    const canClose = can('trade.lc.issue');
    const canApproveDrawing = (d: LcDrawing) => can('loan.disbursement.approve') && d.requestedBy !== me;
    const canPayDrawing = (d: LcDrawing) => can('loan.disbursement.execute') && d.requestedBy !== me && d.approvedBy !== me;

    const issue = async () => {
        if (!(await confirm({ title: t('issueTitle'), message: t('issueMessage', { reference: lc.reference, currency: ccy, amount: lc.amount, beneficiary: lc.beneficiaryName }), confirmLabel: t('issue') }))) return;
        const res = await run('issue', () => api.post(`/lending/letters-of-credit/${id}/issue`, {}, idem(issueKey.keyFor({ id }))));
        if (res) { issueKey.reset(); done(t('issued')); }
    };
    const approveDrawing = async (d: LcDrawing) => {
        if (!(await confirm({ title: t('approveDrawingTitle'), message: t('approveDrawingMessage', { currency: ccy, amount: d.amount, beneficiary: lc.beneficiaryName, documents: d.documentsReference }), confirmLabel: t('approve') }))) return;
        const res = await run(`approve-${d.id}`, () => api.post(`/lending/letters-of-credit/${id}/drawings/${d.id}/approve`));
        if (res) done(t('drawingApproved', { sequence: d.sequence }));
    };
    const submit = async () => {
        if (!panel) return;
        let res: unknown;
        if (panel.kind === 'reject') res = await run('p', () => api.post(`/lending/letters-of-credit/${id}/reject`, { reason: text.trim() }));
        if (panel.kind === 'drawing') res = await run('p', () => api.post(`/lending/letters-of-credit/${id}/drawings`, { amount: amount.trim(), documentsReference: text.trim() }));
        if (panel.kind === 'rejectDrawing') res = await run('p', () => api.post(`/lending/letters-of-credit/${id}/drawings/${panel.drawing.id}/reject`, { reason: text.trim() }));
        if (panel.kind === 'close') {
            const body = { action, reason: text.trim() };
            res = await run('p', () => api.post(`/lending/letters-of-credit/${id}/close`, body, idem(closeKey.keyFor(body))));
            if (res) closeKey.reset();
        }
        if (panel.kind === 'pay') {
            const body = { externalReference: text.trim() };
            res = await run('p', () => api.post(`/lending/letters-of-credit/${id}/drawings/${panel.drawing.id}/pay`, body, idem(payKey.keyFor({ d: panel.drawing.id, ...body }))));
            if (res) payKey.reset();
        }
        if (res) done(t('done'));
    };

    return (
        <LendingShell
            title={t('titleRef', { reference: lc.reference })}
            subtitle={`${lc.beneficiaryName}${lc.beneficiaryBank ? ` · ${lc.beneficiaryBank}` : ''}`}
            back={{ href: '/lending/trade', label: tn('trade') }}
            actions={
                <>
                    {lc.status === 'REQUESTED' && canIssue && <><Btn variant="primary" onClick={issue} busy={busy === 'issue'}>{t('issueEllipsis')}</Btn><Btn variant="danger" onClick={() => open({ kind: 'reject' })}>{t('reject')}</Btn></>}
                    {live && <>{canPresent && <Btn variant="primary" onClick={() => open({ kind: 'drawing' })}>{t('recordPresentation')}</Btn>}{canClose && <Btn onClick={() => open({ kind: 'close' })}>{t('expireCancel')}</Btn>}</>}
                </>
            }
        >
            {msg && <Notice tone="success">{msg}</Notice>}
            {!panel && <ErrorBox error={error} onDismiss={clearError} />}
            <Card title={t('credit')}>
                <KV
                    cols={4}
                    items={[
                        [t('status'), <StatusBadge key="s" status={lc.status} />],
                        [t('amount'), <Money key="a" value={lc.amount} currency={ccy} />],
                        [t('drawn'), <Money key="d" value={lc.drawnAmount} currency={ccy} />],
                        [t('undrawn'), <Money key="u" value={undrawn} currency={ccy} />],
                        [t('issuedOn'), lc.issueDate],
                        [t('expiry'), lc.expiryDate],
                        [t('fee'), <span key="f"><Money value={lc.feeAmount} currency={ccy} />{lc.terms.feePreview && <span className="block text-[11px] text-[#697386]">{lc.terms.feePreview.explanation}</span>}</span>],
                        [t('convertsInto'), lc.terms.conversion ? t('conversion', { product: lc.terms.conversion.productCode, count: lc.terms.conversion.numberOfInstalments }) : '—'],
                    ]}
                />
                {lc.rejectionReason && <div className="mt-3"><Notice tone="danger" title={t('rejected')}>{lc.rejectionReason}</Notice></div>}
                {lc.closeReason && <div className="mt-3"><Notice title={t('closed')}>{lc.closeReason}</Notice></div>}
            </Card>

            {panel && (
                <ActionPanel
                    title={{ reject: t('panelReject'), close: t('panelClose'), drawing: t('panelDrawing'), rejectDrawing: t('panelRejectDrawing'), pay: t('panelPay') }[panel.kind]}
                    onClose={() => setPanel(null)}
                >
                    {panel.kind === 'drawing' && <Field label={t('amountCcy', { currency: ccy })} hint={t('upTo', { amount: undrawn })}><TextInput value={amount} onChange={setAmount} inputMode="decimal" className="max-w-xs" /></Field>}
                    {panel.kind === 'close' && <Field label={t('action')}><SelectInput value={action} onChange={(v) => setAction(v as 'CANCEL' | 'EXPIRE')} options={[{ value: 'CANCEL', label: t('actionCancel') }, { value: 'EXPIRE', label: t('actionExpire') }]} className="max-w-xs" /></Field>}
                    {panel.kind === 'pay' && <p className="text-[12px]">{t.rich('payText', { amount: () => <Money value={panel.drawing.amount} currency={ccy} />, beneficiary: lc.beneficiaryName, count: panel.drawing.numberOfInstalments })}</p>}
                    <Field label={{ reject: t('reason'), close: t('reason'), drawing: t('documentsReference'), rejectDrawing: t('reason'), pay: t('paymentReference') }[panel.kind]}>
                        {panel.kind === 'drawing' || panel.kind === 'pay' ? <TextInput value={text} onChange={setText} maxLength={120} /> : <TextArea value={text} onChange={setText} rows={2} maxLength={500} />}
                    </Field>
                    <ErrorBox error={error} onDismiss={clearError} />
                    <Btn variant={panel.kind === 'reject' || panel.kind === 'rejectDrawing' ? 'danger' : 'primary'} onClick={submit} busy={busy === 'p'}>{t('confirm')}</Btn>
                </ActionPanel>
            )}

            <Card title={t('drawings')} subtitle={t('drawingsSubtitle')} bodyClass="p-0">
                {drawings.length === 0 ? <Empty>{t('noDrawings')}</Empty> : (
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>#</th><th className={th}>{t('status')}</th><th className={thR}>{t('amount')}</th><th className={th}>{t('documents')}</th><th className={th}>{t('loan')}</th><th className={th}></th></tr></thead>
                        <tbody className="divide-y divide-[#F0F2F5]">
                            {drawings.map((d) => (
                                <tr key={d.id}>
                                    <td className={td}>{d.sequence}</td>
                                    <td className={td}><StatusBadge status={d.status} />{d.rejectionReason && <div className="text-[11px] text-red-700">{d.rejectionReason}</div>}</td>
                                    <td className={tdR}><MoneyCell value={d.amount} currency={ccy} strong /></td>
                                    <td className={td}>{d.documentsReference}</td>
                                    <td className={td}>{d.loan ? <Link className="font-semibold text-[#635BFF] hover:underline" href={href(`/lending/loans/${d.loan.id}`)}>{d.loan.reference}</Link> : '—'}</td>
                                    <td className={`${td} whitespace-nowrap`}>
                                        <div className="flex justify-end gap-1.5">
                                            {d.status === 'REQUESTED' && canApproveDrawing(d) && <Btn size="sm" variant="primary" onClick={() => approveDrawing(d)} busy={busy === `approve-${d.id}`}>{t('approve')}</Btn>}
                                            {d.status === 'APPROVED' && canPayDrawing(d) && <Btn size="sm" variant="primary" onClick={() => open({ kind: 'pay', drawing: d })}>{t('payEllipsis')}</Btn>}
                                            {['REQUESTED', 'APPROVED'].includes(d.status) && canApproveDrawing(d) && <Btn size="sm" variant="danger" onClick={() => open({ kind: 'rejectDrawing', drawing: d })}>{t('refuse')}</Btn>}
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
