"use client";

import { useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
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
    const href = useLendingHref();
    const confirm = useConfirm();
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

    if (!view.data) return <LendingShell title="Letter of credit" back={{ href: '/lending/trade', label: 'Trade finance' }}>{view.error ? <ErrorBox error={view.error} /> : <Spinner />}</LendingShell>;
    const { letterOfCredit: lc, drawings, undrawn } = view.data;
    const ccy = lc.currency;
    const open = (p: Panel) => { setPanel(p); setText(''); setAmount(''); clearError(); };
    const done = (m: string) => { setMsg(m); setPanel(null); view.reload(); };
    const live = ['ISSUED', 'PARTIALLY_DRAWN'].includes(lc.status);

    const issue = async () => {
        if (!(await confirm({ title: 'Issue letter of credit', message: `Issue ${lc.reference} for ${ccy} ${lc.amount} to ${lc.beneficiaryName}? The fee is charged and the commitment recorded off balance sheet.`, confirmLabel: 'Issue' }))) return;
        const res = await run('issue', () => api.post(`/lending/letters-of-credit/${id}/issue`, {}, idem(issueKey.keyFor({ id }))));
        if (res) { issueKey.reset(); done('Letter of credit issued'); }
    };
    const approveDrawing = async (d: LcDrawing) => {
        if (!(await confirm({ title: 'Approve drawing', message: `Approve paying ${ccy} ${d.amount} to ${lc.beneficiaryName} against ${d.documentsReference}?`, confirmLabel: 'Approve' }))) return;
        const res = await run(`approve-${d.id}`, () => api.post(`/lending/letters-of-credit/${id}/drawings/${d.id}/approve`));
        if (res) done(`Drawing #${d.sequence} approved — ready to pay`);
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
        if (res) done('Done');
    };

    return (
        <LendingShell
            title={`Letter of credit ${lc.reference}`}
            subtitle={`${lc.beneficiaryName}${lc.beneficiaryBank ? ` · ${lc.beneficiaryBank}` : ''}`}
            back={{ href: '/lending/trade', label: 'Trade finance' }}
            actions={
                <>
                    {lc.status === 'REQUESTED' && <><Btn variant="primary" onClick={issue} busy={busy === 'issue'}>Issue…</Btn><Btn variant="danger" onClick={() => open({ kind: 'reject' })}>Reject</Btn></>}
                    {live && <><Btn variant="primary" onClick={() => open({ kind: 'drawing' })}>Record presentation</Btn><Btn onClick={() => open({ kind: 'close' })}>Expire / cancel</Btn></>}
                </>
            }
        >
            {msg && <Notice tone="success">{msg}</Notice>}
            {!panel && <ErrorBox error={error} onDismiss={clearError} />}
            <Card title="Credit">
                <KV
                    cols={4}
                    items={[
                        ['Status', <StatusBadge key="s" status={lc.status} />],
                        ['Amount', <Money key="a" value={lc.amount} currency={ccy} />],
                        ['Drawn', <Money key="d" value={lc.drawnAmount} currency={ccy} />],
                        ['Undrawn (contingent)', <Money key="u" value={undrawn} currency={ccy} />],
                        ['Issued / requested on', lc.issueDate],
                        ['Expiry', lc.expiryDate],
                        ['Fee', <span key="f"><Money value={lc.feeAmount} currency={ccy} />{lc.terms.feePreview && <span className="block text-[11px] text-[#697386]">{lc.terms.feePreview.explanation}</span>}</span>],
                        ['Converts into', lc.terms.conversion ? `${lc.terms.conversion.productCode}, ${lc.terms.conversion.numberOfInstalments} instalments` : '—'],
                    ]}
                />
                {lc.rejectionReason && <div className="mt-3"><Notice tone="danger" title="Rejected">{lc.rejectionReason}</Notice></div>}
                {lc.closeReason && <div className="mt-3"><Notice title="Closed">{lc.closeReason}</Notice></div>}
            </Card>

            {panel && (
                <ActionPanel
                    title={{ reject: 'Reject the request', close: 'Expire or cancel', drawing: 'Record a presentation', rejectDrawing: 'Refuse the drawing', pay: 'Pay the beneficiary and convert to a loan' }[panel.kind]}
                    onClose={() => setPanel(null)}
                >
                    {panel.kind === 'drawing' && <Field label={`Amount (${ccy})`} hint={`Up to ${undrawn}`}><TextInput value={amount} onChange={setAmount} inputMode="decimal" className="max-w-xs" /></Field>}
                    {panel.kind === 'close' && <Field label="Action"><SelectInput value={action} onChange={(v) => setAction(v as 'CANCEL' | 'EXPIRE')} options={[{ value: 'CANCEL', label: 'Cancel (beneficiary agreed)' }, { value: 'EXPIRE', label: 'Expire (past expiry date)' }]} className="max-w-xs" /></Field>}
                    {panel.kind === 'pay' && <p className="text-[12px]">Pays <Money value={panel.drawing.amount} currency={ccy} /> to {lc.beneficiaryName} and books it as the importer&apos;s loan over {panel.drawing.numberOfInstalments} instalments.</p>}
                    <Field label={{ reject: 'Reason', close: 'Reason', drawing: 'Documents reference', rejectDrawing: 'Reason', pay: 'Payment reference' }[panel.kind]}>
                        {panel.kind === 'drawing' || panel.kind === 'pay' ? <TextInput value={text} onChange={setText} maxLength={120} /> : <TextArea value={text} onChange={setText} rows={2} maxLength={500} />}
                    </Field>
                    <ErrorBox error={error} onDismiss={clearError} />
                    <Btn variant={panel.kind === 'reject' || panel.kind === 'rejectDrawing' ? 'danger' : 'primary'} onClick={submit} busy={busy === 'p'}>Confirm</Btn>
                </ActionPanel>
            )}

            <Card title="Drawings" subtitle="Maker-checker: whoever recorded a presentation cannot approve or pay it." bodyClass="p-0">
                {drawings.length === 0 ? <Empty>No presentations yet.</Empty> : (
                    <Table>
                        <thead><tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]"><th className={th}>#</th><th className={th}>Status</th><th className={thR}>Amount</th><th className={th}>Documents</th><th className={th}>Loan</th><th className={th}></th></tr></thead>
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
                                            {d.status === 'REQUESTED' && <Btn size="sm" variant="primary" onClick={() => approveDrawing(d)} busy={busy === `approve-${d.id}`}>Approve</Btn>}
                                            {d.status === 'APPROVED' && <Btn size="sm" variant="primary" onClick={() => open({ kind: 'pay', drawing: d })}>Pay…</Btn>}
                                            {['REQUESTED', 'APPROVED'].includes(d.status) && <Btn size="sm" variant="danger" onClick={() => open({ kind: 'rejectDrawing', drawing: d })}>Refuse</Btn>}
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
