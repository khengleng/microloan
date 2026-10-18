"use client";

import { type ReactNode, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useWorkspace } from '@/lib/workspace';
import { Person } from '../People';
import { useMyId } from '../access/common';
import { useLendingHref } from '../LendingShell';
import { ActionPanel, Btn, Card, Empty, ErrorBox, Field, Table, TextArea, TextInput, td, tdR, th, thR } from '../ui';
import { idem, useAction, useIdempotencyKey } from '../useAsync';
import { fmtDateTime } from '../format';
import { Money, MoneyCell } from '../MoneyCell';
import { StatusBadge } from '../StatusBadge';
import type { Drawdown } from './types';

type Pending = { kind: 'reject' | 'release'; drawdown: Drawdown };

const who = (id: string | null | undefined) => (id ? <Person id={id} className="text-[12px]" /> : '—');

/**
 * Drawdown history and the maker-checker lifecycle:
 * REQUESTED → APPROVED → RELEASED (money out), or REJECTED / CANCELLED.
 */
export function DrawdownsCard({ facilityId, loanAccountId, drawdowns, actions, onDone }: {
    facilityId: string; loanAccountId: string; drawdowns: Drawdown[]; actions?: ReactNode; onDone: (msg: string) => void;
}) {
    const href = useLendingHref();
    const confirm = useConfirm();
    const { busy, error, run, clearError } = useAction();
    const releaseKey = useIdempotencyKey();
    const [pending, setPending] = useState<Pending | null>(null);
    // Buttons follow the server's rules: the permission, and never the requester deciding their own.
    const { can } = useWorkspace();
    const me = useMyId();
    const mine = (d: Drawdown) => !!me && d.requestedBy === me;
    const canApprove = (d: Drawdown) => can('facility.drawdown.approve') && !mine(d);
    const canRelease = (d: Drawdown) => can('facility.drawdown.release') && !mine(d);
    const [text, setText] = useState('');
    const [problem, setProblem] = useState('');

    const base = `/lending/facilities/${facilityId}/drawdowns`;
    const open = (p: Pending) => { setPending(p); setText(''); setProblem(''); clearError(); };
    const close = () => { setPending(null); setText(''); setProblem(''); };

    const approve = async (d: Drawdown) => {
        const ok = await confirm({
            title: 'Approve drawdown',
            message: `Approve drawdown #${d.sequence} for ${d.currency} ${d.amount}? The limit is re-checked now and again at release.`,
            confirmLabel: 'Approve',
        });
        if (!ok) return;
        const res = await run(`approve-${d.id}`, () => api.post(`${base}/${d.id}/approve`));
        if (res) onDone(`Drawdown #${d.sequence} approved — ready to release`);
    };

    const cancel = async (d: Drawdown) => {
        const ok = await confirm({
            title: 'Cancel drawdown request',
            message: `Cancel drawdown request #${d.sequence} for ${d.currency} ${d.amount}?`,
            confirmLabel: 'Cancel request',
            cancelLabel: 'Keep it',
            variant: 'danger',
        });
        if (!ok) return;
        const res = await run(`cancel-${d.id}`, () => api.post(`${base}/${d.id}/cancel`));
        if (res) onDone(`Drawdown request #${d.sequence} cancelled`);
    };

    const submitPending = async () => {
        if (!pending) return;
        const d = pending.drawdown;
        const value = text.trim();
        if (pending.kind === 'reject') {
            if (!value) { setProblem('Give a reason for rejecting the drawdown.'); return; }
            setProblem('');
            const res = await run(`reject-${d.id}`, () => api.post(`${base}/${d.id}/reject`, { reason: value }));
            if (res) { close(); onDone(`Drawdown #${d.sequence} rejected`); }
            return;
        }
        if (!value) { setProblem('Record the bank or cash reference of the payout.'); return; }
        setProblem('');
        const ok = await confirm({
            title: 'Release drawdown',
            message: `Pay out ${d.currency} ${d.amount}? This posts a disbursement on the facility's loan account and cannot be undone except by reversal.`,
            confirmLabel: 'Release funds',
        });
        if (!ok) return;
        const body = { externalReference: value };
        const key = releaseKey.keyFor({ id: d.id, ...body });
        const res = await run(`release-${d.id}`, () => api.post(`${base}/${d.id}/release`, body, idem(key)));
        if (res) {
            releaseKey.reset();
            close();
            onDone(`Drawdown #${d.sequence} released — ${d.currency} ${d.amount} paid out`);
        }
    };

    return (
        <Card
            title="Drawdowns"
            subtitle="Maker-checker: the officer who requested a drawdown cannot approve or release it. Newest first."
            actions={actions}
            bodyClass="p-0"
        >
            {pending && (
                <div className="p-4 border-b border-[#E3E8EE]">
                    <ActionPanel
                        title={pending.kind === 'reject' ? `Reject drawdown #${pending.drawdown.sequence}` : `Release drawdown #${pending.drawdown.sequence}`}
                        onClose={close}
                    >
                        <p className="text-[12px] text-[#3C4257]">
                            <Money value={pending.drawdown.amount} currency={pending.drawdown.currency} /> · value date {pending.drawdown.valueDate ?? '—'}
                            {pending.drawdown.trancheCode && <> · tranche <span className="font-mono">{pending.drawdown.trancheCode}</span></>}
                            {' '}· requested by {who(pending.drawdown.requestedBy)}
                            {pending.drawdown.approvedBy && <> · approved by {who(pending.drawdown.approvedBy)}</>}
                        </p>
                        {pending.kind === 'reject' ? (
                            <Field label="Reason" error={problem || undefined}>
                                <TextArea value={text} onChange={setText} maxLength={500} rows={2} />
                            </Field>
                        ) : (
                            <Field label="External reference" hint="Bank transfer or cash voucher reference of the payout" error={problem || undefined}>
                                <TextInput value={text} onChange={setText} maxLength={120} className="max-w-sm" />
                            </Field>
                        )}
                        <ErrorBox error={error} onDismiss={clearError} />
                        <Btn
                            variant={pending.kind === 'reject' ? 'danger' : 'primary'}
                            onClick={submitPending}
                            busy={busy === `${pending.kind}-${pending.drawdown.id}`}
                        >
                            {pending.kind === 'reject' ? 'Reject drawdown' : 'Release funds'}
                        </Btn>
                    </ActionPanel>
                </div>
            )}
            {!pending && error && <div className="p-4 border-b border-[#E3E8EE]"><ErrorBox error={error} onDismiss={clearError} /></div>}

            {drawdowns.length === 0 ? <Empty>No drawdowns yet.</Empty> : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>#</th>
                            <th className={th}>Status</th>
                            <th className={thR}>Amount</th>
                            <th className={th}>Value date</th>
                            <th className={th}>Tranche</th>
                            <th className={th}>Purpose</th>
                            <th className={th}>Requested</th>
                            <th className={th}>Decided / released</th>
                            <th className={th}></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F0F2F5]">
                        {drawdowns.map((d) => (
                            <tr key={d.id} className={d.status === 'REQUESTED' || d.status === 'APPROVED' ? 'bg-[#F8F9FF]' : ''}>
                                <td className={td}>{d.sequence}</td>
                                <td className={td}><StatusBadge status={d.status} /></td>
                                <td className={tdR}><MoneyCell value={d.amount} currency={d.currency} strong /></td>
                                <td className={`${td} whitespace-nowrap`}>{d.valueDate ?? '—'}</td>
                                <td className={td}>{d.trancheCode ? <span className="font-mono text-[12px]">{d.trancheCode}</span> : '—'}</td>
                                <td className={`${td} max-w-[220px]`}>{d.purpose || '—'}</td>
                                <td className={`${td} whitespace-nowrap`}>
                                    {who(d.requestedBy)}
                                    <div className="text-[11px] text-[#697386]">{fmtDateTime(d.createdAt)}</div>
                                </td>
                                <td className={`${td} whitespace-nowrap text-[12px]`}>
                                    {d.approvedBy && <div>Approved by {who(d.approvedBy)} <span className="text-[11px] text-[#697386]">{fmtDateTime(d.approvedAt)}</span></div>}
                                    {d.releasedBy && <div>Released by {who(d.releasedBy)} <span className="text-[11px] text-[#697386]">{fmtDateTime(d.releasedAt)}</span></div>}
                                    {d.rejectedBy && <div>Rejected by {who(d.rejectedBy)} <span className="text-[11px] text-[#697386]">{fmtDateTime(d.rejectedAt)}</span></div>}
                                    {d.rejectionReason && <div className="text-[11px] text-red-700 whitespace-normal max-w-[240px]">{d.rejectionReason}</div>}
                                    {!d.approvedBy && !d.releasedBy && !d.rejectedBy && '—'}
                                </td>
                                <td className={`${td} whitespace-nowrap`}>
                                    <div className="flex flex-wrap justify-end gap-1.5">
                                        {d.status === 'REQUESTED' && (
                                            <>
                                                {canApprove(d) && <Btn size="sm" variant="primary" onClick={() => approve(d)} busy={busy === `approve-${d.id}`}>Approve</Btn>}
                                                {canApprove(d) && <Btn size="sm" variant="danger" onClick={() => open({ kind: 'reject', drawdown: d })}>Reject</Btn>}
                                                {can('facility.drawdown.request') && <Btn size="sm" variant="ghost" onClick={() => cancel(d)} busy={busy === `cancel-${d.id}`}>Cancel</Btn>}
                                            </>
                                        )}
                                        {d.status === 'APPROVED' && canRelease(d) && (
                                            <Btn size="sm" variant="primary" onClick={() => open({ kind: 'release', drawdown: d })}>Release…</Btn>
                                        )}
                                        {d.status === 'RELEASED' && d.eventId && (
                                            <Link href={href(`/lending/loans/${loanAccountId}`)} className="text-[12px] font-semibold text-[#635BFF] hover:underline" title={`Disbursement event ${d.eventId}`}>
                                                Ledger event →
                                            </Link>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
        </Card>
    );
}
