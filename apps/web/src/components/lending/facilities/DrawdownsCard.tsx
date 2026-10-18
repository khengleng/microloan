"use client";

import { type ReactNode, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
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
    const t = useTranslations('LendingFacilities.drawdowns');
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
            title: t('confirmApprove.title'),
            message: t('confirmApprove.message', { seq: d.sequence, currency: d.currency, amount: d.amount }),
            confirmLabel: t('actions.approve'),
        });
        if (!ok) return;
        const res = await run(`approve-${d.id}`, () => api.post(`${base}/${d.id}/approve`));
        if (res) onDone(t('toast.approved', { seq: d.sequence }));
    };

    const cancel = async (d: Drawdown) => {
        const ok = await confirm({
            title: t('confirmCancel.title'),
            message: t('confirmCancel.message', { seq: d.sequence, currency: d.currency, amount: d.amount }),
            confirmLabel: t('confirmCancel.confirm'),
            cancelLabel: t('confirmCancel.keep'),
            variant: 'danger',
        });
        if (!ok) return;
        const res = await run(`cancel-${d.id}`, () => api.post(`${base}/${d.id}/cancel`));
        if (res) onDone(t('toast.cancelled', { seq: d.sequence }));
    };

    const submitPending = async () => {
        if (!pending) return;
        const d = pending.drawdown;
        const value = text.trim();
        if (pending.kind === 'reject') {
            if (!value) { setProblem(t('problems.reasonRequired')); return; }
            setProblem('');
            const res = await run(`reject-${d.id}`, () => api.post(`${base}/${d.id}/reject`, { reason: value }));
            if (res) { close(); onDone(t('toast.rejected', { seq: d.sequence })); }
            return;
        }
        if (!value) { setProblem(t('problems.referenceRequired')); return; }
        setProblem('');
        const ok = await confirm({
            title: t('confirmRelease.title'),
            message: t('confirmRelease.message', { currency: d.currency, amount: d.amount }),
            confirmLabel: t('actions.releaseFunds'),
        });
        if (!ok) return;
        const body = { externalReference: value };
        const key = releaseKey.keyFor({ id: d.id, ...body });
        const res = await run(`release-${d.id}`, () => api.post(`${base}/${d.id}/release`, body, idem(key)));
        if (res) {
            releaseKey.reset();
            close();
            onDone(t('toast.released', { seq: d.sequence, currency: d.currency, amount: d.amount }));
        }
    };

    return (
        <Card
            title={t('title')}
            subtitle={t('subtitle')}
            actions={actions}
            bodyClass="p-0"
        >
            {pending && (
                <div className="p-4 border-b border-[#E3E8EE]">
                    <ActionPanel
                        title={pending.kind === 'reject' ? t('panel.rejectTitle', { seq: pending.drawdown.sequence }) : t('panel.releaseTitle', { seq: pending.drawdown.sequence })}
                        onClose={close}
                    >
                        <p className="text-[12px] text-[#3C4257]">
                            <Money value={pending.drawdown.amount} currency={pending.drawdown.currency} /> {t('panel.valueDate', { date: pending.drawdown.valueDate ?? '—' })}
                            {pending.drawdown.trancheCode && <> {t.rich('panel.tranche', { code: pending.drawdown.trancheCode, mono: (c) => <span className="font-mono">{c}</span> })}</>}
                            {' '}{t.rich('panel.requestedBy', { who: () => who(pending.drawdown.requestedBy) })}
                            {pending.drawdown.approvedBy && <> {t.rich('panel.approvedBy', { who: () => who(pending.drawdown.approvedBy) })}</>}
                        </p>
                        {pending.kind === 'reject' ? (
                            <Field label={t('fields.reason')} error={problem || undefined}>
                                <TextArea value={text} onChange={setText} maxLength={500} rows={2} />
                            </Field>
                        ) : (
                            <Field label={t('fields.externalReference')} hint={t('fields.externalReferenceHint')} error={problem || undefined}>
                                <TextInput value={text} onChange={setText} maxLength={120} className="max-w-sm" />
                            </Field>
                        )}
                        <ErrorBox error={error} onDismiss={clearError} />
                        <Btn
                            variant={pending.kind === 'reject' ? 'danger' : 'primary'}
                            onClick={submitPending}
                            busy={busy === `${pending.kind}-${pending.drawdown.id}`}
                        >
                            {pending.kind === 'reject' ? t('actions.rejectDrawdown') : t('actions.releaseFunds')}
                        </Btn>
                    </ActionPanel>
                </div>
            )}
            {!pending && error && <div className="p-4 border-b border-[#E3E8EE]"><ErrorBox error={error} onDismiss={clearError} /></div>}

            {drawdowns.length === 0 ? <Empty>{t('empty')}</Empty> : (
                <Table>
                    <thead>
                        <tr className="border-b border-[#E3E8EE] bg-[#F7FAFC]">
                            <th className={th}>#</th>
                            <th className={th}>{t('columns.status')}</th>
                            <th className={thR}>{t('columns.amount')}</th>
                            <th className={th}>{t('columns.valueDate')}</th>
                            <th className={th}>{t('columns.tranche')}</th>
                            <th className={th}>{t('columns.purpose')}</th>
                            <th className={th}>{t('columns.requested')}</th>
                            <th className={th}>{t('columns.decided')}</th>
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
                                    {d.approvedBy && <div>{t.rich('approvedBy', { who: () => who(d.approvedBy) })} <span className="text-[11px] text-[#697386]">{fmtDateTime(d.approvedAt)}</span></div>}
                                    {d.releasedBy && <div>{t.rich('releasedBy', { who: () => who(d.releasedBy) })} <span className="text-[11px] text-[#697386]">{fmtDateTime(d.releasedAt)}</span></div>}
                                    {d.rejectedBy && <div>{t.rich('rejectedBy', { who: () => who(d.rejectedBy) })} <span className="text-[11px] text-[#697386]">{fmtDateTime(d.rejectedAt)}</span></div>}
                                    {d.rejectionReason && <div className="text-[11px] text-red-700 whitespace-normal max-w-[240px]">{d.rejectionReason}</div>}
                                    {!d.approvedBy && !d.releasedBy && !d.rejectedBy && '—'}
                                </td>
                                <td className={`${td} whitespace-nowrap`}>
                                    <div className="flex flex-wrap justify-end gap-1.5">
                                        {d.status === 'REQUESTED' && (
                                            <>
                                                {canApprove(d) && <Btn size="sm" variant="primary" onClick={() => approve(d)} busy={busy === `approve-${d.id}`}>{t('actions.approve')}</Btn>}
                                                {canApprove(d) && <Btn size="sm" variant="danger" onClick={() => open({ kind: 'reject', drawdown: d })}>{t('actions.reject')}</Btn>}
                                                {can('facility.drawdown.request') && <Btn size="sm" variant="ghost" onClick={() => cancel(d)} busy={busy === `cancel-${d.id}`}>{t('actions.cancel')}</Btn>}
                                            </>
                                        )}
                                        {d.status === 'APPROVED' && canRelease(d) && (
                                            <Btn size="sm" variant="primary" onClick={() => open({ kind: 'release', drawdown: d })}>{t('actions.release')}</Btn>
                                        )}
                                        {d.status === 'RELEASED' && d.eventId && (
                                            <Link href={href(`/lending/loans/${loanAccountId}`)} className="text-[12px] font-semibold text-[#635BFF] hover:underline" title={t('disbursementEvent', { id: d.eventId })}>
                                                {t('ledgerEvent')}
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
